// Книжный архитектор (спека 5.3) — один запуск на стадии Структура.
// Возвращает скелет: главы → сцены (название, бриф, эмоция, объём, арка).
// Temp 0.6. Выход валидируется по схеме с ретраем (спека 11).
// + Оценщик структуры: после генерации оценивает скелет и даёт рекомендации.

import { callLLM, extractJSON } from './llm.js';
import { genreBeatsNote, genreWantsHumor } from './genres.js';
import { bibleForPrompt } from './bible.js';
import { ag } from './state.js';

const ARCS = ['завязка','развитие','кульминация','развязка'];

const PACING_NOTES = {
  action: 'После сильной сцены-потрясения ЧАСТО (не обязательно) нужен короткий sequel — обычно 10-20% сцен книги — sequel, акцент на действии, реже передышки.',
  balanced: 'После сильной сцены-потрясения почти всегда нужен короткий sequel — но НЕ жёстко через одну: используй по ощущению ритма, обычно 20-35% сцен книги — sequel.',
  reflective: 'После сильной сцены-потрясения нужен sequel почти всегда — обычно 35-50% сцен книги — sequel, акцент на внутренней рефлексии, больше пауз между потрясениями.',
};

export function bookArchitectMessages(state, opts={}){
  const p = state.project;
  const totalWords = p.targetWords || 80000;
  // Целевой объём сцены: авто (totalWords/60, зажато 700-2000) ИЛИ явный
  // авторский оверрайд (project.sceneWords) — тогда диапазон шире (300-4000):
  // осознанный выбор автора не зажимаем той же вилкой, что защищает только
  // автоформулу от вырожденных случаев общего объёма (спека §12.1).
  const wPerScene = p.sceneWords>0
    ? Math.max(300, Math.min(4000, p.sceneWords))
    : Math.max(700, Math.min(2000, Math.round(totalWords / 60)));
  const targetScenes = Math.max(6, Math.round(totalWords / wPerScene));
  // При «Улучшении» (opts.previousSkeleton) книга уже разбита на реальные
  // главы/сцены — просить «раздели на N глав» по формуле общего объёма
  // (которая может предсказать совсем другое число, напр. 17 вместо
  // фактических 12) прямо противоречит соседней инструкции «сохрани рабочие
  // элементы, точечно исправь проблемы» несколькими строками ниже. Модель
  // получает два взаимоисключающих указания сразу — раздели заново ИЛИ
  // сохрани. Берём фактические числа из previousSkeleton, когда они есть.
  const prevChapterCount = opts.previousSkeleton ? opts.previousSkeleton.chapters.length : 0;
  const prevSceneCount = opts.previousSkeleton
    ? opts.previousSkeleton.chapters.reduce((n,ch)=>n+(ch.scenes||[]).length, 0) : 0;
  const targetChapters = opts.chapters || prevChapterCount || Math.max(3, Math.min(25, Math.round(targetScenes / 3.5)));
  const scenesPerCh = Math.max(2, Math.round((prevSceneCount || targetScenes) / targetChapters));

  const wMin = Math.round(wPerScene * 0.80);
  const wMax = Math.round(wPerScene * 1.20);
  const sys = [
    'Ты — книжный архитектор. Ты проектируешь скелет книги: главы и сцены. Ты НЕ пишешь прозу.',
    `Каждая сцена — единица письма. Базовый объём: ${wPerScene} слов. Диапазон: ${wMin}–${wMax} слов (±20%).`,
    `Варьируй targetWords по событию: переход/экспозиция → ${wMin}–${Math.round(wPerScene*0.9)} сл; стандартная сцена → ${Math.round(wPerScene*0.9)}–${Math.round(wPerScene*1.1)} сл; кульминация/откровение → ${Math.round(wPerScene*1.1)}–${wMax} сл.`,
    'НЕ выходи за пределы диапазона. Общая сумма targetWords должна быть близка к целевому объёму.',
    'Классифицируй КАЖДУЮ сцену по sceneType (техника Дуайта Свейна — «сцена/секвель», основа ритма профессиональной прозы):',
    '  "scene" — сцена действия: цель героя → конфликт/препятствие → поражение или осложнение (кончается ХУЖЕ, чем начиналась, не разрешением). Растущее напряжение.',
    '  "sequel" — секвель: эмоциональная реакция героя на произошедшее → дилемма (взвешивание вариантов) → решение, которое ставит новую цель. Передышка для читателя, меньше внешнего действия.',
    PACING_NOTES[p.pacing] || PACING_NOTES.balanced,
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
    `Раздели на ${targetChapters} глав (~${scenesPerCh} сцен на главу).`,
    genreBeatsNote(p.genre),
    // Живой пример на «Разломе»: примеры в genreBeatsNote завязаны на магию
    // (профсоюзы драконов, волокита в гильдии) — Архитектор применял иронию
    // ТОЛЬКО к сценам, где на сцене буквально есть магия/гильдия, и полностью
    // пропускал её в немагических сценах (лаборатория, техника, транзитные
    // моменты) той же самой книги, хотя жанр отмечен для книги целиком, а не
    // только для «фэнтезийной половины» сюжета. Прозаик получает от Архитектора
    // только конкретный бриф сцены — если сама формулировка брифа стопроцентно
    // серьёзна, общая жанровая заметка (genreToneNote) редко перевешивает
    // конкретную задачу сцены.
    genreWantsHumor(p.genre)
      ? 'ВАЖНО: ирония жанра — не только про магию. Применяй приём снижения пафоса (бюрократическая/бытовая деталь, самоирония, нелепое несоответствие) РАВНОМЕРНО ко ВСЕМ сценам книги, включая технологические, лабораторные, транзитные и любые немагические — не только там, где на сцене прямо есть магия/гильдия/квест. В брифе КАЖДОЙ сцены явно назови конкретный комический момент словами (какая деталь/реплика/несоответствие снижает пафос именно здесь) — не оставляй это на усмотрение Прозаика без указания.'
      : '',
    (() => {
      // k=15 (не 5/6, как в per-сцена выборках) — разовый обзор всей книги на этапе скелета, нужна широта, не глубина.
      const worldBlock = bibleForPrompt((state.bible||[]).filter(b=>b.source==='world'), p.synopsis||p.idea||'', 15);
      return worldBlock ? `\nМИР КНИГИ (уже зафиксированные факты — не противоречь им):\n${worldBlock}` : '';
    })(),
    // Если это улучшение — показываем предыдущий скелет и проблемы
    opts.previousSkeleton ? (() => {
      const prev = opts.previousSkeleton;
      // Тип сцены/секвель показан в скобках тем же способом, что и Оценщику
      // структуры (structureEvalMessages) — раньше это поле сюда не попадало
      // вообще, и Архитектор при «улучшении» расставлял ритм сцена/секвель
      // заново вслепую на каждой итерации (temp 0.6), хотя Оценщик судит именно
      // по этой оси. Точечное исправление одной проблемы могло случайно
      // перетасовать весь ритм книги и уронить итоговый балл.
      const skText = prev.chapters.map((ch,ci)=>{
        const scList = (ch.scenes||[]).map((sc,si)=>`    ${ci+1}.${si+1}. (${sc.sceneType==='sequel'?'секвель':'сцена'}) «${sc.title}» — ${sc.brief||'(без брифа)'}`).join('\n');
        return `Глава ${ci+1} [${ch.arc||'?'}]: «${ch.title}»\n${scList}`;
      }).join('\n\n');
      return `\nПРЕДЫДУЩАЯ СТРУКТУРА — улучши её, не создавай с нуля. Сохрани то, что работает; исправь только проблемы ниже:\n${skText}`;
    })() : '',
    opts.hint ? `\nПРОБЛЕМЫ ДЛЯ ИСПРАВЛЕНИЯ:\n${opts.hint}` : '',
    '',
    opts.previousSkeleton ? 'Улучши структуру: сохрани рабочие элементы, точечно исправь проблемы. В том числе сохрани sceneType (сцена/секвель) у сцен, которых правка не касается напрямую, — не перетасовывай ритм сцена/секвель заново без причины, только потому что переписываешь скелет. Верни JSON:' : 'Спроектируй скелет. Верни JSON:',
    '{ "chapters": [ { "title": "название главы", "arc": "завязка|развитие|кульминация|развязка", "scenes": [ { "title": "название сцены", "brief": "2-3 предложения: что происходит → ключевой конфликт или открытие → чем кончается и что изменилось", "emotion": "эмоция читателя в финале сцены", "targetWords": число, "sceneType": "scene|sequel" } ] } ] }',
    `Итого ${targetChapters} глав, ~${prevSceneCount || targetScenes} сцен, сумма targetWords ≈ ${totalWords}. Брифы конкретные. Только JSON.`,
  ].filter(Boolean).join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

// Нормализация одной главы из сырого ответа LLM — общая часть validateSkeleton
// и validateSkeletonPatch (точечные правки, см. ниже). Возвращает null, если
// глава без title или без единой валидной сцены.
function normalizeChapterRaw(ch){
  if(!ch || typeof ch.title!=='string') return null;
  // Принимаем любую сцену, у которой есть title (brief может быть null/undefined — LLM иногда
  // использует "description" или вовсе не заполняет поле; не выбрасываем главу из-за этого).
  const scenes = Array.isArray(ch.scenes) ? ch.scenes.filter(s=>s && s.title) : [];
  if(!scenes.length) return null;
  return {
    title: ch.title.trim(),
    arc: ARCS.includes(ch.arc) ? ch.arc : 'развитие',
    scenes: scenes.map(s=>({
      title: (s.title||'Без названия').trim(),
      // Fallback: brief → description → summary → пустая строка
      brief: (typeof s.brief==='string' ? s.brief : typeof s.description==='string' ? s.description : typeof s.summary==='string' ? s.summary : '').trim(),
      emotion: (s.emotion||'').trim(),
      targetWords: Number(s.targetWords)>0 ? Math.round(Number(s.targetWords)) : 700,
      sceneType: s.sceneType==='sequel' ? 'sequel' : 'scene',
    })),
  };
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
  const chapters = j.chapters.map(normalizeChapterRaw).filter(Boolean);
  if(!chapters.length) return { ok:false, error:'ни одной валидной главы со сценами' };
  return { ok:true, skeleton:{ chapters } };
}

// Валидация ответа ТОЧЕЧНОЙ правки (bookArchitectPatchMessages) — модель
// обязана вернуть только главы из allowedNumbers (1-based позиция главы в
// текущей книге), помеченные полем "number". Контекстные главы, которые ей
// показали для стыка ритма, но просили не редактировать, отфильтровываются
// здесь же — если модель всё равно их вернула, просто игнорируем.
export function validateSkeletonPatch(raw, allowedNumbers){
  let j = extractJSON(raw);
  if(!j) return { ok:false, error:'не удалось распарсить JSON' };
  if(!Array.isArray(j.chapters)){
    const nested = Object.values(j).find(v => v && Array.isArray(v.chapters));
    if(nested) j = nested;
  }
  if(!Array.isArray(j.chapters) || !j.chapters.length){
    return { ok:false, error:'нет массива chapters' };
  }
  const allowed = new Set(allowedNumbers);
  const chapters = [];
  for(const ch of j.chapters){
    const number = Number(ch && ch.number);
    if(!allowed.has(number)) continue;
    const norm = normalizeChapterRaw(ch);
    if(norm) chapters.push({ number, ...norm });
  }
  if(!chapters.length) return { ok:false, error:'ни одной валидной главы из запрошенных номеров' };
  return { ok:true, chapters };
}

// Запуск с ретраем при невалидном JSON (спека 11: кривой JSON ломает пайплайн).
export async function runBookArchitect(state, opts={}){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ.');
  const architectAgent = ag(state, 'bookArchitect');
  const msgs = bookArchitectMessages(state, opts);
  // ~140 токенов на сцену (русский бриф 1-2 предложения + поля) + накладные
  const p = state.project;
  // Та же формула wPerScene, что и в bookArchitectMessages — иначе при явном
  // project.sceneWords здесь получим СТАРОЕ (меньшее) число сцен, а промпт
  // попросит модель сгенерировать БОЛЬШЕЕ — и archMaxTokens окажется занижен,
  // провоцируя обрезание JSON именно тогда, когда включён sceneWords.
  const wPerScene = p.sceneWords>0
    ? Math.max(300, Math.min(4000, p.sceneWords))
    : Math.max(700, Math.min(2000, Math.round((p.targetWords||80000)/60)));
  const targetScenes = Math.max(6, Math.round((p.targetWords||80000) / wPerScene));
  // При «Улучшении» формула-предсказание может недооценить фактический размер
  // книги — живой пример: формула по общему объёму предсказала 60 сцен
  // (9900 ток. бюджета), а книга уже реально разрослась до 47 сцен с
  // РАЗВЁРНУТЫМИ брифами (2-3 предложения, не черновые 1-2, как при первой
  // генерации — сама инструкция «улучши» требует сохранить детализацию, не
  // урезать её). 9900 токенов не хватило, JSON обрывался на середине и не
  // парсился. Берём максимум из формулы и фактического числа сцен, и щедрее
  // считаем токены на сцену именно для improve (там брифы длиннее черновых).
  const prevSceneCountForBudget = opts.previousSkeleton
    ? opts.previousSkeleton.chapters.reduce((n,ch)=>n+(ch.scenes||[]).length, 0) : 0;
  const effectiveScenes = Math.max(targetScenes, prevSceneCountForBudget);
  const perSceneTokens = opts.previousSkeleton ? 250 : 140;
  const archMaxTokens = Math.max(4000, Math.min(24000, effectiveScenes * perSceneTokens + 1500));
  let lastErr = '';
  for(let attempt=0; attempt<=(g.retries??2); attempt++){
    const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:architectAgent.temp??0.6, messages:msgs, maxTokens:archMaxTokens });
    const v = validateSkeleton(res.text);
    if(v.ok){
      // Нормализация targetWords: база = totalWords / фактич. число сцен.
      // ЛЛМ может варьировать ±20% по событию — принимаем; за диапазон → клэмп.
      const allScenes = v.skeleton.chapters.flatMap(ch=>ch.scenes||[]);
      const norm = p.sceneWords>0
        ? Math.max(300, Math.min(4000, p.sceneWords))
        : Math.max(700, Math.min(2000, Math.round((p.targetWords||80000)/Math.max(1,allScenes.length))));
      const minW = Math.round(norm * 0.80);
      const maxW = Math.round(norm * 1.20);
      allScenes.forEach(sc=>{
        const tw = Number(sc.targetWords)||0;
        // Симметрично верхнему краю: клэмп в minW, а не в norm — иначе
        // намеренно короткая переходная/экспозиционная сцена (промпт сам
        // просит писать такие короче среднего) принудительно раздувалась
        // до полного среднего объёма без предупреждения.
        if(tw < minW) sc.targetWords = minW;
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

// ── Точечная правка скелета (structurePatchMode) ──
// Вместо пересборки ВСЕЙ книги (bookArchitectMessages — даже нетронутые главы
// неизбежно немного переписываются моделью при temp 0.6, что и уронило балл
// на живом прогоне на «Разломе»: 4 проблемы 3 итерации подряд помечались
// «не устранено», хотя формулировки сцен каждый раз менялись) — отдаём модели
// ТОЛЬКО главы, которые Оценщик назвал в affectedChapters, плюс по одной
// соседней с каждого края КАК КОНТЕКСТ (не редактировать — нужен только чтобы
// модель видела стык ритма сцена/секвель на границе). Все остальные главы,
// включая уже написанные сцены, вообще не попадают в запрос.
export function bookArchitectPatchMessages(state, { affectedChapters, hint }){
  const p = state.project;
  const chapterNodes = (state.structure||[]).filter(n=>n.type==='chapter');
  const structure = state.structure||[];
  const targets = new Set(affectedChapters);
  const contextOnly = new Set();
  affectedChapters.forEach(n=>{
    if(n-1>=1 && !targets.has(n-1)) contextOnly.add(n-1);
    if(n+1<=chapterNodes.length && !targets.has(n+1)) contextOnly.add(n+1);
  });
  const wanted = [...targets, ...contextOnly].sort((a,b)=>a-b);

  const wPerScene = p.sceneWords>0
    ? Math.max(300, Math.min(4000, p.sceneWords))
    : Math.max(700, Math.min(2000, Math.round((p.targetWords||80000)/60)));
  const wMin = Math.round(wPerScene*0.80), wMax = Math.round(wPerScene*1.20);

  const sys = [
    'Ты — книжный архитектор. Тебе показан ФРАГМЕНТ скелета книги — несколько глав, не вся книга.',
    `Перепроектируй ТОЛЬКО главы с номерами: ${affectedChapters.join(', ')}. Главы с пометкой «(КОНТЕКСТ — НЕ редактировать)» показаны только чтобы ты видел стык ритма сцена/секвель на границе — не включай их в ответ и не меняй.`,
    `Базовый объём сцены: ${wPerScene} слов. Диапазон: ${wMin}–${wMax} слов (±20%). НЕ выходи за пределы.`,
    'Классифицируй КАЖДУЮ сцену по sceneType (техника Дуайта Свейна):',
    '  "scene" — сцена действия: цель героя → конфликт/препятствие → поражение или осложнение. Растущее напряжение.',
    '  "sequel" — секвель: реакция героя на произошедшее → дилемма → решение, ставящее новую цель. Передышка, меньше внешнего действия.',
    genreWantsHumor(p.genre)
      ? 'Ирония жанра касается ВСЕХ сцен, не только явно магических/жанровых — сохраняй приём снижения пафоса и там, где он не был явно указан раньше.'
      : '',
  ].filter(Boolean).join('\n');

  const chText = wanted.map(n=>{
    const chNode = chapterNodes[n-1];
    const isTarget = targets.has(n);
    const scenes = structure.filter(s=>s.type==='scene' && s.chapterId===chNode.id);
    const scList = scenes.map((sc,si)=>`    ${n}.${si+1}. (${sc.sceneType==='sequel'?'секвель':'сцена'}) «${sc.title}» [${sc.targetWords||700}сл] — ${sc.brief||'(без брифа)'}`).join('\n');
    return `Глава ${n}${isTarget?'':' (КОНТЕКСТ — НЕ редактировать)'} [${chNode.arc||'?'}]: «${chNode.title}»\n${scList}`;
  }).join('\n\n');

  const user = [
    `Жанр: ${p.genre||'роман'}${p.subgenre?', '+p.subgenre:''}.`,
    'ФРАГМЕНТ СКЕЛЕТА:',
    chText,
    hint ? `\nПРОБЛЕМЫ ДЛЯ ИСПРАВЛЕНИЯ:\n${hint}` : '',
    '',
    `Верни ТОЛЬКО главы ${affectedChapters.join(', ')} (без контекстных), в том же порядке, в JSON:`,
    '{ "chapters": [ { "number": номер_главы, "title": "название главы", "arc": "завязка|развитие|кульминация|развязка", "scenes": [ { "title": "название сцены", "brief": "2-3 предложения: что происходит → ключевой конфликт или открытие → чем кончается и что изменилось", "emotion": "эмоция читателя в финале сцены", "targetWords": число, "sceneType": "scene|sequel" } ] } ] }',
    'Брифы конкретные. Только JSON.',
  ].filter(Boolean).join('\n');

  return [{role:'system',content:sys},{role:'user',content:user}];
}

export async function runBookArchitectPatch(state, opts={}){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ.');
  const architectAgent = ag(state, 'bookArchitect');
  const { affectedChapters } = opts;
  const msgs = bookArchitectPatchMessages(state, opts);
  // Бюджет только под затронутые главы — тот же тариф на сцену (250 ток.),
  // что и полный improve-режим в runBookArchitect, но без раздутия под всю книгу.
  const chapterNodes = (state.structure||[]).filter(n=>n.type==='chapter');
  const structure = state.structure||[];
  const sceneCountInTargets = affectedChapters.reduce((n,num)=>{
    const chNode = chapterNodes[num-1];
    return chNode ? n + structure.filter(s=>s.type==='scene' && s.chapterId===chNode.id).length : n;
  }, 0);
  const maxTokens = Math.max(2000, Math.min(12000, sceneCountInTargets*250 + 800));
  let lastErr = '';
  for(let attempt=0; attempt<=(g.retries??2); attempt++){
    const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:architectAgent.temp??0.6, messages:msgs, maxTokens });
    const v = validateSkeletonPatch(res.text, affectedChapters);
    if(v.ok) return v.chapters;
    lastErr = v.error;
    const preview = (res.text||'').slice(0, 120).replace(/\n/g,' ');
    msgs.push({ role:'user', content:`Ответ невалиден (${v.error}). Начало ответа: «${preview}». Верни СТРОГО JSON {"chapters":[{"number":...,...}]} только для глав ${affectedChapters.join(', ')}, без лишнего текста.` });
  }
  throw new Error(`Архитектор (точечная правка) вернул невалидный ответ: ${lastErr}`);
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
    'Верни JSON одной сцены: { "title":"…", "brief":"что происходит, тон, чем заканчивается", "emotion":"эмоция читателя", "targetWords":число, "sceneType":"scene|sequel" }. sceneType: "scene" — растущее напряжение (цель→конфликт→поражение), "sequel" — передышка (реакция→дилемма→решение). Только JSON.',
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
        sceneType: j.sceneType==='sequel' ? 'sequel' : 'scene',
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
    `Верни JSON: { "scenes": [ ${downstream.length} объектов по порядку: {"title":"…","brief":"…","emotion":"…","targetWords":число,"sceneType":"scene|sequel"} ] }. sceneType: "scene" — растущее напряжение, "sequel" — передышка (реакция→дилемма→решение). Ровно ${downstream.length} сцен. Только JSON.`,
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
        // Тот же фикс, что и в regenerateChapter(): без сброса status/text уже
        // написанная сцена оставалась «готово» со старым текстом, не подходящим
        // под новый бриф после каскадной перегенерации — молча уходило в экспорт.
        if(sc.status==='done' && sc.text){
          sc.proseVersions = sc.proseVersions || [];
          sc.proseVersions.unshift(sc.text);
          if(sc.proseVersions.length>10) sc.proseVersions.length=10;
          sc.status = 'todo';
        }
        sc.title=(fr.title||sc.title).trim();
        sc.brief=fr.brief.trim();
        sc.emotion=(fr.emotion||sc.emotion||'').trim();
        if(Number(fr.targetWords)>0) sc.targetWords=Math.round(Number(fr.targetWords));
        sc.sceneType = fr.sceneType==='sequel' ? 'sequel' : 'scene';
        applied.push(sc.id);
      }
      return applied;
    }
    lastErr='невалидный JSON';
  }
  throw new Error('Каскадная перегенерация не удалась: '+lastErr);
}

// История версий сцены-скелета: сохранить текущие поля перед заменой / откатить.
const SCENE_FIELDS = ['title','brief','emotion','targetWords','sceneType'];
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
        emotion:sc.emotion, targetWords:sc.targetWords, sceneType:sc.sceneType||'scene', text:'', words:0, status:'todo' });
    }
  }
  state.structure = nodes;
}

// Слияние ТОЧЕЧНОЙ правки (structurePatchMode) обратно в state.structure —
// в отличие от applySkeleton() (полная пересборка ВСЕХ глав), здесь заменяются
// только главы из patchChapters (см. runBookArchitectPatch/validateSkeletonPatch).
// Остальные главы и их сцены — ТЕ ЖЕ объекты с теми же id, тем же текстом и
// status: они вообще не участвовали в запросе к LLM, поэтому не могут быть
// случайно переписаны дрейфом формулировок (см. комментарий у applySkeleton
// про "точечно исправь" — инструкция не гарантия, полная регенерация всё
// равно слегка меняет нетронутые места). Побочный плюс: уже написанные сцены
// в незатронутых главах не стираются каждым «Улучшить», как раньше.
export function applySkeletonPatch(state, patchChapters, uid){
  pushSkeletonVersion(state);
  const chapterNodes = (state.structure||[]).filter(n=>n.type==='chapter');
  const byNumber = new Map(patchChapters.map(pc=>[pc.number, pc]));
  const nodes = [];
  chapterNodes.forEach((chNode, idx)=>{
    const patch = byNumber.get(idx+1);
    if(!patch){
      nodes.push(chNode);
      (state.structure||[]).filter(s=>s.type==='scene' && s.chapterId===chNode.id).forEach(sc=>nodes.push(sc));
      return;
    }
    const chId = uid('ch');
    nodes.push({ id:chId, type:'chapter', title:patch.title, arc:patch.arc });
    patch.scenes.forEach(sc=>{
      nodes.push({ id:uid('sc'), type:'scene', chapterId:chId, title:sc.title, brief:sc.brief,
        emotion:sc.emotion, targetWords:sc.targetWords, sceneType:sc.sceneType||'scene', text:'', words:0, status:'todo' });
    });
  });
  state.structure = nodes;
}

// ── История полного скелета (откат неудачной перегенерации) ──
// Каждая версия хранит вместе со срезом structure[] и оценку Оценщика, которая
// была актуальна для НЕЁ (state.structureEval на момент вызова — это оценка
// именно той структуры, что сейчас архивируется, а не новой: applySkeleton
// зовёт push ДО перезаписи state.structure и ДО сброса state.structureEval).
// Раньше версия хранила только structure[], поэтому откат не мог восстановить
// оценку — приходилось молча сбрасывать её в null (см. revertSkeleton ниже).
export function pushSkeletonVersion(state){
  if(!state.structure || !state.structure.length) return; // нечего сохранять на первой генерации
  state.skeletonVersions = state.skeletonVersions || [];
  state.skeletonVersions.unshift({
    structure: JSON.parse(JSON.stringify(state.structure)),
    eval: state.structureEval ? JSON.parse(JSON.stringify(state.structureEval)) : null,
  });
  if(state.skeletonVersions.length>5) state.skeletonVersions.length=5;
}
export function revertSkeleton(state){
  if(!state.skeletonVersions || !state.skeletonVersions.length) return false;
  // Честный откат по истории (LIFO), не свап с одной и той же версией: раньше
  // повторный клик клал текущую структуру обратно на то же место в истории —
  // второй клик просто возвращал вперёд, а версии старше первой были
  // навсегда недостижимы, хотя счётчик кнопки обещал «N» шагов назад.
  const v = state.skeletonVersions.shift();
  state.structure = v.structure;
  state.structureEval = v.eval;
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
    '• Ритм сцена/секвель (техника Дуайта Свейна, помечено в скобках у каждой сцены): секвель («передышка» — реакция/дилемма/решение) должен идти ПОСЛЕ сцены-потрясения, а не после проходного эпизода — иначе передышка не работает. 3+ сцены подряд без секвеля выматывают читателя постоянным напряжением. Секвель за секвелем — провисание темпа, слишком тихо.',
    '• Повтор одной и той же микро-задачи по брифам нескольких сцен подряд (2-3+) без продвижения сюжета — герой снова напуган и снова прячется/бежит, снова сомневается и снова медлит, тот же конфликт на том же уровне — книга топчется на месте, даже если каждая сцена сама по себе написана хорошо. Отличай от намеренного нарастания (тот же страх, но ставки растут, информация меняется, решение героя другое) — это НЕ повтор.',
    '• Рояль в кустах: важный поворот (спаситель, находка, откровение, удачное совпадение) появляется без ХОТЯ БЫ ОДНОГО намёка в брифах более ранних сцен — герой должен был что-то заметить, услышать, о чём-то узнать заранее, пусть мельком. Без этого развязка ощущается как случайность, а не как причина-следствие, даже если сама сцена появления написана эффектно.',
    '• Ставки первой главы: открывающие 1-2 сцены книги должны называть КОНКРЕТНУЮ личную цену происходящего — что именно герой теряет или чем рискует (сломанная вещь, близкий человек в опасности, утекающее время), а не только абстрактную угрозу («опасно», «охотятся»). Без конкретной цены завязка читается как событие, а не как катастрофа, и не удерживает читателя.',
    'Не оценивай качество брифов, стиль или детали — только АРХИТЕКТУРУ.',
    prevEval && (prevEval.issues||[]).length
      ? 'Тебе дана ПРЕДЫДУЩАЯ ОЦЕНКА этой же книги до правки. По каждой прошлой проблеме явно реши: устранена или нет. Не подменяй устранённую проблему похожей, но другой критикой того же места — если правка решила именно то, что было заявлено, значит проблема закрыта, даже если место ещё не идеально. Для неустранённых — объясни, что конкретно осталось, и включи в issues с пометкой «(не устранено)».'
      : '',
    'Для КАЖДОЙ проблемы в issues укажи номер(а) главы (1-based, по порядку в СКЕЛЕТЕ ниже), где её нужно чинить, и собери все такие номера в affectedChapters — только главы, которые ДЕЙСТВИТЕЛЬНО нужно менять, чтобы устранить issues. Если проблема на стыке двух глав (например, ритм сцена/секвель ломается на переходе) — укажи обе.',
  ].filter(Boolean).join('\n');

  // Компактный скелет для промпта — тип сцены в скобках, иначе Оценщик физически
  // не может проверить ритм сцена/секвель (не видел бы, где что стоит).
  const skeletonText = skeleton.chapters.map((ch,ci)=>{
    const scList = (ch.scenes||[]).map((s,si)=>`    ${ci+1}.${si+1}. (${s.sceneType==='sequel'?'секвель':'сцена'}) «${s.title}» [${s.targetWords||700}сл] — ${s.brief}`).join('\n');
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
    '{ "score": среднее_float_0-10, "axes": { "arc": 0-10, "pacing": 0-10, "conflict": 0-10, "balance": 0-10, "ending": 0-10 }, "issues": ["до 4 реальных проблем, кратко и конкретно"], "suggestions": ["до 4 конкретных улучшений со ссылками на главы/сцены"], "affectedChapters": [номера глав (1-based) из issues выше, без соседних непроблемных] }',
    'Если структура хороша — скажи это в suggestions. issues может быть пустым. Только JSON.',
  ].filter(Boolean).join('\n');

  return [{role:'system',content:sys},{role:'user',content:user}];
}

export async function runStructureEval(state, skeleton, prevEval){
  const g = state.global;
  if(!g.apiKey) return null; // конфигурация не задана — это не сбой, тихо пропускаем
  const msgs = structureEvalMessages(state, skeleton, prevEval);
  // С каждой итерацией «Улучшить» промпт просит явно перечислить устранено/не
  // устранено по каждой прошлой проблеме — ответ ощутимо растёт по итерациям
  // (замерено вживую: 603 → 703 → 705 → 787 из 800). При 800 3-4-я итерация
  // обрезает JSON. Запас на затухание роста, а не голая экстраполяция тренда.
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.2, messages:msgs, maxTokens:1500, retries:g.retries });
  const j = extractJSON(res.text);
  if(!j || typeof j.score !== 'number') throw new Error('Оценщик вернул нераспознаваемый ответ — попробуйте ещё раз.');
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
    // Номера глав (1-based), которые реально нужно трогать, чтобы устранить issues —
    // источник для точечных правок (structurePatchMode, см. bookArchitectPatchMessages).
    // Клэмп к реальному числу глав скелета — модель иногда придумывает номер за пределами книги.
    affectedChapters: Array.isArray(j.affectedChapters)
      ? [...new Set(j.affectedChapters.map(Number).filter(n=>Number.isInteger(n) && n>=1 && n<=skeleton.chapters.length))]
      : [],
  };
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
    `Верни JSON: { "scenes": [ ровно ${scenes.length} объектов: {"title","brief","emotion","targetWords","sceneType":"scene|sequel"} ] }. sceneType: "scene" — растущее напряжение, "sequel" — передышка (реакция→дилемма→решение). Только JSON.`,
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
        // pushSceneVersion бэкапит только бриф/план (SCENE_FIELDS), НЕ прозу —
        // раньше эта функция меняла план сцены, но status/text не трогала: уже
        // написанная сцена оставалась «готово» со СТАРЫМ текстом, не подходящим
        // под новый бриф, и ничего не предлагало её переписать, хотя модалка
        // прямо обещает «все сцены будут переписаны». Сбрасываем в 'todo' —
        // старый текст уходит в proseVersions (тот же откат, что и в doRun),
        // не пропадает, а кнопки автопилота в «Написании» теперь реально видят
        // главу как недописанную и предложат переписать по новому брифу.
        if(sc.status==='done' && sc.text){
          sc.proseVersions = sc.proseVersions || [];
          sc.proseVersions.unshift(sc.text);
          if(sc.proseVersions.length>10) sc.proseVersions.length=10;
          sc.status = 'todo';
        }
        sc.title=(fr.title||sc.title).trim(); sc.brief=fr.brief.trim(); sc.emotion=(fr.emotion||sc.emotion||'').trim();
        if(Number(fr.targetWords)>0) sc.targetWords=Math.round(Number(fr.targetWords));
        sc.sceneType = fr.sceneType==='sequel' ? 'sequel' : 'scene';
        applied.push(sc.id);
      }
      return applied;
    }
    lastErr='невалидный JSON';
  }
  throw new Error('Перегенерация главы не удалась: '+lastErr);
}
