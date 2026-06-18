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
  const sceneSums = (state.structure||[]).filter(n=>n.type==='scene'&&n.id!==scene.id&&!n.rolledUp)
    .map(n=>(mem.scenes||{})[n.id]?.current).filter(Boolean);
  if(sceneSums.length) parts.push('Предыдущие сцены:\n'+sceneSums.slice(-8).join('\n'));
  const chars = serializeCharacterStates(state.characters, scene.presentChars);
  if(chars) parts.push('Состояния персонажей:\n'+chars);
  const bible = bibleForPrompt(state.bible, scene.brief||scene.title||'', 5);
  if(bible) parts.push('Канон:\n'+bible);
  return parts.join('\n\n') || '(фактов о мире пока нет)';
}

export function runGuardParse(text){ return parseFlags(text); }

// Кастомный страж: пользовательский промпт проверки. Только флагует.
export function customGuardMessages(state, scene, draft, prompt, strictness){
  const sys = 'Ты — кастомный страж сцены. Твоя задача от автора: ' + (prompt||'проверь сцену') +
    '\nТы НЕ переписываешь текст, только отмечаешь проблемы.\n' + strictnessLine(strictness);
  const user = ['СЦЕНА:', draft, '',
    'Верни JSON: { "flags":[{"severity":"critical|warning|ok","title":"кратко","detail":"что не так","quote":"фрагмент"}] }. Только JSON.'].join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
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
