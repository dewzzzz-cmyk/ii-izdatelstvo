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

// ── Серверная синхронизация (cross-device) ──

export async function listServerProjects(){
  try{ const r=await fetch('/api/sync'); if(!r.ok) return []; return r.json(); }
  catch{ return []; }
}

export async function getServerProject(id){
  try{ const r=await fetch('/api/sync/'+encodeURIComponent(id)); if(!r.ok) return null; return r.json(); }
  catch{ return null; }
}

// Возвращает true/false — раньше ошибка (сеть, 5xx) проглатывалась молча, и
// вызывающий код (state.js save()) не мог отличить реальную синхронизацию от
// провалившейся: индикатор показывал «●» синхронизировано, даже если запрос
// на сервер не дошёл вовсе (см. фикс в save()).
export async function pushToServer(state){
  if(!state?.id) return false;
  try{
    const body = JSON.stringify(state, safeReplacer);
    const res = await fetch('/api/sync/'+encodeURIComponent(state.id),{
      method:'POST', headers:{'Content-Type':'application/json'}, body,
    });
    if(!res.ok) throw new Error('HTTP '+res.status);
    return true;
  }catch(e){ console.warn('sync push failed',e); return false; }
}

export async function deleteFromServer(id){
  try{ await fetch('/api/sync/'+encodeURIComponent(id),{method:'DELETE'}); }catch{}
}

// Синхронизировать все проекты с сервера в локальный IndexedDB.
// Сервер — источник правды при конфликте (более свежая версия побеждает).
export async function syncFromServer(){
  const serverList = await listServerProjects();
  if(!serverList.length) return false;
  let imported = 0;
  for(const {id, updated} of serverList){
    const local = await loadProject(id).catch(()=>null);
    if(!local || (local.updated||0) < (updated||0)){
      const proj = await getServerProject(id);
      if(proj){ await saveProject(proj); imported++; }
    }
  }
  return imported > 0;
}

// Экспорт-чекпоинт: полный проект как .json (секреты и UI-состояние вычищены).
export function exportCheckpoint(state){
  const clean = JSON.parse(JSON.stringify(state, safeReplacer));
  // UI-флаги не нужны в экспорте: они восстанавливаются при открытии
  if(clean.ui){ delete clean.ui.mobPanel; delete clean.ui.rightTab; delete clean.ui.chatEditMode; }
  return JSON.stringify(clean, null, 2);
}
