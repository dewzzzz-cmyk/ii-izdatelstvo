// Агент «Мир» — проактивный worldbuilding до Структуры (в отличие от
// «архивариуса», который вытаскивает факты РЕАКТИВНО из уже написанного
// текста, см. summarizer.js/series.js). Одобренные факты пишутся в обычную
// Библию (state.bible[]) с source:'world' — переиспользует существующую
// TF-IDF-систему канона, отдельного хранилища нет (спека §4).

import { callLLM, extractJSON } from './llm.js';
import { generateImage } from './imagegen.js';
import { tokensOf, tfvec, cosine } from './bible.js';

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

// existing (уже одобренные факты ЭТОЙ категории) передаётся в промпт, иначе
// повторный клик «✨ Предложить» после того как автор уже одобрил часть
// фактов, не видит их вообще — модель придумывает категорию заново с нуля,
// и результат может противоречить уже установленному вместо того, чтобы его
// расширять (найдено live-тестом: география «меняется», а не дополняется).
export function worldSuggestMessages(state, category, opts={}){
  const p = state.project;
  const hint = (opts.hint||'').trim();
  const ideaSeed = (opts.ideaSeed||'').trim();
  const existing = (state.bible||[]).filter(b=>b.source==='world' && b.category===category);
  const sys = [
    'Ты — соавтор по мироустройству (worldbuilding). Ты предлагаешь конкретные факты мира книги — НЕ пишешь прозу и не строишь сюжет.',
    'Каждый факт — конкретное, проверяемое утверждение (не «в этом мире есть магия», а «боевая магия истощает год жизни за каждое применение») — расплывчатые факты хуже работают с системой поиска канона и не помогают стражам ловить противоречия.',
    `Сейчас нужны факты ТОЛЬКО категории «${category}»: ${CATEGORY_HINTS[category]||''}`,
    existing.length ? 'В каноне УЖЕ ЕСТЬ факты этой категории (см. ниже) — твоя задача РАСШИРИТЬ мир, а не начать заново. Новые факты должны логически сочетаться с уже установленным: не повторяй их другими словами и не противоречь им, добавляй ДРУГИЕ грани категории (если уже есть факт про столицу — предложи не другую версию столицы, а что-то ещё: соседний регион, торговый путь, географическую особенность).' : '',
    altHistoryNote(p.genre),
  ].filter(Boolean).join('\n');
  const user = [
    `Жанр: ${p.genre||'роман'}${p.subgenre?', '+p.subgenre:''}.`,
    p.era ? `Эпоха: ${p.era}.` : '',
    (p.synopsis||p.idea) ? `Синопсис: ${p.synopsis||p.idea}` : '',
    ideaSeed ? `Идея мира от автора: ${ideaSeed}` : '',
    hint ? `Подсказка автора для категории «${category}»: ${hint}` : '',
    existing.length ? `\nУЖЕ В КАНОНЕ (категория «${category}») — не повторяй и не противоречь, расширяй:\n${existing.map(f=>'— '+f.text).join('\n')}` : '',
    '',
    `Предложи 3-6 ${existing.length ? 'НОВЫХ, дополняющих' : ''} фактов категории «${category}».`,
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

// ── Оценка глубины уже собранного канона мира — по фактам, БЕЗ прозы ──
// Отличается от runWorldDepthCheck в bookreview.js: тот читает уже написанные
// сцены (bookOverview) и смотрит только категорию «магия/технология»/«система»
// (клише жанровых систем) — требует минимум 2 написанные сцены, недоступен на
// стадии «Мир», где сцен ещё физически нет. Эта проверка по умолчанию — по
// ВСЕМ категориям сразу (общий срез мира); необязательный параметр category
// сужает её до ОДНОЙ категории — точечная проверка прямо с карточки категории,
// без прогона остальных.
export function worldOverviewMessages(state, category=null){
  const p = state.project;
  const facts = (state.bible||[]).filter(b=>b.source==='world' && (!category || b.category===category));
  const byCategory = {};
  facts.forEach(f=>{ const cat=f.category||'без категории'; (byCategory[cat]=byCategory[cat]||[]).push(f.text); });
  const catText = Object.entries(byCategory).map(([cat,texts])=>`${cat} (${texts.length}):\n${texts.map(t=>'  — '+t).join('\n')}`).join('\n\n');
  const sys = [
    category
      ? `Ты — редактор-worldbuilder. Оцени, насколько ГЛУБОКО и КОНКРЕТНО проработана ТОЛЬКО категория «${category}» мира книги — по уже собранным фактам канона, прозы может ещё не быть вообще.`
      : 'Ты — редактор-worldbuilder. Оцени, насколько ГЛУБОКО и КОНКРЕТНО проработан мир книги — по уже собранным фактам канона, прозы может ещё не быть вообще.',
    'Глубина — это конкретные, проверяемые правила и ограничения, а не общие слова («в этом мире есть магия» — плохо, «маг стареет на год за каждое серьёзное заклинание» — хорошо).' + (category ? '' : ' Разнообразие категорий важно не меньше числа фактов в одной: 10 фактов только про географию при пустой истории/фракциях/культуре — тоже поверхностно, даже если каждый факт хорош.'),
    'Штрафуй за: расплывчатые факты без конкретики, отсутствие ограничений/цены там, где они уместны (магия/технология/система — что система НЕ может, чего стоит), факты-клише жанра (то, что можно вставить в любую книгу этого жанра без изменений).' + (category ? '' : ' Также штрафуй за пустые или почти пустые категории.'),
  ].join('\n');
  const user = [
    `Жанр: ${p.genre||'роман'}${p.era?', '+p.era:''}.`,
    '',
    facts.length ? `СОБРАННЫЕ ФАКТЫ КАНОНА${category?` КАТЕГОРИИ «${category}»`:' ПО КАТЕГОРИЯМ'}:\n${catText}` : `Фактов канона${category?` категории «${category}»`:''} пока нет вообще.`,
    '',
    category
      ? `Верни JSON: { "depth": 0-10 (0 = фактов почти нет или сплошные общие слова, 10 = богатая, конкретная категория), "issues": ["до 4 конкретных проблем с привязкой к факту"], "suggestions": ["до 4 конкретных направлений, что добавить или уточнить именно в этой категории"] }`
      : 'Верни JSON: { "depth": 0-10 (0 = фактов почти нет или сплошные общие слова, 10 = богатый, конкретный, разноплановый мир), "thinCategories": ["категории, где фактов мало или они расплывчаты, 0-3"], "issues": ["до 4 конкретных проблем с привязкой к факту или категории"], "suggestions": ["до 4 конкретных направлений, что добавить или уточнить"] }',
    `Если ${category?'категория':'мир'} уже хорош${category?'а':''} — скажи это в suggestions, issues${category?'':' и thinCategories'} могут быть пустыми. Только JSON.`,
  ].filter(Boolean).join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

export async function runWorldOverview(state, category=null){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ текстовой модели (⚙).');
  const facts = (state.bible||[]).filter(b=>b.source==='world' && (!category || b.category===category));
  const minFacts = category ? 2 : 3;
  if(facts.length < minFacts) throw new Error(category ? `Нужно хотя бы ${minFacts} факта категории «${category}», чтобы оценить глубину.` : 'Нужно хотя бы несколько фактов канона мира, чтобы оценить глубину.');
  const msgs = worldOverviewMessages(state, category);
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.3, messages:msgs, maxTokens:900, retries:g.retries });
  const j = extractJSON(res.text);
  if(!j || typeof j.depth !== 'number') throw new Error('Не удалось разобрать ответ.');
  return {
    depth: Math.max(0, Math.min(10, Math.round(j.depth))),
    thinCategories: category ? [] : (Array.isArray(j.thinCategories) ? j.thinCategories.slice(0,3) : []),
    issues: Array.isArray(j.issues) ? j.issues.slice(0,4) : [],
    suggestions: Array.isArray(j.suggestions) ? j.suggestions.slice(0,4) : [],
  };
}

// Поиск возможных дублей канона мира — локально, БЕЗ обращения к LLM: риск
// дублирования растёт с каждой добавленной пачкой фактов (та же деталь
// формулируется по-разному в разных категориях/заходах), а гонять это через
// API на каждый чих незачем — переиспользуем ту же TF-IDF-косинус-систему,
// что и bibleMatches() в bible.js, просто попарно между самими фактами мира.
// Порог 0.45 откалиброван на реальных парафразах/неродственных фактах:
// перефразировки одного и того же факта дают cosine ~0.5-0.56, а факты на
// одну тему, но про разное — ~0.13 и ниже.
const DUPLICATE_THRESHOLD = 0.45;

export function findWorldDuplicates(state, threshold=DUPLICATE_THRESHOLD){
  const facts = (state.bible||[]).filter(b=>b.source==='world');
  const vecs = facts.map(f=>tfvec(tokensOf((f.keys||'')+' '+(f.text||''))));
  const pairs = [];
  for(let i=0;i<facts.length;i++){
    for(let j=i+1;j<facts.length;j++){
      const sim = cosine(vecs[i], vecs[j]);
      if(sim >= threshold) pairs.push({ a: facts[i], b: facts[j], sim });
    }
  }
  pairs.sort((x,y)=>y.sim-x.sim);
  return pairs;
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
// Ни один из вариантов не должен просить отдельный текстовый элемент
// (заголовок, картуш с названием и т.п.) — это прямо противоречит запрету
// на любой текст сверх заданных подписей мест ниже (geoLine). Раньше
// последний вариант просил "ornate cartouche title banner" — модель
// послушно рисовала декоративный титульный баннер с надписью «Атлас Мира»,
// которого никто не просил, поверх и без того ограниченного бюджета текста.
const MAP_STYLE_FLAVORS = [
  "weathered antique parchment, sepia ink linework, hand-lettered typography",
  "painterly illuminated atlas page, muted watercolor washes, gilded border ornaments",
  "woodcut-engraving style, cross-hatched shading, Renaissance-explorer aesthetic",
  "hand-drawn adventurer's field map, ink-and-wash, coffee-stained edges, sketchy compass rose",
  "richly illustrated tabletop-RPG atlas, saturated color, ornate decorative border",
];

// Язык подписей КАРТЫ — отдельная настройка от общего ruText/noText в
// «Иллюстрациях» (те остаются для обложки/сцен, где нужен настоящий читаемый
// текст на языке книги). Карта — почти всегда фэнтези-объект, и родной шрифт
// расы куда уместнее кириллицы. Для придуманных языков (эльфийский/дроу/
// дварфийский) у модели нет реальной письменности — просим ДЕКОРАТИВНУЮ
// стилизацию под дух языка, не перевод: она всё равно нарисует нечитаемые
// знаки, но хотя бы в правильном стиле, а не случайную кириллицу/латиницу.
export const MAP_LANGUAGES = {
  ru:       { label: 'Русский',     instr: 'Russian, Cyrillic script, not English' },
  en:       { label: 'Английский',  instr: 'English' },
  elvish:   { label: 'Эльфийский',  instr: 'an elegant flowing elvish fantasy script (Tolkien-inspired decorative letterforms) — invented calligraphy, NOT real English or Cyrillic letters; it does not need to be legible as any real language, only to look consistently elvish' },
  drow:     { label: 'Дроу',        instr: 'a dark, angular drow (dark-elf) runic script — sharp jagged fantasy glyphs, NOT real English or Cyrillic letters; it does not need to be legible as any real language, only to look consistently like drow runes' },
  dwarvish: { label: 'Дварфийский', instr: 'a blocky, geometric dwarvish runic script — angular carved-stone-style glyphs, NOT real English or Cyrillic letters; it does not need to be legible as any real language, only to look consistently dwarvish' },
  none:     { label: 'Без текста',  instr: '' },
};

// ── Карта мира — НЕ через suggestIllustrations()/illustrationSuggestMessages()
// (те требуют doneScenesOrdered(state), а на стадии «Мир» сцен ещё нет, спека §9).
// Переиспользуется только низкоуровневый generateImage() из imagegen.js.
// mapLanguage (state.illustrations) читается здесь и определяет формулировку
// "labeled"/"no text" в самом промпте — раньше карта ВСЕГДА просила и "no text
// artifacts", и "labeled" геообъекты в одном промпте (прямое противоречие
// самому себе), и никогда не учитывала язык подписей, хотя карта — ровно то
// место, где надписи (названия мест) есть чаще всего.
export function mapPromptFor(state){
  const geoFacts = (state.bible||[]).filter(b=>b.source==='world' && b.category==='география');
  if(!geoFacts.length) throw new Error('Нужно хотя бы несколько фактов категории «География» в каноне.');
  const p = state.project;
  const ic = state.illustrations || {};
  const lang = MAP_LANGUAGES[ic.mapLanguage] ? ic.mapLanguage : 'ru';
  const noText = lang === 'none';
  // Бюджет символов — у фактов ОТДЕЛЬНЫЙ кап, а не общий с шаблоном: при
  // насыщенном каноне (10+ фактов географии) общий .slice() в конце срезал
  // промпт прямо на середине списка фактов, тихо теряя половину из них —
  // не резать хвост, а ограничивать именно факты.
  // Кап поднят с 900 до 3000: у проработанного мира легко набирается 15+
  // фактов географии (3-4 тыс. символов) — на 900 генератор видел едва ли
  // четверть карты и обрубался ПРЯМО ПОСЕРЕДИНЕ СЛОВА одного из фактов,
  // отправляя модели синтаксически оборванное предложение. Теперь режем
  // строго по границе целого факта — последний, что не влезает целиком, в
  // промпт не попадает вообще, а не отправляется огрызком.
  const FACTS_BUDGET = 3000;
  let facts = '';
  for(const f of geoFacts){
    const next = facts ? facts + ' ' + f.text : f.text;
    if(next.length > FACTS_BUDGET) break;
    facts = next;
  }
  if(!facts) facts = geoFacts[0].text.slice(0, FACTS_BUDGET); // единственный факт длиннее бюджета — редкий крайний случай
  const style = `${p.genre||'роман'}${p.era?', '+p.era:''}`;
  const flavor = MAP_STYLE_FLAVORS[Math.floor(Math.random()*MAP_STYLE_FLAVORS.length)];
  // Карта обычно требует МНОГО подписей (по факту на место) — а именно плотный
  // мелкий текст (много коротких надписей на одной картинке) сильнее всего
  // подвержен артефактам у любых image-моделей. Автор сам выбирает, сколько
  // САМЫХ важных мест подписать крупно (селектор в ui/world.js, по умолчанию
  // 5) — раньше это был бинарный переключатель («2-3» или «6-8»), не дающий
  // выбрать промежуточное или большее значение.
  const labelCount = Math.max(1, Math.min(10, Math.round(Number(ic.mapLabelCount)) || 5));
  // Доп. рычаги против кракозябр (сверх количества подписей и языка):
  // 1) жёсткий лимит длины подписи — длинное название («Пустыня Забытых
  //    Часов») ломается почти всегда, даже если подписей всего 2-3;
  //    просим короткий алиас/ключевое слово, а не полное каноничное имя.
  // 2) явный запрет на тонкие/рукописные засечки — они гарантированно
  //    рассыпаются на мелких деталях сильнее, чем толстая простая обводка.
  const fontNote = 'Use thick, simple, blocky lettering (like carved stone or a woodcut stamp) — thin serif or flowing cursive strokes reliably break apart into illegible marks at this level of detail.';
  // Порог поднят с ">5" на ">3" по живому тесту: на 5 подписях 2 из 5 вышли
  // с побитыми буквами (реальный прогон, не гипотеза) — риск начинается
  // раньше, чем предыдущая формулировка признавала. Второй риск ниже (подпись
  // типа рельефа) добавляет ещё текста на ту же картинку — предупреждение
  // об этом всегда, не только при большом labelCount.
  const riskNote = (labelCount > 3
    ? ' More labels means higher risk of garbled letters even with these precautions — accept that trade-off, and take extra care to spell each one correctly.'
    : ' Leave the rest of the geography unlabeled rather than cramming in more text — fewer, larger labels stay legible far more reliably than many small ones.')
    + ' Each name+type pair together is still just two short words — do not let the type line grow longer or more detailed than the name above it.';
  const geoLine = noText
    ? `Geography (must appear as visual features only — NO text, no labels, no writing anywhere): ${facts}`
    // Автор явно попросил подписывать не только имя, но и ОБЩИЙ ТИП рельефа —
    // без этого «Кристальных Когтей»/«Забытых Часов» читаются как случайные
    // фэнтези-слова, и непонятно, что перед тобой горы или пустыня, не
    // прочитав факт в каноне отдельно. Тип — второй, заметно мельче основного
    // имени, чтобы не спорить с ним за внимание и не задваивать риск кракозябр
    // на самом важном слове (названии).
    : `Geography (must appear as visual features — ${facts}). Label ONLY the ${labelCount} most important named place${labelCount>1?'s':''}, in LARGE, bold, hand-lettered text (${MAP_LANGUAGES[lang].instr}) styled as part of the map's decoration (not a printed caption). Each label must be SHORT — one word, or a two-word nickname, never the full name. ALWAYS strip the generic category word from the name, keeping only the distinctive part: "Пустыня Забытых Часов" → "Забытых Часов", "Хребет Кристальных Когтей" → "Кристальных Когтей", "Болото Ускользающих Огней" → "Ускользающих Огней", "Лес Шатких Теней" → "Шатких Теней" — this applies to EVERY label, not just some of them. This is not optional: the type line below already states that generic word (горы, пустыня, болото, лес...), so keeping it in the name too means saying the same thing twice on the same label. Never merge two different place names into one invented hybrid label — each label names exactly ONE place from the facts above. Directly under each name, add a SECOND, noticeably smaller line — exactly ONE plain Russian word naming its general terrain type (горы, пустыня, лес, болото, озеро, остров, город, река, побережье, долина, etc. — whichever matches the fact), so the kind of place is clear without guessing from the fantasy name alone. Do not add a title, banner, caption, scale bar, or any other text on the map beyond these ${labelCount} name+type pairs — the ONLY exception is a compass rose's single-letter N/S/E/W marks, nothing else. ${fontNote}${riskNote}`;
  return [
    `Fantasy-style map, top-down bird's-eye view, cartography illustration${noText ? ', no text artifacts' : ''}.`,
    `Art direction: ${flavor}.`,
    `Render the terrain richly and visibly, not as a bare outline: rivers winding to the sea or lakes, forests as clusters of tree symbols, mountain ranges with peak hatching, roads or trails connecting settlements, coastlines with texture — infer plausible terrain features even where the facts below don't specify every one, as long as they don't contradict the facts. Where a fact names a terrain TYPE (desert, swamp, forest, mountains, sea), draw that actual terrain there, not a generic or unrelated feature — a desert fact means visible dunes/sand, not open water.`,
    `Feel free to invent atmospheric cartographic flourishes NOT contradicting the facts below — a compass rose (single-letter N/S/E/W marks only, no other wording), sea monsters or ships in unmapped waters, decorative border, weathered texture, subtle terrain shading. Do NOT add a numbered scale bar — the small numerals on a scale bar are exactly the kind of tiny, dense text that reliably garbles; a decorative border or texture reads as authentic without it. The map should read as a real hand-drawn artifact, not a bare literal diagram of only what's listed.`,
    `Setting: ${style}.`,
    geoLine,
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
  return { dataUrl, prompt };
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
