// Иллюстрации книги. Два разных API, не путать:
//   1) Подсказка промптов и настроек — обычный текстовый LLM (тот же, что уже
//      настроен для прозы, напр. deepseek) — читает книгу и предлагает
//      кандидатов на иллюстрации. Ничего не стоит сверх обычного текстового вызова.
//   2) Сама генерация картинки — отдельный провайдер и отдельный ключ
//      (state.illustrations.provider/apiKey), см. imagegen.js. Стоит реальных
//      денег за каждую картинку — вызывается ТОЛЬКО по явному клику автора,
//      никогда не автоматически.

import { callLLM, extractJSON } from './llm.js';
import { bookOverview, doneScenesOrdered } from './bookreview.js';
import { generateImage } from './imagegen.js';
import { ART_STYLES } from './artStyles.js';

// ── 1) Кандидаты на иллюстрации (текстовый LLM) ──
// Обложке не нужны готовые сцены (промпт для неё строится только из
// жанра/синопсиса/идеи) — поэтому функция работает и без единой законченной
// сцены, просто просит у арт-директора только обложку в этом случае.
export function illustrationSuggestMessages(state){
  const p = state.project;
  const count = state.illustrations?.suggestCount || 7;
  const scenes = doneScenesOrdered(state);
  const hasScenes = scenes.length > 0;
  const sys = [
    'Ты — арт-директор книги. Ты НЕ рисуешь — ты предлагаешь кандидатов на иллюстрации и текстовые промпты для генератора изображений.',
    'Промпт для картинки должен быть самодостаточным визуальным описанием (место, персонажи, свет, композиция, настроение) — генератор изображений не читал книгу и не поймёт отсылок к именам без описания их внешности.',
    'Сквозные персонажи должны выглядеть одинаково во всех картинках: если персонаж встречается в нескольких кандидатах, реши ОДИН РАЗ его внешность (вид/порода, окрас, размер, характерные детали — не общие слова вроде «милый», а то, что реально отличает его от похожих) и повторяй это описание СЛОВО В СЛОВО на английском в промпте каждой картинки с этим персонажем. Генератор не помнит предыдущие картинки — без дословного повтора он каждый раз рисует другого персонажа.',
    'Обложка — всегда первый кандидат: она должна работать как обложка жанра (не сцена дословно, а образ, который продаёт книгу на полке).',
  ].join('\n');
  const knownChars = (state.characters||[]).filter(c=>c.desc).map(c=>`${c.name}: ${c.desc}`);
  const user = [
    `Жанр: ${p.genre||'роман'}. Аудитория: ${p.audience||'широкая'}.`,
    p.synopsis||p.idea ? `Синопсис: ${p.synopsis||p.idea}` : '',
    '',
    hasScenes ? 'ОБЗОР КНИГИ ПО ГЛАВАМ И СЦЕНАМ (сводки по порядку):' : '',
    hasScenes ? bookOverview(state) : '',
    '',
    knownChars.length ? `ИЗВЕСТНАЯ ВНЕШНОСТЬ ПЕРСОНАЖЕЙ (используй дословно вместо того, чтобы придумывать заново):\n${knownChars.join('\n')}\n` : '',
    hasScenes
      ? `Предложи кандидатов на иллюстрации: 1 обложка + до ${Math.max(0, count-1)} сильных визуальных сцен (не каждую, только те, что реально дают яркую картинку — не диалоги и не размышления, а моменты с явным визуальным образом).`
      : 'Готовых сцен ещё нет — предложи только ОБЛОЖКУ (1 кандидат), по жанру, аудитории и синопсису/идее выше.',
    'Верни JSON: { "candidates": [ { "type":"cover|scene", "sceneTitle":"точное название сцены из обзора (пусто для обложки)", "prompt":"самодостаточный визуальный промпт для генератора изображений, на английском, 1-3 предложения", "reason":"почему эта сцена/образ — по-русски, коротко", "importance":"число 1-10, насколько сильна эта картинка для книги — 10 = ключевой визуальный момент, 1 = проходной" } ] }',
    'Только JSON.',
  ].filter(Boolean).join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

export async function suggestIllustrations(state){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ текстовой модели (⚙).');
  const scenes = doneScenesOrdered(state);
  const msgs = illustrationSuggestMessages(state);
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.6, messages:msgs, maxTokens:1500, retries:g.retries });
  const j = extractJSON(res.text);
  const arr = j && Array.isArray(j.candidates) ? j.candidates : null;
  if(!arr) throw new Error('Не удалось разобрать ответ арт-директора.');
  // Map<название, очередь сцен> — раньше был Map<название, сцена>, и при
  // совпадении названий (например, дефолтное «Без названия» у нескольких
  // незаполненных сцен — штатный случай, не гипотетика) побеждала последняя
  // по порядку сцена в книге: иллюстрация, задуманная для одной сцены,
  // прикреплялась к совершенно другой. Теперь каждый кандидат забирает
  // ПЕРВУЮ ещё не занятую сцену с этим названием — по порядку кандидатов,
  // совпадающему с порядком обзора книги, который видела модель.
  const sceneByTitle = new Map();
  scenes.forEach(s=>{
    const key = s.title.trim().toLowerCase();
    if(!sceneByTitle.has(key)) sceneByTitle.set(key, []);
    sceneByTitle.get(key).push(s);
  });
  const cap = state.illustrations?.suggestCount || 7;
  // Без единой законченной сцены брать в расчёт только обложку — сцену-кандидата
  // без реального текста подставить всё равно не к чему (модель могла
  // ослушаться инструкции и предложить сцену тоже).
  const usable = scenes.length ? arr : arr.filter(c=>c.type==='cover');
  return usable.slice(0, cap).map((c,i)=>{
    const sceneTitle = String(c.sceneTitle||'').trim();
    const queue = sceneTitle ? sceneByTitle.get(sceneTitle.toLowerCase()) : null;
    const matched = queue && queue.length ? queue.shift() : null;
    return {
      id: 'ic_'+Date.now().toString(36)+'_'+i,
      type: c.type==='cover' ? 'cover' : 'scene',
      sceneId: matched ? matched.id : null,
      sceneTitle: matched ? matched.title : sceneTitle,
      prompt: String(c.prompt||'').slice(0,600),
      reason: String(c.reason||'').slice(0,300),
      importance: (n=>Math.max(1, Math.min(10, Math.round(Number.isFinite(n)?n:5))))(Number(c.importance)),
      textOn: !state.illustrations?.noText,
    };
  });
}

// ── 2) Генерация ОДНОЙ картинки (провайдер картинок, тратит деньги) ──
// Стиль картинки собирается из необязательных частей (все могут сочетаться):
// visualVoice (state.style.visualVoice, если тумблер включён), пресет ART_STYLES
// (state.style.artStyleId), чёрно-белый режим (state.style.colorMode==='bw'),
// язык надписей/запрет текста и портретная обложка (все три — state.illustrations).
// Цвет по умолчанию — без доп. инструкции (большинство генераторов рисуют
// цветное по умолчанию), явная инструкция нужна только для ч/б.
//
// noText/ruText/portraitCover проверяются здесь, а не в illustrationSuggestMessages,
// по той же причине, что и стиль/цвет выше: это единственная точка, через которую
// проходит ЛЮБая генерация картинки (пакетный подбор арт-директора, точечный
// suggestOneIllustration, перегенерация промпта, перегенерация только картинки) —
// вставлять инструкцию в промпт LLM-подсказчика пришлось бы дублировать в
// нескольких местах и она бы не действовала на промпт, отредактированный автором вручную.
// Мелкий/плотный текст на картинках рисуют с артефактами (нечитаемые буквы,
// «кракозябры») ВСЕ современные image-модели без исключения — это ограничение
// самих диффузионных моделей, не промпта конкретного провайдера. Единственное,
// что реально снижает частоту брака — просить КРУПНЫЙ, немногословный текст;
// полностью убрать риск нельзя, только уменьшить (или выключить текст совсем — noText).
export function textInstruction(ic){
  if(ic?.noText) return 'Do not include any readable text, letters, numbers or writing anywhere in the image.';
  // Раньше для обложки инструкция ограничивалась «если есть текст — пусть будет
  // русский», но НИКОГДА не называла сам текст — генератор картинок книгу не
  // читал и придумывал правдоподобное, но постороннее название. Явно передаём
  // реальное название книги, только когда есть что передать (обложка + заголовок задан).
  const titleClause = (ic?.type==='cover' && ic?.title)
    ? ` The book title rendered on the cover must be EXACTLY this text, unchanged and not translated or shortened: «${ic.title}».`
    : '';
  if(ic?.ruText) return 'If the image contains any readable text or lettering (book title, map labels, signs), it must be written in Russian (Cyrillic script), not English — and rendered LARGE, bold and sparse: a few big, clear words, not small or dense text. Small/dense text reliably comes out garbled — prefer omitting a label entirely over rendering it small.' + titleClause;
  if(titleClause) return 'If the image contains any readable text or lettering, render it LARGE, bold and sparse — a few big, clear words, not small or dense text.' + titleClause;
  return '';
}
// Эффективное «текст на картинке» для конкретного кандидата/элемента галереи:
// undefined (старые элементы до этой фичи) — берём общий проектный тумблер;
// иначе — точечное переопределение автора для этой конкретной картинки
// (строка в таблице «Кандидаты»/«Сгенерированные»), которое имеет приоритет.
export function effectiveTextOn(entity, ic){
  return entity?.textOn !== undefined ? !!entity.textOn : !ic?.noText;
}
// Портретные пропорции обложки (для площадок вроде ЛитРес/Author.Today) — часть
// провайдеров (OpenAI/Qwen) реально уважает size, часть (Gemini/Recraft, см.
// server.js handleGenerateImage) size игнорирует и рисует по промпту — поэтому
// инструкция дублируется и текстом, и через size, чтобы сработать там, где возможно.
const PORTRAIT_SIZE = '1024x1536';
function portraitInstruction(ic, type){
  if(type!=='cover' || !ic?.portraitCover) return '';
  return 'Vertical portrait book-cover orientation, taller than wide (2:3 aspect ratio), not square, not landscape.';
}
export async function generateIllustrationFor(state, candidate){
  const ic = state.illustrations || {};
  if(!ic.apiKey) throw new Error('Не задан API-ключ для генерации картинок (⚙).');
  const parts = [];
  if(state.style?.visualVoiceOn && state.style?.visualVoice) parts.push(`Стиль: ${state.style.visualVoice}`);
  const artStyle = ART_STYLES.find(s=>s.id===state.style?.artStyleId);
  if(artStyle) parts.push(artStyle.promptFragment);
  if(state.style?.colorMode==='bw') parts.push('black and white, monochrome, no color');
  const noText = !effectiveTextOn(candidate, ic);
  const txtInstr = textInstruction({ noText, ruText: ic.ruText, type: candidate.type, title: state.project?.title }); if(txtInstr) parts.push(txtInstr);
  const portraitInstr = portraitInstruction(ic, candidate.type); if(portraitInstr) parts.push(portraitInstr);
  const prompt = parts.length ? `${candidate.prompt}\n\n${parts.join('. ')}` : candidate.prompt;
  const size = (candidate.type==='cover' && ic.portraitCover) ? PORTRAIT_SIZE : ic.size;
  const { dataUrl } = await generateImage({
    provider: ic.provider||'gemini',
    apiKey: ic.apiKey,
    model: ic.model,
    prompt,
    size,
    quality: ic.quality,
    proxyToken: state.global?.proxyToken,
  });
  return dataUrl;
}

// ── 1b) Ручной режим: точечное предложение промпта для ОДНОЙ выбранной цели ──
// В отличие от suggestIllustrations() (просит арт-директора самому набрать
// список кандидатов по своему усмотрению) — здесь автор уже решил, ЧТО именно
// иллюстрировать (обложка или конкретная глава), и нужен только промпт под неё.
// Для главы — просим арт-директора самого выбрать внутри неё самую визуальную
// сцену (не всякая сцена в главе одинаково рисуема), поэтому возвращаем
// sceneTitle и резолвим его в sceneId так же, как suggestIllustrations().
// Используется и для первой генерации промпта, и для «перегенерировать промпт»
// у уже существующей картинки (тот же вызов, старый прompt просто отбрасывается).
function singleTargetMessages(state, target){
  const p = state.project;
  const knownChars = (state.characters||[]).filter(c=>c.desc).map(c=>`${c.name}: ${c.desc}`);
  const sys = [
    'Ты — арт-директор книги. Ты НЕ рисуешь — ты предлагаешь ОДИН текстовый промпт для генератора изображений под конкретную, уже выбранную автором цель.',
    'Промпт должен быть самодостаточным визуальным описанием (место, персонажи, свет, композиция, настроение) на английском — генератор изображений не читал книгу и не поймёт отсылок к именам без описания их внешности.',
  ].join('\n');
  const userParts = [
    `Жанр: ${p.genre||'роман'}. Аудитория: ${p.audience||'широкая'}.`,
    knownChars.length ? `ИЗВЕСТНАЯ ВНЕШНОСТЬ ПЕРСОНАЖЕЙ (используй дословно):\n${knownChars.join('\n')}` : '',
  ];
  if(target.type==='cover'){
    userParts.push(
      p.synopsis||p.idea ? `Синопсис: ${p.synopsis||p.idea}` : '',
      'Нужен промпт ТОЛЬКО для ОБЛОЖКИ книги — образ, который продаёт жанр на полке, не дословная сцена.',
    );
  } else {
    const chScenes = doneScenesOrdered(state).filter(sc=>sc.chapterId===target.chapterId);
    const mem = state.memory||{};
    userParts.push(
      `ГЛАВА «${target.chapterTitle}» — СЦЕНЫ ПО ПОРЯДКУ:`,
      chScenes.map(sc=>`«${sc.title}»: ${mem.scenes?.[sc.id]?.current || sc.brief || ''}`).join('\n') || '(нет написанных сцен)',
      'Выбери ОДНУ самую визуально сильную сцену этой главы (яркий образ, не диалог и не размышление) и предложи промпт под неё.',
    );
  }
  userParts.push(
    'Верни JSON: { "sceneTitle": "точное название выбранной сцены — пусто для обложки", "prompt": "визуальный промпт на английском, 1-3 предложения", "reason": "почему этот образ — по-русски, коротко" }',
    'Только JSON.',
  );
  return [{role:'system',content:sys},{role:'user',content:userParts.filter(Boolean).join('\n')}];
}

export async function suggestOneIllustration(state, target){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ текстовой модели (⚙).');
  const msgs = singleTargetMessages(state, target);
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.6, messages:msgs, maxTokens:500, retries:g.retries });
  const j = extractJSON(res.text);
  if(!j || !j.prompt) throw new Error('Не удалось разобрать ответ арт-директора.');
  let sceneId = null, sceneTitle = '';
  if(target.type==='scene'){
    const wanted = String(j.sceneTitle||'').trim().toLowerCase();
    const match = wanted ? doneScenesOrdered(state).find(sc=>sc.chapterId===target.chapterId && sc.title.trim().toLowerCase()===wanted) : null;
    sceneId = match ? match.id : null;
    sceneTitle = match ? match.title : String(j.sceneTitle||target.chapterTitle||'').trim();
  }
  return {
    id: 'ic_'+Date.now().toString(36),
    type: target.type,
    sceneId,
    sceneTitle,
    prompt: String(j.prompt).slice(0,600),
    reason: String(j.reason||'').slice(0,300),
    importance: 5,
    textOn: !state.illustrations?.noText,
  };
}

// Глава, к которой относится сцена — по позиции в structure (та же логика,
// что buildBook() в export.js), null для обложки/несцены или сцены без главы.
export function chapterTitleForScene(state, sceneId){
  if(!sceneId) return null;
  const nodes = state.structure||[];
  let cur = null;
  for(const n of nodes){
    if(n.type==='chapter') cur = n.title;
    else if(n.type==='scene' && n.id===sceneId) return cur||null;
  }
  return null;
}

// ── Версии картинки — история ПРОШЛЫХ dataUrl/prompt элемента галереи ──
// Картинки платные и тяжёлые (base64 в IndexedDB + весь state уходит на сервер
// при каждом save()) — поэтому cap ниже, чем у текстового promptHistory (20):
// 3 прошлых версии (плюс текущая — до 4 суммарно) достаточно, чтобы откатиться
// после неудачной перегенерации, не раздувая хранилище бесконечно.
const MAX_IMAGE_VERSIONS = 3;

// Прошлое состояние item'а (для переноса при замене одного «синглтона» другим —
// карта/обложка при повторной генерации/загрузке ЗАМЕНЯЮТ элемент массива
// целиком, а не мутируют dataUrl на месте, поэтому историю нужно переносить
// вручную в новый item, иначе она потеряется вместе со старым объектом).
export function carryVersions(oldItem){
  if(!oldItem) return [];
  return [{ dataUrl: oldItem.dataUrl, prompt: oldItem.prompt, createdAt: oldItem.createdAt }, ...(oldItem.versions||[])].slice(0, MAX_IMAGE_VERSIONS);
}

// Перед перегенерацией картинки ПО ТОМУ ЖЕ item (мутация dataUrl на месте,
// см. .ill-regen-img в ui/illustrations.js) — сохранить прежнее состояние в историю.
export function pushImageVersion(item){
  item.versions = item.versions || [];
  item.versions.unshift({ dataUrl: item.dataUrl, prompt: item.prompt, createdAt: item.createdAt });
  if(item.versions.length > MAX_IMAGE_VERSIONS) item.versions.length = MAX_IMAGE_VERSIONS;
}

// Откатиться к прошлой версии — текущее состояние НЕ теряется, уходит в
// историю на место восстановленной (симметрично: вперёд-назад без потерь).
export function restoreImageVersion(item, verIdx){
  const chosen = item.versions?.[verIdx]; if(!chosen) return false;
  const current = { dataUrl: item.dataUrl, prompt: item.prompt, createdAt: item.createdAt };
  item.versions.splice(verIdx, 1);
  item.dataUrl = chosen.dataUrl; item.prompt = chosen.prompt; item.createdAt = chosen.createdAt;
  item.versions.unshift(current);
  if(item.versions.length > MAX_IMAGE_VERSIONS) item.versions.length = MAX_IMAGE_VERSIONS;
  return true;
}

// Сохранить сгенерированную карту мира в общую галерею (единый источник
// правды — state.illustrations.items, спека §9). Вызывается из world.js
// напрямую, минуя suggestIllustrations()/doneScenesOrdered (на стадии «Мир»
// сцен ещё нет). Одна карта на проект — повторная генерация заменяет старую
// запись массива, но её dataUrl/prompt переносится в versions[] новой (см.
// carryVersions выше) — старая карта не пропадает, доступна через историю.
export function saveMapItem(state, dataUrl, prompt=''){
  state.illustrations = state.illustrations || {};
  const old = (state.illustrations.items||[]).find(it=>it.type==='map');
  const versions = carryVersions(old);
  state.illustrations.items = (state.illustrations.items||[]).filter(it=>it.type!=='map');
  // baseDataUrl — чистая картинка БЕЗ подписей (та, что реально пришла от
  // генератора), labels — координатные подписи поверх неё (см. compositeMapLabels
  // ниже). Новая генерация — новая геометрия карты, старые координаты подписей
  // больше не имеют смысла, поэтому labels всегда сбрасываются здесь, не переносятся.
  const item = { id:'map_'+Date.now().toString(36), type:'map', sceneId:null, sceneTitle:'', prompt, dataUrl, baseDataUrl:dataUrl, labels:[], createdAt:Date.now(), versions };
  state.illustrations.items.push(item);
  return item;
}

// Своя картинка автора (не через провайдера) — вместо генерации. uploaded:true
// отличает такие элементы в галерее: у них нет промпта, поэтому «другой
// промпт»/«перегенерировать картинку» для них не показываются (см. ui/illustrations.js).
// Карта и обложка — как saveMapItem: одна на проект, повторная загрузка заменяет
// запись массива, старая версия переносится в versions[] (carryVersions), не теряется.
export function saveUploadedItem(state, dataUrl, { type, sceneId=null, sceneTitle='' }){
  state.illustrations = state.illustrations || {};
  state.illustrations.items = state.illustrations.items || [];
  let versions = [];
  if(type==='map' || type==='cover'){
    versions = carryVersions(state.illustrations.items.find(it=>it.type===type));
    state.illustrations.items = state.illustrations.items.filter(it=>it.type!==type);
  }
  const item = { id:'up_'+Date.now().toString(36), type, sceneId, sceneTitle, prompt:'', dataUrl, createdAt:Date.now(), uploaded:true, versions,
    ...(type==='map' ? { baseDataUrl:dataUrl, labels:[] } : {}) };
  state.illustrations.items.push(item);
  if(type==='cover') state.project.coverDataUrl = dataUrl;
  return item;
}

// ── Подписи мест на карте — НАСТОЯЩИЙ текст (canvas), а не то, что рисует сама
// image-модель. У сгенерированного текста на картинке всегда есть шанс
// нечитаемых «кракозябр» (см. mapPromptFor в world.js) — этого способа не
// избежать полностью никакими формулировками промпта. Подписи поверх карты —
// координаты (в процентах от размера картинки, не в пикселях — не зависят от
// того, каким разрешением ответил провайдер) хранятся ОТДЕЛЬНО от готовой
// картинки: item.dataUrl каждый раз пересобирается заново из item.baseDataUrl
// (чистая карта без подписей) + item.labels, поэтому добавление/правка/
// удаление одной подписи не требует новой платной генерации и никогда не
// накладывает текст поверх уже напечатанного текста.
export const MAX_MAP_LABELS = 15;
export function addMapLabel(item, text, xPct, yPct){
  item.labels = item.labels || [];
  if(item.labels.length >= MAX_MAP_LABELS) return null;
  const label = { id:'lbl_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),
    text: String(text||'').trim().slice(0,40), xPct: clampPct(xPct), yPct: clampPct(yPct) };
  item.labels.push(label);
  return label;
}
export function removeMapLabel(item, id){
  if(!item.labels) return false;
  const before = item.labels.length;
  item.labels = item.labels.filter(l=>l.id!==id);
  return item.labels.length !== before;
}
export function updateMapLabelText(item, id, text){
  const l = (item.labels||[]).find(x=>x.id===id);
  if(!l) return false;
  l.text = String(text||'').trim().slice(0,40);
  return true;
}
function clampPct(n){ return Math.max(0, Math.min(100, Number(n)||0)); }

function roundRectPath(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
}

// baseDataUrl + labels → готовая PNG-картинка с наложенным текстом. Пустой
// labels — возвращает base как есть (не гоняет картинку через canvas зря).
export function compositeMapLabels(baseDataUrl, labels){
  const list = (labels||[]).filter(l=>(l.text||'').trim());
  if(!list.length) return Promise.resolve(baseDataUrl);
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.onload = ()=>{
      try{
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const fontSize = Math.max(16, Math.round(canvas.width * 0.024));
        ctx.font = `700 ${fontSize}px Georgia, 'Times New Roman', serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        list.forEach(l=>{
          const text = l.text.trim();
          const x = (l.xPct/100) * canvas.width;
          const y = (l.yPct/100) * canvas.height;
          const w = ctx.measureText(text).width;
          const padX = fontSize*0.55, padY = fontSize*0.32;
          const boxW = w + padX*2, boxH = fontSize + padY*2;
          ctx.fillStyle = 'rgba(24,16,8,0.6)';
          roundRectPath(ctx, x-boxW/2, y-boxH/2, boxW, boxH, boxH/2);
          ctx.fill();
          ctx.fillStyle = '#f7edd8';
          ctx.fillText(text, x, y + fontSize*0.04);
        });
        resolve(canvas.toDataURL('image/png'));
      }catch(e){ reject(e); }
    };
    img.onerror = ()=>reject(new Error('Не удалось загрузить карту для наложения подписей.'));
    img.src = baseDataUrl;
  });
}

// Пересобрать item.dataUrl из base+labels и сохранить прошлую готовую картинку
// в историю версий — тот же принцип отката, что у обычной перегенерации.
export async function applyMapLabels(item){
  const base = item.baseDataUrl || item.dataUrl;
  const composited = await compositeMapLabels(base, item.labels||[]);
  if(composited !== item.dataUrl){ pushImageVersion(item); item.dataUrl = composited; }
  return composited;
}

// Убрать обложку целиком — используется и стадией «Концепция» (ручная загрузка/
// удаление), и разделом «Иллюстрации», чтобы обе вкладки видели одно и то же:
// раньше «✕ Убрать обложку» в Концепции чистила только project.coverDataUrl, не
// трогая illustrations.items — в галерее оставалась картинка, которая больше
// никуда не попадала (не в экспорт, не в чтение), выглядя как рассинхрон.
export function removeCover(state){
  state.illustrations = state.illustrations || {};
  state.illustrations.items = (state.illustrations.items||[]).filter(it=>it.type!=='cover');
  state.project.coverDataUrl = '';
}
