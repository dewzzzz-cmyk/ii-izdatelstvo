// Модель состояния проекта Литсовет + дефолты.
// Единый объект state, персистентный в IndexedDB (storage.js).

import { saveProject, loadProject, pushToServer, syncFromServer, getServerProject } from './storage.js';
import { rebuildBibleVecs, tokensOf, tfvec, cosine } from './bible.js';

// Версия приложения — единственный источник правды (дублируется в package.json
// для npm, но UI читает отсюда, чтобы не тянуть package.json в браузер).
export const APP_VERSION = '1.13.0';

// Цены за 1M токенов (вход/выход) — грубая оценка стоимости. Перенос из ИИ-Издательства.
export const PRICES = {
  'deepseek-chat':     { in:0.14, out:0.28 },
  'deepseek-reasoner': { in:0.55, out:2.19 },
  'gpt-4o':            { in:2.5,  out:10 },
  'gpt-4o-mini':      { in:0.15, out:0.6 },
};

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
      profanity: 'moderate',   // off | mild | moderate | strict
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
    characters: [],            // {name, desc, stateNote, book}
    memory: { scenes:{}, chapters:{}, books:{} },
    series: [],
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
      mapRichLabels: false,     // больше подписанных мест на карте (6-8 вместо 2-3) — осознанный риск нечитаемых артефактов текста
    },
    global: {
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: '',              // ТОЛЬКО в памяти, не сериализуется
      budgetTokens: 32000,     // бюджет сборки контекста
      retries: 2,
      evaluatorThreshold: 7.5,  // порог принятия сцены Оценщиком — минимум 7.5 (не ниже, качество важнее скорости)
      evaluatorMaxIter: 5,      // сколько раз дорабатывать сцену, прежде чем сдаться — увеличено вместе с порогом
      structureMaxIter: 3,      // сколько раз архитектор сам перерабатывает скелет книги по замечаниям
                                // Оценщика структуры, прежде чем остановиться (раньше — если оценка ≥8/10)
    },
    log: [],
    ui: { stage: 'concept', rightTab: 'roadmap', mobPanel: 'center', chatEditMode: false, editorAuto: false },
  };
}

// Реестр агентов с дефолтами. Каждый включаем/отключаем (диагностический режим).
export function defaultAgents(){
  return [
    { id:'architect', name:'Архитектор сцены', icon:'🏗', temp:0.4, maxTokens:900, enabled:true, role:'architect',
      desc:'Планирует сцену: ключевые детали, шаги, запрещённые слова. Не пишет прозу — готовит каркас для Прозаика.' },
    { id:'prose',     name:'Прозаик',          icon:'✍️', temp:0.85, maxTokens:3600, enabled:true, role:'prose', loop:true,
      desc:'Пишет прозу сцены по брифу и контексту. В петле с Оценщиком дорабатывает черновик, пока тот не примет.' },
    { id:'evaluator', name:'Оценщик',          icon:'⚖️', temp:0.2, maxTokens:1950, enabled:true, role:'evaluator',
      desc:'Независимо оценивает черновик по 5 осям (свежесть, ритм, конкретность, голос, бриф). Не пишет — судит и возвращает замечания. Образует петлю с Прозаиком.' },
    { id:'voiceguard',name:'Страж голоса',     icon:'👁', temp:0.2, maxTokens:2100, strictness:2, enabled:false, role:'voiceguard',
      desc:'Сверяет стиль и ритм с образцом вашего голоса, цитируя образец. Только флагует, не переписывает. Идёт параллельно с другими стражами.' },
    { id:'logic',     name:'Страж логики',     icon:'⚖️', temp:0.2, maxTokens:2100, strictness:2, enabled:true, role:'logic',
      desc:'Проверяет физику, время и причинность: возможно ли это в мире сцены. Видит только факты, не стиль. Параллельно.' },
    { id:'events',    name:'Страж событий',    icon:'🗓', temp:0.2, maxTokens:2100, strictness:2, enabled:true, role:'events',
      desc:'Проверяет, что персонаж знает/чувствует то, что должен по прошлым событиям. Видит только факты. Параллельно.' },
    { id:'styleguard',name:'Страж стиля',      icon:'🚦', temp:0.2, maxTokens:2100, strictness:2, enabled:true, role:'styleguard',
      desc:'Ловит нарушения ваших «Правил автора» (do/don\'t) и показывает цитату. Только флагует. Параллельно с другими стражами.' },
    { id:'imagery',   name:'Страж образов',    icon:'🎨', temp:0.2, maxTokens:2100, strictness:2, enabled:true, role:'imagery',
      desc:'Ловит смешанные, абсурдные или физически невозможные метафоры и сравнения, разъехавшийся регистр образа. Не клише — за это отвечает другой страж. Только флагует. Параллельно с другими стражами.' },
    { id:'lineedit',  name:'Линейный редактор',icon:'✂️', temp:0.3, maxTokens:3600, enabled:true, role:'lineedit',
      desc:'Лёгкая правка: убирает эмоциональные ярлыки, варьирует ритм, чистит клише. Единственный, кто меняет текст после Прозаика.' },
    { id:'reader',    name:'Читатель',          icon:'📖', temp:0.3, maxTokens:2100, strictness:2, enabled:true, role:'reader',
      desc:'Смотрит на сцену глазами читателя: не теряется ли интерес, ясна ли ставка, совпадает ли финальная эмоция с задуманной. Только флагует, не переписывает. Идёт параллельно с другими стражами.' },
    { id:'pov',       name:'Страж точки зрения',icon:'👀', temp:0.2, maxTokens:2100, strictness:2, enabled:true, role:'pov',
      desc:'Ловит head-hopping: незаметные скачки к мыслям/ощущениям другого персонажа внутри сцены без разметки. Только флагует. Параллельно с другими стражами.' },
    { id:'dialogue',  name:'Страж диалога',     icon:'💬', temp:0.3, maxTokens:2100, strictness:2, enabled:true, role:'dialogue',
      desc:'Ловит реплики «в лоб» (без подтекста), избыточные теги вместо экшн-бит, неразличимые голоса персонажей. Только флагует. Параллельно с другими стражами.' },
    { id:'resolution',name:'Страж развязки',     icon:'⏳', temp:0.2, maxTokens:2100, strictness:2, enabled:true, role:'resolution',
      desc:'Ловит преждевременную развязку: герой мгновенно принимает невероятное, конфликт гаснет без эскалации, тайна получает ответ без паузы. Только флагует. Параллельно с другими стражами.' },
    { id:'atmosphere',name:'Страж атмосферы',    icon:'🌲', temp:0.3, maxTokens:2100, strictness:2, enabled:true, role:'atmosphere',
      desc:'Ловит недостаток сенсорных деталей (природа, существа, погода) там, где сцена вводит новое или важное место мира — обратный полюс оси «Темп» Оценщика. Только флагует. Параллельно с другими стражами.' },
    { id:'bookArchitect', name:'Книжный архитектор', icon:'🏛️', temp:0.6, enabled:true, role:'bookArchitect',
      desc:'Строит скелет книги (главы→сцены) на стадии Структуры. Один запуск на книгу, не часть цикла сцены — maxTokens считается автоматически по объёму книги, не настраивается.' },
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

let _agc = 0;
// Добавить кастомного агента-стража (флагует по своему промпту, безопасно).
export function addCustomAgent(state, name, prompt){
  const a = { id:'custom_'+(Date.now().toString(36))+(_agc++), name:name||'Свой страж', icon:'🛡',
    temp:0.2, maxTokens:2100, strictness:2, enabled:true, role:'custom', custom:true,
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

// ---- Глобальное состояние сессии ----
let _state = null;
const _subs = new Set();

export function getState(){ return _state; }
export function setState(s){ _state = s; emit(); }
export function subscribe(fn){ _subs.add(fn); return ()=>_subs.delete(fn); }
function emit(){ _subs.forEach(fn=>{ try{ fn(_state); }catch(e){ console.error(e); } }); }

let _saveTimer = null;
export function save(){
  if(!_state) return;
  _state.updated = Date.now();
  // API-ключ хранится отдельно в localStorage браузера (не уходит на сервер)
  const k = _state.global?.apiKey;
  if(typeof k === 'string') lsSet('litsovet_apikey', k);
  const ik = _state.illustrations?.apiKey;
  if(typeof ik === 'string') lsSet('litsovet_ic_apikey', ik);
  emit();
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(()=>{
    saveProject(_state)
      .then(()=>{ pushToServer(_state); setSyncStatus('ok'); })
      .catch(e=>{
        console.error('save failed', e);
        setSyncStatus('err');
        let b = document.getElementById('_saveBanner');
        if(!b){
          b = document.createElement('div'); b.id='_saveBanner';
          b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:9999;padding:8px 16px;background:#c0392b;color:#fff;font-size:13px;text-align:center;cursor:pointer';
          b.onclick=()=>b.remove(); document.body?.appendChild(b);
        }
        b.textContent='⚠ Не удалось сохранить: '+e.message+' · нажмите чтобы скрыть';
      });
  }, 400);
}

function lsGet(k){ try{ return localStorage.getItem(k); }catch{ return null; } }
function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch{} }

export async function init(){
  // Синхронизируем с сервером в фоне ДО загрузки активного проекта
  // чтобы сразу иметь актуальные данные при первом открытии
  setSyncStatus('syncing');
  const hadNew = await syncFromServer().catch(()=>false);

  const savedKey = lsGet('litsovet_apikey') || '';
  const savedIcKey = lsGet('litsovet_ic_apikey') || '';
  const lastId = lsGet('litsovet_last');
  if(lastId){
    const loaded = await loadProject(lastId).catch(()=>null);
    if(loaded){ loaded.global = loaded.global||{}; loaded.global.apiKey = savedKey; loaded.illustrations = loaded.illustrations||{}; loaded.illustrations.apiKey = savedIcKey; _state = migrate(loaded); setSyncStatus('ok'); emit(); return _state; }
  }
  // Если lastId не нашёлся локально — мог прийти с сервера
  if(hadNew && lastId){
    const loaded = await loadProject(lastId).catch(()=>null);
    if(loaded){ loaded.global = loaded.global||{}; loaded.global.apiKey = savedKey; loaded.illustrations = loaded.illustrations||{}; loaded.illustrations.apiKey = savedIcKey; _state = migrate(loaded); setSyncStatus('ok'); emit(); return _state; }
  }
  _state = defaultState();
  lsSet('litsovet_last', _state.id);
  setSyncStatus('ok');
  emit();
  return _state;
}

export function newProject(){
  const prevKey = _state?.global?.apiKey || '';
  const prevIc = _state?.illustrations || {};
  _state = defaultState();
  _state.global.apiKey = prevKey;
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
  proj.global = proj.global||{}; proj.global.apiKey = _state?.global?.apiKey||'';
  proj.illustrations = proj.illustrations||{}; proj.illustrations.apiKey = _state?.illustrations?.apiKey||'';
  _state = migrate(proj);
  lsSet('litsovet_last', id);
  emit();
  return true;
}

// Индикатор статуса синхронизации (обновляется в шапке)
let _syncStatus = 'ok'; // 'ok' | 'syncing' | 'err'
export function getSyncStatus(){ return _syncStatus; }
export function setSyncStatus(s){ _syncStatus=s; const el=document.getElementById('_syncDot'); if(el) el.textContent=s==='ok'?'●':s==='syncing'?'◌':'⚠'; el&&(el.style.color=s==='ok'?'var(--ok)':s==='syncing'?'var(--text-3)':'var(--err)'); }

// Мягкая миграция отсутствующих полей (версионирование схемы).
function migrate(s){
  const d = defaultState();
  s.project = Object.assign({}, d.project, s.project);
  s.style   = Object.assign({}, d.style, s.style);
  s.voice   = Object.assign({}, d.voice, s.voice);
  s.global  = Object.assign({}, d.global, s.global);
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
  s.structureStale = s.structureStale || false;
  // Порог принятия сцены — теперь минимум 7.5 (жёсткий пол, не «дефолт по
  // умолчанию»): даже если автор раньше сам поставил ниже, качество текста
  // важнее скорости прохождения. Макс. итераций подтягиваем со старого
  // дефолта (3) на новый (5) — раз порог строже, доработке нужно больше попыток,
  // прежде чем сдаваться; ручную настройку выше дефолта не трогаем.
  s.global.evaluatorThreshold = Math.max(7.5, s.global.evaluatorThreshold ?? 7.5);
  if(s.global.evaluatorMaxIter === 3) s.global.evaluatorMaxIter = 5;
  // Мердж агентов по id: сохраняем пользовательские enabled/temp и ПОРЯДОК, до-добавляем новых из дефолтов.
  if(!s.agents || !s.agents.length){ s.agents = d.agents; }
  else {
    const KEEP = ['enabled','temp','maxTokens','strictness','manual'];
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
    const defById = Object.fromEntries(d.agents.map(a=>[a.id, a]));
    // Идём по СОХРАНЁННОМУ порядку — пользовательская перестановка сохраняется.
    const storedIds = new Set(s.agents.map(a=>a.id));
    const updated = s.agents.filter(a=>!a.custom).map(a=>{
      const da = defById[a.id]; if(!da) return null; // удалённый дефолт — выкинуть
      const merged = Object.assign({}, da);
      KEEP.forEach(k=>{
        if(a[k]===undefined) return;
        if(k==='maxTokens' && (OLD_MAXTOKENS_DEFAULT[a.role]===a.maxTokens || OLD_MAXTOKENS_DEFAULT_V2[a.role]===a.maxTokens)) return; // всё ещё старый дефолт — берём новый
        merged[k]=a[k];
      });
      return merged;
    }).filter(Boolean);
    // Новые встроенные агенты (добавлены в дефолты после последнего сохранения) — в конец.
    const newBuiltins = d.agents.filter(da=>!da.custom && !storedIds.has(da.id));
    const customs = s.agents.filter(a=>a.custom).map(a=>{
      if(a.maxTokens===700) return {...a, maxTokens:1400};
      if(a.maxTokens===1400) return {...a, maxTokens:2100};
      return a;
    });
    s.agents = [...updated, ...newBuiltins, ...customs];
  }
  s.ui = Object.assign({}, d.ui, s.ui);
  s.characters = s.characters || [];
  s.series = s.series || [];
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
