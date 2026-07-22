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

// Лёгкий индекс проектов в META (ключ 'projectsIndex') — listProjects() раньше
// делала store.getAll() на STORE, десериализуя ПОЛНЫЕ объекты всех локальных
// проектов (у книги с историей прогонов — 15-20+ МБ на проект) только чтобы
// достать id/title/updated. Из-за этого открытие настроек ⚙ ощутимо
// подвисало на каждый клик. Индекс обновляется инкрементально при каждом
// saveProject() — сам он маленький, десериализовать его дёшево.
async function updateProjectIndexEntry(entry){
  const store = await tx(META, 'readwrite');
  const idx = await new Promise(resolve=>{
    const r = store.get('projectsIndex');
    r.onsuccess = ()=>resolve(r.result?.value || []);
    r.onerror = ()=>resolve([]);
  });
  const i = idx.findIndex(p=>p.id===entry.id);
  if(i>=0) idx[i]=entry; else idx.push(entry);
  return new Promise(resolve=>{
    const r = store.put({key:'projectsIndex', value:idx});
    r.onsuccess = ()=>resolve();
    r.onerror = ()=>resolve();
  });
}

export async function saveProject(state){
  const store = await tx(STORE, 'readwrite');
  // Глубокая копия без секретов/приватных полей, но с сохранением apiKey ТОЛЬКО в памяти —
  // здесь намеренно сериализуем через safeReplacer, поэтому ключ на диск не попадёт.
  const clean = JSON.parse(JSON.stringify(state, safeReplacer));
  clean.id = state.id;
  await new Promise((resolve, reject)=>{
    const r = store.put(clean);
    r.onsuccess = ()=>resolve();
    r.onerror = ()=>reject(r.error);
  });
  await updateProjectIndexEntry({ id:clean.id, title:clean.project?.title||'(без названия)', updated:clean.updated });
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
  const metaStore = await tx(META);
  const idx = await new Promise(resolve=>{
    const r = metaStore.get('projectsIndex');
    r.onsuccess = ()=>resolve(r.result?.value ?? null);
    r.onerror = ()=>resolve(null);
  });
  if(idx) return idx;
  // Индекса ещё нет (первый запуск после обновления) — построить один раз
  // старым (медленным) способом и закэшировать, дальше будет быстро.
  const store = await tx(STORE);
  const full = await new Promise((resolve, reject)=>{
    const r = store.getAll();
    r.onsuccess = ()=>resolve(r.result||[]);
    r.onerror = ()=>reject(r.error);
  });
  const built = full.map(p=>({id:p.id, title:p.project?.title||'(без названия)', updated:p.updated}));
  const idxStore = await tx(META, 'readwrite');
  idxStore.put({key:'projectsIndex', value:built});
  return built;
}

export async function deleteProject(id){
  const store = await tx(STORE, 'readwrite');
  await new Promise((resolve, reject)=>{
    const r = store.delete(id);
    r.onsuccess = ()=>resolve();
    r.onerror = ()=>reject(r.error);
  });
  const metaStore = await tx(META, 'readwrite');
  const idx = await new Promise(resolve=>{
    const r = metaStore.get('projectsIndex');
    r.onsuccess = ()=>resolve(r.result?.value || []);
    r.onerror = ()=>resolve([]);
  });
  metaStore.put({key:'projectsIndex', value: idx.filter(p=>p.id!==id)});
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
//
// state.rev — счётчик оптимистичной блокировки сервера (см. handleSyncSave в
// server.js). Отправляем как есть (то значение, с которым эта вкладка
// загружалась/последний раз успешно сохранялась); при конфликте (409) сервер
// не тронул свою копию — сюда просто возвращается false, как при любой другой
// ошибке сохранения, и уже существующий баннер «⚠ Не удалось сохранить»
// (persistToServer в state.js) сигналит автору, что нужно перезагрузить
// вкладку, вместо того чтобы молча стереть более новые серверные данные.
// Последний пуш отбит сервером как конфликт ревизий (409) — эта вкладка
// устарела, на сервере лежит более новая версия проекта. Флаг читает
// state.js (persistToServer), чтобы показать автору содержательный баннер
// «обновите страницу», а не общий «не удалось сохранить».
export let lastPushConflict = false;

export async function pushToServer(state){
  if(!state?.id) return false;
  lastPushConflict = false;
  try{
    const body = JSON.stringify(state, safeReplacer);
    const res = await fetch('/api/sync/'+encodeURIComponent(state.id),{
      method:'POST', headers:{'Content-Type':'application/json'}, body,
    });
    if(res.status === 409){
      lastPushConflict = true;
      console.warn('sync conflict: server has a newer revision — reload to get latest');
      return false;
    }
    if(!res.ok) throw new Error('HTTP '+res.status);
    const data = await res.json().catch(()=>null);
    if(data && typeof data.rev === 'number') state.rev = data.rev;
    return true;
  }catch(e){ console.warn('sync push failed',e); return false; }
}

export async function deleteFromServer(id){
  try{ await fetch('/api/sync/'+encodeURIComponent(id),{method:'DELETE'}); }catch{}
}

// Синхронизировать все проекты с сервера в локальный IndexedDB.
// Сервер — источник правды при конфликте.
// Сравнение по rev (счётчик сервера, см. handleSyncSave), а не по updated:
// updated клиент проставляет как Date.now() в момент save() — давнооткрытая
// вкладка со СТАРЫМ содержимым при любом клике записывала его в IndexedDB со
// «свежей» меткой времени, и после этого даже перезагрузка страницы не
// подтягивала серверную версию («локальная выглядит новее») — автор
// продолжал видеть старую копию, хотя на сервере лежала новая (живой репорт
// «почему я это не вижу?»). rev растёт только при УСПЕШНОМ сохранении на
// сервер, устаревшая вкладка его увеличить не может (её пуш отбивается 409).
// Для старых записей без rev — прежнее сравнение по updated.
export async function syncFromServer(){
  const serverList = await listServerProjects();
  if(!serverList.length) return false;
  let imported = 0;
  for(const {id, updated, rev} of serverList){
    const local = await loadProject(id).catch(()=>null);
    const serverNewer = rev
      ? (local?.rev||0) < rev
      : (local?.updated||0) < (updated||0);
    if(!local || serverNewer){
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
