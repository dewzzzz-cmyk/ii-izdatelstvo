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

// Точечная правка: внести ТОЛЬКО одно замечание в текущий текст сцены,
// не переписывая остальное и не запуская цикл агентов. Возвращает весь текст.
export async function patchScene(state, scene, instruction){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ (⚙).');
  const draft = (scene.text||'').trim();
  if(!draft) throw new Error('Нет текста сцены.');
  if(!instruction || !instruction.trim()) throw new Error('Пустое замечание.');
  const base = { baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, retries:g.retries };
  const sys = [
    'Ты — редактор-хирург. Тебе дают полный текст сцены и ОДНО конкретное замечание.',
    'Внеси МИНИМАЛЬНУЮ правку, которая устраняет только это замечание: можешь добавить или изменить нужные фразы/короткий фрагмент.',
    'Всё, что не относится к замечанию, оставь ДОСЛОВНО — те же предложения, тот же порядок, тот же голос и стиль.',
    'Не переписывай сцену заново, не переставляй абзацы, не «улучшай» то, о чём не просили.',
  ].join('\n');
  const user = [
    'ЗАМЕЧАНИЕ (что исправить):', instruction.trim(), '',
    'ТЕКСТ СЦЕНЫ:', draft, '',
    'Верни ВЕСЬ текст сцены целиком с внесённой правкой — без кавычек, заголовков и пояснений.',
  ].join('\n');
  const cap = Math.min(4000, Math.max(1400, Math.round(draft.length/2) + 800));
  const res = await callLLM({ ...base, temperature:0.4,
    messages:[{role:'system',content:sys},{role:'user',content:user}], maxTokens:cap });
  const out = (res.text||'').trim();
  if(out.length < draft.length*0.6) throw new Error('Ответ оборван — попробуйте ещё раз.');
  return out;
}
