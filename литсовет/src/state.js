// Модель состояния проекта Литсовет + дефолты.
// Единый объект state, персистентный в IndexedDB (storage.js).

import { saveProject, loadProject } from './storage.js';

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
      idea: '',                // «о чём книга» — один вопрос онбординга
      genre: '', subgenre: '', audience: '', era: '',
      synopsis: '',
      targetWords: 80000,
      type: 'single',          // single | series
      mode: 'director',         // director (режиссёр) | factory (фабрика)
    },
    style: {
      refs: [],                // стилевые ориентиры (авторы)
      density: 3, dialogue: 2, pace: 2,
      forbidden: ['клише','эмоц. ярлыки','восклицания'],
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
      budgetTokens: 12000,     // бюджет сборки контекста
      retries: 2,
      evaluatorThreshold: 7,
      evaluatorMaxIter: 3,
    },
    log: [],
    ui: { stage: 'concept' },
  };
}

// Реестр агентов с дефолтами. Каждый включаем/отключаем (диагностический режим).
export function defaultAgents(){
  return [
    { id:'architect', name:'Архитектор сцены', icon:'🏗', temp:0.4, enabled:true, role:'architect' },
    { id:'prose',     name:'Прозаик',          icon:'✍️', temp:0.85, enabled:true, role:'prose', loop:true },
    { id:'evaluator', name:'Оценщик',          icon:'⚖️', temp:0.2, enabled:true, role:'evaluator' },
    { id:'voiceguard',name:'Страж голоса',     icon:'👁', temp:0.2, enabled:false, role:'voiceguard' },
    { id:'logic',     name:'Страж логики',     icon:'⚖️', temp:0.2, enabled:false, role:'logic' },
    { id:'events',    name:'Страж событий',    icon:'🗓', temp:0.2, enabled:false, role:'events' },
    { id:'lineedit',  name:'Линейный редактор',icon:'✂️', temp:0.3, enabled:false, role:'lineedit' },
  ];
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
  emit();
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(()=>{ saveProject(_state).catch(e=>console.error('save failed', e)); }, 400);
}

export async function init(){
  // последний проект или новый. apiKey всегда пустой при старте (только память).
  const lastId = localStorage.getItem('litsovet_last');
  if(lastId){
    const loaded = await loadProject(lastId).catch(()=>null);
    if(loaded){ loaded.global = loaded.global||{}; loaded.global.apiKey=''; _state = migrate(loaded); emit(); return _state; }
  }
  _state = defaultState();
  localStorage.setItem('litsovet_last', _state.id);
  emit();
  return _state;
}

export function newProject(){
  _state = defaultState();
  localStorage.setItem('litsovet_last', _state.id);
  save();
  return _state;
}

// Мягкая миграция отсутствующих полей (версионирование схемы).
function migrate(s){
  const d = defaultState();
  s.project = Object.assign({}, d.project, s.project);
  s.style   = Object.assign({}, d.style, s.style);
  s.voice   = Object.assign({}, d.voice, s.voice);
  s.global  = Object.assign({}, d.global, s.global);
  s.memory  = Object.assign({}, d.memory, s.memory);
  s.diagnostics = s.diagnostics || { runs: [] };
  s.agents  = s.agents && s.agents.length ? s.agents : d.agents;
  s.ui = s.ui || { stage:'concept' };
  return s;
}
