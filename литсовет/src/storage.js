// Хранилище проекта в IndexedDB. Заменяет localStorage (квота ~5-10 МБ
// недостаточна для серии книг). Версионирование схемы + экспорт-чекпоинт.
//
// API-ключ НИКОГДА не пишется на диск — см. SECRET_KEYS / safeReplacer.

const DB_NAME = 'litsovet';
const DB_VERSION = 1;
const STORE = 'projects';
const META = 'meta';

let _db = null;

function open(){
  if(_db) return Promise.resolve(_db);
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, {keyPath:'id'});
      if(!db.objectStoreNames.contains(META))  db.createObjectStore(META,  {keyPath:'key'});
    };
    req.onsuccess = ()=>{ _db = req.result; resolve(_db); };
    req.onerror = ()=>reject(req.error);
  });
}

function tx(store, mode='readonly'){
  return open().then(db=>db.transaction(store, mode).objectStore(store));
}

// Поля, которые никогда не сериализуются (секреты).
export const SECRET_KEYS = new Set(['apiKey','apiKeys','proxyToken']);

// Реплейсер для JSON.stringify: вычищает секреты и приватные поля (_vec и т.п.)
export function safeReplacer(key, value){
  if(SECRET_KEYS.has(key)) return undefined;
  if(key.startsWith('_')) return undefined; // _vec, _* — не сериализуются
  return value;
}

export async function saveProject(state){
  const store = await tx(STORE, 'readwrite');
  // Глубокая копия без секретов/приватных полей, но с сохранением apiKey ТОЛЬКО в памяти —
  // здесь намеренно сериализуем через safeReplacer, поэтому ключ на диск не попадёт.
  const clean = JSON.parse(JSON.stringify(state, safeReplacer));
  clean.id = state.id;
  return new Promise((resolve, reject)=>{
    const r = store.put(clean);
    r.onsuccess = ()=>resolve();
    r.onerror = ()=>reject(r.error);
  });
}

export async function loadProject(id){
  const store = await tx(STORE);
  return new Promise((resolve, reject)=>{
    const r = store.get(id);
    r.onsuccess = ()=>resolve(r.result||null);
    r.onerror = ()=>reject(r.error);
  });
}

export async function listProjects(){
  const store = await tx(STORE);
  return new Promise((resolve, reject)=>{
    const r = store.getAll();
    r.onsuccess = ()=>resolve((r.result||[]).map(p=>({id:p.id, title:p.project?.title||'(без названия)', updated:p.updated})));
    r.onerror = ()=>reject(r.error);
  });
}

export async function deleteProject(id){
  const store = await tx(STORE, 'readwrite');
  return new Promise((resolve, reject)=>{
    const r = store.delete(id);
    r.onsuccess = ()=>resolve();
    r.onerror = ()=>reject(r.error);
  });
}

export async function getMeta(key){
  const store = await tx(META);
  return new Promise((resolve)=>{
    const r = store.get(key);
    r.onsuccess = ()=>resolve(r.result?.value ?? null);
    r.onerror = ()=>resolve(null);
  });
}
export async function setMeta(key, value){
  const store = await tx(META, 'readwrite');
  return new Promise((resolve)=>{ const r=store.put({key,value}); r.onsuccess=()=>resolve(); r.onerror=()=>resolve(); });
}

// Оценка занятого места + предупреждение (мягкое, не падение).
export async function storageEstimate(){
  if(navigator.storage && navigator.storage.estimate){
    const {usage, quota} = await navigator.storage.estimate();
    return {usage, quota, ratio: quota? usage/quota : 0};
  }
  return null;
}

// Экспорт-чекпоинт: полный проект как .json (секреты вычищены).
export function exportCheckpoint(state){
  return JSON.stringify(state, safeReplacer, 2);
}
