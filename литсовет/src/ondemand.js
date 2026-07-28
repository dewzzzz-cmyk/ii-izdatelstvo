// Ручной запуск ОДНОГО агента на текущей сцене — по просьбе автора, вне
// полного пайплайна. Возвращает структурированный разбор с замечаниями и
// предложениями правок. Не меняет текст сам (кроме предложения Линейного
// редактора, которое автор применяет вручную).

import { callLLM, extractJSON } from './llm.js';
import { evaluatorMessages, parseEvaluator, architectMessages, parseArchitect } from './agents.js';
import { voiceGuardMessages, logicGuardMessages, eventsGuardMessages,
         customGuardMessages, lineEditMessages, runGuardParse, surgicalReviseMessages,
         styleGuardMessages, sceneQuestionMessages, readerGuardMessages, imageryGuardMessages,
         povGuardMessages, dialogueGuardMessages, resolutionGuardMessages, atmosphereGuardMessages,
         humorGuardMessages, parseDebateRevision, looksTokenTruncated } from './guards.js';
import { bookContextBlock } from './context.js';
import { effectiveRules, ag, llmFor } from './state.js';
import { rememberRejected } from './pipeline.js';

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
  const base = llmFor(state, agent);
  const role = agent.role;

  if(role==='evaluator'){
    const msgs = evaluatorMessages(scene, draft, state.voice?.examples, bookContextBlock(state, scene), effectiveRules(state.style));
    const res = await callLLM({ ...base, temperature:agent.temp??0.2, messages:msgs, maxTokens:agent.maxTokens??840 });
    // Тот же принцип, что в pipeline.js: без образцов голоса ось «Голос»
    // судить не по чему — исключаем её из балла, а не даём модели выдумать
    // число. Разовый прогон Оценщика и прогон в цикле обязаны считать балл
    // одинаково, иначе одна и та же сцена получает два разных числа.
    const skipAxes = (state.voice?.examples||[]).filter(Boolean).length ? [] : ['voice'];
    return { kind:'evaluator', verdict: parseEvaluator(res.text, g.evaluatorThreshold ?? 7.5, { skipAxes }) };
  }
  if(role==='architect'){
    const msgs = architectMessages(state, scene, bookContextBlock(state, scene));
    const res = await callLLM({ ...base, temperature:agent.temp??0.4, messages:msgs, maxTokens:agent.maxTokens??720 });
    return { kind:'architect', plan: parseArchitect(res.text) };
  }
  if(role==='lineedit'){
    const msgs = lineEditMessages(draft, state.style?.forbidden, '', { anchors: scene.lastEval?.anchors, rejectedNotes: scene.rejectedNotes });
    // Тот же приём, что и в pipeline.js: Линейный редактор возвращает ВЕСЬ текст
    // сцены целиком, статичный maxTokens обрубал длинные сцены раньше, чем текст
    // дописан. Без проверки длины обрубленный ответ тихо заменял всю сцену.
    const draftWords = (draft.match(/\S+/g)||[]).length;
    // 3.5 ток/слово (не 2.5) — см. тот же расчёт и обоснование в pipeline.js.
    const dynMin = Math.round(Math.max(2500, Math.round(draftWords * 3.5)) * 1.2);
    const maxTk = Math.max(agent.maxTokens ?? 4320, dynMin);
    const res = await callLLM({ ...base, temperature:agent.temp??0.3, messages:msgs, maxTokens:maxTk });
    if(!res.text || res.text.length < draft.length*0.5)
      throw new Error(`Ответ короче половины исходного текста (похоже на обрыв лимитом ${maxTk} ток.) — попробуйте ещё раз.`);
    // Раньше здесь проверялась ТОЛЬКО длина (>50% исходного) — тот же пробел,
    // что чинили в pipeline.js: ответ может быть нужной длины, но обрываться не
    // на знаке препинания (обрыв ближе к концу лимита). looksTokenTruncated —
    // общая эвристика из guards.js, теперь применяется и здесь.
    if(looksTokenTruncated(res.text))
      throw new Error(`Ответ обрывается не на знаке препинания (похоже на обрыв лимитом ${maxTk} ток.) — попробуйте ещё раз.`);
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
  else if(role==='reader')    msgs = readerGuardMessages(scene, draft, agent.strictness, state.project?.genre);
  else if(role==='imagery')   msgs = imageryGuardMessages(draft, agent.strictness);
  else if(role==='pov')       msgs = povGuardMessages(draft, agent.strictness);
  else if(role==='dialogue')  msgs = dialogueGuardMessages(draft, agent.strictness);
  else if(role==='resolution')msgs = resolutionGuardMessages(draft, agent.strictness, state.project?.genre);
  else if(role==='atmosphere')msgs = atmosphereGuardMessages(draft, agent.strictness, state.project?.genre);
  else if(role==='humor')     msgs = humorGuardMessages(draft, agent.strictness, state.project?.genre);
  else                        msgs = customGuardMessages(state, scene, draft, agent.prompt, agent.strictness);
  const res = await callLLM({ ...base, temperature:agent.temp??0.2, messages:msgs, maxTokens:agent.maxTokens??840 });
  // Тот же захват passive-флага, что уже есть в guardJob() (pipeline.js) —
  // без него ручной ("по требованию") запуск стража «Читатель» из этой
  // вкладки не обновлял scene.passivityFlag, и книжная сводка пассивности
  // (passivityIsSystemic()) видела только автопрогоны из основного пайплайна.
  if(role==='reader'){
    const j = extractJSON(res.text);
    if(j && typeof j.passive === 'boolean') scene.passivityFlag = j.passive;
  }
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
  const res = await callLLM({ ...base, temperature:0.2, messages: sceneQuestionMessages(scene, draft, question.trim()), maxTokens:840 });
  return { kind:'guard', flags: runGuardParse(res.text) };
}

// Точечная правка: внести ТОЛЬКО одно замечание в текущий текст сцены,
// не переписывая остальное и не запуская цикл агентов. Возвращает весь текст.
export async function patchScene(state, scene, instruction){
  // Точечная правка пишет прозу — использует конфиг LLM Прозаика (в т.ч. его
  // переопределение модели/провайдера, если задано), а не голый state.global.
  const base = llmFor(state, ag(state,'prose'));
  if(!base.apiKey) throw new Error('Не задан API-ключ (⚙).');
  const draft = (scene.text||'').trim();
  if(!draft) throw new Error('Нет текста сцены.');
  if(!instruction || !instruction.trim()) throw new Error('Пустое замечание.');
  // Тот же расчёт, что и у Прозаика в pipeline.js (см. обоснование там): реальная
  // плотность ≈2.78 ток/слово на уже написанном тексте книги — старый потолок в
  // 4000 не оставлял запаса под текст [РАЗБОР] перед переписанной прозой.
  const cap = Math.round(Math.min(9000, Math.max(1800, Math.round(draft.length/2) + 1200)) * 1.2);
  const msgs = surgicalReviseMessages(draft, instruction, state.style?.rules);
  let res = await callLLM({ ...base, temperature:0.4, messages: msgs, maxTokens:cap });
  // Ответ приходит в формате [РАЗБОР]/[ТЕКСТ] (см. surgicalReviseMessages) — без
  // parseDebateRevision в сцену дословно попадал служебный разбор замечаний.
  let parsed = parseDebateRevision(res.text||'');
  if(parsed.truncated){
    // Тот же принцип повтора с удвоенным лимитом, что уже стоит у Прозаика на
    // правке в pipeline.js — раньше здесь был только тихий отказ (кидали ошибку
    // и автору приходилось вручную нажимать «Патч текста» ещё раз, теряя вызов).
    const retryMaxTk = Math.max(cap+1, Math.min(24000, cap*2));
    res = await callLLM({ ...base, temperature:0.4, messages: msgs, maxTokens: retryMaxTk });
    parsed = parseDebateRevision(res.text||'');
    if(parsed.truncated) throw new Error(`Ответ оборван дважды подряд (лимит был ${retryMaxTk} ток.) — попробуйте ещё раз.`);
  }
  // Отклонённые Прозаиком замечания запоминаются так же, как в основном
  // пайплайне — иначе Стражи на следующей автоматической проверке заново
  // поднимут вопрос, который автор уже увидел разобранным и отклонённым здесь.
  if(parsed.rejected && parsed.rejected.length) rememberRejected(scene, parsed.rejected);
  const out = (parsed.prose||'').trim();
  if(out.length < draft.length*0.6) throw new Error('Ответ оборван — попробуйте ещё раз.');
  // parsed.truncated ловит только «тега [ТЕКСТ] почти нет» — не «текст есть, но
  // обрывается на полуслове чуть дальше» (тот же пробел, что чинили в
  // pipeline.js). looksTokenTruncated закрывает именно этот случай.
  if(looksTokenTruncated(out)) throw new Error('Ответ обрывается не на знаке препинания (похоже на обрыв токенами) — попробуйте ещё раз.');
  return out;
}
