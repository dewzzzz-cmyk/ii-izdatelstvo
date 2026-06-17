// Агенты пайплайна. ПП2: Архитектор сцены, Прозаик, Оценщик (рубрика 6.1).
// Каждый агент — чистый строитель промпта + парсер ответа. Вызовы — в pipeline.js.

import { extractJSON } from './llm.js';

// ── Архитектор сцены (temp 0.4) — JSON якорей/деталей/запретов, НЕ пишет прозу ──
export function architectMessages(state, scene){
  const proj = state.project;
  const sys = [
    'Ты — архитектор сцены. Ты НЕ пишешь прозу. Ты возвращаешь структурный план сцены в JSON.',
    `Жанр: ${proj.genre||'—'}. Эпоха: ${proj.era||'—'}.`,
  ].join('\n');
  const user = [
    'Бриф сцены: ' + (scene.brief || scene.title || ''),
    scene.emotion ? 'Эмоция читателя в финале: ' + scene.emotion : '',
    '',
    'Верни JSON со схемой:',
    '{ "anchors": [строки — ключевые детали/образы, 2-4], "presentChars": [имена персонажей в сцене], "forbiddenWords": [слова которых избегать, 0-5], "beats": [краткие шаги развития сцены, 2-4] }',
    'Только JSON, без пояснений.',
  ].filter(Boolean).join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}
export function parseArchitect(text){
  const j = extractJSON(text);
  if(!j) return null;
  return {
    anchors: Array.isArray(j.anchors)? j.anchors : [],
    presentChars: Array.isArray(j.presentChars)? j.presentChars : [],
    forbiddenWords: Array.isArray(j.forbiddenWords)? j.forbiddenWords : [],
    beats: Array.isArray(j.beats)? j.beats : [],
  };
}
export function architectToText(plan){
  if(!plan) return '';
  const lines = [];
  if(plan.anchors.length) lines.push('Якоря (обязательно отрази): ' + plan.anchors.join('; '));
  if(plan.beats.length) lines.push('Шаги сцены: ' + plan.beats.join(' → '));
  if(plan.forbiddenWords.length) lines.push('Избегай слов: ' + plan.forbiddenWords.join(', '));
  return lines.join('\n');
}

// ── Оценщик (temp 0.2) — рубрика из 5 осей (спека 6.1). Отдельный агент. ──
// НЕ видит рассуждений Прозаика, только готовый черновик + бриф + критерии.
export const RUBRIC_AXES = [
  { key:'freshness', label:'Свежесть образа', anti:'клише, штампы' },
  { key:'rhythm',    label:'Ритм',            anti:'монотонность' },
  { key:'concrete',  label:'Конкретность',    anti:'абстракции, ярлыки' },
  { key:'voice',     label:'Голос',           anti:'регрессия к нейтральному' },
  { key:'brief',     label:'Соответствие брифу', anti:'уход от задачи' },
];

export function evaluatorMessages(scene, draft, voiceExamples){
  const sys = [
    'Ты — строгий литературный оценщик. Ты НЕ переписываешь текст. Ты оцениваешь черновик по рубрике.',
    'Оси (каждая 1–10):',
    ...RUBRIC_AXES.map(a=>`  - ${a.label}: высокий балл = сильно; штраф за: ${a.anti}.`),
    'Оси «Свежесть образа» и «Ритм» — защита от гладкой обезличенной прозы: снижай их, если текст обтекаем и предсказуем.',
  ].join('\n');
  const exBlock = voiceExamples && voiceExamples.length
    ? '\nОбразец голоса автора:\n' + voiceExamples.map(e=>'  «'+e+'»').join('\n')
    : '';
  const user = [
    'Бриф сцены: ' + (scene.brief || scene.title || ''),
    scene.emotion ? 'Целевая эмоция: ' + scene.emotion : '',
    exBlock,
    '',
    'ЧЕРНОВИК:',
    draft,
    '',
    'Верни JSON: { "scores": {"freshness":n,"rhythm":n,"concrete":n,"voice":n,"brief":n}, "weighted": n, "notes": [конкретные замечания для переработки, 1-4], "verdict": "pass"|"revise" }',
    'weighted — средневзвешенное (0-10). verdict="pass" только если weighted ≥ порог И ни одна ось < 5.',
    'Только JSON.',
  ].filter(Boolean).join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

export function parseEvaluator(text, threshold){
  const j = extractJSON(text);
  if(!j || !j.scores) return { ok:false, raw:text };
  const scores = j.scores;
  const axes = RUBRIC_AXES.map(a=>a.key);
  const vals = axes.map(k=>Number(scores[k])||0);
  const weighted = typeof j.weighted==='number' ? j.weighted : (vals.reduce((a,b)=>a+b,0)/vals.length);
  const minAxis = Math.min(...vals);
  const pass = weighted >= threshold && minAxis >= 5;
  return {
    ok: true,
    scores,
    weighted: Math.round(weighted*10)/10,
    minAxis,
    pass,
    notes: Array.isArray(j.notes) ? j.notes : [],
  };
}
