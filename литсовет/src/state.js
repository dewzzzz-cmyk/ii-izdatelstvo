// Модель состояния проекта Литсовет + дефолты.
// Единый объект state, персистентный в IndexedDB (storage.js).

import { saveProject, loadProject, pushToServer, syncFromServer, getServerProject } from './storage.js';
import { rebuildBibleVecs } from './bible.js';

// Версия приложения — единственный источник правды (дублируется в package.json
// для npm, но UI читает отсюда, чтобы не тянуть package.json в браузер).
export const APP_VERSION = '1.7.0';

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
      seriesSummary: '',        // краткое содержание предыдущих книг серии (для книги 2+)
    },
    style: {
      refs: [],                // стилевые ориентиры (авторы)
      density: 3, dialogue: 2, pace: 2,
      forbidden: ['клише','эмоц. ярлыки','восклицания'],
      rules: [],               // правила автора (do/don't): идут Прозаику, Оценщику, Стражу стиля
      profanity: 'moderate',   // off | mild | moderate | strict
    },
    voice: {
      sample: '',              // вставленный образец прозы
      examples: [],            // 5+ отобранных предложений (управляющий вход в промпт)
      metrics: null,           // числовые метрики (только индикатор UI)
    },
    structure: [],             // плоский массив узлов {type:'chapter'|'scene', ...}
    bible: [],                 // {keys, text, _vec?}
    characters: [],            // {name, desc, stateNote, book}
    memory: { scenes:{}, chapters:{}, books:{} },
    series: [],
    agents: defaultAgents(),
    diagnostics: { runs: [] },  // трейсы прогонов по run_id
    global: {
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: '',              // ТОЛЬКО в памяти, не сериализуется
      budgetTokens: 32000,     // бюджет сборки контекста
      retries: 2,
      evaluatorThreshold: 7,
      evaluatorMaxIter: 3,
    },
    log: [],
    ui: { stage: 'concept', rightTab: 'roadmap', mobPanel: 'center', chatEditMode: false, editorAuto: false },
  };
}

// Реестр агентов с дефолтами. Каждый включаем/отключаем (диагностический режим).
export function defaultAgents(){
  return [
    { id:'architect', name:'Архитектор сцены', icon:'🏗', temp:0.4, maxTokens:600, enabled:true, role:'architect',
      desc:'Планирует сцену: ключевые детали, шаги, запрещённые слова. Не пишет прозу — готовит каркас для Прозаика.' },
    { id:'prose',     name:'Прозаик',          icon:'✍️', temp:0.85, maxTokens:2400, enabled:true, role:'prose', loop:true,
      desc:'Пишет прозу сцены по брифу и контексту. В петле с Оценщиком дорабатывает черновик, пока тот не примет.' },
    { id:'evaluator', name:'Оценщик',          icon:'⚖️', temp:0.2, maxTokens:900, enabled:true, role:'evaluator',
      desc:'Независимо оценивает черновик по 5 осям (свежесть, ритм, конкретность, голос, бриф). Не пишет — судит и возвращает замечания. Образует петлю с Прозаиком.' },
    { id:'voiceguard',name:'Страж голоса',     icon:'👁', temp:0.2, maxTokens:700, strictness:2, enabled:false, role:'voiceguard',
      desc:'Сверяет стиль и ритм с образцом вашего голоса, цитируя образец. Только флагует, не переписывает. Идёт параллельно с другими стражами.' },
    { id:'logic',     name:'Страж логики',     icon:'⚖️', temp:0.2, maxTokens:700, strictness:2, enabled:false, role:'logic',
      desc:'Проверяет физику, время и причинность: возможно ли это в мире сцены. Видит только факты, не стиль. Параллельно.' },
    { id:'events',    name:'Страж событий',    icon:'🗓', temp:0.2, maxTokens:700, strictness:2, enabled:false, role:'events',
      desc:'Проверяет, что персонаж знает/чувствует то, что должен по прошлым событиям. Видит только факты. Параллельно.' },
    { id:'styleguard',name:'Страж стиля',      icon:'🚦', temp:0.2, maxTokens:700, strictness:2, enabled:false, role:'styleguard',
      desc:'Ловит нарушения ваших «Правил автора» (do/don\'t) и показывает цитату. Только флагует. Параллельно с другими стражами.' },
    { id:'imagery',   name:'Страж образов',    icon:'🎨', temp:0.2, maxTokens:700, strictness:2, enabled:false, role:'imagery',
      desc:'Ловит смешанные, абсурдные или физически невозможные метафоры и сравнения, разъехавшийся регистр образа. Не клише — за это отвечает другой страж. Только флагует. Параллельно с другими стражами.' },
    { id:'lineedit',  name:'Линейный редактор',icon:'✂️', temp:0.3, maxTokens:1600, enabled:false, role:'lineedit',
      desc:'Лёгкая правка: убирает эмоциональные ярлыки, варьирует ритм, чистит клише. Единственный, кто меняет текст после Прозаика.' },
    { id:'reader',    name:'Читатель',          icon:'📖', temp:0.3, maxTokens:700, strictness:2, enabled:false, role:'reader',
      desc:'Смотрит на сцену глазами читателя: не теряется ли интерес, ясна ли ставка, совпадает ли финальная эмоция с задуманной. Только флагует, не переписывает. Идёт параллельно с другими стражами.' },
    { id:'pov',       name:'Страж точки зрения',icon:'👀', temp:0.2, maxTokens:700, strictness:2, enabled:false, role:'pov',
      desc:'Ловит head-hopping: незаметные скачки к мыслям/ощущениям другого персонажа внутри сцены без разметки. Только флагует. Параллельно с другими стражами.' },
    { id:'dialogue',  name:'Страж диалога',     icon:'💬', temp:0.3, maxTokens:700, strictness:2, enabled:false, role:'dialogue',
      desc:'Ловит реплики «в лоб» (без подтекста), избыточные теги вместо экшн-бит, неразличимые голоса персонажей. Только флагует. Параллельно с другими стражами.' },
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

// Добавить правило автора (do/don't). Дедуп по тексту. Возвращает true, если добавлено.
export function addRule(state, text){
  text = (text||'').trim(); if(!text) return false;
  state.style = state.style || {}; state.style.rules = state.style.rules || [];
  if(state.style.rules.includes(text)) return false;
  state.style.rules.push(text); return true;
}

let _agc = 0;
// Добавить кастомного агента-стража (флагует по своему промпту, безопасно).
export function addCustomAgent(state, name, prompt){
  const a = { id:'custom_'+(Date.now().toString(36))+(_agc++), name:name||'Свой страж', icon:'🛡',
    temp:0.2, maxTokens:700, strictness:2, enabled:true, role:'custom', custom:true,
    prompt: prompt||'Проверь сцену и отметь проблемы.', desc:'Кастомный страж: '+(prompt||'').slice(0,80) };
  state.agents.push(a); return a;
}
export function removeAgent(state, id){
  const a=(state.agents||[]).find(x=>x.id===id);
  if(a && a.custom){ state.agents = state.agents.filter(x=>x.id!==id); return true; }
  return false; // встроенных не удаляем — их можно только выключить тумблером
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
  const lastId = lsGet('litsovet_last');
  if(lastId){
    const loaded = await loadProject(lastId).catch(()=>null);
    if(loaded){ loaded.global = loaded.global||{}; loaded.global.apiKey = savedKey; _state = migrate(loaded); setSyncStatus('ok'); emit(); return _state; }
  }
  // Если lastId не нашёлся локально — мог прийти с сервера
  if(hadNew && lastId){
    const loaded = await loadProject(lastId).catch(()=>null);
    if(loaded){ loaded.global = loaded.global||{}; loaded.global.apiKey = savedKey; _state = migrate(loaded); setSyncStatus('ok'); emit(); return _state; }
  }
  _state = defaultState();
  lsSet('litsovet_last', _state.id);
  setSyncStatus('ok');
  emit();
  return _state;
}

export function newProject(){
  const prevKey = _state?.global?.apiKey || '';
  _state = defaultState();
  _state.global.apiKey = prevKey;
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
  s.diagnostics = s.diagnostics || { runs: [] };
  // Мердж агентов по id: сохраняем пользовательские enabled/temp и ПОРЯДОК, до-добавляем новых из дефолтов.
  if(!s.agents || !s.agents.length){ s.agents = d.agents; }
  else {
    const KEEP = ['enabled','temp','maxTokens','strictness','manual'];
    const defById = Object.fromEntries(d.agents.map(a=>[a.id, a]));
    // Идём по СОХРАНЁННОМУ порядку — пользовательская перестановка сохраняется.
    const storedIds = new Set(s.agents.map(a=>a.id));
    const updated = s.agents.filter(a=>!a.custom).map(a=>{
      const da = defById[a.id]; if(!da) return null; // удалённый дефолт — выкинуть
      const merged = Object.assign({}, da);
      KEEP.forEach(k=>{ if(a[k]!==undefined) merged[k]=a[k]; });
      return merged;
    }).filter(Boolean);
    // Новые встроенные агенты (добавлены в дефолты после последнего сохранения) — в конец.
    const newBuiltins = d.agents.filter(da=>!da.custom && !storedIds.has(da.id));
    const customs = s.agents.filter(a=>a.custom);
    s.agents = [...updated, ...newBuiltins, ...customs];
  }
  s.ui = Object.assign({}, d.ui, s.ui);
  s.characters = s.characters || [];
  s.series = s.series || [];
  // Bible-векторы не сериализуются — восстанавливаем после загрузки
  if(s.bible && s.bible.length) rebuildBibleVecs(s.bible);
  return s;
}
