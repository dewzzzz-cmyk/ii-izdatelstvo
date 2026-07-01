// Линейная оркестрация пайплайна сцены (спека: executor как идеи, не граф).
// ПП2-цепочка: [Архитектор] → Прозаик ⇄ Оценщик (петля).
// Каждый агент включаем/отключаем; всё пишется в диагностический трейс.

import { callLLM } from './llm.js';
import { buildSceneContext, bookContextBlock } from './context.js';
import { architectMessages, parseArchitect, architectToText,
         evaluatorMessages, parseEvaluator, RUBRIC_AXES } from './agents.js';
import { voiceGuardMessages, logicGuardMessages, eventsGuardMessages,
         lineEditMessages, runGuardParse, customGuardMessages, surgicalReviseMessages,
         parseDebateRevision, styleGuardMessages, readerGuardMessages } from './guards.js';
import { startRun, logStep, endRun, agentEnabled } from './diagnostics.js';

let _running = false; // защита от конкурентного прогона (переключение сцены и т.п.)
export function isRunning(){ return _running; }

// Фактические стражи — бегут каждую итерацию, пока текст ещё меняется (в отличие от
// литературных, которые видят текст только один раз, в конце).
const FACTUAL_GUARD_ROLES = new Set(['logic','events']);

// Конфиг агента по роли ИЛИ id (для кастомных). Настраивается ползунками.
function ag(state, role){ return (state.agents||[]).find(a=>a.role===role || a.id===role) || {}; }
function manual(state, role){ return ag(state, role).manual === true; }

// Пауза на подтверждение в ручном режиме. Возвращает {approve, note, text}.
// extra может нести {draft, editable} — тогда автор правит текст прямо в окне.
async function gate(state, role, label, output, opts, extra={}){
  if(!manual(state, role) || !opts.onApproval) return { approve:true };
  return await opts.onApproval({ role, label, output, ...extra });
}
// Объединённая директива: Прозаик получает всё сразу — оценщик + стражи + запреты.
function buildUnifiedDirective(verdict, allBanned, criticalFlags){
  const parts = [];
  if((verdict.anchors||[]).length) parts.push('СОХРАНИ ДОСЛОВНО (якоря): ' + verdict.anchors.join('; '));
  parts.push(...(verdict.notes||[]));
  if(criticalFlags.length) parts.push('КРИТИЧЕСКИЕ ЗАМЕЧАНИЯ СТРАЖЕЙ:\n' + criticalFlags.join('\n'));
  if(allBanned.length) parts.push('убери клише (все предыдущие итерации): ' + allBanned.join(', '));
  return parts.join('\n\n');
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

    // ── 2+3. Единая петля: Прозаик ⇄ Оценщик + Стражи ──
    // Стражи — часть той же петли, не отдельный цикл.
    // Прозаик получает объединённую директиву (оценщик + стражи вместе) и разбирает всё в [РАЗБОР].
    // Консенсус = Оценщик принял И Стражи молчат.
    const GUARD_LABELS = {voiceguard:'Страж голоса', logic:'Страж логики', events:'Страж событий', styleguard:'Страж стиля', reader:'Читатель'};
    const proseAg = ag(state,'prose'), evalAg = ag(state,'evaluator');
    const threshold = g.evaluatorThreshold ?? 7;
    const maxIter = agentEnabled('evaluator') ? (g.evaluatorMaxIter ?? 3) : 1;
    const hasGuards = agentEnabled('voiceguard') || agentEnabled('logic') || agentEnabled('events') ||
      agentEnabled('reader') ||
      (agentEnabled('styleguard') && (state.style?.rules||[]).filter(Boolean).length) ||
      (state.agents||[]).some(a=>a.custom && a.enabled!==false);
    let best = null, bestEval = null;
    let directive = opts.directive || '';
    let prevDraft = opts.initialDraft || '';
    let iter = 0, safety = 0;
    let flags = {};
    const bannedCliches = new Set();
    let anchorVerdict = null;   // оценки итерации 1 — baseline для стабильности Оценщика
    const scoreHistory = [];    // история scores по итерациям — детектор стагнации осей
    const AXIS_LABELS = Object.fromEntries(RUBRIC_AXES.map(a=>[a.key, a.label]));

    while(iter < maxIter && safety++ < 20){
      iter++;
      const isRevision = !!(iter > 1 && prevDraft || iter === 1 && prevDraft && directive);
      let streamed = '';
      const streamCb = chunk=>{ streamed+=chunk; onProgress && onProgress({stage:'prose', text:streamed, streaming:true}); };
      let pRes, logInput, logLayers;
      if(isRevision){
        onProgress && onProgress({stage:'prose', text:`Прозаик разбирает замечания и правит черновик (итерация ${iter})…`});
        const cap = Math.min(5000, Math.max(2000, Math.round(prevDraft.length/2) + 1400));
        pRes = await callLLM({ ...llmBase, temperature:0.4, messages: surgicalReviseMessages(prevDraft, directive, state.style?.rules), maxTokens: Math.max(proseAg.maxTokens ?? cap, cap) }, streamCb);
        const parsed = parseDebateRevision(pRes.text);
        if(parsed.debate) logStep({ agent:'prose-debate', iter, input:directive, output:parsed.debate, tokensIn:0, tokensOut:0, cost:0 });
        if(parsed.truncated){
          onProgress && onProgress({log:{icon:'⚠️', text:'Прозаик: ответ обрезан токенами (нет секции [ТЕКСТ]) — используем предыдущий черновик', state:'warn'}});
          pRes.text = prevDraft;
        } else if(parsed.prose) pRes.text = parsed.prose;
        if(pRes.text && pRes.text.length < prevDraft.length*0.6) pRes.text = prevDraft;
        logInput = '(разбор замечаний + точечная правка) ' + (directive||'');
      } else {
        onProgress && onProgress({stage:'prose', text:'Прозаик пишет…'});
        const ctx = buildSceneContext(state, scene, { prevSceneText, architectOutput:architectText, directive, prevDraft:'' });
        const sceneWords = scene.targetWords || 700;
        const dynMin = Math.max(2000, Math.round(sceneWords * 2.5));
        const proseMaxTk = proseAg.maxTokens != null ? Math.max(proseAg.maxTokens, dynMin) : dynMin;
        pRes = await callLLM({ ...llmBase, temperature: proseAg.temp ?? 0.85, messages:ctx.messages, maxTokens: proseMaxTk }, streamCb);
        logInput = ctx.messages[1].content; logLayers = ctx.layers;
      }
      prevDraft = pRes.text;
      logStep({ agent:'prose', iter, input:logInput, output:pRes.text,
        layers:logLayers, tokensIn:pRes.tokensIn, tokensOut:pRes.tokensOut, cost:pRes.cost });
      const _budget = (state.global && state.global.budgetTokens) || 32000;
      const _pct = Math.round((pRes.tokensIn||0) / _budget * 100);
      onProgress && onProgress({log:{icon:'✍️', text:isRevision?`Прозаик: черновик ${iter} (разобрал замечания)`:`Прозаик: черновик ${iter} написан · контекст ${pRes.tokensIn||0} / ${_budget} ток. (${_pct}%)`}});
      if(!isRevision && (pRes.tokensIn||0) > _budget * 0.8){
        onProgress && onProgress({log:{icon:'⚠️', text:`Контекст заполнен на ${_pct}% — часть памяти (сводки сцен, глав) могла быть урезана. Увеличьте бюджет в Настройках или свёртывайте старые сцены.`, state:'warn'}});
      }

      // Если Оценщик тоже ручной, его гейт покажет тот же черновик + оценку сразу после —
      // не спрашиваем дважды подряд одно и то же без контекста.
      const evaluatorWillGate = agentEnabled('evaluator') && manual(state,'evaluator');
      if(manual(state,'prose') && !evaluatorWillGate){
        const gt = await gate(state,'prose','Прозаик'+(iter>1?` · итерация ${iter}`:''), '', opts, {draft:pRes.text, editable:true});
        if(!gt.approve){ directive=gt.note||directive; prevDraft=''; iter--; continue; }
        if(gt.text!=null && gt.text.trim()){ pRes.text=gt.text.trim(); prevDraft=pRes.text; }
      }

      if(!agentEnabled('evaluator')){ best=pRes.text; bestEval=null; }
      else {
        onProgress && onProgress({stage:'evaluator', text:'Оценщик судит черновик…'});
        const eMsgs = evaluatorMessages(scene, pRes.text, state.voice?.examples, bookContextBlock(state, scene), state.style?.rules);
        // Anchor-score: передаём baseline итерации 1 чтобы Оценщик не дрейфовал между итерациями
        if(iter > 1 && anchorVerdict?.ok){
          const baseStr = Object.entries(anchorVerdict.scores).map(([k,v])=>`${AXIS_LABELS[k]||k}:${v}`).join(', ');
          eMsgs[1].content += `\n\nИтерация ${iter}. Базовые оценки черновика 1: [${baseStr}]. Оценивай ТЕКУЩИЙ черновик относительно baseline — ось должна расти там где проблема устранена, и падать если добавлена новая.`;
        }
        const eRes = await callLLM({ ...llmBase, temperature:evalAg.temp??0.2, messages:eMsgs, maxTokens:evalAg.maxTokens??900 });
        const verdict = parseEvaluator(eRes.text, threshold);
        if(iter === 1 && verdict.ok) anchorVerdict = verdict;
        if(verdict.ok) scoreHistory.push({...verdict.scores});
        logStep({ agent:'evaluator', iter, input:'(черновик)', output:eRes.text, verdict,
          tokensIn:eRes.tokensIn, tokensOut:eRes.tokensOut, cost:eRes.cost });
        const evalLogExtra = (verdict.anchors?.length?` · ✦ ${verdict.anchors[0]}`:'')
          + (verdict.questions?.length?` · ? ${verdict.questions[0]}`:'');
        const deltaStr = iter > 1 && anchorVerdict?.ok && verdict.ok
          ? ` (Δ${verdict.weighted > anchorVerdict.weighted ? '+' : ''}${(verdict.weighted - anchorVerdict.weighted).toFixed(1)})`
          : '';
        onProgress && onProgress({log:{ icon:'⚖️',
          text:`Оценщик: ${verdict.ok?verdict.weighted+'/10'+deltaStr:'—'} ${verdict.pass?'✓ принято':'↻ на доработку'}`
            + (verdict.cliches?.length?` · клише: ${verdict.cliches.join(', ')}`
               : (verdict.notes?.length?` · ${verdict.notes[0]}`:'')+evalLogExtra),
          state: verdict.pass?'ok':'warn' }});
        if(!bestEval || verdict.ok && verdict.weighted > (bestEval.weighted||0)){ best=pRes.text; bestEval=verdict; }
        (verdict.cliches||[]).forEach(c=>bannedCliches.add(c));
        const allBanned = [...bannedCliches];

        if(manual(state,'evaluator')){
          const gt = await gate(state,'evaluator',`Оценщик · ${verdict.ok?verdict.weighted+'/10':'?'}`, '', opts, {draft:pRes.text, editable:true, verdict});
          if(gt.approve){ best=(gt.text?.trim())||pRes.text; bestEval=verdict; break; }
          if(gt.text?.trim()){ pRes.text=gt.text.trim(); prevDraft=pRes.text; }
          directive = gt.note || buildUnifiedDirective(verdict, allBanned, []) || directive;
          continue;
        }

        // Стражи: фактические (логика, события) — каждую итерацию, пока текст ещё меняется.
        // Литературные (голос, стиль) — только когда оценщик принял ИЛИ последняя итерация.
        const hasCliches = (verdict.cliches||[]).length > 0;
        const evalAccepted = verdict.ok && verdict.pass && !(hasCliches && iter < maxIter);
        const voiceExamples = (state.voice?.examples||[]).filter(Boolean);
        let criticals = [];
        if(hasGuards){
          flags = {};
          const guardJobs = [];
          // Фактические стражи — запускаем на каждой итерации
          if(agentEnabled('logic'))  guardJobs.push(guardJob(state,'logic', llmBase, logicGuardMessages(state, scene, best, ag(state,'logic').strictness), flags));
          if(agentEnabled('events')) guardJobs.push(guardJob(state,'events', llmBase, eventsGuardMessages(state, scene, best, ag(state,'events').strictness), flags));
          // Литературные стражи — только когда текст принят или итерации кончились
          if(evalAccepted || iter >= maxIter){
            if(agentEnabled('voiceguard')){
              if(voiceExamples.length > 0)
                guardJobs.push(guardJob(state,'voiceguard', llmBase, voiceGuardMessages(scene, best, voiceExamples, ag(state,'voiceguard').strictness), flags));
              else
                onProgress && onProgress({log:{icon:'👁', text:'Страж голоса: пропущен — добавьте образцы голоса в настройках «Голос»', state:'warn'}});
            }
            if(agentEnabled('styleguard') && (state.style?.rules||[]).filter(Boolean).length)
              guardJobs.push(guardJob(state,'styleguard', llmBase, styleGuardMessages(best, state.style.rules, ag(state,'styleguard').strictness), flags));
            if(agentEnabled('reader'))
              guardJobs.push(guardJob(state,'reader', llmBase, readerGuardMessages(scene, best, ag(state,'reader').strictness), flags));
            (state.agents||[]).filter(a=>a.custom && a.enabled!==false).forEach(a=>{
              guardJobs.push(guardJob(state, a.id, llmBase, customGuardMessages(state, scene, best, a.prompt, a.strictness), flags));
            });
          }
          if(guardJobs.length){
            onProgress && onProgress({stage:'guards', text:iter>1?`Стражи перепроверяют (итерация ${iter})…`:'Стражи проверяют сцену…'});
            await Promise.all(guardJobs);

            const flagList = Object.entries(flags).flatMap(([role,arr])=>(arr||[]).filter(f=>f.severity!=='ok').map(f=>({role,severity:f.severity,title:f.title,detail:f.detail||''})));
            // Критично — от любого стража. Плюс warning от ФАКТИЧЕСКИХ стражей (логика, события):
            // они одни из немногих, что бегут каждую итерацию, и их предупреждения иначе тонут
            // молча (Прозаик их никогда не видит), пока не эскалируются в critical — обычно уже
            // на последней итерации, когда чинить поздно.
            criticals = Object.entries(flags).flatMap(([role,arr])=>(arr||[])
              .filter(f=>f.severity==='critical' || (f.severity==='warning' && FACTUAL_GUARD_ROLES.has(role)))
              .map(f=>`[${GUARD_LABELS[role]||role}] ${f.title}: ${f.detail||''}`));
            onProgress && onProgress({log:{icon:'🛡',
              text: flagList.length
                ? `Стражи: ${flagList.length} замечаний${criticals.length?` (${criticals.length} крит.)`:''}`
                : 'Стражи: замечаний нет',
              flags:flagList, state: flagList.length?'warn':'ok'}});

            // agentEnabled() матчит только по role — для кастомных стражей (все с role:'custom')
            // это находит не того агента, поэтому здесь читаем enabled/manual напрямую через ag().
            const guardCandidates = ['voiceguard','logic','events','styleguard','reader',
              ...(state.agents||[]).filter(a=>a.custom).map(a=>a.id)];
            const manualGuard = guardCandidates.find(r=>{ const a=ag(state,r); return a.enabled!==false && a.manual===true; });
            if(manualGuard && (evalAccepted || iter >= maxIter)){
              const gt = await gate(state, manualGuard, 'Стражи · флаги сцены', flagsText(flags), opts);
              if(gt.approve) criticals = [];
            }
          }
        }

        // Консенсус: оценщик принял И стражи не нашли критических проблем → готово.
        if(evalAccepted && criticals.length === 0){ break; }

        // Директива строится от лучшего оценщика (bestEval), а не обязательно от текущего verdict.
        // Это важно когда guards запустились на финальной итерации, а best — из более ранней.
        const directiveVerdict = (bestEval && bestEval.weighted > (verdict.weighted||0)) ? bestEval : verdict;
        // Стагнация: если ось не растёт 2 итерации подряд — добавить радикальную инструкцию
        let stagnantNote = '';
        if(scoreHistory.length >= 2){
          const stuck = RUBRIC_AXES.map(a=>a.key).filter(k=>{
            const vals = scoreHistory.map(s=>s[k]||0);
            return vals.length >= 2 && vals[vals.length-1] <= vals[vals.length-2] + 0.5;
          });
          if(stuck.length){
            stagnantNote = '\n\nОСИ БЕЗ ПРОГРЕССА — измени подход РАДИКАЛЬНО, не шлифуй то же самое: ' + stuck.map(k=>AXIS_LABELS[k]||k).join(', ');
            onProgress && onProgress({log:{icon:'⚡', text:`Стагнация осей: ${stuck.map(k=>AXIS_LABELS[k]).join(', ')} — директива усилена`, state:'warn'}});
          }
        }
        // Бан точной фразы не спасает от клише — модель просто перефразирует ту же идею
        // ("сердце в горле" → "кожа на затылке стянулась"). Категорию называет сам
        // Оценщик (clicheCategory) — надёжнее самодельного словаря стемов/ключевых слов.
        const categoryNote = directiveVerdict.clicheCategory
          ? '\n\nИЗБЕГАЙ ЦЕЛОЙ КАТЕГОРИИ (не просто других слов той же идеи): ' + directiveVerdict.clicheCategory + ' — передай тревогу через другой канал: звук, свет, память, деталь обстановки.'
          : '';
        directive = (buildUnifiedDirective(directiveVerdict, allBanned, criticals) || directive) + stagnantNote + categoryNote;
      }
    }
    if(!best) best = prevDraft || '';

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
