// Стражи и Линейный редактор (спека 6). Запускаются параллельно после петли.
// Стражи ТОЛЬКО флагуют, не переписывают. Линейный редактор — единственный,
// кто правит текст (опционально).
//
// Принцип разделения (спека 6): Стражи логики/событий видят ТОЛЬКО факты
// (сводки + Bible + состояния), НЕ инструкции стиля. Страж голоса — наоборот.

import { callLLM, extractJSON } from './llm.js';
import { bibleForPrompt } from './bible.js';
import { serializeCharacterStates } from './context.js';

// Строгость 1-3 → инструкция для Стража (реально влияет на число и порог флагов).
function strictnessLine(strictness){
  const s = strictness||2;
  if(s<=1) return 'Строгость: МЯГКАЯ — отмечай только грубые, явные проблемы; мелочи пропускай.';
  if(s>=3) return 'Строгость: ВЫСОКАЯ — придирайся, отмечай даже мелкие и потенциальные проблемы.';
  return 'Строгость: ОБЫЧНАЯ — отмечай заметные проблемы, не придирайся к мелочам.';
}

function parseFlags(text){
  const j = extractJSON(text);
  if(!j || !Array.isArray(j.flags)) return [];
  return j.flags.filter(f=>f&&f.title).map(f=>({
    severity: ['critical','warning','ok'].includes(f.severity)?f.severity:'warning',
    title: String(f.title).slice(0,120),
    detail: String(f.detail||'').slice(0,300),
    quote: f.quote? String(f.quote).slice(0,200):'',
  }));
}

// ── Страж голоса (0.2): стиль/ритм против образца. Цитирует образец. ──
export function voiceGuardMessages(scene, draft, voiceExamples, strictness){
  const sys = 'Ты — страж голоса. Ты НЕ переписываешь текст. Ты отмечаешь отклонения стиля/ритма от образца автора. По каждому флагу цитируй релевантное предложение из образца.\n'+strictnessLine(strictness);
  const ex = voiceExamples&&voiceExamples.length ? 'Образец голоса:\n'+voiceExamples.map(e=>'  «'+e+'»').join('\n') : '';
  const user = [ex,'','ЧЕРНОВИК:',draft,'',
    'Верни JSON: { "flags":[{"severity":"critical|warning|ok","title":"кратко","detail":"что не так","quote":"цитата из образца"}] }. 1-4 флага. Только JSON.'
  ].join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

// ── Страж логики (0.2): причинность/время/пространство. ТОЛЬКО факты. ──
export function logicGuardMessages(state, scene, draft, strictness){
  const facts = factsBlock(state, scene);
  const sys = [
    'Ты — страж логики. Проверяешь физическую/временну́ю/причинную непротиворечивость сцены. Ты НЕ оцениваешь стиль и НЕ переписываешь.',
    'Ты ловишь ДВА типа проблем:',
    '1) ПРОТИВОРЕЧИЕ — сцена утверждает то, что невозможно физически/хронологически или спорит с фактами мира (severity: critical).',
    '2) НЕУСТАНОВЛЕННАЯ ПОСЫЛКА — сцена опирается на пространственный факт, которого нигде нет: позиция героя (этаж, комната), расстояние и досягаемость, линия взгляда, кто откуда что видит, может ли объект дотянуться/пройти. Это не ошибка, а пробел: задай вопрос автору (severity: warning).',
    'Пример пробела: существа «двинулись к окну», но не указан этаж — могут ли они физически добраться? Флаг-вопрос, а не выдумывай ответ.',
    strictnessLine(strictness),
  ].join('\n');
  const user = [facts,'','СЦЕНА:',draft,'',
    'Верни JSON: { "flags":[{"severity":"critical|warning|ok","title":"кратко","detail":"противоречие ИЛИ какой посылки не хватает","quote":"фрагмент сцены"}] }. Реальные противоречия (critical) и важные пространственные пробелы (warning). Не придирайся к мелочам. Только JSON.'
  ].join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

// ── Страж событий (0.2): кто что знает / состояния. ТОЛЬКО факты. ──
export function eventsGuardMessages(state, scene, draft, strictness){
  const facts = factsBlock(state, scene);
  const sys = [
    'Ты — страж событий. Проверяешь, следуют ли знания, эмоции, действия и намерения персонажей (и сил сцены) из установленного. Ты НЕ оцениваешь стиль.',
    'Ты ловишь ДВА типа проблем:',
    '1) ПРОТИВОРЕЧИЕ — персонаж знает/чувствует/делает то, что не следует из прошлых событий или его состояния (severity: critical).',
    '2) НЕУСТАНОВЛЕННАЯ ПОСЫЛКА — сцена подразумевает событие/намерение, которого не показала: кто кого заметил, откуда стало известно, смена траектории или вектор на героя без триггера, перцепция без линии восприятия. Это пробел: задай вопрос автору (severity: warning).',
    'Пример пробела: нагнетание строится на том, что существа идут к герою, но в тексте они лишь «перетекают вдоль забора» — не показано, что они его заметили и сменили направление. Флаг-вопрос.',
    'Переход и смену локации проверяй ТОЛЬКО относительно «непосредственно предыдущей сцены», если она указана. Не бери локацию из общего синопсиса или сводок других сцен. Если предыдущей сцены нет — переход не флагуй.',
    strictnessLine(strictness),
  ].join('\n');
  const user = [facts,'','СЦЕНА:',draft,'',
    'Верни JSON: { "flags":[{"severity":"critical|warning|ok","title":"кратко","detail":"что не следует из установленного ИЛИ какой посылки/триггера не хватает","quote":"фрагмент сцены"}] }. Только JSON.'
  ].join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

// Блок фактов (без инструкций стиля) — общий для логики и событий.
function factsBlock(state, scene){
  const mem = state.memory||{};
  const parts = [];
  const syn = (mem.books&&mem.books.__running__)?mem.books.__running__.current:'';
  if(syn) parts.push('Ранее в книге: '+syn);
  // Только сцены ДО текущей (по порядку в структуре) — не «свалка» и без будущих сцен.
  const scenes = (state.structure||[]).filter(n=>n.type==='scene');
  const idx = scenes.findIndex(n=>n.id===scene.id);
  const prior = (idx<0 ? scenes : scenes.slice(0, idx)).filter(n=>!n.rolledUp);
  const priorSums = prior.map(n=>(mem.scenes||{})[n.id]?.current).filter(Boolean);
  if(priorSums.length) parts.push('Предыдущие сцены (по порядку):\n'+priorSums.slice(-8).join('\n'));
  // Непосредственно предыдущая сцена — явно, чтобы Страж сверял переход/локацию с ней, а не угадывал.
  const prevScene = idx>0 ? [...scenes.slice(0, idx)].reverse().find(n=>(mem.scenes||{})[n.id]?.current || n.text) : null;
  if(prevScene){
    const ps = (mem.scenes||{})[prevScene.id]?.current || (prevScene.text? prevScene.text.slice(-400) : '');
    if(ps) parts.push(`НЕПОСРЕДСТВЕННО ПРЕДЫДУЩАЯ СЦЕНА — «${prevScene.title||'без названия'}» (только с ней сверяй переход и смену локации):\n${ps}`);
  } else if(idx===0){
    parts.push('Это ПЕРВАЯ сцена книги — предыдущей сцены нет, переход и смену локации проверять не с чем.');
  }
  const chars = serializeCharacterStates(state.characters, scene.presentChars);
  if(chars) parts.push('Состояния персонажей:\n'+chars);
  const bible = bibleForPrompt(state.bible, scene.brief||scene.title||'', 5);
  if(bible) parts.push('Канон:\n'+bible);
  return parts.join('\n\n') || '(фактов о мире пока нет)';
}

export function runGuardParse(text){ return parseFlags(text); }

// ── Разовый вопрос автора о сцене: страж отвечает по тексту. ──
// Если по вопросу есть пробел/проблема — флаг с цитатой; если всё в порядке —
// флаг severity "ok" с обоснованием. Не переписывает.
export function sceneQuestionMessages(scene, draft, question){
  const sys = 'Ты — страж сцены, отвечающий на КОНКРЕТНЫЙ вопрос автора о текущей сцене. Опирайся только на её текст и здравую логику повествования. Ты НЕ переписываешь текст. Если по вопросу есть пробел или проблема — верни флаг с цитатой проблемного места и развёрнутым ответом. Если всё в порядке — верни один флаг severity "ok" с кратким обоснованием.';
  const user = ['ВОПРОС АВТОРА: '+question, '', 'ТЕКСТ СЦЕНЫ:', draft, '',
    'Верни JSON: { "flags":[{"severity":"critical|warning|ok","title":"суть ответа","detail":"ответ по тексту: что есть/чего не хватает и где","quote":"релевантный фрагмент сцены или пусто"}] }. 1-3 флага. Только JSON.'
  ].join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

// ── Страж стиля (0.2): ловит нарушения «Правил автора» (do/don't). Цитирует. ──
export function styleGuardMessages(draft, rules, strictness){
  const list = (rules||[]).filter(Boolean);
  const sys = 'Ты — страж стиля автора. Тебе дан список ПРАВИЛ автора (его «не делай так» и «делай так»). Отметь места в черновике, где правило нарушено. Ты НЕ переписываешь, только флагуешь, цитируя нарушающий фрагмент. Правила, которые не нарушены, не упоминай.\n'+strictnessLine(strictness);
  const user = ['ПРАВИЛА АВТОРА:', list.map((r,i)=>`${i+1}. ${r}`).join('\n'), '', 'ЧЕРНОВИК:', draft, '',
    'Верни JSON: { "flags":[{"severity":"critical|warning|ok","title":"какое правило нарушено","detail":"в чём нарушение","quote":"фрагмент черновика"}] }. Только реальные нарушения правил. Только JSON.'
  ].join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

// Кастомный страж: пользовательский промпт проверки. Только флагует.
export function customGuardMessages(state, scene, draft, prompt, strictness){
  const sys = 'Ты — кастомный страж сцены. Твоя задача от автора: ' + (prompt||'проверь сцену') +
    '\nТы НЕ переписываешь текст, только отмечаешь проблемы.\n' + strictnessLine(strictness);
  const user = ['СЦЕНА:', draft, '',
    'Верни JSON: { "flags":[{"severity":"critical|warning|ok","title":"кратко","detail":"что не так","quote":"фрагмент"}] }. Только JSON.'].join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

// ── Хирургическая доработка по замечаниям: меняем ТОЛЬКО нужные фразы, ──
// остальное оставляем дословно. Используется и ручным «Поправить точечно»,
// и петлёй Прозаик⇄Оценщик (чтобы Прозаик правил фразы, а не переписывал всё).
// Прозаик разбирает замечания Оценщика как автор, а не как исполнитель:
// для каждого замечания — ПРИНЯТО (применю) или ОТКЛОНЕНО (это художественный приём).
// Формат ответа: [РАЗБОР] ... [ТЕКСТ] ... — парсится через parseDebateRevision().
export function surgicalReviseMessages(draft, instruction, rules){
  const rl = (rules||[]).filter(Boolean);
  const sys = [
    'Ты — автор прозы. Редактор прислал замечания к твоей сцене.',
    'Разбери каждое замечание как профессионал:',
    '  ПРИНЯТО — внесу минимальную точечную правку',
    '  ОТКЛОНЕНО — это намеренный художественный приём (назови кратко: «ритм напряжения», «маска персонажа», «ирония» и т.п.)',
    'Правило: явное клише или фактическую ошибку — прими. Вопрос вкуса или намеренный эффект — можешь отклонить.',
    'К принятым замечаниям: меняй ТОЛЬКО нужные фразы, остальное — ДОСЛОВНО. Не переписывай сцену заново.',
    'Пунктуация при правке конца предложения: если дописываешь продолжение — УДАЛИ старую точку. Конструкция «слово., продолжение» недопустима.',
    rl.length ? 'Правила автора (не нарушать):\n'+rl.map(r=>'— '+r).join('\n') : '',
    'Формат ответа (строго):',
    '[РАЗБОР]',
    '1. «цитата замечания» → ПРИНЯТО: что именно исправлю',
    '2. «цитата замечания» → ОТКЛОНЕНО: художественный приём — почему так задумано',
    '',
    '[ТЕКСТ]',
    '(полный текст сцены с принятыми правками)',
  ].filter(Boolean).join('\n');
  const user = [
    'ЗАМЕЧАНИЯ:', (instruction||'').trim() || 'улучши самые слабые места, остальное сохрани',
    '', 'ТЕКСТ СЦЕНЫ:', draft,
  ].join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

// Вычленяет "спор" (РАЗБОР) и прозу (ТЕКСТ) из ответа surgicalReviseMessages.
// При отсутствии маркера [ТЕКСТ] — всё содержимое считается прозой (safe fallback).
export function parseDebateRevision(text){
  const m = text.match(/\[ТЕКСТ\]\s*\n([\s\S]+)/i);
  let prose = m && m[1].trim().length > 50 ? m[1].trim() : text;
  // Артефакт хирургической правки: LLM копирует конец фразы с точкой и затем дописывает
  // продолжение через запятую. Результат: «целое., но» → убираем паразитную точку.
  prose = prose.replace(/\.,(\s)/g, ',$1');
  // Аналогично «!,» и «?,» — редко, но бывает
  prose = prose.replace(/([!?])\s*,(\s)/g, '$1$2');
  return m && m[1].trim().length > 50
    ? { debate: text.slice(0, m.index).trim(), prose }
    : { debate: '', prose };
}

// ── Линейный редактор (0.3): убирает ярлыки, варьирует ритм. ПРАВИТ текст. ──
export function lineEditMessages(draft, forbidden){
  const sys = 'Ты — линейный редактор. Лёгкая правка: убери эмоциональные ярлыки (замени на действие/деталь), разнообразь ритм предложений, убери лишние наречия и клише. Сохрани смысл, сюжет и голос. Не добавляй новых событий.';
  const user = [
    forbidden&&forbidden.length?('Особенно избегай: '+forbidden.join(', ')+'.'):'',
    '','ТЕКСТ:',draft,'','Верни ТОЛЬКО отредактированный текст, без пояснений.'
  ].filter(Boolean).join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}
