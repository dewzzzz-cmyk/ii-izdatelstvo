// Ручной запуск ОДНОГО агента на текущей сцене — по просьбе автора, вне
// полного пайплайна. Возвращает структурированный разбор с замечаниями и
// предложениями правок. Не меняет текст сам (кроме предложения Линейного
// редактора, которое автор применяет вручную).

import { callLLM } from './llm.js';
import { evaluatorMessages, parseEvaluator, architectMessages, parseArchitect } from './agents.js';
import { voiceGuardMessages, logicGuardMessages, eventsGuardMessages,
         customGuardMessages, lineEditMessages, runGuardParse } from './guards.js';

// runAgentOnDemand(state, scene, agent) → { kind, ... }
//   kind:'evaluator' → { verdict }      (оценка по рубрике + клише + замечания)
//   kind:'guard'     → { flags }        (флаги стража)
//   kind:'lineedit'  → { text }         (предложенная правка текста)
//   kind:'architect' → { plan }         (якоря/шаги/запреты)
export async function runAgentOnDemand(state, scene, agent){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ (⚙).');
  const draft = (scene.text||'').trim();
  if(!draft && agent.role!=='architect')
    throw new Error('Сначала напишите или вставьте текст сцены — оценивать нечего.');
  const base = { baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, retries:g.retries };
  const role = agent.role;

  if(role==='evaluator'){
    const msgs = evaluatorMessages(scene, draft, state.voice?.examples);
    const res = await callLLM({ ...base, temperature:agent.temp??0.2, messages:msgs, maxTokens:agent.maxTokens??700 });
    return { kind:'evaluator', verdict: parseEvaluator(res.text, g.evaluatorThreshold ?? 7) };
  }
  if(role==='architect'){
    const msgs = architectMessages(state, scene);
    const res = await callLLM({ ...base, temperature:agent.temp??0.4, messages:msgs, maxTokens:agent.maxTokens??600 });
    return { kind:'architect', plan: parseArchitect(res.text) };
  }
  if(role==='lineedit'){
    const msgs = lineEditMessages(draft, state.style?.forbidden);
    const res = await callLLM({ ...base, temperature:agent.temp??0.3, messages:msgs, maxTokens:agent.maxTokens??1600 });
    return { kind:'lineedit', text:(res.text||'').trim() };
  }
  // стражи (включая кастомных) — только флагуют
  let msgs;
  if(role==='voiceguard')   msgs = voiceGuardMessages(scene, draft, state.voice?.examples, agent.strictness);
  else if(role==='logic')   msgs = logicGuardMessages(state, scene, draft, agent.strictness);
  else if(role==='events')  msgs = eventsGuardMessages(state, scene, draft, agent.strictness);
  else                      msgs = customGuardMessages(state, scene, draft, agent.prompt, agent.strictness);
  const res = await callLLM({ ...base, temperature:agent.temp??0.2, messages:msgs, maxTokens:agent.maxTokens??700 });
  return { kind:'guard', flags: runGuardParse(res.text) };
}
