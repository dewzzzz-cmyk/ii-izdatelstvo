// Модель состояния проекта Литсовет + дефолты.
// Единый объект state, персистентный в IndexedDB (storage.js).

import { saveProject, loadProject, pushToServer, syncFromServer, getServerProject, lastPushConflict } from './storage.js';
import { rebuildBibleVecs, tokensOf, tfvec, cosine } from './bible.js';
import { TEXT_PROVIDERS, matchTextProvider, MODEL_PRICES } from './providers.js';

// Версия приложения — единственный источник правды (дублируется в package.json
// для npm, но UI читает отсюда, чтобы не тянуть package.json в браузер).
export const APP_VERSION = '1.76.1';

// Цены за 1M токенов (вход/выход) — грубая оценка стоимости. Единый источник —
// providers.js (та же таблица кормит подсказку цены прямо в селекте модели,
// см. priceLabel там же) — раньше это была вторая, отдельно живущая копия
// того же списка, рискующая разъехаться с первой при каждом добавлении
// провайдера.
export const PRICES = MODEL_PRICES;

let _id = 0;
export function uid(prefix='id'){ return prefix + '_' + (Date.now().toString(36)) + '_' + (++_id).toString(36); }

export function defaultState(){
  return {
    id: uid('proj'),
    updated: Date.now(),
    project: {
      title: '',
      author: '',              // имя на обложке и в метаданных EPUB
      idea: '',                // «о чём книга» — один вопрос онбординга
      genre: '', subgenre: '', audience: '', era: '',
      synopsis: '',
      coverDataUrl: '',        // обложка (dataURL jpeg/png) — попадает в EPUB
      bookUuid: '',            // постоянный уникальный идентификатор книги (dc:identifier)
      targetWords: 80000,
      type: 'single',          // single | series
      seriesTitle: '',
      seriesTotal: 3,
      seriesBook: 1,
      mode: 'director',         // director (режиссёр) | factory (фабрика)
      useVoice: false,          // показывать вкладку «Голос» и учитывать образец
      sceneWords: 0,            // 0 = авто (totalWords/60, зажато 700-2000); явное значение — диапазон 300-4000
      chapterCount: 0,          // 0 = «авто» — предзаполняет #chCount на Структуре
      pacing: 'balanced',       // action | balanced | reflective — доля сцена/секвель у Архитектора
      seriesSummary: '',        // краткое содержание предыдущих книг серии (для книги 2+)
    },
    style: {
      refs: [],                // стилевые ориентиры (авторы)
      density: 3, dialogue: 2, pace: 2,
      forbidden: ['клише','эмоц. ярлыки','восклицания'],
      rules: [],               // правила автора (do/don't): идут Прозаику, Оценщику, Стражу стиля
      profanity: 'off',        // off | mild | moderate | strict — см. effectiveRules() ниже
      humorLevel: 'auto',      // auto | off | light | strong — см. humorLevelNote() в genres.js
      colorMode: 'color',      // color | bw — цветные иллюстрации или чёрно-белые
      artStyleId: '',          // id пресета из artStyles.js; '' = без пресета (только «Визуальный голос»)
    },
    voice: {
      sample: '',              // вставленный образец прозы
      examples: [],            // 5+ отобранных предложений (управляющий вход в промпт)
      metrics: null,           // числовые метрики (только индикатор UI)
    },
    structure: [],             // плоский массив узлов {type:'chapter'|'scene', ...}
    structureStale: false,     // true — в канон добавлены world-факты после того как скелет уже построен
    bible: [],                 // {keys, text, _vec?}
    // Клише/образы, уже подтверждённые Оценщиком в ЛЮБОЙ сцене книги (не только
    // текущей) — bannedCliches в pipeline.js раньше сбрасывался на каждую новую
    // сцену, из-за чего одна и та же авторская находка модели («X — резко, как
    // Y») не мешала ей повторить почти тот же образ в другой сцене несколькими
    // прогонами позже. Обрезается в runScene() до последних ~150 записей.
    usedCliches: [],
    // Живой инцидент: несколько сцен подряд заканчивались одним и тем же
    // приёмом («уровень заряда: N%») — не дословный повтор (usedCliches его
    // не ловит, слова разные каждый раз), а повтор ТИПА концовки. Хвосты
    // последних сцен книги — тот же принцип, что и usedCliches (сверка книги
    // с самой собой), но для оси «Ритм» Оценщика, не «Свежести». Обрезается
    // в runScene() до последних ~10.
    recentSceneEndings: [],
    characters: [],            // {name, desc, stateNote, book}
    memory: { scenes:{}, chapters:{}, books:{} },
    series: [],
    // Разборы книги целиком (Критик, Бета-ридер). Раньше жили в модульных
    // переменных ui/stages.js — отчёт исчезал при перезагрузке страницы, и за
    // него приходилось платить заново. Кнопка «↺ открыть снова» работала ровно
    // до первого F5. Отсюда же «непонятно, что с ним делать»: с ним нечего было
    // делать, потому что он не жил. done[] — ключи пунктов, отмеченных автором
    // как сделанные: отчёт превращается из разового текста в рабочий список.
    reviews: {
      critic:  null,  // { report, at, done:[] }
      beta:    null,  // { report, at, done:[] }
      chekhov: null,  // { report, at, done:[] } — ружья Чехова
    },
    agents: defaultAgents(),
    diagnostics: { runs: [] },  // трейсы прогонов по run_id
    illustrations: {
      provider: 'gemini',      // gemini | openai — какой платный провайдер картинок
      apiKey: '',              // отдельный ключ, НЕ текстовый — тоже только в памяти
      model: '',                // пусто → дефолт провайдера (gpt-image-1 / gemini-2.5-flash-image)
      quality: 'standard',     // standard | hd
      items: [],                // {id, type, sceneId, sceneTitle, prompt, dataUrl, createdAt, versions?} — versions[] хранит ПРОШЛЫЕ dataUrl/prompt/createdAt (см. illustrations.js pushImageVersion/restoreImageVersion), cap 3
      suggestCount: 7,          // сколько кандидатов предлагать (включая обложку), 1-15
      mode: 'auto',             // auto (арт-директор сам предлагает) | manual (автор выбирает главы/обложку галочкой)
      ruText: true,             // если на картинке есть надписи (обложка/сцены) — они на русском
      noText: false,            // вообще без текста на картинке — приоритет над ruText
      portraitCover: false,     // обложка в портретных пропорциях (под требования площадок публикации)
      mapLanguage: 'ru',        // язык подписей КАРТЫ отдельно от ruText/noText — см. MAP_LANGUAGES в world.js (эльфийский/дроу/дварфийский и т.п.)
      mapLabelCount: 5,          // сколько мест подписывать на карте крупным текстом — больше подписей, выше риск нечитаемых артефактов у любых image-моделей (см. mapPromptFor в world.js)
      mapAutoLabels: false,      // только вместе с mapLanguage:'none' — карта получает пронумерованные точки вместо слов, detectMapMarkers() потом распознаёт номера и подписывает настоящим текстом (см. world.js)
    },
    global: {
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: '',              // ТОЛЬКО в памяти, не сериализуется
      budgetTokens: 128000,    // бюджет сборки контекста
      retries: 2,
      evaluatorThreshold: 7.5,  // порог принятия сцены Оценщиком — минимум 7.5 (не ниже, качество важнее скорости)
      // 5→3 по просьбе автора: литературные стражи теперь бегут с ПЕРВОЙ
      // итерации (см. pipeline.js), а не только под конец — Прозаик получает
      // их замечания раньше, и 5 попыток стало избыточно дорого для того же
      // результата.
      evaluatorMaxIter: 3,      // сколько раз дорабатывать сцену, прежде чем сдаться
      // 3→1: живой инцидент — «Улучшить» за один клик прогнало 3 внутренние
      // итерации без спроса, и суммарный объём книги усох с ~90к до ~70,6к
      // слов (17→11 глав) за эти прогоны — откат по баллу (см. ui/stages.js)
      // это не ловил, т.к. Оценщик судит архитектуру, не объём. Один прогон
      // за клик — автор явно видит результат и решает, продолжать ли; кто
      // хочет автоматических повторов — поднимает слайдер сам.
      structureMaxIter: 1,      // сколько раз архитектор сам перерабатывает скелет книги по замечаниям
                                // Оценщика структуры, прежде чем остановиться (раньше — если оценка ≥8/10)
      structurePatchMode: false, // «Улучшить» правит только главы из affectedChapters Оценщика, остальные
                                // (включая уже написанные сцены) не проходят через LLM вообще — иначе по
                                // умолчанию как раньше: каждая итерация пересобирает весь скелет целиком
      architectTokenMultiplier: 1, // множитель поверх авто-рассчитанного потолка токенов Архитектора
                                // (runBookArchitect/runBookArchitectPatch/regenerateDownstream) — обычный
                                // слайдер maxTokens для этой роли не показываем (см. ui/diagnostics.js): он
                                // сломал бы авто-масштабирование под объём книги. Множитель даёт ту же
                                // ручку «дать больше места», не отменяя саму формулу.
      // Ключи API по провайдеру ('deepseek'|'openai'|'gemini'|'qwen') — заполняется
      // автоматически при сохранении Настроек (см. ui/app.js), чтобы роль,
      // переопределившая себе другого провайдера (agent.provider, панель агентов
      // ui/diagnostics.js → llmFor() ниже), могла использовать этот же ключ снова,
      // не вводя его заново. Имя поля 'apiKeys' (не providerKeys) намеренно —
      // совпадает с SECRET_KEYS в storage.js, поэтому автоматически ТОЛЬКО в
      // памяти, как и одиночный apiKey (см. восстановление из localStorage ниже).
      apiKeys: {},
    },
    log: [],
    ui: { stage: 'concept', rightTab: 'roadmap', mobPanel: 'center', chatEditMode: false, editorAuto: false },
    // Суммарный факт. расход на ЭТОТ проект — в отличие от «потрачено» в
    // Роадмапе (сумма diagnostics.runs[].totalCost, только текст, и runs
    // обрезаются до 50 последних — у долгоживущих книг старые прогоны
    // выпадают из суммы), это НИКОГДА не урезаемый счётчик: llm.js и
    // imagegen.js прибавляют сюда после КАЖДОГО успешного запроса (см.
    // callLLM/generateImage), независимо от того, какая бизнес-функция его
    // вызвала — единая точка учёта вместо разметки каждого места вызова.
    spend: { text: 0, images: 0 },
  };
}

// Реестр агентов с дефолтами. Каждый включаем/отключаем (диагностический режим).
export function defaultAgents(){
  return [
    { id:'architect', name:'Архитектор сцены', icon:'🏗', temp:0.4, maxTokens:16200, enabled:true, role:'architect',
      desc:'Планирует сцену: ключевые детали, шаги, запрещённые слова. Не пишет прозу — готовит каркас для Прозаика.' },
    // Единственная роль с дефолтным переопределением модели. Замер на живой
    // сцене (один и тот же контекст, один и тот же Оценщик, менялась только
    // модель Прозаика): deepseek-chat дал свежесть 5 / конкретность 5 / 515
    // слов при цели 750, deepseek-v4-pro — 6 / 6 / 858 слов, deepseek-reasoner
    // — 6 / 7 / балл 6.9. До этого ось «Свежесть» стояла ровно на 5 во ВСЕХ 18
    // замерах по четырём сценам — потолок оказался у модели Прозаика, а не у
    // рубрики Оценщика и не у формы директивы. v4-pro выбран как компромисс:
    // качество reasoner при вдвое меньшей цене выхода ($0.87 против $2.19).
    // Остальные роли остаются на глобальной модели намеренно — см. CHANGELOG
    // 1.57.0 про замер v4-flash на Стражах.
    { id:'prose',     name:'Прозаик',          icon:'✍️', temp:0.85, maxTokens:64800, enabled:true, role:'prose', loop:true,
      provider:'deepseek', model:'deepseek-v4-pro',
      desc:'Пишет прозу сцены по брифу и контексту. В петле с Оценщиком дорабатывает черновик, пока тот не примет.' },
    { id:'evaluator', name:'Оценщик',          icon:'⚖️', temp:0.2, maxTokens:57600, enabled:true, role:'evaluator',
      desc:'Независимо оценивает черновик по 5 осям (свежесть, ритм, конкретность, голос, бриф). Не пишет — судит и возвращает замечания. Образует петлю с Прозаиком.' },
    { id:'voiceguard',name:'Страж голоса',     icon:'👁', temp:0.2, maxTokens:37800, strictness:2, enabled:false, role:'voiceguard',
      desc:'Сверяет стиль и ритм с образцом вашего голоса, цитируя образец. Только флагует, не переписывает. Идёт параллельно с другими стражами.' },
    { id:'logic',     name:'Страж логики',     icon:'⚖️', temp:0.2, maxTokens:37800, strictness:2, enabled:true, role:'logic',
      desc:'Проверяет физику, время и причинность: возможно ли это в мире сцены. Видит только факты, не стиль. Параллельно.' },
    { id:'events',    name:'Страж событий',    icon:'🗓', temp:0.2, maxTokens:37800, strictness:2, enabled:true, role:'events',
      desc:'Проверяет, что персонаж знает/чувствует то, что должен по прошлым событиям. Видит только факты. Параллельно.' },
    { id:'styleguard',name:'Страж стиля',      icon:'🚦', temp:0.2, maxTokens:37800, strictness:2, enabled:true, role:'styleguard',
      desc:'Ловит нарушения ваших «Правил автора» (do/don\'t) и показывает цитату. Только флагует. Параллельно с другими стражами.' },
    { id:'imagery',   name:'Страж образов',    icon:'🎨', temp:0.2, maxTokens:37800, strictness:2, enabled:true, role:'imagery',
      desc:'Ловит смешанные, абсурдные или физически невозможные метафоры и сравнения, разъехавшийся регистр образа. Не клише — за это отвечает другой страж. Только флагует. Параллельно с другими стражами.' },
    { id:'lineedit',  name:'Линейный редактор',icon:'✂️', temp:0.3, maxTokens:64800, enabled:true, role:'lineedit',
      desc:'Лёгкая правка: убирает эмоциональные ярлыки, варьирует ритм, чистит клише. Единственный, кто меняет текст после Прозаика.' },
    { id:'reader',    name:'Читатель',          icon:'📖', temp:0.3, maxTokens:37800, strictness:2, enabled:true, role:'reader',
      desc:'Смотрит на сцену глазами читателя: не теряется ли интерес, ясна ли ставка, совпадает ли финальная эмоция с задуманной. Только флагует, не переписывает. Идёт параллельно с другими стражами.' },
    { id:'pov',       name:'Страж точки зрения',icon:'👀', temp:0.2, maxTokens:37800, strictness:2, enabled:true, role:'pov',
      desc:'Ловит head-hopping: незаметные скачки к мыслям/ощущениям другого персонажа внутри сцены без разметки. Только флагует. Параллельно с другими стражами.' },
    { id:'dialogue',  name:'Страж диалога',     icon:'💬', temp:0.3, maxTokens:37800, strictness:2, enabled:true, role:'dialogue',
      desc:'Ловит реплики «в лоб» (без подтекста), избыточные теги вместо экшн-бит, неразличимые голоса персонажей. Только флагует. Параллельно с другими стражами.' },
    { id:'resolution',name:'Страж развязки',     icon:'⏳', temp:0.2, maxTokens:37800, strictness:2, enabled:true, role:'resolution',
      desc:'Ловит преждевременную развязку: герой мгновенно принимает невероятное, конфликт гаснет без эскалации, тайна получает ответ без паузы. Только флагует. Параллельно с другими стражами.' },
    { id:'atmosphere',name:'Страж атмосферы',    icon:'🌲', temp:0.3, maxTokens:37800, strictness:2, enabled:true, role:'atmosphere',
      desc:'Ловит недостаток сенсорных деталей (природа, существа, погода) там, где сцена вводит новое или важное место мира — обратный полюс оси «Темп» Оценщика. Только флагует. Параллельно с другими стражами.' },
    { id:'humor',     name:'Страж жанра',        icon:'🎭', temp:0.3, maxTokens:37800, strictness:2, enabled:true, role:'humor',
      desc:'Только для иронических жанров (ироничный детектив/фэнтези, юмористическая проза) — ловит упущенные моменты, где жанр явно требует иронии/шутки, а сцена сыграна полностью прямо. На остальных жанрах не запускается. Только флагует. Параллельно с другими стражами.' },
    { id:'bookArchitect', name:'Книжный архитектор', icon:'🏛️', temp:0.6, enabled:true, role:'bookArchitect',
      desc:'Строит скелет книги (главы→сцены) на стадии Структуры. Один запуск на книгу, не часть цикла сцены — maxTokens считается автоматически по объёму книги, не настраивается.' },
    // ── Роли ВНЕ цикла сцены. До 1.61.0 их вообще не было в этом списке:
    // лимиты токенов и модель были захардкожены в своих модулях, автор не мог
    // ни поднять потолок, ни выбрать модель, ни увидеть, что эти агенты
    // существуют. Тумблер «включён» им не нужен — они запускаются кнопкой, а
    // не пайплайном, поэтому enabled стоит всегда true и в UI не показывается
    // (см. offPipeline ниже).
    { id:'critic', name:'Критик книги', icon:'🎭', temp:0.4, maxTokens:38400, enabled:true, role:'critic', offPipeline:true,
      desc:'Рецензия на всю рукопись, бета-ридер, ружья Чехова, глубина мира, картонность персонажей. Запускается кнопками на вкладке «Редактура».' },
    { id:'worldbuilder', name:'Мироустроитель', icon:'🌍', temp:0.6, maxTokens:26400, enabled:true, role:'worldbuilder', offPipeline:true,
      desc:'Предлагает факты мира по категориям, ищет нестыковки канона, строит карту. Запускается кнопками на вкладке «Мир».' },
    { id:'historian', name:'Историк', icon:'📜', temp:0.4, maxTokens:30000, enabled:true, role:'historian', offPipeline:true,
      desc:'Историческая справка по эпохе и проверка анахронизмов. Запускается на вкладке «Мир».' },
    { id:'artdirector', name:'Арт-директор', icon:'🖼️', temp:0.6, maxTokens:18000, enabled:true, role:'artdirector', offPipeline:true,
      desc:'Предлагает, что иллюстрировать, и пишет промпты для картинок. Сами картинки рисует отдельный провайдер (вкладка «Иллюстрации»).' },
  ];
}

// ── Персонажи: единая точка разрешения имени (спека — устраняет расщепление
// одного персонажа на несколько карточек). Раньше memory.js и series.js
// матчили ТОЛЬКО точным совпадением строки — «Олег» и «Олег К.» из разных
// сцен превращались в двух разных персонажей, потому что архивариус каждый
// раз не знал, что имя уже встречалось, и модель свободно выбирала форму.
//
// Слово-в-слово сравнение (не посимвольный prefix!) — иначе «Оля» ложно
// матчилась бы с «Олег». Сокращение с точкой («К.») считается совпадением
// с полным словом на ту же букву («Крылов»).
function wordsMatch(w1, w2){
  if(w1===w2) return true;
  const d1=w1.replace(/\.$/,''), d2=w2.replace(/\.$/,'');
  if(w1.endsWith('.') && d1 && w2.startsWith(d1)) return true;
  if(w2.endsWith('.') && d2 && w1.startsWith(d2)) return true;
  return false;
}
export function charNamesMatch(a, b){
  const an=(a||'').trim().toLowerCase(), bn=(b||'').trim().toLowerCase();
  if(!an || !bn) return false;
  if(an===bn) return true;
  const aw=an.split(/\s+/).filter(Boolean), bw=bn.split(/\s+/).filter(Boolean);
  if(!aw.length || !bw.length) return false;
  const short = aw.length<=bw.length ? aw : bw;
  const long  = aw.length<=bw.length ? bw : aw;
  return short.every((w,i)=>wordsMatch(w, long[i]));
}
// Найти персонажа по имени (с защитой от дублей форм) или создать нового.
// extra — доп. поля (desc/book) для НОВОЙ карточки, не перезаписывает существующую.
export function findOrCreateCharacter(state, name, extra={}){
  state.characters = state.characters || [];
  let ch = state.characters.find(x=>charNamesMatch(x.name, name));
  if(!ch){
    ch = { name, desc:'', stateNote:'', book: state.project?.title||'', ...extra };
    state.characters.push(ch);
  }
  return ch;
}
// Объединить два персонажа вручную (панель «Память»): оставляет запись keepIdx,
// переносит недостающие desc/stateNote из dropIdx, чинит scene.presentChars
// во всех сценах (там могло остаться старое имя дубля) и удаляет дубль.
export function mergeCharacters(state, keepIdx, dropIdx){
  const chars = state.characters||[];
  const keep = chars[keepIdx], drop = chars[dropIdx];
  if(!keep || !drop || keepIdx===dropIdx) return false;
  if(!keep.desc && drop.desc) keep.desc = drop.desc;
  if(!keep.stateNote && drop.stateNote) keep.stateNote = drop.stateNote;
  (state.structure||[]).forEach(n=>{
    if(n.type==='scene' && Array.isArray(n.presentChars) && n.presentChars.includes(drop.name)){
      n.presentChars = [...new Set(n.presentChars.map(nm=>nm===drop.name?keep.name:nm))];
    }
  });
  state.characters = chars.filter((_,i)=>i!==dropIdx);
  return true;
}

const OBSERVE_SIM = 0.5;
function sameNote(a, b){ return cosine(tfvec(tokensOf(a)), tfvec(tokensOf(b))) >= OBSERVE_SIM; }

// Добавить правило автора (do/don't). Дедуп по СХОДСТВУ (не только точному
// тексту) — «✨ Обобщить» и ручной ввод могут дать чуть разные формулировки
// одного и того же принципа. Возвращает true, если добавлено.
export function addRule(state, text){
  text = (text||'').trim(); if(!text) return false;
  state.style = state.style || {}; state.style.rules = state.style.rules || [];
  if(state.style.rules.some(r=>sameNote(r, text))) return false;
  state.style.rules.push(text); return true;
}

// Мягкая память замеченных Оценщиком клише-категорий (state.style.observed[]).
// В отличие от rules — не «соблюдай неукоснительно», а «уже случалось в этой
// книге N раз» с накоплением счётчика по сценам. Не становится жёстким правилом,
// пока автор сам не закрепит через UI (ui/memory.js → openRuleModal → addRule).
// Вызывается из pipeline.js каждый раз, когда Оценщик выдаёт clicheCategory для
// текущей сцены — дедуп по sceneId внутри записи не даёт раздуть счётчик
// повторными итерациями одной сцены.
export function recordObservedPattern(state, sceneId, category){
  const text = (category||'').trim(); if(!text) return;
  state.style = state.style || {};
  state.style.observed = state.style.observed || [];
  if((state.style.rules||[]).some(r=>sameNote(r, text))) return; // уже стало явным правилом
  const existing = state.style.observed.find(o=>!o.dismissed && sameNote(o.category, text));
  if(existing){
    if(!existing.sceneIds.includes(sceneId)){ existing.count++; existing.sceneIds.push(sceneId); existing.lastSeen = Date.now(); }
  } else {
    state.style.observed.push({ category:text, count:1, sceneIds:[sceneId], lastSeen: Date.now() });
  }
  // защита от разрастания на очень длинной книге: держим top-40 по частоте
  if(state.style.observed.length > 40){
    state.style.observed.sort((a,b)=>b.count-a.count || b.lastSeen-a.lastSeen);
    state.style.observed.length = 40;
  }
}

// Скрыть паттерн из «мягкого» списка — и когда автор закрепил его как правило
// через openRuleModal (тот уже вызвал addRule сам, здесь только чистим список),
// и когда решил «не сейчас». Не удаляем совсем: то же замечание, встретившись
// снова, не должно открыться сразу с count:1 и запутать счётчик — помечаем
// dismissed, recordObservedPattern такие пропускает при поиске совпадения
// (новое вхождение заведёт свежую запись).
export function dismissObserved(state, idx){
  const o = (state.style?.observed||[])[idx]; if(!o) return false;
  o.dismissed = true; return true;
}

// Открытые сюжетные линии («чеховские ружья» без развязки) — state.memory.openThreads[].
// Копится в closeChapter() (author-control.js) на каждой границе главы через
// runChekhovCheck (bookreview.js): что этот прогон считает нерешённым — остаётся
// и стареет (chaptersOpen++), что теперь решено — уходит из списка. Дедуп по
// смыслу (sameNote), не по тексту — формулировка от прогона к прогону чуть плывёт.
export function updateOpenThreads(state, setups){
  state.memory = state.memory || {};
  state.memory.openThreads = state.memory.openThreads || [];
  const threads = state.memory.openThreads;
  (setups||[]).forEach(s=>{
    const what = (s.what||'').trim(); if(!what) return;
    if(s.resolved){
      const idx = threads.findIndex(t=>!t.dismissed && sameNote(t.what, what));
      if(idx>=0) threads.splice(idx,1);
      return;
    }
    const existing = threads.find(t=>!t.dismissed && sameNote(t.what, what));
    if(existing){ existing.chaptersOpen++; existing.lastSeen = Date.now(); }
    else threads.push({ what, introducedIn: s.introducedIn||'', chaptersOpen: 1, lastSeen: Date.now() });
  });
  if(threads.length > 20){
    threads.sort((a,b)=>b.chaptersOpen-a.chaptersOpen);
    threads.length = 20;
  }
}

// Скрыть линию — автор решил, что она осознанно оставлена открытой (или уже
// разобрался сам). Та же логика, что dismissObserved: помечаем, не удаляем.
export function dismissOpenThread(state, idx){
  const t = (state.memory?.openThreads||[])[idx]; if(!t) return false;
  t.dismissed = true; return true;
}

// Обнаруженные противоречия нового факта канона с уже существующим —
// state.memory.factConflicts[]. Пишется из summarizeScene() (memory.js), когда
// архивариус извлёк новый факт, близкий по теме к уже записанному (та же
// сущность/объект), а сверка ИИ решила, что они противоречат, а не дополняют
// друг друга — напр. одна сцена описывает предмет как гаджет, другая как
// магический артефакт. В отличие от openThreads/observed — не растёт
// счётчиком повторов: каждая пара «новый факт против старого» своя запись,
// дедуп по точному совпадению пары (не по смыслу — иначе разные пары A/B и
// A/C схлопнутся в одну и потеряется, с чем именно противоречие).
export function recordFactConflict(state, { newFact, oldFact, explain, sceneId, sceneTitle }){
  const nf = (newFact||'').trim(), of = (oldFact||'').trim(); if(!nf || !of) return;
  state.memory = state.memory || {};
  state.memory.factConflicts = state.memory.factConflicts || [];
  const conflicts = state.memory.factConflicts;
  if(conflicts.some(c=>!c.dismissed && c.newFact===nf && c.oldFact===of)) return;
  conflicts.push({ newFact:nf, oldFact:of, explain:(explain||'').trim(), sceneId:sceneId||'', sceneTitle:sceneTitle||'', at: Date.now() });
  if(conflicts.length > 30) conflicts.splice(0, conflicts.length-30);
}

// Скрыть конфликт — автор решил (или уже исправил вручную). Та же логика: помечаем, не удаляем.
export function dismissFactConflict(state, idx){
  const c = (state.memory?.factConflicts||[])[idx]; if(!c) return false;
  c.dismissed = true; return true;
}

// Расхождение сцены с планом книги — state.memory.driftFlags[]. Пишется из
// summarizeScene() (memory.js) в двух случаях: (1) type:'newCharacter' —
// сцена ввела персонажа, которого не было в каноне книги (findOrCreateCharacter
// создал НОВУЮ карточку, а не нашёл существующую); (2) type:'futureConflict' —
// новый факт из сцены противоречит брифу ещё НЕ НАПИСАННОЙ сцены дальше по
// книге (в отличие от factConflicts выше — там сверка с уже существующим
// каноном, здесь наоборот, с планом будущего). Оба случая — «сюжет уехал от
// плана, а план об этом не знает»; автор решает сам, никогда не переписывается
// автоматически. Дедуп по (type, text, sceneId) — та же пара может всплыть
// повторно при пересуммаризации одной и той же сцены.
// ---- Разборы книги: сохранение и отметки «сделано» ----
// kind: 'critic' | 'beta' | 'chekhov'. Отчёт живёт в проекте, а не в памяти
// вкладки — иначе F5 стирал результат платного разбора.
export function saveReview(state, kind, report){
  state.reviews = state.reviews || {};
  const прежние = state.reviews[kind]?.done || [];
  // Новый разбор — новые пункты; старые отметки «сделано» к ним не относятся
  // и переносить их вслепую нельзя (индексы разъедутся, и автор увидит
  // вычеркнутым то, чего не делал). Сбрасываем осознанно.
  state.reviews[kind] = { report, at: Date.now(), done: [], prevDoneCount: прежние.length };
  return state.reviews[kind];
}
export function getReview(state, kind){ return state.reviews?.[kind] || null; }
// Ключ пункта — стабильная строка от вызывающего (секция+индекс), а не сам
// текст: текст длинный, а хранить его копию в done[] значит дублировать отчёт.
export function toggleReviewDone(state, kind, key){
  const r = state.reviews?.[kind]; if(!r) return false;
  r.done = r.done || [];
  const i = r.done.indexOf(key);
  if(i >= 0){ r.done.splice(i,1); return false; }
  r.done.push(key); return true;
}
export function isReviewDone(state, kind, key){ return !!state.reviews?.[kind]?.done?.includes(key); }

export function recordDriftFlag(state, { type, text, sceneId, sceneTitle, targetSceneId, targetSceneTitle }){
  const t = (text||'').trim(); if(!t) return;
  state.memory = state.memory || {};
  state.memory.driftFlags = state.memory.driftFlags || [];
  const flags = state.memory.driftFlags;
  if(flags.some(f=>!f.dismissed && f.type===type && f.text===t && f.sceneId===sceneId)) return;
  flags.push({ type, text:t, sceneId:sceneId||'', sceneTitle:sceneTitle||'', targetSceneId:targetSceneId||'', targetSceneTitle:targetSceneTitle||'', at: Date.now() });
  if(flags.length > 30) flags.splice(0, flags.length-30);
}

// Скрыть — та же логика, что и у остальных мягких сигналов: помечаем, не удаляем.
export function dismissDriftFlag(state, idx){
  const f = (state.memory?.driftFlags||[])[idx]; if(!f) return false;
  f.dismissed = true; return true;
}

let _agc = 0;
// Добавить кастомного агента-стража (флагует по своему промпту, безопасно).
export function addCustomAgent(state, name, prompt){
  const a = { id:'custom_'+(Date.now().toString(36))+(_agc++), name:name||'Свой страж', icon:'🛡',
    temp:0.2, maxTokens:25200, strictness:2, enabled:true, role:'custom', custom:true,
    prompt: prompt||'Проверь сцену и отметь проблемы.', desc:'Кастомный страж: '+(prompt||'').slice(0,80) };
  state.agents.push(a); return a;
}
export function removeAgent(state, id){
  const a=(state.agents||[]).find(x=>x.id===id);
  if(a && a.custom){ state.agents = state.agents.filter(x=>x.id!==id); return true; }
  return false; // встроенных не удаляем — их можно только выключить тумблером
}

// Найти агента по роли (или id как fallback) — используется пайплайном сцены
// и Книжным архитектором для чтения temp/maxTokens конкретной роли.
export function ag(state, role){
  return (state.agents||[]).find(a=>a.role===role || a.id===role) || {};
}

// Конфиг вызова LLM для конкретного агента: если у агента задан свой
// provider (см. per-роль переключатель провайдера/модели в
// ui/diagnostics.js — выпадающие списки из providers.js, не свободный
// текст), URL и ключ берутся оттуда — иначе наследуется state.global как
// раньше. Ключ ищется в global.apiKeys[provider] (заполняется автоматически
// при сохранении Настроек, см. ui/app.js); если его там нет, но именно этот
// провайдер сейчас выбран глобально — используем текущий global.apiKey.
// Модель агента (agent.model) при этом независима от provider: можно
// оставить провайдера как в настройках, но взять другую его модель.
export function llmFor(state, agent){
  const g = state.global;
  if(agent && agent.provider){
    const p = TEXT_PROVIDERS.find(x=>x.v===agent.provider && x.v!=='custom');
    if(p){
      // Ключ ТОЛЬКО от этого же провайдера: либо сохранённый под него в
      // apiKeys[provider], либо глобальный — но лишь когда глобально выбран
      // ровно этот же провайдер. Раньше в конце стоял ещё один фолбэк
      // `|| g.apiKey`, который сводил всю проверку на нет: если автор
      // переключил роли (например, Оценщику) отдельного провайдера, не введя
      // для него ключ, сюда подставлялся ключ ГЛОБАЛЬНОГО, совсем другого
      // провайдера — и уходил в заголовке авторизации на baseURL чужой
      // компании. То есть секрет одного сервиса утекал третьей стороне, а сам
      // запрос всё равно падал с auth-ошибкой. Пустой ключ здесь — правильное
      // поведение: вызывающий код (все callLLM-сайты) отдаёт понятную ошибку
      // «Не задан API-ключ» вместо тихой отправки чужого секрета.
      const apiKey = (g.apiKeys && g.apiKeys[agent.provider])
        || (matchTextProvider(g.baseURL)===agent.provider ? g.apiKey : '');
      return { baseURL: p.baseURL, apiKey, model: agent.model || p.model, retries: g.retries };
    }
  }
  return {
    baseURL: g.baseURL,
    apiKey: g.apiKey,
    model: (agent && agent.model) || g.model,
    retries: g.retries,
  };
}

// ---- Глобальное состояние сессии ----
let _state = null;
const _subs = new Set();

export function getState(){ return _state; }
export function setState(s){ _state = s; emit(); }
export function subscribe(fn){ _subs.add(fn); return ()=>_subs.delete(fn); }
function emit(){ _subs.forEach(fn=>{ try{ fn(_state); }catch(e){ console.error(e); } }); }

// Стиль баннера — по просьбе автора уменьшен и снабжён отдельной кнопкой
// закрытия (раньше был на всю ширину экрана, во весь голос, и не закрывался
// иначе как через полную перезагрузку страницы). Сама тонкая полоска сверху
// сохранена — это по-прежнему сигнал «сервер не видит последних правок», не
// декоративный тост, поэтому не прячем совсем, но заметность снижена.
const BANNER_CSS = 'position:fixed;top:8px;right:8px;z-index:9999;max-width:340px;padding:6px 10px;background:#c0392b;color:#fff;font-size:12px;line-height:1.4;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.25);display:flex;gap:8px;align-items:flex-start';
function showBanner(text, onclickText, onclick){
  let b = document.getElementById('_saveBanner');
  if(!b){
    b = document.createElement('div'); b.id='_saveBanner'; b.style.cssText=BANNER_CSS;
    document.body?.appendChild(b);
  }
  b.innerHTML = `<span style="flex:1;cursor:${onclick?'pointer':'default'}">${text}</span><span style="cursor:pointer;opacity:.8;flex-shrink:0" title="скрыть">✕</span>`;
  if(onclick) b.querySelector('span').onclick = onclick;
  b.lastElementChild.onclick = (e)=>{ e.stopPropagation(); b.remove(); };
}

function persistToServer(){
  return saveProject(_state)
    .then(json=>pushToServer(_state, json))
    // pushToServer возвращает false при любой сетевой/HTTP-ошибке (см. её
    // комментарий в storage.js) — раньше результат не проверялся вообще,
    // индикатор синхронизации всегда показывал «●», даже если сцена никогда
    // не доходила до сервера. Локальные данные (IndexedDB) при этом целы —
    // это именно сигнал «сервер не видит последних правок», не потеря данных.
    .then(ok=>{
      setSyncStatus(ok ? 'ok' : 'err');
      // Конфликт ревизий — не «сеть моргнула», а «эта вкладка устарела»:
      // без явного баннера автор видел лишь тихий ⚠ у точки синхронизации и
      // продолжал работать со старой копией, недоумевая, куда делись свежие
      // изменения (живой репорт «почему я это не вижу?»). Если после фикса
      // гонки (см. runPersist ниже) это всё же случилось — значит, на сервер
      // реально пришла более новая версия ОТКУДА-ТО ЕЩЁ (другая вкладка,
      // устройство, фоновый скрипт), а не самоконфликт этой же вкладки.
      if(!ok && lastPushConflict){
        showBanner('⚠ На сервере более новая версия проекта — нажмите, чтобы обновить страницу и загрузить её', null, ()=>location.reload());
      }
      return ok;
    })
    .catch(e=>{
      console.error('save failed', e);
      setSyncStatus('err');
      showBanner('⚠ Не удалось сохранить: '+e.message);
      return false;
    });
}

let _saveTimer = null;
// Серия promise: каждый вызов встаёт в хвост и ждёт, пока долетит предыдущий
// пуш, вместо того чтобы лететь ПАРАЛЛЕЛЬНО с ним. Живой инцидент: на реальной
// сети (не localhost) ответ сервера иногда занимал больше 400мс дебаунса —
// следующая правка успевала запустить ВТОРОЙ persistToServer() поверх ещё не
// завершившегося первого; второй уходил со СТАРЫМ state.rev (первый ещё не
// успел обновить его своим ответом), сервер видел это как чужой конфликт
// (409) и автор получал баннер «на сервере более новая версия» — хотя обе
// версии были от этой же вкладки. Отсюда «баннер вылезает после каждой
// правки». Теперь новый пуш дожидается предыдущего и уходит с уже верным rev.
let _pushChain = null;
function runPersist(){
  _pushChain = (_pushChain || Promise.resolve()).then(persistToServer);
  const p = _pushChain;
  p.finally(()=>{ if(_pushChain===p) _pushChain=null; });
  return p;
}

export function save(){
  if(!_state) return;
  _state.updated = Date.now();
  // API-ключ хранится отдельно в localStorage браузера (не уходит на сервер)
  const k = _state.global?.apiKey;
  if(typeof k === 'string') lsSet('litsovet_apikey', k);
  const ik = _state.illustrations?.apiKey;
  if(typeof ik === 'string') lsSet('litsovet_ic_apikey', ik);
  // Ключи по провайдеру (per-роль override, см. llmFor) — тот же принцип:
  // не уходят на сервер/диск (см. SECRET_KEYS в storage.js), восстанавливаются
  // из localStorage при загрузке (см. init() ниже).
  if(_state.global?.apiKeys) lsSet('litsovet_apikeys', JSON.stringify(_state.global.apiKeys));
  emit();
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(runPersist, 400);
}

// Страховка на закрытие вкладки/уход со страницы.
// save() не пишет на диск сразу — она лишь планирует запись через 400мс, и
// собственно saveProject() (IndexedDB) выполняется уже внутри отложенного
// persistToServer(). Именно save() (а не saveNow()) фиксирует текст сцены:
// blur ручного редактора и завершение прогона Прозаика. Обработчиков выгрузки
// страницы не было ни одного, автосохранения по таймеру — тоже: автор снимал
// фокус с текста и закрывал вкладку в пределах этих 400мс — правка исчезала
// молча, без единого предупреждения, и при следующем открытии книги её просто
// не было. Здесь дожимаем отложенную запись синхронно, пока страница ещё жива.
// pagehide — потому что на мобильных/при восстановлении из кэша beforeunload
// не гарантирован; visibilitychange('hidden') ловит сворачивание приложения.
if(typeof window !== 'undefined'){
  const flushPending = ()=>{
    if(!_state || !_saveTimer) return;
    clearTimeout(_saveTimer);
    _saveTimer = null;
    // Только локальная запись: сетевой пуш всё равно не успеет завершиться на
    // выгрузке страницы, а IndexedDB — успевает и является источником правды
    // при следующем открытии проекта.
    try{ saveProject(_state); }catch{}
  };
  window.addEventListener('beforeunload', flushPending);
  window.addEventListener('pagehide', flushPending);
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden') flushPending(); });
}

// Тот же save(), но пуш на сервер не ждёт 400мс дебаунса — для результатов
// дорогих платных операций (генерация картинки и т.п.), где цена гонки
// «автор обновил страницу раньше, чем дошёл отложенный пуш» ощутимо выше,
// чем у обычной текстовой правки: без этого результат генерации оставался
// только в IndexedDB этой вкладки, и обновление страницы (или открытие с
// другого устройства) до истечения дебаунса показывало старую картинку —
// не потеря данных (IndexedDB цел), но выглядит именно как потеря.
export async function saveNow(){
  if(!_state) return false;
  clearTimeout(_saveTimer);
  // Та же синхронная часть, что и в save() — но без повторного
  // planning'а отложенного таймера (иначе persistToServer() ушёл бы дважды:
  // сразу и снова через 400мс).
  _state.updated = Date.now();
  const k = _state.global?.apiKey;
  if(typeof k === 'string') lsSet('litsovet_apikey', k);
  const ik = _state.illustrations?.apiKey;
  if(typeof ik === 'string') lsSet('litsovet_ic_apikey', ik);
  if(_state.global?.apiKeys) lsSet('litsovet_apikeys', JSON.stringify(_state.global.apiKeys));
  emit();
  return runPersist();
}

function lsGet(k){ try{ return localStorage.getItem(k); }catch{ return null; } }
function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch{} }
// global.apiKeys хранится в localStorage как JSON (см. save()) — тот же
// принцип, что у одиночного litsovet_apikey, просто структура сложнее.
function lsGetApiKeys(){ try{ return JSON.parse(lsGet('litsovet_apikeys') || '{}'); }catch{ return {}; } }

export async function init(){
  // Синхронизируем с сервером в фоне ДО загрузки активного проекта
  // чтобы сразу иметь актуальные данные при первом открытии
  setSyncStatus('syncing');
  const hadNew = await syncFromServer().catch(()=>false);

  const savedKey = lsGet('litsovet_apikey') || '';
  const savedIcKey = lsGet('litsovet_ic_apikey') || '';
  const savedApiKeys = lsGetApiKeys();
  const lastId = lsGet('litsovet_last');
  if(lastId){
    const loaded = await loadProject(lastId).catch(()=>null);
    if(loaded){ loaded.global = loaded.global||{}; loaded.global.apiKey = savedKey; loaded.global.apiKeys = savedApiKeys; loaded.illustrations = loaded.illustrations||{}; loaded.illustrations.apiKey = savedIcKey; _state = migrate(loaded); setSyncStatus('ok'); emit(); return _state; }
  }
  // Если lastId не нашёлся локально — мог прийти с сервера
  if(hadNew && lastId){
    const loaded = await loadProject(lastId).catch(()=>null);
    if(loaded){ loaded.global = loaded.global||{}; loaded.global.apiKey = savedKey; loaded.global.apiKeys = savedApiKeys; loaded.illustrations = loaded.illustrations||{}; loaded.illustrations.apiKey = savedIcKey; _state = migrate(loaded); setSyncStatus('ok'); emit(); return _state; }
  }
  _state = defaultState();
  lsSet('litsovet_last', _state.id);
  setSyncStatus('ok');
  emit();
  return _state;
}

export function newProject(){
  const prevKey = _state?.global?.apiKey || '';
  const prevApiKeys = _state?.global?.apiKeys || {};
  const prevIc = _state?.illustrations || {};
  _state = defaultState();
  _state.global.apiKey = prevKey;
  _state.global.apiKeys = prevApiKeys;
  _state.illustrations.apiKey = prevIc.apiKey || '';
  // Провайдер/модель/качество/размер идут вместе с ключом — ключ одного
  // провайдера не работает у другого (иначе после первого нового проекта
  // ключ молча остаётся, а провайдер откатывается на дефолтный gemini).
  if(prevIc.provider) _state.illustrations.provider = prevIc.provider;
  if(prevIc.model) _state.illustrations.model = prevIc.model;
  if(prevIc.quality) _state.illustrations.quality = prevIc.quality;
  if(prevIc.size) _state.illustrations.size = prevIc.size;
  lsSet('litsovet_last', _state.id);
  save();
  return _state;
}

// Переключиться на другой проект по id (из IndexedDB или сервера)
export async function switchProject(id){
  let proj = await loadProject(id).catch(()=>null);
  if(!proj){
    proj = await getServerProject(id).catch(()=>null);
    if(proj) await saveProject(proj).catch(()=>{});
  }
  if(!proj) return false;
  proj.global = proj.global||{}; proj.global.apiKey = _state?.global?.apiKey||''; proj.global.apiKeys = _state?.global?.apiKeys||{};
  proj.illustrations = proj.illustrations||{}; proj.illustrations.apiKey = _state?.illustrations?.apiKey||'';
  _state = migrate(proj);
  lsSet('litsovet_last', id);
  emit();
  return true;
}

// Индикатор статуса синхронизации (обновляется в шапке)
let _syncStatus = 'ok'; // 'ok' | 'syncing' | 'err'
export function getSyncStatus(){ return _syncStatus; }
export function setSyncStatus(s){
  _syncStatus=s;
  const el=document.getElementById('_syncDot');
  if(!el) return;
  el.textContent = s==='ok' ? '●' : s==='syncing' ? '◌' : '⚠';
  el.style.color = s==='ok' ? 'var(--ok)' : s==='syncing' ? 'var(--text-3)' : 'var(--err)';
  el.title = s==='err'
    ? 'Не удалось синхронизировать с сервером — правки сохранены только в этом браузере, на другом устройстве их не видно'
    : 'Синхронизация с сервером';
}

// Мягкая миграция отсутствующих полей (версионирование схемы).
// Экспортируется ради тестов: миграция — самое ответственное место (тихая
// потеря авторских настроек между версиями), и проверять её надо напрямую,
// а не через побочные эффекты загрузки проекта.
export function migrate(s){
  const d = defaultState();
  s.project = Object.assign({}, d.project, s.project);
  s.style   = Object.assign({}, d.style, s.style);
  s.voice   = Object.assign({}, d.voice, s.voice);
  s.global  = Object.assign({}, d.global, s.global);
  // Бюджет сборки контекста 32000 → 128000 (×4). Тот же принцип, что у
  // maxTokens выше: подтягиваем только тех, кто ещё сидит на старом дефолте,
  // ручное значение автора не трогаем. Повод — рост книги: при 32000 на длинной
  // книге applyBudget() выбивал сводки глав, персонажей и КАНОН, причём молча
  // (см. отчёт trimmed в context.js). Контекстное окно DeepSeek V4 — 1 млн
  // токенов, так что 128000 упирается не в модель, а только в цену входа.
  if(s.global.budgetTokens === 32000) s.global.budgetTokens = 128000;
  s.memory  = Object.assign({}, d.memory, s.memory);
  // mapLanguage — новое поле; в проектах, где карта уже настраивалась через
  // общий ruText/noText (единственный вариант до этой фичи), переносим их
  // выбор один раз, а не тихо сбрасываем всем на дефолтный «Русский».
  const hadMapLanguage = !!(s.illustrations && 'mapLanguage' in s.illustrations);
  s.illustrations = Object.assign({}, d.illustrations, s.illustrations);
  if(!hadMapLanguage) s.illustrations.mapLanguage = s.illustrations.noText ? 'none' : (s.illustrations.ruText ? 'ru' : 'en');
  s.illustrations.items = s.illustrations.items || [];
  // Самовосстановление обложки: старая кнопка «✕ Убрать обложку» в Концепции
  // чистила только project.coverDataUrl, не трогая illustrations.items — в
  // проектах, где обложка когда-то была сгенерирована/загружена через раздел
  // «Иллюстрации», а потом убрана оттуда, картинка обложки оставалась висеть в
  // галерее, но не попадала ни в экспорт, ни в чтение книги. Если поле пустое,
  // а осиротевшая обложка в галерее есть — подтягиваем её обратно как официальную.
  if(!s.project.coverDataUrl){
    const coverItem = s.illustrations.items.filter(it=>it.type==='cover').pop();
    if(coverItem) s.project.coverDataUrl = coverItem.dataUrl;
  }
  s.diagnostics = s.diagnostics || { runs: [] };
  // Диета состояния — живой инцидент: проект разросся до 23 МБ и грузился
  // 13+ секунд только по сети. Разложение: 12.2 МБ — ОДНА карта мира
  // (base64-дубль в baseDataUrl + 3 полных версии в истории), 5.9 МБ —
  // 33 полных трейса пайплайна в diagnostics.runs (кап был 50). Всё это
  // ездит на сервер при каждом save() и обратно при каждой загрузке.
  // Здесь — разовая чистка уже раздутых проектов; новые записи ограничивают
  // те же капы на месте создания (diagnostics.js, illustrations.js).
  if(Array.isArray(s.diagnostics.runs) && s.diagnostics.runs.length > 10) s.diagnostics.runs.length = 10;
  (s.illustrations.items||[]).forEach(it=>{
    if(it.type!=='map') return;
    if(Array.isArray(it.versions) && it.versions.length > 1) it.versions.length = 1;
    // Дубль чистой карты: пока подписи не накладывались, baseDataUrl===dataUrl —
    // держать две копии по 2.7 МБ незачем. Пустая строка = «база совпадает с
    // dataUrl»; applyMapLabels материализует копию обратно перед первым
    // наложением подписей (см. illustrations.js), читатели используют fallback.
    if(it.baseDataUrl && it.baseDataUrl === it.dataUrl) it.baseDataUrl = '';
  });
  s.spend = s.spend || { text: 0, images: 0 };
  s.structureStale = s.structureStale || false;
  // Порог принятия сцены — теперь минимум 7.5 (жёсткий пол, не «дефолт по
  // умолчанию»): даже если автор раньше сам поставил ниже, качество текста
  // важнее скорости прохождения. Макс. итераций подтягиваем со старого
  // дефолта (3) на новый (5) — раз порог строже, доработке нужно больше попыток,
  // прежде чем сдаваться; ручную настройку выше дефолта не трогаем.
  s.global.evaluatorThreshold = Math.max(7.5, s.global.evaluatorThreshold ?? 7.5);
  // Одноразовые миграции значений — ТОЛЬКО под флагом версии.
  // Раньше здесь стояли две подряд идущие правки одного поля по его значению:
  // «если 3 → стало 5», а следующей строкой «если 5 → стало 3». Обе выполнялись
  // в ОДНОМ вызове migrate() над одним объектом, и по значению невозможно
  // отличить «старый дефолт» от «автор сам выставил столько же». Итог: автор,
  // сознательно поставивший слайдер «Макс. итераций Оценщика» на 5 (диапазон
  // 1-8, 5 — легальное значение), при КАЖДОЙ загрузке проекта молча получал
  // откат на 3 — его настройка не приживалась никогда и без единого сообщения.
  // Флаг версии решает ровно это: одноразовое действительно происходит один
  // раз, а дальше значение принадлежит автору и больше не переписывается.
  // ИМЯ БЕЗ ПОДЧЁРКИВАНИЯ — принципиально: safeReplacer в storage.js вырезает из
  // сериализации любой ключ, начинающийся с «_» (он задуман для приватных полей
  // вроде _vec у Библии). Флаг с именем `_migVer` не доживал до следующей
  // загрузки, всегда читался как 0 — и одноразовая миграция снова оказывалась
  // «каждоразовой», то есть баг с откатом ручной настройки сохранялся бы полностью.
  const migVer = s.global.migrationVersion ?? 0;
  if(migVer < 1){
    // Литературные стражи теперь бегут с первой итерации (pipeline.js), поэтому
    // 5 попыток избыточны — переводим на текущий дефолт 3 тех, кто ещё сидит на
    // прежнем дефолте 5. Однократно: см. комментарий выше.
    if(s.global.evaluatorMaxIter === 5) s.global.evaluatorMaxIter = 3;
    // Тот же однократный спуск 3→1 для structureMaxIter.
    if(s.global.structureMaxIter === 3) s.global.structureMaxIter = 1;
  }
  s.global.migrationVersion = 1;
  // scene.words — чистая производная от scene.text, но живёт отдельным полем и
  // в двух местах отстаёт от текста: живой стрим пишет text по ходу генерации
  // (нарочно — чтобы пережить обрыв сети), а ручной ввод коммитит счётчик
  // только на blur. Прогон, оборванный между стримом и финальной записью,
  // оставлял 4000 символов прозы при words:0 — и книга «весила» вдвое меньше
  // во всех списках, в шапке и в режиме чтения. Пересчёт на загрузке чинит и
  // уже испорченные книги, и любую будущую щель того же вида: врать счётчику
  // незачем, текст всегда рядом. НЕ под флагом миграции — это не однократное
  // решение автора, а инвариант.
  (s.structure||[]).forEach(n=>{
    if(n.type!=='scene') return;
    const w = (n.text||'').trim() ? (n.text.match(/\S+/g)||[]).length : 0;
    if(n.words !== w) n.words = w;
  });
  // Мердж агентов по id: сохраняем пользовательские enabled/temp и ПОРЯДОК, до-добавляем новых из дефолтов.
  if(!s.agents || !s.agents.length){ s.agents = d.agents; }
  else {
    // provider/model раньше в KEEP НЕ входили — их добавили вместе с per-role
    // переопределением моделей позже, а список не обновили. Итог: автор
    // выбирал Оценщику отдельного провайдера, выходила новая версия, и
    // настройка молча слетала на глобальную. Ровно тот же класс, что и
    // остальные находки этой сессии: настройка исчезает, а выглядит как
    // «автор так и хотел». Пустая строка здесь значима — это явное «как
    // глобально», отличимое от undefined («не задано, бери дефолт роли»);
    // именно поэтому UI при снятии пишет '' , а не удаляет поле.
    const KEEP = ['enabled','temp','maxTokens','strictness','manual','provider','model'];
    // Однократный бамп maxTokens для стражей/Оценщика/Линейного редактора — старый
    // дефолт (700 у стражей и кастомных, 900 у Оценщика, 1600 у Линейного редактора)
    // регулярно обрезал JSON-ответ на полуслове (найдено live-тестом: Страж событий
    // обрывался на ~816 токенах при потолке 700 — результат: 0 найденных флагов
    // вместо реальных 4, молча). Если автор НЕ трогал слайдер (значение всё ещё
    // старое) — подтягиваем к новому дефолту; если менял вручную — не трогаем.
    const OLD_MAXTOKENS_DEFAULT = { voiceguard:700, logic:700, events:700, styleguard:700, imagery:700, reader:700, pov:700, dialogue:700, evaluator:900, lineedit:1600 };
    // Второй раунд бампа (+50% от уже поднятого дефолта) — автор снова уткнулся
    // в потолок токенов у агентов. Та же логика: трогаем только тех, кто ещё
    // сидит на прошлом дефолте, ручные значения не перезаписываем.
    const OLD_MAXTOKENS_DEFAULT_V2 = { architect:600, prose:2400, evaluator:1300, voiceguard:1400, logic:1400, events:1400, styleguard:1400, imagery:1400, reader:1400, pov:1400, dialogue:1400, resolution:1400, atmosphere:1400, lineedit:2400 };
    // Третий раунд — Оценщик и раньше был бампнут (900→1300→1950 в предыдущих
    // сессиях, вручную/по факту прошлых версий дефолта), но живой прогон с
    // реальным usage апстрима (не оценкой) показал tokensOut РОВНО на 1950 —
    // JSON оборвался, вердикт не распарсился. Та же логика: трогаем только тех,
    // кто ещё сидит именно на этом значении, ручные правки не перезаписываем.
    const OLD_MAXTOKENS_DEFAULT_V3 = { evaluator:1950 };
    // Четвёртый раунд — +20% по прямой просьбе автора («подними все лимит
    // токенов ещё на 20%»), общий проход по всем лимитам приложения, не
    // реакция на конкретный обрыв. Та же логика: трогаем только тех, кто
    // ещё сидит на прошлом (V3-эпохи) дефолте, ручные правки не трогаем.
    const OLD_MAXTOKENS_DEFAULT_V4 = { architect:900, prose:3600, evaluator:3200, voiceguard:2100, logic:2100, events:2100, styleguard:2100, imagery:2100, lineedit:3600, reader:2100, pov:2100, dialogue:2100, resolution:2100, atmosphere:2100, humor:2100 };
    // Пятый раунд — по прямой просьбе автора после живого инцидента («Оценщик:
    // ответ не распарсился... лимит был 3840 — повтор с лимитом 7680»): +50% по
    // всем ролям разом, не точечно под Оценщика — та же логика («ещё сидит на
    // прошлом дефолте → подтягиваем, ручное значение не трогаем»).
    const OLD_MAXTOKENS_DEFAULT_V5 = { architect:1080, prose:4320, evaluator:3840, voiceguard:2520, logic:2520, events:2520, styleguard:2520, imagery:2520, lineedit:4320, reader:2520, pov:2520, dialogue:2520, resolution:2520, atmosphere:2520, humor:2520 };
    // Шестой раунд — ×2 по всем ролям по прямой просьбе автора. Повод не в
    // очередном обрыве, а в смене класса моделей: замер трёх Прозаиков показал,
    // что рост качества даёт переход на reasoning-модели (deepseek-v4-pro,
    // deepseek-reasoner), а они тратят ЧАСТЬ ТОГО ЖЕ лимита на рассуждение до
    // ответа (в пробе — 75-225 reasoning-токенов даже на запрос «ответь одним
    // словом»). На прежнем потолке длинная сцена у такой модели оборвалась бы
    // не из-за длины прозы, а из-за невидимой части ответа. Та же логика: кто
    // ещё сидит на прошлом дефолте — подтягиваем, ручные значения не трогаем.
    const OLD_MAXTOKENS_DEFAULT_V6 = { architect:1620, prose:6480, evaluator:5760, voiceguard:3780, logic:3780, events:3780, styleguard:3780, imagery:3780, lineedit:6480, reader:3780, pov:3780, dialogue:3780, resolution:3780, atmosphere:3780, humor:3780 };
    // V7 — значения до подъёма x5. Без этой строки проекты, стоящие на прежних
    // дефолтах, остались бы на них навсегда: миграция поднимает лимит только
    // тому, кто НЕ трогал его руками, а «не трогал» опознаётся ровно по
    // совпадению с одним из старых дефолтов.
    const OLD_MAXTOKENS_DEFAULT_V7 = { architect:3240, prose:12960, evaluator:11520, voiceguard:7560, logic:7560, events:7560, styleguard:7560, imagery:7560, lineedit:12960, reader:7560, pov:7560, dialogue:7560, resolution:7560, atmosphere:7560, humor:7560, critic:7680, worldbuilder:5280, historian:6000, artdirector:3600 };
    const defById = Object.fromEntries(d.agents.map(a=>[a.id, a]));
    // Идём по СОХРАНЁННОМУ порядку — пользовательская перестановка сохраняется.
    const storedIds = new Set(s.agents.map(a=>a.id));
    const updated = s.agents.filter(a=>!a.custom).map(a=>{
      const da = defById[a.id]; if(!da) return null; // удалённый дефолт — выкинуть
      const merged = Object.assign({}, da);
      KEEP.forEach(k=>{
        if(a[k]===undefined) return;
        if(k==='maxTokens' && (OLD_MAXTOKENS_DEFAULT[a.role]===a.maxTokens || OLD_MAXTOKENS_DEFAULT_V2[a.role]===a.maxTokens || OLD_MAXTOKENS_DEFAULT_V3[a.role]===a.maxTokens || OLD_MAXTOKENS_DEFAULT_V4[a.role]===a.maxTokens || OLD_MAXTOKENS_DEFAULT_V5[a.role]===a.maxTokens || OLD_MAXTOKENS_DEFAULT_V6[a.role]===a.maxTokens || OLD_MAXTOKENS_DEFAULT_V7[a.role]===a.maxTokens)) return; // всё ещё старый дефолт — берём новый
        merged[k]=a[k];
      });
      return merged;
    }).filter(Boolean);
    // Новые встроенные агенты (добавлены в дефолты после последнего сохранения) — в конец.
    const newBuiltins = d.agents.filter(da=>!da.custom && !storedIds.has(da.id));
    const customs = s.agents.filter(a=>a.custom).map(a=>{
      if(a.maxTokens===700) return {...a, maxTokens:1400};
      if(a.maxTokens===1400) return {...a, maxTokens:2100};
      if(a.maxTokens===2100) return {...a, maxTokens:2520};
      if(a.maxTokens===2520) return {...a, maxTokens:3780};
      if(a.maxTokens===3780) return {...a, maxTokens:37800};   // ×2, шестой раунд
      return a;
    });
    s.agents = [...updated, ...newBuiltins, ...customs];
  }
  s.ui = Object.assign({}, d.ui, s.ui);
  s.characters = s.characters || [];
  s.series = s.series || [];
  // Разборы книги: у проектов, сохранённых до 1.59.0, поля нет вовсе.
  s.reviews = Object.assign({ critic:null, beta:null, chekhov:null }, s.reviews || {});
  ['critic','beta','chekhov'].forEach(k=>{ if(s.reviews[k] && !Array.isArray(s.reviews[k].done)) s.reviews[k].done = []; });
  // Старые сохранённые оценки сцен (scene.lastEval.scores) в проектах-долгожителях
  // используют ключ «fresh» вместо текущего «freshness» — RUBRIC_AXES читает
  // freshness, находит undefined и рисует шкалу «Свежесть образа» пустой,
  // будто оценка 0, хотя реальный балл сохранён под старым именем.
  (s.structure||[]).forEach(n=>{
    const sc = n.lastEval?.scores;
    if(sc && sc.fresh!==undefined && sc.freshness===undefined){ sc.freshness = sc.fresh; delete sc.fresh; }
  });
  // Bible-векторы не сериализуются — восстанавливаем после загрузки
  if(s.bible && s.bible.length) rebuildBibleVecs(s.bible);
  return s;
}

// Ненормативная лексика (мат) раньше была полем в style без единого места, где
// оно реально читалось бы — настройка существовала в данных, но ни на что не
// влияла. Здесь она конвертируется в обычное «правило автора» и подмешивается
// к style.rules везде, где эти правила уже идут в промпт (Прозаик, Оценщик,
// Страж стиля, разбор замечаний) — одна точка сборки вместо N мест, которые
// иначе пришлось бы держать в синхроне вручную.
const PROFANITY_NOTES = {
  off: 'Не используй нецензурную лексику (мат) и грубые ругательства ни в речи персонажей, ни в повествовании — передавай сильные эмоции через действие, паузу, эвфемизм или умолчание вместо запрещённых слов.',
  mild: 'Ограничь грубую лексику лёгкими просторечными словами и восклицаниями — без нецензурного мата.',
  moderate: '', // естественный уровень — модель решает сама, без явного ограничения
  strict: 'В кризисных и эмоционально сильных сценах допустима откровенная нецензурная лексика в речи персонажей, если того требует ситуация.',
};
export function effectiveRules(style){
  const base = (style?.rules||[]).filter(Boolean);
  const note = PROFANITY_NOTES[style?.profanity] || '';
  return note ? [note, ...base] : base;
}
