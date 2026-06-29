// Линейная оркестрация пайплайна сцены (спека: executor как идеи, не граф).
// ПП2-цепочка: [Архитектор] → Прозаик ⇄ Оценщик (петля).
// Каждый агент включаем/отключаем; всё пишется в диагностический трейс.

import { callLLM } from './llm.js';
import { buildSceneContext, bookContextBlock } from './context.js';
import { architectMessages, parseArchitect, architectToText,
         evaluatorMessages, parseEvaluator } from './agents.js';
import { voiceGuardMessages, logicGuardMessages, eventsGuardMessages,
         lineEditMessages, runGuardParse, customGuardMessages, surgicalReviseMessages,
         parseDebateRevision, styleGuardMessages } from './guards.js';
import { startRun, logStep, endRun, agentEnabled } from './diagnostics.js';

let _running = false; // защита от конкурентного прогона (переключение сцены и т.п.)
export function isRunning(){ return _running; }

// Конфиг агента по роли ИЛИ id (для кастомных). Настраивается ползунками.
function ag(state, role){ return (state.agents||[]).find(a=>a.role===role || a.id===role) || {}; }
function manual(state, role){ return ag(state, role).manual === true; }

// Пауза на подтверждение в ручном режиме. Возвращает {approve, note, text}.
// extra может нести {draft, editable} — тогда автор правит текст прямо в окне.
async function gate(state, role, label, output, opts, extra={}){
  if(!manual(state, role) || !opts.onApproval) return { approve:true };
  return await opts.onApproval({ role, label, output, ...extra });
}
function buildReviseDirective(verdict, allBanned){
  const parts = [];
  if((verdict.anchors||[]).length) parts.push('СОХРАНИ ДОСЛОВНО (якоря): ' + verdict.anchors.join('; '));
  parts.push(...(verdict.notes||[]));
  if(allBanned.length) parts.push('убери клише (все предыдущие итерации): ' + allBanned.join(', '));
  return parts.join('; ');
}
function formatVerdict(v){
  if(!v || !v.ok) return 'Оценщик не вернул оценку.';
  const lines = Object.entries(v.scores||{}).map(([k,val])=>`${k}: ${val}`);
  return `Средневзвешенное: ${v.weighted}/10 (мин. ось ${v.minAxis})\n` +
    lines.join('  ·  ') +
    (v.anchors&&v.anchors.length?`\n\n✦ Якоря (не трогать): ${v.anchors.join('; ')}`:'') +
    (v.cliches&&v.cliches.length?`\n\nКлише: ${v.cliches.join('; ')}`:'') +
    (v.notes&&v.notes.length?`\n\nЗамечания:\n– ${v.notes.join('\n– ')}`:'') +
    (v.questions&&v.questions.length?`\n\n? Вопросы автору:\n– ${v.questions.join('\n– ')}`:'');
}
function flagsText(flags){
  const all=[]; Object.entries(flags).forEach(([role,arr])=>(arr||[]).forEach(f=>all.push(`[${f.severity}] ${f.title}: ${f.detail||''}`)));
  return all.length? all.join('\n') : 'Флагов нет.';
}

// Запустить пайплайн для одной сцены. Возвращает {text, eval, runId}.
// onProgress({stage, text}) — для UI стрима.
export async function runScene(state, scene, opts={}, onProgress){
  if(_running) throw new Error('Уже идёт прогон — дождитесь завершения.');
  _running = true;
  const g = state.global;
  const llmBase = { baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, retries:g.retries };
  const prevSceneText = opts.prevSceneText || prevDoneSceneText(state, scene);
  const runId = startRun(scene.id, 'Сцена: ' + (scene.title||scene.id));

  try {
    // ── 1. Архитектор сцены (опц.) ──
    let architectText = '';
    if(agentEnabled('architect')){
      const ac = ag(state,'architect');
      const aMsgs = architectMessages(state, scene);
      for(let g0=0; g0<6; g0++){
        onProgress && onProgress({stage:'architect', text:'Архитектор планирует сцену…'});
        const aRes = await callLLM({ ...llmBase, temperature:ac.temp??0.4, messages:aMsgs, maxTokens:ac.maxTokens??600 });
        const plan = parseArchitect(aRes.text);
        architectText = architectToText(plan);
        if(plan && plan.presentChars.length) scene.presentChars = plan.presentChars;
        logStep({ agent:'architect', input:aMsgs[1].content, output:aRes.text,
          tokensIn:aRes.tokensIn, tokensOut:aRes.tokensOut, cost:aRes.cost });
        onProgress && onProgress({log:{icon:'🏗', text:'Архитектор: план сцены готов'}});
        const gt = await gate(state,'architect','Архитектор сцены', architectText||aRes.text, opts);
        if(gt.approve) break;
        aMsgs.push({ role:'user', content:'Переделай план сцены. '+(gt.note||'') });
      }
    }

    // ── 2. Прозаик ⇄ Оценщик (петля) ──
    const proseAg = ag(state,'prose'), evalAg = ag(state,'evaluator');
    const threshold = g.evaluatorThreshold ?? 7;
    const maxIter = agentEnabled('evaluator') ? (g.evaluatorMaxIter ?? 3) : 1;
    let best = null, bestEval = null;
    let directive = opts.directive || '';
    let prevDraft = opts.initialDraft || '';
    let iter = 0, safety = 0;
    const bannedCliches = new Set(); // накапливает все клише со всех итераций

    while(iter < maxIter && safety++ < 20){
      iter++;
      // Хирургическая правка: когда есть существующий черновик (передан как initialDraft
      // или получен от предыдущей итерации) — редактируем точечно, не переписываем с нуля.
      const isRevision = !!(iter > 1 && prevDraft || iter === 1 && prevDraft && directive);
      let streamed = '';
      const streamCb = chunk=>{ streamed+=chunk; onProgress && onProgress({stage:'prose', text:streamed, streaming:true}); };
      let pRes, logInput, logLayers;
      if(isRevision){
        onProgress && onProgress({stage:'prose', text:`Прозаик разбирает замечания и правит черновик (итерация ${iter})…`});
        // +1000 токенов сверх прозы — под блок [РАЗБОР] (аргументы принять/отклонить)
        const cap = Math.min(5000, Math.max(2000, Math.round(prevDraft.length/2) + 1400));
        pRes = await callLLM({ ...llmBase, temperature:0.4, messages: surgicalReviseMessages(prevDraft, directive, state.style?.rules), maxTokens: Math.max(proseAg.maxTokens ?? cap, cap) }, streamCb);
        // Разделяем "спор" ([РАЗБОР]) от итогового текста ([ТЕКСТ])
        const { debate, prose } = parseDebateRevision(pRes.text);
        if(debate) logStep({ agent:'prose-debate', iter, input:directive, output:debate, tokensIn:0, tokensOut:0, cost:0 });
        if(prose) pRes.text = prose;
        // защита от усечения: если текст подозрительно короткий — оставляем прошлый черновик
        if(pRes.text && pRes.text.length < prevDraft.length*0.6) pRes.text = prevDraft;
        logInput = '(разбор замечаний + точечная правка) ' + (directive||'');
      } else {
        onProgress && onProgress({stage:'prose', text:'Прозаик пишет…'});
        const ctx = buildSceneContext(state, scene, { prevSceneText, architectOutput:architectText, directive, prevDraft:'' });
        // Кириллица: ~2.5 токена/слово — dynMin обеспечивает минимум для полного текста
        const sceneWords = scene.targetWords || 700;
        const dynMin = Math.max(2000, Math.round(sceneWords * 2.5));
        const proseMaxTk = proseAg.maxTokens != null ? Math.max(proseAg.maxTokens, dynMin) : dynMin;
        pRes = await callLLM({ ...llmBase, temperature: proseAg.temp ?? 0.85, messages:ctx.messages, maxTokens: proseMaxTk }, streamCb);
        logInput = ctx.messages[1].content; logLayers = ctx.layers;
      }
      prevDraft = pRes.text;
      logStep({ agent:'prose', iter, input:logInput, output:pRes.text,
        layers:logLayers, tokensIn:pRes.tokensIn, tokensOut:pRes.tokensOut, cost:pRes.cost });
      onProgress && onProgress({log:{icon:'✍️', text:isRevision?`Прозаик: черновик ${iter} (принял/отклонил замечания)`:`Прозаик: черновик ${iter} написан`}});

      // Ручная пауза после Прозаика: автор может ПОПРАВИТЬ ТЕКСТ руками, принять или вернуть на переписывание.
      if(manual(state,'prose')){
        const gt = await gate(state,'prose','Прозаик'+(iter>1?` · итерация ${iter}`:''), '', opts, {draft:pRes.text, editable:true});
        if(!gt.approve){ directive=gt.note||directive; prevDraft=''; iter--; continue; } // переписать с нуля, не считая итерацию
        if(gt.text!=null && gt.text.trim()){ pRes.text=gt.text.trim(); prevDraft=pRes.text; } // принять с ручными правками
      }

      if(!agentEnabled('evaluator')){ best=pRes.text; bestEval=null; break; }

      // Оценщик
      onProgress && onProgress({stage:'evaluator', text:'Оценщик судит черновик…'});
      const eMsgs = evaluatorMessages(scene, pRes.text, state.voice?.examples, bookContextBlock(state, scene), state.style?.rules);
      const eRes = await callLLM({ ...llmBase, temperature:evalAg.temp??0.2, messages:eMsgs, maxTokens:evalAg.maxTokens??900 });
      const verdict = parseEvaluator(eRes.text, threshold);
      logStep({ agent:'evaluator', iter, input:'(черновик)', output:eRes.text, verdict,
        tokensIn:eRes.tokensIn, tokensOut:eRes.tokensOut, cost:eRes.cost });
      const evalLogExtra = (verdict.anchors&&verdict.anchors.length?` · ✦ ${verdict.anchors[0]}`:'')
        + (verdict.questions&&verdict.questions.length?` · ? ${verdict.questions[0]}`:'');
      onProgress && onProgress({log:{ icon:'⚖️',
        text:`Оценщик: ${verdict.ok?verdict.weighted+'/10':'—'} ${verdict.pass?'✓ принято':'↻ на доработку'}`
          + ((verdict.cliches&&verdict.cliches.length)?` · клише: ${verdict.cliches.join(', ')}`
             : (verdict.notes&&verdict.notes.length?` · ${verdict.notes[0]}`:'')+evalLogExtra),
        state: verdict.pass?'ok':'warn' }});

      // лучший по баллу вариант
      if(!bestEval || (verdict.ok && verdict.weighted > (bestEval.weighted||0))){ best=pRes.text; bestEval=verdict; }

      // Накапливаем все клише со всех итераций — прозаик не должен их повторять
      (verdict.cliches||[]).forEach(c => bannedCliches.add(c));
      const allBanned = [...bannedCliches];

      // Ручная пауза после Оценщика: автор видит вердикт, может ПОПРАВИТЬ ТЕКСТ руками,
      // принять как есть или вернуть Прозаику на точечную доработку по замечаниям.
      if(manual(state,'evaluator')){
        const gt = await gate(state,'evaluator',`Оценщик · ${verdict.ok?verdict.weighted+'/10':'?'}`, formatVerdict(verdict), opts, {draft:pRes.text, editable:true, verdict});
        if(gt.approve){ best=(gt.text!=null && gt.text.trim())?gt.text.trim():pRes.text; bestEval=verdict; break; }
        if(gt.text!=null && gt.text.trim()){ pRes.text=gt.text.trim(); prevDraft=pRes.text; }
        directive = gt.note || buildReviseDirective(verdict, allBanned) || directive;
        continue;
      }

      // Авто-решение: принять, только если прошёл порог И нет клише (либо итерации кончились).
      const hasCliches = (verdict.cliches||[]).length > 0;
      const iterationsLeft = iter < maxIter;
      if(verdict.ok && verdict.pass && !(hasCliches && iterationsLeft)){ break; }
      directive = buildReviseDirective(verdict, allBanned) || directive;
    }

    // ── 3. Стражи → авто-петля правки (critical-флаги → Прозаик → Оценщик → повтор) ──
    const GUARD_LABELS = {voiceguard:'Страж голоса', logic:'Страж логики', events:'Страж событий', styleguard:'Страж стиля'};
    const hasGuards = agentEnabled('voiceguard') || agentEnabled('logic') || agentEnabled('events') ||
      (agentEnabled('styleguard') && (state.style?.rules||[]).filter(Boolean).length) ||
      (state.agents||[]).some(a=>a.custom && a.enabled!==false);
    const maxGuardIter = Math.min(2, g.evaluatorMaxIter ?? 3); // макс. итераций правки по стражам
    let guardFixIter = 0; // сколько раз уже правили по стражам
    let flags = {};

    if(hasGuards){
      let keepLooping = true;
      while(keepLooping){
        // Запускаем всех стражей параллельно
        flags = {};
        const guardJobs = [];
        if(agentEnabled('voiceguard')) guardJobs.push(guardJob(state,'voiceguard', llmBase, voiceGuardMessages(scene, best, state.voice?.examples, ag(state,'voiceguard').strictness), flags));
        if(agentEnabled('logic'))      guardJobs.push(guardJob(state,'logic', llmBase, logicGuardMessages(state, scene, best, ag(state,'logic').strictness), flags));
        if(agentEnabled('events'))     guardJobs.push(guardJob(state,'events', llmBase, eventsGuardMessages(state, scene, best, ag(state,'events').strictness), flags));
        if(agentEnabled('styleguard') && (state.style?.rules||[]).filter(Boolean).length)
          guardJobs.push(guardJob(state,'styleguard', llmBase, styleGuardMessages(best, state.style.rules, ag(state,'styleguard').strictness), flags));
        (state.agents||[]).filter(a=>a.custom && a.enabled!==false).forEach(a=>{
          guardJobs.push(guardJob(state, a.id, llmBase, customGuardMessages(state, scene, best, a.prompt, a.strictness), flags));
        });
        const label = guardFixIter > 0 ? `Стражи перепроверяют (${guardFixIter+1})…` : 'Стражи проверяют сцену…';
        onProgress && onProgress({stage:'guards', text:label});
        await Promise.all(guardJobs);

        // Разделяем на критические (триггер петли) и просто замечания (info)
        const flagList = Object.entries(flags).flatMap(([role,arr])=>(arr||[]).filter(f=>f.severity!=='ok').map(f=>({role,severity:f.severity,title:f.title,detail:f.detail||''})));
        const criticals = Object.entries(flags).flatMap(([role,arr])=>(arr||[]).filter(f=>f.severity==='critical').map(f=>`[${GUARD_LABELS[role]||role}] ${f.title}: ${f.detail||''}`));
        const iterSuffix = guardFixIter > 0 ? ` · пересмотр ${guardFixIter+1}` : '';
        onProgress && onProgress({log:{icon:'🛡',
          text: flagList.length
            ? `Стражи${iterSuffix}: ${flagList.length} замечаний${criticals.length ? ` (${criticals.length} крит.)` : ''}`
            : `Стражи${iterSuffix}: замечаний нет`,
          flags:flagList, state: flagList.length?'warn':'ok'}});

        // Ручная пауза (хотя бы один страж в manual-режиме)
        const manualGuard = ['voiceguard','logic','events','styleguard'].find(r=>agentEnabled(r) && manual(state,r));
        if(manualGuard){
          const gt = await gate(state, manualGuard, 'Стражи · флаги сцены', flagsText(flags), opts);
          if(gt.approve){ keepLooping = false; break; } // автор принял флаги, выходим
        }

        // Нет критических замечаний или исчерпали лимит → выходим
        if(!criticals.length || guardFixIter >= maxGuardIter){ keepLooping = false; break; }
        guardFixIter++;

        // ── 3b. Прозаик исправляет критические флаги (хирургически) ──
        const guardDirective = 'Исправь критические замечания стражей:\n' + criticals.join('\n');
        onProgress && onProgress({stage:'prose', text:`Прозаик исправляет замечания стражей (${guardFixIter})…`});
        let gStreamed = '';
        const gStreamCb = chunk=>{ gStreamed+=chunk; onProgress && onProgress({stage:'prose', text:gStreamed, streaming:true}); };
        const gCap = Math.min(5000, Math.max(2000, Math.round(best.length/2)+1400));
        const gpRes = await callLLM({
          ...llmBase, temperature:0.4,
          messages: surgicalReviseMessages(best, guardDirective, state.style?.rules),
          maxTokens: Math.max(proseAg.maxTokens ?? gCap, gCap)
        }, gStreamCb);
        const { debate:gDebate, prose:gProse } = parseDebateRevision(gpRes.text);
        if(gDebate) logStep({agent:'prose-debate', phase:'guard-fix', iter:guardFixIter, input:guardDirective, output:gDebate, tokensIn:0, tokensOut:0, cost:0});
        const candidateText = gProse && gProse.length > best.length*0.6 ? gProse : best;
        logStep({agent:'prose', phase:'guard-fix', iter:guardFixIter, input:guardDirective, output:gpRes.text, tokensIn:gpRes.tokensIn, tokensOut:gpRes.tokensOut, cost:gpRes.cost});
        onProgress && onProgress({log:{icon:'✍️', text:`Прозаик: правка по стражам (${guardFixIter})`}});

        // ── 3c. Оценщик — гарантия что правка не ухудшила прозу ──
        if(agentEnabled('evaluator')){
          onProgress && onProgress({stage:'evaluator', text:'Оценщик проверяет правку стражей…'});
          const geMsgs = evaluatorMessages(scene, candidateText, state.voice?.examples, bookContextBlock(state, scene), state.style?.rules);
          const geRes = await callLLM({...llmBase, temperature:evalAg.temp??0.2, messages:geMsgs, maxTokens:evalAg.maxTokens??900});
          const gVerdict = parseEvaluator(geRes.text, threshold);
          logStep({agent:'evaluator', phase:'guard-fix', iter:guardFixIter, input:'(правка)', output:geRes.text, verdict:gVerdict, tokensIn:geRes.tokensIn, tokensOut:geRes.tokensOut, cost:geRes.cost});
          const prevScore = bestEval?.weighted ?? 0;
          if(gVerdict.ok && gVerdict.weighted >= prevScore - 1.5){
            // Правка стражей приемлема → берём
            best = candidateText; bestEval = gVerdict;
            onProgress && onProgress({log:{icon:'⚖️', text:`После стражей (${guardFixIter}): ${gVerdict.weighted}/10 ${gVerdict.pass?'✓':'?'}`, state:gVerdict.pass?'ok':'warn'}});
          } else {
            // Откат: правка стражей ухудшила прозу — оставляем лучший черновик
            onProgress && onProgress({log:{icon:'⚠️', text:`Откат: правка стражей снизила оценку (${gVerdict.weighted} < ${prevScore}−1.5) — оставляю лучший черновик прозаика`, state:'warn'}});
            keepLooping = false; // не имеет смысла итерировать дальше
          }
        } else {
          best = candidateText; // оценщик выключен — берём правку без проверки
        }
      }
    }

    // ── 4. Линейный редактор (опц.) — единственный, кто правит текст ──
    if(agentEnabled('lineedit')){
      const leAg = ag(state,'lineedit');
      for(let g0=0; g0<6; g0++){
        onProgress && onProgress({stage:'lineedit', text:'Линейный редактор правит…'});
        try{
          const leRes = await callLLM({ ...llmBase, temperature:leAg.temp??0.3, messages:lineEditMessages(best, state.style?.forbidden), maxTokens:leAg.maxTokens??1600 });
          if(leRes.text && leRes.text.length > best.length*0.5){ // защита от усечённого ответа
            logStep({ agent:'lineedit', input:'(черновик)', output:leRes.text, tokensIn:leRes.tokensIn, tokensOut:leRes.tokensOut, cost:leRes.cost });
            onProgress && onProgress({log:{icon:'✂️', text:'Линейный редактор: текст подчищен'}});
            const gt = await gate(state,'lineedit','Линейный редактор', '', opts, {draft:leRes.text, editable:true});
            if(gt.approve){ best = (gt.text!=null && gt.text.trim())?gt.text.trim():leRes.text; break; }
            // переписать: оставляем прежний best, просим иначе — но без note менять нечего, выходим
            if(!gt.note){ break; }
          } else break;
        }catch(e){ logStep({ agent:'lineedit', output:'[АГЕНТ ПРОВАЛИЛСЯ] '+e.message }); break; }
      }
    }

    const run = endRun('done');
    return { text: best || '', eval: bestEval, flags, runId, run };
  } catch(e){
    logStep({ agent:'error', output: e.message });
    const run = endRun('error');
    throw Object.assign(e, { runId, run });
  } finally {
    _running = false;
  }
}

// Запуск одного Стража с устойчивостью к падению (спека 11: не валим весь прогон).
async function guardJob(state, role, llmBase, messages, flagsOut){
  const a = ag(state, role);
  try{
    const res = await callLLM({ ...llmBase, temperature:a.temp??0.2, messages, maxTokens:a.maxTokens??700 });
    const flags = runGuardParse(res.text);
    flagsOut[role] = flags;
    logStep({ agent:role, input:'(черновик)', output:res.text, flags, tokensIn:res.tokensIn, tokensOut:res.tokensOut, cost:res.cost });
  }catch(e){
    flagsOut[role] = [];
    logStep({ agent:role, output:'[АГЕНТ ПРОВАЛИЛСЯ] '+e.message });
  }
}

function prevDoneSceneText(state, scene){
  const scenes = (state.structure||[]).filter(n=>n.type==='scene');
  const idx = scenes.findIndex(s=>s.id===scene.id);
  for(let i=idx-1; i>=0; i--){ if(scenes[i].text) return scenes[i].text; }
  return '';
}
