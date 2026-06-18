// Линейная оркестрация пайплайна сцены (спека: executor как идеи, не граф).
// ПП2-цепочка: [Архитектор] → Прозаик ⇄ Оценщик (петля).
// Каждый агент включаем/отключаем; всё пишется в диагностический трейс.

import { callLLM } from './llm.js';
import { buildSceneContext, bookContextBlock } from './context.js';
import { architectMessages, parseArchitect, architectToText,
         evaluatorMessages, parseEvaluator } from './agents.js';
import { voiceGuardMessages, logicGuardMessages, eventsGuardMessages,
         lineEditMessages, runGuardParse, customGuardMessages, surgicalReviseMessages,
         styleGuardMessages } from './guards.js';
import { startRun, logStep, endRun, agentEnabled } from './diagnostics.js';

let _running = false; // защита от конкурентного прогона (переключение сцены и т.п.)

// Конфиг агента по роли ИЛИ id (для кастомных). Настраивается ползунками.
function ag(state, role){ return (state.agents||[]).find(a=>a.role===role || a.id===role) || {}; }
function manual(state, role){ return ag(state, role).manual === true; }

// Пауза на подтверждение в ручном режиме. Возвращает {approve, note, text}.
// extra может нести {draft, editable} — тогда автор правит текст прямо в окне.
async function gate(state, role, label, output, opts, extra={}){
  if(!manual(state, role) || !opts.onApproval) return { approve:true };
  return await opts.onApproval({ role, label, output, ...extra });
}
function formatVerdict(v){
  if(!v || !v.ok) return 'Оценщик не вернул оценку.';
  const lines = Object.entries(v.scores||{}).map(([k,val])=>`${k}: ${val}`);
  return `Средневзвешенное: ${v.weighted}/10 (мин. ось ${v.minAxis})\n` +
    lines.join('  ·  ') +
    (v.cliches&&v.cliches.length?`\n\nКлише: ${v.cliches.join('; ')}`:'') +
    (v.notes&&v.notes.length?`\n\nЗамечания:\n– ${v.notes.join('\n– ')}`:'');
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
    let prevDraft = '';
    let iter = 0, safety = 0;

    while(iter < maxIter && safety++ < 20){
      iter++;
      // На доработке (iter>1) — ХИРУРГИЧЕСКАЯ правка прошлого черновика по замечаниям:
      // меняем только нужные фразы, остальное сохраняем дословно (не переписываем всё).
      const isRevision = iter > 1 && prevDraft;
      let streamed = '';
      const streamCb = chunk=>{ streamed+=chunk; onProgress && onProgress({stage:'prose', text:streamed, streaming:true}); };
      let pRes, logInput, logLayers;
      if(isRevision){
        onProgress && onProgress({stage:'prose', text:`Прозаик правит черновик по замечаниям (итерация ${iter})…`});
        const cap = Math.min(4000, Math.max(1400, Math.round(prevDraft.length/2) + 800));
        pRes = await callLLM({ ...llmBase, temperature:0.4, messages: surgicalReviseMessages(prevDraft, directive, state.style?.rules), maxTokens: proseAg.maxTokens ?? cap }, streamCb);
        // защита от усечения: если ответ подозрительно короткий — оставляем прошлый черновик
        if(pRes.text && pRes.text.length < prevDraft.length*0.6) pRes.text = prevDraft;
        logInput = '(хирургическая доработка) ' + (directive||'');
      } else {
        onProgress && onProgress({stage:'prose', text:'Прозаик пишет…'});
        const ctx = buildSceneContext(state, scene, { prevSceneText, architectOutput:architectText, directive, prevDraft:'' });
        pRes = await callLLM({ ...llmBase, temperature: proseAg.temp ?? 0.85, messages:ctx.messages, maxTokens: proseAg.maxTokens ?? 1600 }, streamCb);
        logInput = ctx.messages[1].content; logLayers = ctx.layers;
      }
      prevDraft = pRes.text;
      logStep({ agent:'prose', iter, input:logInput, output:pRes.text,
        layers:logLayers, tokensIn:pRes.tokensIn, tokensOut:pRes.tokensOut, cost:pRes.cost });
      onProgress && onProgress({log:{icon:'✍️', text:isRevision?`Прозаик: черновик ${iter} (точечная правка)`:`Прозаик: черновик ${iter} написан`}});

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
      const eRes = await callLLM({ ...llmBase, temperature:evalAg.temp??0.2, messages:eMsgs, maxTokens:evalAg.maxTokens??700 });
      const verdict = parseEvaluator(eRes.text, threshold);
      logStep({ agent:'evaluator', iter, input:'(черновик)', output:eRes.text, verdict,
        tokensIn:eRes.tokensIn, tokensOut:eRes.tokensOut, cost:eRes.cost });
      onProgress && onProgress({log:{ icon:'⚖️',
        text:`Оценщик: ${verdict.ok?verdict.weighted+'/10':'—'} ${verdict.pass?'✓ принято':'↻ на доработку'}`
          + ((verdict.cliches&&verdict.cliches.length)?` · клише: ${verdict.cliches.join(', ')}`
             : (verdict.notes&&verdict.notes.length?` · ${verdict.notes[0]}`:'')),
        state: verdict.pass?'ok':'warn' }});

      // лучший по баллу вариант
      if(!bestEval || (verdict.ok && verdict.weighted > (bestEval.weighted||0))){ best=pRes.text; bestEval=verdict; }

      // Ручная пауза после Оценщика: автор видит вердикт, может ПОПРАВИТЬ ТЕКСТ руками,
      // принять как есть или вернуть Прозаику на точечную доработку по замечаниям.
      if(manual(state,'evaluator')){
        const gt = await gate(state,'evaluator',`Оценщик · ${verdict.ok?verdict.weighted+'/10':'?'}`, formatVerdict(verdict), opts, {draft:pRes.text, editable:true, verdict});
        if(gt.approve){ best=(gt.text!=null && gt.text.trim())?gt.text.trim():pRes.text; bestEval=verdict; break; }
        if(gt.text!=null && gt.text.trim()){ pRes.text=gt.text.trim(); prevDraft=pRes.text; } // правки автора → база для доработки
        directive = gt.note || [...(verdict.notes||[]), ...((verdict.cliches||[]).length?['убери клише: '+verdict.cliches.join(', ')]:[])].join('; ') || directive;
        continue;
      }

      // Авто-решение: принять, только если прошёл порог И нет клише (либо итерации кончились).
      const hasCliches = (verdict.cliches||[]).length > 0;
      const iterationsLeft = iter < maxIter;
      if(verdict.ok && verdict.pass && !(hasCliches && iterationsLeft)){ break; }
      const fix = [...(verdict.notes||[]), ...(hasCliches?['убери клише: '+verdict.cliches.join(', ')]:[])];
      directive = fix.join('; ') || directive;
    }

    // ── 3. Стражи (параллельно) — только флагуют, не переписывают ──
    const flags = {};
    const guardJobs = [];
    if(agentEnabled('voiceguard')) guardJobs.push(guardJob(state,'voiceguard', llmBase, voiceGuardMessages(scene, best, state.voice?.examples, ag(state,'voiceguard').strictness), flags));
    if(agentEnabled('logic'))      guardJobs.push(guardJob(state,'logic', llmBase, logicGuardMessages(state, scene, best, ag(state,'logic').strictness), flags));
    if(agentEnabled('events'))     guardJobs.push(guardJob(state,'events', llmBase, eventsGuardMessages(state, scene, best, ag(state,'events').strictness), flags));
    if(agentEnabled('styleguard') && (state.style?.rules||[]).filter(Boolean).length)
                                   guardJobs.push(guardJob(state,'styleguard', llmBase, styleGuardMessages(best, state.style.rules, ag(state,'styleguard').strictness), flags));
    // кастомные стражи (добавленные автором)
    (state.agents||[]).filter(a=>a.custom && a.enabled!==false).forEach(a=>{
      guardJobs.push(guardJob(state, a.id, llmBase, customGuardMessages(state, scene, best, a.prompt, a.strictness), flags));
    });
    if(guardJobs.length){
      onProgress && onProgress({stage:'guards', text:'Стражи проверяют сцену…'});
      await Promise.all(guardJobs);
      onProgress && onProgress({log:{icon:'🛡', text:`Стражи: ${Object.values(flags).reduce((a,b)=>a+(b?b.length:0),0)} флагов`}});
      // Ручная пауза: если хоть один Страж в ручном режиме — показать флаги и ждать.
      if(['voiceguard','logic','events','styleguard'].some(r=>agentEnabled(r) && manual(state,r))){
        await gate(state, ['voiceguard','logic','events','styleguard'].find(r=>manual(state,r)), 'Стражи · флаги сцены', flagsText(flags), opts);
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
