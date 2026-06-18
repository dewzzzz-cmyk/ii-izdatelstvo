// Ручной запуск ОДНОГО агента на текущей сцене — по просьбе автора, вне
// полного пайплайна. Возвращает структурированный разбор с замечаниями и
// предложениями правок. Не меняет текст сам (кроме предложения Линейного
// редактора, которое автор применяет вручную).

import { callLLM } from './llm.js';
import { evaluatorMessages, parseEvaluator, architectMessages, parseArchitect } from './agents.js';
import { voiceGuardMessages, logicGuardMessages, eventsGuardMessages,
         customGuardMessages, lineEditMessages, runGuardParse, surgicalReviseMessages,
         styleGuardMessages, sceneQuestionMessages } from './guards.js';
import { bookContextBlock } from './context.js';

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
    const msgs = evaluatorMessages(scene, draft, state.voice?.examples, bookContextBlock(state, scene), state.style?.rules);
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
  if(role==='voiceguard')    msgs = voiceGuardMessages(scene, draft, state.voice?.examples, agent.strictness);
  else if(role==='logic')    msgs = logicGuardMessages(state, scene, draft, agent.strictness);
  else if(role==='events')   msgs = eventsGuardMessages(state, scene, draft, agent.strictness);
  else if(role==='styleguard'){
    if(!(state.style?.rules||[]).filter(Boolean).length) throw new Error('Нет правил автора — добавьте их на вкладке «Голос» или кнопкой «⊕ В правило».');
    msgs = styleGuardMessages(draft, state.style.rules, agent.strictness);
  }
  else                       msgs = customGuardMessages(state, scene, draft, agent.prompt, agent.strictness);
  const res = await callLLM({ ...base, temperature:agent.temp??0.2, messages:msgs, maxTokens:agent.maxTokens??700 });
  return { kind:'guard', flags: runGuardParse(res.text) };
}

// Разовый вопрос автора о сцене → ответ стража (флаги). Те же действия в разборе.
export async function askSceneQuestion(state, scene, question){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ (⚙).');
  const draft = (scene.text||'').trim();
  if(!draft) throw new Error('Сначала напишите текст сцены — вопрос задавать не к чему.');
  if(!question || !question.trim()) throw new Error('Пустой вопрос.');
  const base = { baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, retries:g.retries };
  const res = await callLLM({ ...base, temperature:0.2, messages: sceneQuestionMessages(scene, draft, question.trim()), maxTokens:700 });
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
  const cap = Math.min(4000, Math.max(1400, Math.round(draft.length/2) + 800));
  const res = await callLLM({ ...base, temperature:0.4,
    messages: surgicalReviseMessages(draft, instruction, state.style?.rules), maxTokens:cap });
  const out = (res.text||'').trim();
  if(out.length < draft.length*0.6) throw new Error('Ответ оборван — попробуйте ещё раз.');
  return out;
}
