// Агент «Мир» — проактивный worldbuilding до Структуры (в отличие от
// «архивариуса», который вытаскивает факты РЕАКТИВНО из уже написанного
// текста, см. summarizer.js/series.js). Одобренные факты пишутся в обычную
// Библию (state.bible[]) с source:'world' — переиспользует существующую
// TF-IDF-систему канона, отдельного хранилища нет (спека §4).

import { callLLM, extractJSON } from './llm.js';
import { generateImage } from './imagegen.js';

// Жанры с придуманным сеттингом — добавляют категорию магии/технологии/системы
// (см. categoriesFor ниже). Стадия «Мир» видна всегда (как «Иллюстрации»),
// отдельного тумблера включения больше нет.
// «альтернативн» — намеренно короче полного слова, матчит и «альтернативная
// история», и падежные формы; не пересекается по подстроке с «исторический
// роман» (проверено в Task 1).
export const WORLD_GENRES = ['фэнтези', 'фантастика', 'ромфант', 'литрпг', 'мистика', 'ужасы', 'альтернативн'];

export function genreWantsWorld(genre){
  const g = (genre||'').toLowerCase();
  return WORLD_GENRES.some(w=>g.includes(w));
}

const BASE_CATEGORIES = ['география', 'история', 'фракции', 'культура'];

// Genre-aware набор категорий (спека §5.2) — детерминированный список на
// стороне кода, не свободная генерация набора самим агентом.
export function categoriesFor(genre){
  const g = (genre||'').toLowerCase();
  const cats = [...BASE_CATEGORIES];
  if(g.includes('литрпг')){
    cats.splice(1, 0, 'система');
  } else if(genreWantsWorld(g)){
    cats.splice(1, 0, 'магия/технология');
  }
  return cats;
}

export const CATEGORY_HINTS = {
  'география': 'места действия, расстояния, климат, что где находится',
  'история': 'ключевые прошлые события, формирующие настоящее',
  'магия/технология': 'как это работает — и ЯВНО, что оно НЕ может делать / чего стоит (ограничения не менее важны, чем возможности: без них автор потом придумывает deus ex machina, а стражи не могут это поймать, т.к. в каноне нет отрицательных фактов)',
  'система': 'правила прогрессии — уровни, статы, классы, есть ли пермасмерть',
  'фракции': 'силы в конфликте, их цели',
  'культура': 'повседневность, соц. нормы, статус/обращение, религия/мировоззрение — не только быт (еда/одежда)',
};

// Альт-история требует явной точки развилки в категории «история» — не
// хардблок (см. missingPOD ниже), но агент должен явно про это знать.
function altHistoryNote(genre){
  const g = (genre||'').toLowerCase();
  if(!g.includes('альтернативн')) return '';
  return 'ЭТОТ ЖАНР ТРЕБУЕТ явной точки развилки в категории «история»: конкретное историческое событие + год + что пошло иначе + 2-3 конкретных следствия (технологические/политические/культурные), логически из неё вытекающих. Без точки развилки жанр не работает — обязательно включи такой факт.';
}

export function worldSuggestMessages(state, category, opts={}){
  const p = state.project;
  const hint = (opts.hint||'').trim();
  const ideaSeed = (opts.ideaSeed||'').trim();
  const sys = [
    'Ты — соавтор по мироустройству (worldbuilding). Ты предлагаешь конкретные факты мира книги — НЕ пишешь прозу и не строишь сюжет.',
    'Каждый факт — конкретное, проверяемое утверждение (не «в этом мире есть магия», а «боевая магия истощает год жизни за каждое применение») — расплывчатые факты хуже работают с системой поиска канона и не помогают стражам ловить противоречия.',
    `Сейчас нужны факты ТОЛЬКО категории «${category}»: ${CATEGORY_HINTS[category]||''}`,
    altHistoryNote(p.genre),
  ].filter(Boolean).join('\n');
  const user = [
    `Жанр: ${p.genre||'роман'}${p.subgenre?', '+p.subgenre:''}.`,
    p.era ? `Эпоха: ${p.era}.` : '',
    (p.synopsis||p.idea) ? `Синопсис: ${p.synopsis||p.idea}` : '',
    ideaSeed ? `Идея мира от автора: ${ideaSeed}` : '',
    hint ? `Подсказка автора для категории «${category}»: ${hint}` : '',
    '',
    `Предложи 3-6 фактов категории «${category}».`,
    `Верни JSON: { "facts": [ { "keys": "2-4 ключевых слова через запятую", "text": "сам факт, 1-2 предложения" } ] }`,
    'Только JSON.',
  ].filter(Boolean).join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

export async function suggestWorldFacts(state, category, opts={}){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ текстовой модели (⚙).');
  const msgs = worldSuggestMessages(state, category, opts);
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.8, messages:msgs, maxTokens:800, retries:g.retries });
  const j = extractJSON(res.text);
  const arr = j && Array.isArray(j.facts) ? j.facts : null;
  if(!arr) throw new Error('Не удалось разобрать ответ агента «Мир».');
  return arr.slice(0, 6).map((f,i)=>({
    id: 'wf_'+Date.now().toString(36)+'_'+i,
    category,
    keys: String(f.keys||'').slice(0,120),
    text: String(f.text||'').trim().slice(0,500),
  })).filter(f=>f.text);
}

// Перегенерация ОДНОГО уже одобренного факта — «эта формулировка не устроила»,
// не путать с ✨-расширением в ui/memory.js (то дописывает деталями, это меняет
// саму формулировку, не трогая суть). Возвращает новый текст — вызывающая
// сторона (ui/world.js) сама присваивает fact.text и вызывает rebuildBibleVecs.
export async function rerollWorldFact(state, fact){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ текстовой модели (⚙).');
  const sys = 'Ты — соавтор по мироустройству. Автору не понравилась формулировка факта мира — предложи ДРУГУЮ версию ТОЙ ЖЕ сути (тот же смысл, другие слова), не меняя факт по содержанию.';
  const user = [
    `Жанр: ${state.project.genre||'роман'}.`,
    `Факт (категория «${fact.category||''}»): ${fact.text}`,
    '',
    'Верни только новый текст факта, одно-два предложения, без пояснений и без кавычек.',
  ].join('\n');
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.9, messages:[{role:'system',content:sys},{role:'user',content:user}], maxTokens:300, retries:g.retries });
  const text = res.text.trim().replace(/^["«]+|["»]+$/g,'');
  if(!text) throw new Error('Пустой ответ.');
  return text;
}

// Мягкая проверка (не блокирует, спека §10) — для альт-истории нужен хотя бы
// один факт категории «история» в каноне. Не валидируем содержание.
export function missingPOD(state){
  const g = (state.project?.genre||'').toLowerCase();
  if(!g.includes('альтернативн')) return false;
  return !(state.bible||[]).some(b=>b.source==='world' && b.category==='история');
}

// Стилевые вариации карты — без этого модель при тонком промпте раз за разом
// выбирает один и тот же дефолтный облик (тот же эффект конвергенции, что и
// у Архитектора при генерации структуры на скудном входе). Выбор случайный,
// не по проекту — разные карты одного мира (перегенерация) тоже не должны
// выглядеть одинаково, если автору не понравился первый вариант.
// Осознанное отличие от ART_STYLES (artStyles.js) и AUTHOR_STYLES (styles.js) —
// там выбор ЕДИНСТВЕННЫЙ и ручной (автор выбирает и это сохраняется в state).
// Для карты пока нет своего UI-слота под выбор стиля — авто-рандом здесь
// временное решение, не постоянный архитектурный паттерн для будущих списков.
const MAP_STYLE_FLAVORS = [
  "weathered antique parchment, sepia ink linework, hand-lettered typography",
  "painterly illuminated atlas page, muted watercolor washes, gilded border ornaments",
  "woodcut-engraving style, cross-hatched shading, Renaissance-explorer aesthetic",
  "hand-drawn adventurer's field map, ink-and-wash, coffee-stained edges, sketchy compass rose",
  "richly illustrated tabletop-RPG atlas, saturated color, ornate cartouche title banner",
];

// ── Карта мира — НЕ через suggestIllustrations()/illustrationSuggestMessages()
// (те требуют doneScenesOrdered(state), а на стадии «Мир» сцен ещё нет, спека §9).
// Переиспользуется только низкоуровневый generateImage() из imagegen.js.
export function mapPromptFor(state){
  const geoFacts = (state.bible||[]).filter(b=>b.source==='world' && b.category==='география');
  if(!geoFacts.length) throw new Error('Нужно хотя бы несколько фактов категории «География» в каноне.');
  const p = state.project;
  // Бюджет символов — у фактов ОТДЕЛЬНЫЙ кап, а не общий с шаблоном: при
  // насыщенном каноне (10+ фактов географии) общий .slice() в конце срезал
  // промпт прямо на середине списка фактов, тихо теряя половину из них —
  // не резать хвост, а ограничивать именно факты.
  const facts = geoFacts.map(f=>f.text).join(' ').slice(0, 900);
  const style = `${p.genre||'роман'}${p.era?', '+p.era:''}`;
  const flavor = MAP_STYLE_FLAVORS[Math.floor(Math.random()*MAP_STYLE_FLAVORS.length)];
  return [
    `Fantasy-style map, top-down bird's-eye view, cartography illustration, no text artifacts.`,
    `Art direction: ${flavor}.`,
    `Feel free to invent atmospheric cartographic flourishes NOT contradicting the facts below — compass rose, sea monsters or ships in unmapped waters, decorative border, scale bar, weathered texture, subtle terrain shading. The map should read as a real hand-drawn artifact, not a bare literal diagram of only what's listed.`,
    `Setting: ${style}.`,
    `Geography (must appear, labeled): ${facts}`,
  ].join(' ');
}

export async function generateWorldMap(state){
  const ic = state.illustrations || {};
  if(!ic.apiKey) throw new Error('Не задан API-ключ для генерации картинок (⚙).');
  const prompt = mapPromptFor(state);
  const { dataUrl } = await generateImage({
    provider: ic.provider||'gemini',
    apiKey: ic.apiKey,
    model: ic.model,
    prompt,
    size: ic.size,
    quality: ic.quality,
    proxyToken: state.global?.proxyToken,
  });
  return dataUrl;
}

// ── Архитектор сверяет скелет с каноном (спека §7 — канал остаётся открытым,
// не одноразовый гейт). Не критично для успеха генерации скелета — при сбое
// возвращает [], а не бросает ошибку.
export function missingFactsMessages(state, skeleton){
  const p = state.project;
  const worldFacts = (state.bible||[]).filter(b=>b.source==='world');
  const canonText = worldFacts.length ? worldFacts.map(f=>`— ${f.text}`).join('\n') : '(канон пуст)';
  const skeletonText = skeleton.chapters.map((ch,ci)=>
    (ch.scenes||[]).map((sc,si)=>`${ci+1}.${si+1}. ${sc.brief||sc.title}`).join('\n')
  ).join('\n');
  const sys = 'Ты — книжный архитектор. Ты только что спроектировал скелет книги. Сверь его с уже зафиксированным каноном мира и найди факты, на которые скелет ОПИРАЕТСЯ (упоминает как данность), но которых в каноне ещё нет. НЕ придумывай новые сюжетные повороты — только формализуй то, что уже подразумевает скелет.';
  const user = [
    `Жанр: ${p.genre||'роман'}.`,
    `КАНОН МИРА:\n${canonText}`,
    '',
    `СКЕЛЕТ КНИГИ:\n${skeletonText}`,
    '',
    'До 5 фактов, которых не хватает канону (если скелету ничего не нужно — верни пустой массив facts). Верни JSON: { "facts": [ { "category": "география|история|фракции|культура|магия/технология|система", "keys": "ключевые слова", "text": "факт" } ] }',
    'Только JSON.',
  ].join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

export async function suggestMissingWorldFacts(state, skeleton){
  const g = state.global;
  if(!g.apiKey) return [];
  try{
    const msgs = missingFactsMessages(state, skeleton);
    const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.4, messages:msgs, maxTokens:800, retries:g.retries });
    const j = extractJSON(res.text);
    const arr = j && Array.isArray(j.facts) ? j.facts : [];
    const cats = categoriesFor(state.project.genre);
    return arr.slice(0,5).map((f,i)=>({
      id: 'wf_missing_'+Date.now().toString(36)+'_'+i,
      category: cats.includes(f.category) ? f.category : cats[0],
      keys: String(f.keys||'').slice(0,120),
      text: String(f.text||'').trim().slice(0,500),
    })).filter(f=>f.text);
  }catch{ return []; }
}
