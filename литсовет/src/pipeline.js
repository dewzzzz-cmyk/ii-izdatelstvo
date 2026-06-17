// Линейная оркестрация пайплайна сцены (спека: executor как идеи, не граф).
// ПП2-цепочка: [Архитектор] → Прозаик ⇄ Оценщик (петля).
// Каждый агент включаем/отключаем; всё пишется в диагностический трейс.

import { callLLM } from './llm.js';
import { buildSceneContext } from './context.js';
import { architectMessages, parseArchitect, architectToText,
         evaluatorMessages, parseEvaluator } from './agents.js';
import { startRun, logStep, endRun, agentEnabled } from './diagnostics.js';

// Запустить пайплайн для одной сцены. Возвращает {text, eval, runId}.
// onProgress({stage, text}) — для UI стрима.
export async function runScene(state, scene, opts={}, onProgress){
  const g = state.global;
  const llmBase = { baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, retries:g.retries };
  const prevSceneText = opts.prevSceneText || prevDoneSceneText(state, scene);
  const runId = startRun(scene.id, 'Сцена: ' + (scene.title||scene.id));

  try {
    // ── 1. Архитектор сцены (опц.) ──
    let architectText = '';
    if(agentEnabled('architect')){
      onProgress && onProgress({stage:'architect', text:'Архитектор планирует сцену…'});
      const aMsgs = architectMessages(state, scene);
      const aRes = await callLLM({ ...llmBase, temperature:0.4, messages:aMsgs, maxTokens:600 });
      const plan = parseArchitect(aRes.text);
      architectText = architectToText(plan);
      if(plan && plan.presentChars.length) scene.presentChars = plan.presentChars;
      logStep({ agent:'architect', input:aMsgs[1].content, output:aRes.text,
        tokensIn:aRes.tokensIn, tokensOut:aRes.tokensOut, cost:aRes.cost });
    }

    // ── 2. Прозаик ⇄ Оценщик (петля) ──
    const threshold = g.evaluatorThreshold ?? 7;
    const maxIter = agentEnabled('evaluator') ? (g.evaluatorMaxIter ?? 3) : 1;
    let best = null, bestEval = null;
    let directive = opts.directive || '';
    let prevDraft = '';

    for(let iter=1; iter<=maxIter; iter++){
      onProgress && onProgress({stage:'prose', text:`Прозаик пишет${iter>1?` (итерация ${iter})`:''}…`});
      // На доработке (iter>1) даём Прозаику прошлый черновик + замечания, температура ниже (точечная правка).
      const isRevision = iter > 1 && prevDraft;
      const ctx = buildSceneContext(state, scene, {
        prevSceneText, architectOutput:architectText, directive,
        prevDraft: isRevision ? prevDraft : '',
      });
      let streamed = '';
      const pRes = await callLLM({ ...llmBase, temperature: isRevision?0.7:0.85, messages:ctx.messages, maxTokens:1600 },
        chunk=>{ streamed+=chunk; onProgress && onProgress({stage:'prose', text:streamed, streaming:true}); });
      prevDraft = pRes.text;
      logStep({ agent:'prose', iter, input:ctx.messages[1].content, output:pRes.text,
        layers:ctx.layers, tokensIn:pRes.tokensIn, tokensOut:pRes.tokensOut, cost:pRes.cost });

      if(!agentEnabled('evaluator')){ best=pRes.text; bestEval=null; break; }

      // Оценщик
      onProgress && onProgress({stage:'evaluator', text:'Оценщик судит черновик…'});
      const eMsgs = evaluatorMessages(scene, pRes.text, state.voice?.examples);
      const eRes = await callLLM({ ...llmBase, temperature:0.2, messages:eMsgs, maxTokens:700 });
      const verdict = parseEvaluator(eRes.text, threshold);
      logStep({ agent:'evaluator', iter, input:'(черновик)', output:eRes.text, verdict,
        tokensIn:eRes.tokensIn, tokensOut:eRes.tokensOut, cost:eRes.cost });

      // лучший по баллу вариант
      if(!bestEval || (verdict.ok && verdict.weighted > (bestEval.weighted||0))){ best=pRes.text; bestEval=verdict; }
      // Принять можно, только если прошёл порог И Оценщик не нашёл клише (либо итерации кончились).
      // Иначе анти-клише замечания остались бы справкой, а не действием.
      const hasCliches = (verdict.cliches||[]).length > 0;
      const iterationsLeft = iter < maxIter;
      if(verdict.ok && verdict.pass && !(hasCliches && iterationsLeft)){ break; }
      // обратная связь Прозаику (замечания + явный список клише)
      const fix = [...(verdict.notes||[]), ...(hasCliches?['убери клише: '+verdict.cliches.join(', ')]:[])];
      directive = fix.join('; ') || directive;
    }

    const run = endRun('done');
    return { text: best || '', eval: bestEval, runId, run };
  } catch(e){
    logStep({ agent:'error', output: e.message });
    const run = endRun('error');
    throw Object.assign(e, { runId, run });
  }
}

function prevDoneSceneText(state, scene){
  const scenes = (state.structure||[]).filter(n=>n.type==='scene');
  const idx = scenes.findIndex(s=>s.id===scene.id);
  for(let i=idx-1; i>=0; i--){ if(scenes[i].text) return scenes[i].text; }
  return '';
}
