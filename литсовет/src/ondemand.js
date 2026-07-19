// Ручной запуск ОДНОГО агента на текущей сцене — по просьбе автора, вне
// полного пайплайна. Возвращает структурированный разбор с замечаниями и
// предложениями правок. Не меняет текст сам (кроме предложения Линейного
// редактора, которое автор применяет вручную).

import { callLLM } from './llm.js';
import { evaluatorMessages, parseEvaluator, architectMessages, parseArchitect } from './agents.js';
import { voiceGuardMessages, logicGuardMessages, eventsGuardMessages,
         customGuardMessages, lineEditMessages, runGuardParse, surgicalReviseMessages,
         styleGuardMessages, sceneQuestionMessages, readerGuardMessages, imageryGuardMessages,
         povGuardMessages, dialogueGuardMessages, resolutionGuardMessages, atmosphereGuardMessages,
         humorGuardMessages, parseDebateRevision } from './guards.js';
import { bookContextBlock } from './context.js';
import { effectiveRules } from './state.js';

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
    const msgs = evaluatorMessages(scene, draft, state.voice?.examples, bookContextBlock(state, scene), effectiveRules(state.style));
    const res = await callLLM({ ...base, temperature:agent.temp??0.2, messages:msgs, maxTokens:agent.maxTokens??700 });
    return { kind:'evaluator', verdict: parseEvaluator(res.text, g.evaluatorThreshold ?? 7.5) };
  }
  if(role==='architect'){
    const msgs = architectMessages(state, scene);
    const res = await callLLM({ ...base, temperature:agent.temp??0.4, messages:msgs, maxTokens:agent.maxTokens??600 });
    return { kind:'architect', plan: parseArchitect(res.text) };
  }
  if(role==='lineedit'){
    const msgs = lineEditMessages(draft, state.style?.forbidden);
    // Тот же приём, что и в pipeline.js: Линейный редактор возвращает ВЕСЬ текст
    // сцены целиком, статичный maxTokens обрубал длинные сцены раньше, чем текст
    // дописан. Без проверки длины обрубленный ответ тихо заменял всю сцену.
    const draftWords = (draft.match(/\S+/g)||[]).length;
    const dynMin = Math.max(2000, Math.round(draftWords * 2.5));
    const maxTk = Math.max(agent.maxTokens ?? 3600, dynMin);
    const res = await callLLM({ ...base, temperature:agent.temp??0.3, messages:msgs, maxTokens:maxTk });
    if(!res.text || res.text.length < draft.length*0.5)
      throw new Error(`Ответ короче половины исходного текста (похоже на обрыв лимитом ${maxTk} ток.) — попробуйте ещё раз.`);
    return { kind:'lineedit', text:res.text.trim() };
  }
  // стражи (включая кастомных) — только флагуют
  let msgs;
  if(role==='voiceguard')    msgs = voiceGuardMessages(scene, draft, state.voice?.examples, agent.strictness);
  else if(role==='logic')    msgs = logicGuardMessages(state, scene, draft, agent.strictness);
  else if(role==='events')   msgs = eventsGuardMessages(state, scene, draft, agent.strictness);
  else if(role==='styleguard'){
    const rules = effectiveRules(state.style);
    if(!rules.length) throw new Error('Нет правил автора — добавьте их на вкладке «Голос» или кнопкой «⊕ В правило».');
    msgs = styleGuardMessages(draft, rules, agent.strictness);
  }
  else if(role==='reader')    msgs = readerGuardMessages(scene, draft, agent.strictness);
  else if(role==='imagery')   msgs = imageryGuardMessages(draft, agent.strictness);
  else if(role==='pov')       msgs = povGuardMessages(draft, agent.strictness);
  else if(role==='dialogue')  msgs = dialogueGuardMessages(draft, agent.strictness);
  else if(role==='resolution')msgs = resolutionGuardMessages(draft, agent.strictness);
  else if(role==='atmosphere')msgs = atmosphereGuardMessages(draft, agent.strictness, state.project?.genre);
  else if(role==='humor')     msgs = humorGuardMessages(draft, agent.strictness, state.project?.genre);
  else                        msgs = customGuardMessages(state, scene, draft, agent.prompt, agent.strictness);
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
  // Ответ приходит в формате [РАЗБОР]/[ТЕКСТ] (см. surgicalReviseMessages) — без
  // parseDebateRevision в сцену дословно попадал служебный разбор замечаний.
  const parsed = parseDebateRevision(res.text||'');
  if(parsed.truncated) throw new Error('Ответ оборван — попробуйте ещё раз.');
  const out = (parsed.prose||'').trim();
  if(out.length < draft.length*0.6) throw new Error('Ответ оборван — попробуйте ещё раз.');
  return out;
}
