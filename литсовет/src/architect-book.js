// Книжный архитектор (спека 5.3) — один запуск на стадии Структура.
// Возвращает скелет: главы → сцены (название, бриф, эмоция, объём, арка).
// Temp 0.6. Выход валидируется по схеме с ретраем (спека 11).
// + Оценщик структуры: после генерации оценивает скелет и даёт рекомендации.

import { callLLM, extractJSON } from './llm.js';

const ARCS = ['завязка','развитие','кульминация','развязка'];

export function bookArchitectMessages(state, opts={}){
  const p = state.project;
  const totalWords = p.targetWords || 80000;
  // Целевой объём сцены: 1200 слов для романа — реалистичная сцена.
  // Более крупная сцена → меньше вызовов LLM, лучше связность.
  const wPerScene = Math.max(700, Math.min(2000, Math.round(totalWords / 60)));
  const targetScenes = Math.max(6, Math.round(totalWords / wPerScene));
  const targetChapters = opts.chapters || Math.max(3, Math.min(25, Math.round(targetScenes / 3.5)));
  const scenesPerCh = Math.max(2, Math.round(targetScenes / targetChapters));

  const wMin = Math.round(wPerScene * 0.80);
  const wMax = Math.round(wPerScene * 1.20);
  const sys = [
    'Ты — книжный архитектор. Ты проектируешь скелет книги: главы и сцены. Ты НЕ пишешь прозу.',
    `Каждая сцена — единица письма. Базовый объём: ${wPerScene} слов. Диапазон: ${wMin}–${wMax} слов (±20%).`,
    `Варьируй targetWords по событию: переход/экспозиция → ${wMin}–${Math.round(wPerScene*0.9)} сл; стандартная сцена → ${Math.round(wPerScene*0.9)}–${Math.round(wPerScene*1.1)} сл; кульминация/откровение → ${Math.round(wPerScene*1.1)}–${wMax} сл.`,
    'НЕ выходи за пределы диапазона. Общая сумма targetWords должна быть близка к целевому объёму.',
  ].join('\n');
  // Нарративная инструкция по позиции в серии
  let seriesArcNote = '';
  if(p.type==='series'){
    const book = p.seriesBook||1, total = p.seriesTotal||3;
    if(book===1)
      seriesArcNote = `ПОЗИЦИЯ В СЕРИИ — книга 1 из ${total}: заложи мир, персонажей и главный серийный конфликт. Финал открытый — угроза обозначена, но не разрешена, читатель хочет продолжения.`;
    else if(book===total)
      seriesArcNote = `ПОЗИЦИЯ В СЕРИИ — финальная книга (${book} из ${total}): все нити серии должны найти разрешение, финал — полная точка для всего цикла.`;
    else
      seriesArcNote = `ПОЗИЦИЯ В СЕРИИ — книга ${book} из ${total}: развивай персонажей и углубляй конфликт из предыдущих книг. Финал продвигает серийный конфликт, но не закрывает его полностью — впереди ещё ${total-book} книг.`;
  }

  const user = [
    `Жанр: ${p.genre||'роман'}${p.subgenre?', '+p.subgenre:''}.`,
    p.era ? `Эпоха: ${p.era}.` : '',
    p.audience ? `Аудитория: ${p.audience}.` : '',
    `Идея/синопсис: ${p.synopsis || p.idea || '(не задан)'}`,
    p.type==='series' ? `Серия: «${p.seriesTitle||'(без названия)'}» — книга ${p.seriesBook||1} из ${p.seriesTotal||3}.` : '',
    seriesArcNote,
    p.seriesSummary ? `Содержание предыдущих книг:\n${p.seriesSummary}` : '',
    `Целевой объём: ${totalWords} слов (~${targetScenes} сцен × ~${wPerScene} слов каждая).`,
    // Если это улучшение — показываем предыдущий скелет и проблемы
    opts.previousSkeleton ? (() => {
      const prev = opts.previousSkeleton;
      const skText = prev.chapters.map((ch,ci)=>{
        const scList = (ch.scenes||[]).map((sc,si)=>`    ${ci+1}.${si+1}. «${sc.title}» — ${sc.brief||'(без брифа)'}`).join('\n');
        return `Глава ${ci+1} [${ch.arc||'?'}]: «${ch.title}»\n${scList}`;
      }).join('\n\n');
      return `\nПРЕДЫДУЩАЯ СТРУКТУРА — улучши её, не создавай с нуля. Сохрани то, что работает; исправь только проблемы ниже:\n${skText}`;
    })() : '',
    opts.hint ? `\nПРОБЛЕМЫ ДЛЯ ИСПРАВЛЕНИЯ:\n${opts.hint}` : '',
    '',
    opts.previousSkeleton ? 'Улучши структуру: сохрани рабочие элементы, точечно исправь проблемы. Верни JSON:' : 'Спроектируй скелет. Верни JSON:',
    '{ "chapters": [ { "title": "название главы", "arc": "завязка|развитие|кульминация|развязка", "scenes": [ { "title": "название сцены", "brief": "2-3 предложения: что происходит → ключевой конфликт или открытие → чем кончается и что изменилось", "emotion": "эмоция читателя в финале сцены", "targetWords": число } ] } ] }',
    `Итого ~${targetScenes} сцен, сумма targetWords ≈ ${totalWords}. Брифы конкретные. Только JSON.`,
  ].filter(Boolean).join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

// Валидация + нормализация скелета. Возвращает {ok, skeleton|error}.
export function validateSkeleton(raw){
  let j = extractJSON(raw);
  if(!j) return { ok:false, error:'не удалось распарсить JSON' };
  // Модель иногда оборачивает ответ: { "skeleton": {...} } или { "data": {...} }
  if(!Array.isArray(j.chapters)){
    const nested = Object.values(j).find(v => v && Array.isArray(v.chapters));
    if(nested) j = nested;
  }
  if(!Array.isArray(j.chapters) || !j.chapters.length){
    return { ok:false, error:'нет массива chapters' };
  }
  const chapters = [];
  for(const ch of j.chapters){
    if(!ch || typeof ch.title!=='string') continue;
    // Принимаем любую сцену, у которой есть title (brief может быть null/undefined — LLM иногда
    // использует "description" или вовсе не заполняет поле; не выбрасываем главу из-за этого).
    const scenes = Array.isArray(ch.scenes) ? ch.scenes.filter(s=>s && s.title) : [];
    if(!scenes.length) continue;
    chapters.push({
      title: ch.title.trim(),
      arc: ARCS.includes(ch.arc) ? ch.arc : 'развитие',
      scenes: scenes.map(s=>({
        title: (s.title||'Без названия').trim(),
        // Fallback: brief → description → summary → пустая строка
        brief: (typeof s.brief==='string' ? s.brief : typeof s.description==='string' ? s.description : typeof s.summary==='string' ? s.summary : '').trim(),
        emotion: (s.emotion||'').trim(),
        targetWords: Number(s.targetWords)>0 ? Math.round(Number(s.targetWords)) : 700,
      })),
    });
  }
  if(!chapters.length) return { ok:false, error:'ни одной валидной главы со сценами' };
  return { ok:true, skeleton:{ chapters } };
}

// Запуск с ретраем при невалидном JSON (спека 11: кривой JSON ломает пайплайн).
export async function runBookArchitect(state, opts={}){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ.');
  const msgs = bookArchitectMessages(state, opts);
  // ~140 токенов на сцену (русский бриф 1-2 предложения + поля) + накладные
  const p = state.project;
  const targetScenes = Math.max(6, Math.round((p.targetWords||80000) / Math.max(700, Math.round((p.targetWords||80000)/60))));
  const archMaxTokens = Math.max(4000, Math.min(16000, targetScenes * 140 + 1500));
  const wPerScene = Math.max(700, Math.min(2000, Math.round((p.targetWords||80000)/60)));
  let lastErr = '';
  for(let attempt=0; attempt<=(g.retries??2); attempt++){
    const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.6, messages:msgs, maxTokens:archMaxTokens });
    const v = validateSkeleton(res.text);
    if(v.ok){
      // Нормализация targetWords: база = totalWords / фактич. число сцен.
      // ЛЛМ может варьировать ±20% по событию — принимаем; за диапазон → клэмп.
      const allScenes = v.skeleton.chapters.flatMap(ch=>ch.scenes||[]);
      const norm = Math.max(700, Math.min(2000, Math.round((p.targetWords||80000)/Math.max(1,allScenes.length))));
      const minW = Math.round(norm * 0.80);
      const maxW = Math.round(norm * 1.20);
      allScenes.forEach(sc=>{
        const tw = Number(sc.targetWords)||0;
        if(tw < minW) sc.targetWords = norm;
        else if(tw > maxW) sc.targetWords = maxW;
      });
      return v.skeleton;
    }
    lastErr = v.error;
    const preview = (res.text||'').slice(0, 120).replace(/\n/g,' ');
    // на ретрае — сообщаем модели что конкретно не так
    if((res.text||'').trim().endsWith('"') || (res.text||'').trim().endsWith(',') || !(res.text||'').trim().endsWith('}')){
      msgs.push({ role:'user', content:`JSON обрезан (ответ не закончен). Повтори запрос: верни ТОЛЬКО полный JSON-объект с chapters, без пояснений. Пример начала: {"chapters":[{"title":"...` });
    } else {
      msgs.push({ role:'user', content:`Ответ невалиден (${v.error}). Начало ответа: «${preview}». Верни СТРОГО JSON {"chapters":[...]} без лишнего текста.` });
    }
  }
  throw new Error(`Книжный архитектор вернул невалидный скелет: ${lastErr}`);
}

// Перегенерация ОДНОЙ сцены скелета с подсказкой автора о направлении.
// Видит соседние сцены и главу — чтобы вписаться в дугу. Возвращает поля сцены.
export async function regenerateScene(state, scene, hint){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ.');
  const nodes = state.structure||[];
  const ch = nodes.find(n=>n.type==='chapter' && n.id===scene.chapterId);
  const scenes = nodes.filter(n=>n.type==='scene');
  const idx = scenes.findIndex(n=>n.id===scene.id);
  const prev = scenes[idx-1], next = scenes[idx+1];
  const p = state.project;
  const sys = 'Ты — книжный архитектор. Перепроектируй ОДНУ сцену по подсказке автора, сохраняя её место в нарративной арке книги. Не пишешь прозу.';
  const user = [
    `Жанр: ${p.genre||'роман'}. Синопсис: ${p.synopsis||p.idea||''}`,
    ch?`Глава: «${ch.title}» (${ch.arc||''}).`:'',
    prev?`Предыдущая сцена: «${prev.title}» — ${prev.brief}`:'',
    next?`Следующая сцена: «${next.title}» — ${next.brief}`:'',
    `Текущая сцена: «${scene.title}» — ${scene.brief}`,
    '',
    'ПОДСКАЗКА АВТОРА (в каком направлении переделать): ' + (hint||'сделай сильнее и конкретнее'),
    '',
    'Верни JSON одной сцены: { "title":"…", "brief":"что происходит, тон, чем заканчивается", "emotion":"эмоция читателя", "targetWords":число }. Только JSON.',
  ].filter(Boolean).join('\n');
  let lastErr='';
  for(let attempt=0; attempt<=(g.retries??2); attempt++){
    const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.7, messages:[{role:'system',content:sys},{role:'user',content:user}], maxTokens:500 });
    const j = extractJSON(res.text);
    if(j && typeof j.brief==='string'){
      return {
        title:(j.title||scene.title).trim(),
        brief:j.brief.trim(),
        emotion:(j.emotion||scene.emotion||'').trim(),
        targetWords: Number(j.targetWords)>0?Math.round(Number(j.targetWords)):(scene.targetWords||700),
      };
    }
    lastErr='невалидный JSON';
  }
  throw new Error('Не удалось перегенерировать: '+lastErr);
}

// Каскадная перегенерация ВСЕХ последующих сцен с учётом изменения текущей
// (когда поворот сюжета сделал хвост книги несогласованным). Сохраняет число
// сцен и привязку к главам; переписывает их брифы/эмоции консистентно.
export async function regenerateDownstream(state, pivotScene, hint){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ.');
  const nodes = state.structure||[];
  const scenes = nodes.filter(n=>n.type==='scene');
  const pi = scenes.findIndex(n=>n.id===pivotScene.id);
  const downstream = scenes.slice(pi+1);
  if(!downstream.length) return [];

  const chTitle = id => (nodes.find(n=>n.type==='chapter'&&n.id===id)||{}).title || '';
  const p = state.project;
  const sys = 'Ты — книжный архитектор. Изменилась одна сцена и повернула сюжет. Перепроектируй ВСЕ последующие сцены так, чтобы они логически следовали из изменения и не противоречили ему. Сохрани число сцен и их принадлежность главам. Не пишешь прозу.';
  const list = downstream.map((s,i)=>`${i+1}. [${chTitle(s.chapterId)}] «${s.title}» — ${s.brief}`).join('\n');
  const user = [
    `Жанр: ${p.genre||'роман'}. Синопсис: ${p.synopsis||p.idea||''}`,
    '',
    `ИЗМЕНЁННАЯ СЦЕНА (поворот): «${pivotScene.title}» — ${pivotScene.brief}` + (pivotScene.emotion?` (эмоция: ${pivotScene.emotion})`:''),
    hint?`Направление автора: ${hint}`:'',
    '',
    `ПОСЛЕДУЮЩИЕ СЦЕНЫ (${downstream.length}) — перепиши каждую под новый поворот, по порядку:`,
    list,
    '',
    `Верни JSON: { "scenes": [ ${downstream.length} объектов по порядку: {"title":"…","brief":"…","emotion":"…","targetWords":число} ] }. Ровно ${downstream.length} сцен. Только JSON.`,
  ].filter(Boolean).join('\n');

  let lastErr='';
  for(let attempt=0; attempt<=(g.retries??2); attempt++){
    const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.7, messages:[{role:'system',content:sys},{role:'user',content:user}], maxTokens:3000 });
    const j = extractJSON(res.text);
    const arr = j && Array.isArray(j.scenes) ? j.scenes.filter(x=>x&&typeof x.brief==='string') : null;
    if(arr && arr.length){
      // применяем позиционно; число сцен не меняем (берём min для устойчивости)
      const applied = [];
      for(let i=0;i<Math.min(arr.length, downstream.length);i++){
        const sc = downstream[i], fr = arr[i];
        pushSceneVersion(sc);
        sc.title=(fr.title||sc.title).trim();
        sc.brief=fr.brief.trim();
        sc.emotion=(fr.emotion||sc.emotion||'').trim();
        if(Number(fr.targetWords)>0) sc.targetWords=Math.round(Number(fr.targetWords));
        applied.push(sc.id);
      }
      return applied;
    }
    lastErr='невалидный JSON';
  }
  throw new Error('Каскадная перегенерация не удалась: '+lastErr);
}

// История версий сцены-скелета: сохранить текущие поля перед заменой / откатить.
const SCENE_FIELDS = ['title','brief','emotion','targetWords'];
export function pushSceneVersion(scene){
  scene.briefVersions = scene.briefVersions || [];
  scene.briefVersions.unshift(Object.fromEntries(SCENE_FIELDS.map(f=>[f, scene[f]])));
  if(scene.briefVersions.length>10) scene.briefVersions.length=10;
}
export function revertScene(scene){
  if(!scene.briefVersions || !scene.briefVersions.length) return false;
  const v = scene.briefVersions.shift();
  SCENE_FIELDS.forEach(f=>{ if(v[f]!==undefined) scene[f]=v[f]; });
  return true;
}

// Применить скелет к плоскому state.structure[] (chapter|scene узлы).
// Перед заменой сохраняет прошлую структуру в историю (откат полного скелета).
export function applySkeleton(state, skeleton, uid){
  pushSkeletonVersion(state);
  const nodes = [];
  for(const ch of skeleton.chapters){
    const chId = uid('ch');
    nodes.push({ id:chId, type:'chapter', title:ch.title, arc:ch.arc });
    for(const sc of ch.scenes){
      nodes.push({ id:uid('sc'), type:'scene', chapterId:chId, title:sc.title, brief:sc.brief,
        emotion:sc.emotion, targetWords:sc.targetWords, text:'', words:0, status:'todo' });
    }
  }
  state.structure = nodes;
}

// ── История полного скелета (откат неудачной перегенерации) ──
export function pushSkeletonVersion(state){
  if(!state.structure || !state.structure.length) return; // нечего сохранять на первой генерации
  state.skeletonVersions = state.skeletonVersions || [];
  state.skeletonVersions.unshift(JSON.parse(JSON.stringify(state.structure)));
  if(state.skeletonVersions.length>5) state.skeletonVersions.length=5;
}
export function revertSkeleton(state){
  if(!state.skeletonVersions || !state.skeletonVersions.length) return false;
  const prev = state.skeletonVersions.shift();
  state.skeletonVersions.unshift(JSON.parse(JSON.stringify(state.structure))); // текущее → в историю (свап, можно вернуться)
  state.structure = prev;
  return true;
}

// ── Оценщик структуры: оценивает сгенерированный скелет по 5 осям ──
// Возвращает { score, axes:{arc,pacing,conflict,balance,ending}, issues[], suggestions[] }
// prevEval (опц.) — оценка ДО перегенерации: без неё каждый прогон видит скелет свежим
// взглядом и либо дословно повторяет прошлую критику, либо чинит одно замечание ценой
// другого (напр. "добавь сцену-паузу" → "теперь глава перегружена сценами").
export function structureEvalMessages(state, skeleton, prevEval){
  const p = state.project;
  const totalScenes = skeleton.chapters.reduce((n,ch)=>n+(ch.scenes||[]).length, 0);
  const sys = [
    'Ты — главный редактор с 20-летним опытом. Оцени АРХИТЕКТУРУ скелета книги.',
    'Ищи только структурные проблемы, которые нельзя починить на уровне сцены:',
    '• Диспропорции: слишком длинный/короткий акт, скучкованные сцены одного типа',
    '• Нарративные провалы: нет момента невозврата, финал не подготовлен, кульминация смещена',
    '• Конфликт без нарастания или без разрядки',
    '• Финал серии (если серия) без нужного закрытия/открытия арок',
    'Не оценивай качество брифов, стиль или детали — только АРХИТЕКТУРУ.',
    prevEval && (prevEval.issues||[]).length
      ? 'Тебе дана ПРЕДЫДУЩАЯ ОЦЕНКА этой же книги до правки. По каждой прошлой проблеме явно реши: устранена или нет. Не подменяй устранённую проблему похожей, но другой критикой того же места — если правка решила именно то, что было заявлено, значит проблема закрыта, даже если место ещё не идеально. Для неустранённых — объясни, что конкретно осталось, и включи в issues с пометкой «(не устранено)».'
      : '',
  ].filter(Boolean).join('\n');

  // Компактный скелет для промпта
  const skeletonText = skeleton.chapters.map((ch,ci)=>{
    const scList = (ch.scenes||[]).map((s,si)=>`    ${ci+1}.${si+1}. «${s.title}» [${s.targetWords||700}сл] — ${s.brief}`).join('\n');
    return `Глава ${ci+1} [${ch.arc||'?'}]: «${ch.title}»\n${scList}`;
  }).join('\n\n');

  const prevBlock = prevEval && (prevEval.issues||[]).length
    ? `\nПРЕДЫДУЩАЯ ОЦЕНКА (${prevEval.score}/10) отметила эти проблемы — проверь каждую:\n${prevEval.issues.map((s,i)=>`${i+1}. ${s}`).join('\n')}`
    : '';

  const user = [
    `Жанр: ${p.genre||'роман'}, аудитория: ${p.audience||'широкая'}, объём: ${(p.targetWords||80000)/1000}к слов.`,
    p.synopsis||p.idea ? `Синопсис: ${p.synopsis||p.idea}` : '',
    p.type==='series' ? `Серия: книга ${p.seriesBook||1} из ${p.seriesTotal||3}.` : '',
    prevBlock,
    '',
    `СКЕЛЕТ (${skeleton.chapters.length} глав, ${totalScenes} сцен):`,
    skeletonText,
    '',
    'Оцени структуру. Верни JSON:',
    '{ "score": среднее_float_0-10, "axes": { "arc": 0-10, "pacing": 0-10, "conflict": 0-10, "balance": 0-10, "ending": 0-10 }, "issues": ["до 4 реальных проблем, кратко и конкретно"], "suggestions": ["до 4 конкретных улучшений со ссылками на главы/сцены"] }',
    'Если структура хороша — скажи это в suggestions. issues может быть пустым. Только JSON.',
  ].filter(Boolean).join('\n');

  return [{role:'system',content:sys},{role:'user',content:user}];
}

export async function runStructureEval(state, skeleton, prevEval){
  const g = state.global;
  if(!g.apiKey) return null;
  const msgs = structureEvalMessages(state, skeleton, prevEval);
  try {
    const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.2, messages:msgs, maxTokens:800 });
    const j = extractJSON(res.text);
    if(!j || typeof j.score !== 'number') return null;
    return {
      score: Math.max(0, Math.min(10, j.score)),
      axes: {
        arc:      Math.max(0,Math.min(10, (j.axes||{}).arc      ?? j.score)),
        pacing:   Math.max(0,Math.min(10, (j.axes||{}).pacing   ?? j.score)),
        conflict: Math.max(0,Math.min(10, (j.axes||{}).conflict ?? j.score)),
        balance:  Math.max(0,Math.min(10, (j.axes||{}).balance  ?? j.score)),
        ending:   Math.max(0,Math.min(10, (j.axes||{}).ending   ?? j.score)),
      },
      issues:      Array.isArray(j.issues)      ? j.issues.slice(0,4).map(String)      : [],
      suggestions: Array.isArray(j.suggestions) ? j.suggestions.slice(0,4).map(String) : [],
    };
  } catch(e){
    return null; // оценка необязательна — молча игнорируем ошибку
  }
}

// ── Перегенерация всех сцен ОДНОЙ главы с подсказкой ──
export async function regenerateChapter(state, chapter, hint){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ.');
  const nodes = state.structure||[];
  const ci = nodes.findIndex(n=>n.id===chapter.id);
  const scenes=[]; for(let i=ci+1;i<nodes.length;i++){ if(nodes[i].type==='chapter') break; if(nodes[i].type==='scene') scenes.push(nodes[i]); }
  if(!scenes.length) return [];
  const p = state.project;
  const sys = 'Ты — книжный архитектор. Перепроектируй сцены ОДНОЙ главы по подсказке автора, сохраняя их число и дугу главы. Не пишешь прозу.';
  const user = [
    `Жанр: ${p.genre||'роман'}. Синопсис: ${p.synopsis||p.idea||''}`,
    `Глава: «${chapter.title}» (${chapter.arc||''}). Сцен: ${scenes.length}.`,
    'Текущие сцены:\n'+scenes.map((s,i)=>`${i+1}. «${s.title}» — ${s.brief}`).join('\n'),
    '',
    'ПОДСКАЗКА АВТОРА: ' + (hint||'сделай сильнее и конкретнее, сохрани сюжетные функции'),
    '',
    `Верни JSON: { "scenes": [ ровно ${scenes.length} объектов: {"title","brief","emotion","targetWords"} ] }. Только JSON.`,
  ].join('\n');
  let lastErr='';
  for(let attempt=0; attempt<=(g.retries??2); attempt++){
    const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.7, messages:[{role:'system',content:sys},{role:'user',content:user}], maxTokens:2000 });
    const j = extractJSON(res.text);
    const arr = j && Array.isArray(j.scenes) ? j.scenes.filter(x=>x&&typeof x.brief==='string') : null;
    if(arr && arr.length){
      const applied=[];
      for(let i=0;i<Math.min(arr.length,scenes.length);i++){
        const sc=scenes[i], fr=arr[i];
        pushSceneVersion(sc);
        sc.title=(fr.title||sc.title).trim(); sc.brief=fr.brief.trim(); sc.emotion=(fr.emotion||sc.emotion||'').trim();
        if(Number(fr.targetWords)>0) sc.targetWords=Math.round(Number(fr.targetWords));
        applied.push(sc.id);
      }
      return applied;
    }
    lastErr='невалидный JSON';
  }
  throw new Error('Перегенерация главы не удалась: '+lastErr);
}
