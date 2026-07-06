// Агенты пайплайна. ПП2: Архитектор сцены, Прозаик, Оценщик (рубрика 6.1).
// Каждый агент — чистый строитель промпта + парсер ответа. Вызовы — в pipeline.js.

import { extractJSON } from './llm.js';

// ── Архитектор сцены (temp 0.4) — JSON якорей/деталей/запретов, НЕ пишет прозу ──
export function architectMessages(state, scene){
  const proj = state.project;
  const isSequel = scene.sceneType==='sequel';
  const sys = [
    'Ты — архитектор сцены. Ты НЕ пишешь прозу. Ты возвращаешь структурный план сцены в JSON.',
    `Жанр: ${proj.genre||'—'}. Эпоха: ${proj.era||'—'}.`,
  ].join('\n');
  const goalDesc = isSequel
    ? '"goal": "к какому РЕШЕНИЮ должен прийти ПОВ-персонаж к концу сцены (эта сцена — секвель: реакция→дилемма→решение)"'
    : '"goal": "чего хочет ПОВ-персонаж в этой сцене"';
  const obstacleDesc = isSequel
    ? '"obstacle": "в чём дилемма — какие варианты решения конфликтуют между собой"'
    : '"obstacle": "что конкретно мешает"';
  const user = [
    'Бриф сцены: ' + (scene.brief || scene.title || ''),
    scene.emotion ? 'Эмоция читателя в финале: ' + scene.emotion : '',
    '',
    'Верни JSON со схемой:',
    `{ "anchors": [ключевые детали/образы, 2-4], "presentChars": [имена персонажей], "forbiddenWords": [слова избегать, 0-5], "beats": [шаги развития, 2-4], ${goalDesc}, ${obstacleDesc}, "historicalDetail": "одна точная деталь эпохи (одежда/предмет/обычай/технология) для достоверности" }`,
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
    goal: typeof j.goal==='string'? j.goal : '',
    obstacle: typeof j.obstacle==='string'? j.obstacle : '',
    historicalDetail: typeof j.historicalDetail==='string'? j.historicalDetail : '',
  };
}
export function architectToText(plan, scene){
  if(!plan) return '';
  const isSequel = scene?.sceneType==='sequel';
  const lines = [];
  if(plan.anchors.length) lines.push('Якоря (обязательно отрази): ' + plan.anchors.join('; '));
  if(plan.beats.length) lines.push('Шаги сцены: ' + plan.beats.join(' → '));
  if(plan.goal) lines.push((isSequel?'Решение, к которому должен прийти герой: ':'Цель ПОВ-персонажа в сцене: ') + plan.goal);
  if(plan.obstacle) lines.push((isSequel?'Дилемма (конфликт вариантов): ':'Препятствие: ') + plan.obstacle);
  if(plan.historicalDetail) lines.push('Деталь эпохи (вставь в текст): ' + plan.historicalDetail);
  if(plan.forbiddenWords.length) lines.push('Избегай слов: ' + plan.forbiddenWords.join(', '));
  return lines.join('\n');
}

// ── Оценщик (temp 0.2) — рубрика из 5 осей (спека 6.1). Отдельный агент. ──
// НЕ видит рассуждений Прозаика, только готовый черновик + бриф + критерии.
// weight: «Соответствие брифу» весит вдвое больше остальных осей — уход от
// задачи сцены это структурный провал (сцена не делает того, для чего нужна),
// а не вопрос полировки, как остальные четыре оси. Раньше weighted был простым
// средним — сцена, наполовину мимо брифа, но гладко написанная, легко проходила
// порог за счёт высоких оценок по остальным осям.
export const RUBRIC_AXES = [
  { key:'freshness', label:'Свежесть образа', anti:'клише, штампы', weight:1 },
  { key:'rhythm',    label:'Ритм',            anti:'монотонность', weight:1 },
  { key:'concrete',  label:'Конкретность',    anti:'абстракции, ярлыки', weight:1 },
  { key:'voice',     label:'Голос',           anti:'регрессия к нейтральному', weight:1 },
  { key:'pace',      label:'Темп',            anti:'проседание из-за избыточных бытовых деталей — сцена топчется на месте', weight:1 },
  { key:'brief',     label:'Соответствие брифу', anti:'уход от задачи', weight:2 },
];

export function evaluatorMessages(scene, draft, voiceExamples, bookContext, rules){
  const sys = [
    'Ты — строгий литературный оценщик. Ты НЕ переписываешь текст. Ты оцениваешь черновик по рубрике из 6 осей.',
    'Шкала каждой оси (используй весь диапазон, не жмись к 7-8):',
    '  1–3 — слабо/провал · 4–6 — средне, есть проблемы · 7–8 — хорошо · 9–10 — выдающееся.',
    'Оси:',
    ...RUBRIC_AXES.map(a=>`  - ${a.label}: штрафуй за «${a.anti}».`),
    'Оси «Свежесть образа» и «Ритм» — защита от гладкой обезличенной ИИ-прозы. Если текст обтекаем, предсказуем, «правильный» но безжизненный — это 4–6, не 7.',
    'ВАЖНО: перед баллом за «Свежесть» процитируй 1–2 самых клишированных или штампованных оборота из черновика. Если клише нет — обоснуй одной фразой. Это защита от завышения.',
    'КЛИШЕ В РЕЧИ ПЕРСОНАЖЕЙ (в кавычках, после тире реплики) — это норма, не штраф: живые люди в сильных эмоциях говорят затёртыми фразами («чтоб духу твоего не было», «да плевать я хотел»), это достоверность, а не слабость письма. Цитируй как клише для «Свежести» только обороты из АВТОРСКОГО ПОВЕСТВОВАНИЯ (описания, метафоры, внутренние ощущения вне прямой речи).',
    'ВАЖНО: перед баллом за «Конкретность» процитируй 1 самый абстрактный/неконкретный оборот из черновика (ярлык, обобщение без сенсорной детали). Если такого нет — обоснуй одной фразой.',
    'ВАЖНО: перед баллом за «Темп» процитируй 1 фрагмент, где сцена топчется на месте — избыточное бытовое действие/деталь (кто куда сел, что во что налил, как застегнул пуговицу), которое не двигает цель/препятствие сцены и не добавляет характеристики или подтекста. Это НЕ про физический экшн (погоня, драка) — там низкий темп это провал по-другому; это именно про бытовой шум, замещающий движение сюжета. Если такого фрагмента нет — обоснуй одной фразой, почему темп держится.',
    'ЯКОРЯ: обязательно найди 1-2 конкретных цитаты из текста, которые РАБОТАЮТ и не нужно трогать. Якорь — короткая дословная фраза из черновика, не пересказ. Хороший якорь: «фонарь пульсировал, как затухающая спичка» — плохой якорь: «хорошее описание фонаря». Якорь найдётся почти всегда — даже в слабом тексте есть детали лучше остальных.',
    'ВОПРОСЫ: 0-2 спорных художественных выбора, где ответ неоднозначен и должен решать автор (не ошибки, а дилеммы: «два образа подряд — нужны ли оба?»). Если дилемм нет — пустой массив.',
    bookContext ? 'Тебе дан КОНТЕКСТ КНИГИ (сюжет, канон, персонажи). Ось «Соответствие брифу» и замечания оценивай С УЧЁТОМ него: предложения по правке не должны противоречить канону и сюжету, опирайся на конкретные детали мира и состояния персонажей. Сам контекст не оценивай — оценивай только черновик.' : '',
    (rules&&rules.length) ? 'ПРАВИЛА АВТОРА — нарушение штрафуй (снижай соответствующую ось) и выноси отдельным notes с цитатой:\n'+rules.filter(Boolean).map(r=>'— '+r).join('\n') : '',
  ].filter(Boolean).join('\n');
  const exBlock = voiceExamples && voiceExamples.length
    ? '\nОбразец голоса автора (для оси «Голос»):\n' + voiceExamples.map(e=>'  «'+e+'»').join('\n')
    : '';
  const ctxBlock = bookContext ? '\nКОНТЕКСТ КНИГИ (учитывать, не оценивать):\n' + bookContext + '\n' : '';
  const user = [
    'Бриф сцены: ' + (scene.brief || scene.title || ''),
    scene.emotion ? 'Целевая эмоция: ' + scene.emotion : '',
    ctxBlock,
    exBlock,
    '',
    'ЧЕРНОВИК:',
    draft,
    '',
    'Верни JSON: { "cliches": [процитированные клише, 0-2], "clicheCategory": "если clichés не пусто — к какому ОБЩЕМУ приёму они относятся (не сами слова, а тип: например «телесные маркеры тревоги», «олицетворение природы», «механика движения рук»); иначе пустая строка", "abstractions": [процитированный самый неконкретный/абстрактный оборот, 0-1], "padding": [процитированный фрагмент с избыточной бытовой деталью, из-за которой сцена топчется на месте, 0-1], "anchors": [короткие дословные цитаты из текста которые нельзя трогать, 1-2], "questions": [спорные художественные выборы для автора, 0-2], "scores": {"freshness":n,"rhythm":n,"concrete":n,"voice":n,"pace":n,"brief":n}, "notes": [замечания для переработки с привязкой к фрагментам, 1-4] }',
    'Баллы — целые 1-10. notes должны указывать ЧТО и ГДЕ исправить через принцип или критерий («нужна сенсорная деталь», «слишком абстрактно»)' + (bookContext ? ' и учитывать контекст книги (канон, сюжет, персонажей)' : '') + '. НЕ давай готовые формулировки замен — только направление.',
    'clicheCategory важна не меньше самих цитат: автор правит точечно только буквальные слова, если не назвать сам приём, который повторяется вместо конкретики.',
    'Только JSON.',
  ].filter(Boolean).join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

// threshold проверяется здесь; weighted считаем САМИ из осей (не доверяем модели — иначе подгонит под verdict).
export function parseEvaluator(text, threshold){
  const j = extractJSON(text);
  if(!j || !j.scores) return { ok:false, raw:text };
  const scores = j.scores;
  const axes = RUBRIC_AXES.map(a=>a.key);
  const weights = RUBRIC_AXES.map(a=>a.weight||1);
  // Округляем до целого — промпт просит целые баллы 1-10, но модель иногда
  // возвращает дробные; без округления погранично-дробный балл мог давать
  // minAxis вроде 4.6, который проходит порог ">=5" при показе как «5», хотя
  // фактически ниже — несоответствие между тем, что видит автор, и тем, что
  // реально сравнивается с порогом.
  const vals = axes.map(k=>clamp(Math.round(Number(scores[k])||0)));
  const weightSum = weights.reduce((a,b)=>a+b,0);
  const weighted = vals.reduce((sum,v,i)=>sum+v*weights[i],0)/weightSum; // взвешенное среднее по осям
  const minAxis = Math.min(...vals);
  const pass = weighted >= threshold && minAxis >= 5;
  return {
    ok: true,
    scores: Object.fromEntries(axes.map((k,i)=>[k, vals[i]])),
    weighted: Math.round(weighted*10)/10,
    minAxis,
    pass,
    notes: Array.isArray(j.notes) ? j.notes : [],
    abstractions: Array.isArray(j.abstractions) ? j.abstractions : [],
    padding: Array.isArray(j.padding) ? j.padding : [],
    cliches: Array.isArray(j.cliches) ? j.cliches : [],
    clicheCategory: typeof j.clicheCategory === 'string' ? j.clicheCategory.trim() : '',
    anchors: Array.isArray(j.anchors) ? j.anchors : [],
    questions: Array.isArray(j.questions) ? j.questions : [],
  };
}
function clamp(n){ return Math.max(0, Math.min(10, n)); }
