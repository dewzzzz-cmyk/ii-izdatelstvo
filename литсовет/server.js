'use strict';
/*
 * Литсовет — потоковый прокси к LLM (OpenAI-совместимый формат).
 * Перенесён из ИИ-Издательства: ключ/провайдер/модель приходят в теле
 * запроса, сервер ничего не хранит, только проксирует и стримит во фронт.
 *
 * Запуск:  node server.js   →   http://localhost:8788
 * env: PORT (8788), PROXY_TOKEN (опц.)
 *
 * Хранилище состояния — на клиенте (IndexedDB). Сервер только:
 *   POST /api/generate       — прокси к LLM (стрим)
 *   POST /api/generate-image — прокси к провайдеру картинок (Gemini/OpenAI), разово, без стрима
 *   POST /api/checkpoint     — сохранить экспорт-чекпоинт проекта на диск
 *   GET  /api/checkpoints    — список чекпоинтов
 *   GET  /api/checkpoint?file=…  — прочитать чекпоинт
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 8788;
const ROOT = __dirname;
// DATA_DIR указывает на смонтированный persistent volume (Railway и т.п.) —
// без него чекпоинты и серверная синхронизация проектов жили в обычной
// файловой системе контейнера и стирались при каждом деплое. По умолчанию
// (без DATA_DIR, локальный запуск) поведение прежнее — данные рядом с кодом.
const DATA_DIR = process.env.DATA_DIR || ROOT;
const CHECKPOINT_DIR = path.join(DATA_DIR, 'checkpoints');
const SYNC_DIR = path.join(DATA_DIR, 'data', 'projects');
ensureDir(SYNC_DIR);

// Страховка: без этого необработанная ошибка в любом асинхронном обработчике
// (оборванное клиентом стриминг-соединение, гонка res.writeHead/res.end и т.п.)
// по умолчанию в Node роняет весь процесс целиком — все проекты всех вкладок,
// не только один запрос. Логируем и продолжаем жить.
process.on('unhandledRejection', (err)=>{ console.error('unhandledRejection:', err); });
process.on('uncaughtException', (err)=>{ console.error('uncaughtException:', err); });

const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml',
  '.png':'image/png','.ico':'image/x-icon' };

function send(res, code, body, type='text/plain; charset=utf-8'){ res.writeHead(code,{'Content-Type':type}); res.end(body); }
function ensureDir(dir){ try{ fs.mkdirSync(dir,{recursive:true}); }catch{} }

// Копит тело запроса как Buffer-чанки и декодирует в UTF-8 ОДИН РАЗ в конце.
// Раньше каждый обработчик делал `raw += c` (c — Buffer) — неявный c.toString()
// на КАЖДОМ чанке по отдельности; если многобайтовый UTF-8 символ (любая
// кириллица — 2 байта) попадал ровно на границу двух TCP-чанков, обе половинки
// декодировались как невалидные и превращались в отдельные «�» — необратимая
// порча текста прямо в теле запроса (промпт с текстом рукописи, sync/checkpoint
// с всем проектом). Проявлялось только на достаточно длинных телах, где HTTP
// успевает разбить запрос на несколько чанков — отсюда «иногда» и «в середине
// текста», а не всегда и не в одном месте.
// req.destroy() на превышении лимита обрывает сокет БЕЗ ответа — клиентский
// fetch() в этом случае не получает ни успеха, ни ошибки, а просто виснет до
// собственного таймаута (или навсегда, если таймаута нет) — снаружи это
// неотличимо от «сервер не отвечает». Явный 413 до destroy() даёт клиенту
// сразу понятную ошибку вместо зависания.
function readBody(req, res, maxBytes, cb){
  const chunks = []; let total = 0; let stopped = false;
  req.on('data', c=>{
    if(stopped) return;
    total += c.length;
    if(total > maxBytes){ stopped = true; send(res, 413, 'PAYLOAD_TOO_LARGE: тело запроса больше '+maxBytes+' байт.'); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', ()=>{ if(!stopped) cb(Buffer.concat(chunks).toString('utf8')); });
}

function serveStatic(req, res){
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const fp = path.normalize(path.join(ROOT, rel));
  if (!fp.startsWith(ROOT)) return send(res, 403, 'Forbidden');
  fs.readFile(fp, (e, d) => {
    if(e) return send(res,404,'Not found');
    res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(d);
  });
}

async function handleGenerate(req, res){
  readBody(req, res, 5e5, async (raw)=>{
    let b={}; try{ b=JSON.parse(raw||'{}'); }catch{}
    const wantStream = b.stream !== false;
    if(process.env.PROXY_TOKEN && (b.proxyToken||'')!==process.env.PROXY_TOKEN) return send(res, 401, 'UNAUTHORIZED: неверный токен прокси.');
    const apiKey = (b.apiKey||'').trim();
    const baseURL = (b.baseURL||'https://api.deepseek.com').replace(/\/+$/,'');
    const model = b.model || 'deepseek-chat';
    if(!apiKey) return send(res, 400, 'NO_KEY: не задан API-ключ (откройте настройки).');
    let up;
    try{
      up = await fetch(`${baseURL}/chat/completions`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages:b.messages||[], stream: wantStream,
          temperature: typeof b.temperature==='number'? b.temperature : 1.0,
          ...(b.max_tokens ? {max_tokens: b.max_tokens} : {}) }),
      });
    }catch(e){ return send(res, 502, 'UPSTREAM_FAIL: '+e.message); }
    if(!up.ok || !up.body){ const t=await up.text().catch(()=> ''); return send(res, up.status||502, 'API_ERROR '+up.status+': '+t.slice(0,400)); }
    if(!wantStream){
      let fullBody = '';
      const reader2 = up.body.getReader(); const dec2 = new TextDecoder();
      try{
        while(true){ const {value, done} = await reader2.read(); if(done) break; fullBody += dec2.decode(value, {stream:true}); }
        fullBody += dec2.decode(); // добить недокодированный хвост многобайтового символа
      }
      catch(e){ return send(res, 502, 'READ_ERROR: '+e.message); }
      let content = '';
      try { content = JSON.parse(fullBody).choices?.[0]?.message?.content || ''; }
      catch(e) {
        content = fullBody.split('\n').filter(l => l.startsWith('data: ') && l !== 'data: [DONE]')
          .map(l => { try{ return JSON.parse(l.slice(6)).choices?.[0]?.delta?.content||''; }catch{ return ''; } }).join('');
      }
      res.writeHead(200, {'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-cache'});
      res.end(content); return;
    }
    res.writeHead(200, { 'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-cache' });
    const reader=up.body.getReader(), dec=new TextDecoder(); let buf='';
    const emitLine=(line)=>{
      const s=line.trim(); if(!s.startsWith('data:')) return;
      const data=s.slice(5).trim(); if(data==='[DONE]') return;
      try{ const d=JSON.parse(data).choices?.[0]?.delta?.content; if(d) res.write(d); }catch{}
    };
    try{
      while(true){
        const {value,done}=await reader.read(); if(done) break;
        buf += dec.decode(value,{stream:true});
        const lines=buf.split('\n'); buf=lines.pop();
        for(const line of lines) emitLine(line);
      }
      // Апстрим закрыл соединение — добить недокодированный хвост многобайтового
      // символа (финальный decode без {stream:true}) и обработать последнюю
      // строку без завершающего \n: раньше оба случая молча теряли конец текста
      // при обрыве ровно на границе символа/строки, неотличимо от штатного конца.
      buf += dec.decode();
      if(buf) emitLine(buf);
    }catch{}
    res.end();
  });
}

async function handleWiki(req, res){
  readBody(req, res, 5e3, async (raw)=>{
    let b={}; try{ b=JSON.parse(raw||'{}'); }catch{ return send(res,400,'BAD_JSON'); }
    const query=(b.query||'').trim().slice(0,200);
    const lang=/^[a-z]{2}$/.test(b.lang||'ru')?(b.lang||'ru'):'ru';
    const limit=Math.min(parseInt(b.limit)||3,5);
    if(!query) return send(res,400,'NO_QUERY');
    try{
      const searchUrl=`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srsearch=${encodeURIComponent(query)}&srlimit=${limit}`;
      const sr=await fetch(searchUrl,{headers:{'User-Agent':'Litsovet/1.0'}});
      if(!sr.ok) return send(res,502,'WIKI_SEARCH_FAIL '+sr.status);
      const sd=await sr.json();
      const pages=(sd.query?.search||[]).slice(0,3);
      const summaries=[];
      for(const page of pages){
        try{
          const enc=encodeURIComponent(page.title.replace(/ /g,'_'));
          const su=await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${enc}`,{headers:{'User-Agent':'Litsovet/1.0'}});
          if(!su.ok) continue;
          const s=await su.json();
          if(s.extract) summaries.push({title:s.title,extract:s.extract.slice(0,2000)});
        }catch{}
      }
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'});
      res.end(JSON.stringify({summaries}));
    }catch(e){ send(res,502,'WIKI_ERROR: '+e.message); }
  });
}

// ── Генерация иллюстраций (Gemini/Nano Banana или OpenAI) ──
// Ключ/провайдер приходят в теле запроса от клиента (как и в handleGenerate) —
// сервер ничего не хранит, только проксирует к нужному upstream и возвращает
// картинку как data URL (не стримит, ответ маленький и разовый).
async function handleGenerateImage(req, res){
  readBody(req, res, 5e5, async (raw)=>{
    let b={}; try{ b=JSON.parse(raw||'{}'); }catch{ return send(res,400,'BAD_JSON'); }
    if(process.env.PROXY_TOKEN && (b.proxyToken||'')!==process.env.PROXY_TOKEN) return send(res, 401, 'UNAUTHORIZED: неверный токен прокси.');
    const apiKey = (b.apiKey||'').trim();
    const prompt = (b.prompt||'').trim();
    const provider = ['openai','gemini','qwen','recraft'].includes(b.provider) ? b.provider : 'gemini';
    if(!apiKey) return send(res, 400, 'NO_KEY: не задан API-ключ для генерации изображений.');
    if(!prompt) return send(res, 400, 'NO_PROMPT: пуст промпт для картинки.');
    try{
      if(provider==='openai'){
        const model = b.model || 'gpt-image-1';
        const up = await fetch('https://api.openai.com/v1/images/generations', {
          method:'POST',
          headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${apiKey}` },
          body: JSON.stringify({ model, prompt, size: b.size||'1024x1024', quality: b.quality||'medium', n:1 }),
        });
        if(!up.ok){ const t=await up.text().catch(()=>''); return send(res, up.status||502, 'API_ERROR '+up.status+': '+t.slice(0,500)); }
        const d = await up.json();
        const b64 = d?.data?.[0]?.b64_json;
        if(!b64) return send(res, 502, 'UPSTREAM_EMPTY: провайдер не вернул изображение.');
        return send(res, 200, JSON.stringify({dataUrl:'data:image/png;base64,'+b64}), 'application/json; charset=utf-8');
      } else if(provider==='gemini'){
        const model = b.model || 'gemini-2.5-flash-image';
        const up = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
          method:'POST',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ contents:[{ parts:[{ text: prompt }] }] }),
        });
        if(!up.ok){ const t=await up.text().catch(()=>''); return send(res, up.status||502, 'API_ERROR '+up.status+': '+t.slice(0,500)); }
        const d = await up.json();
        const parts = d?.candidates?.[0]?.content?.parts || [];
        const imgPart = parts.find(p=>p.inlineData && p.inlineData.data);
        if(!imgPart) return send(res, 502, 'UPSTREAM_EMPTY: провайдер не вернул изображение.');
        const mime = imgPart.inlineData.mimeType || 'image/png';
        return send(res, 200, JSON.stringify({dataUrl:`data:${mime};base64,`+imgPart.inlineData.data}), 'application/json; charset=utf-8');
      } else if(provider==='recraft'){
        // Recraft V4.1 — синхронный REST API, OpenAI-совместимый формат ответа
        // (data[].b64_json), но отдельный домен/эндпоинт и свой набор имён
        // моделей. Имя модели `recraftv4_1` (с подчёркиванием) — рабочий
        // вариант, проверенный вручную при разработке (ручная проверка, не
        // зафиксирована коммитом или автотестом — в проекте их нет).
        const model = b.model || 'recraftv4_1';
        const up = await fetch('https://external.api.recraft.ai/v1/images/generations', {
          method:'POST',
          headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${apiKey}` },
          body: JSON.stringify({ model, prompt, n:1, response_format:'b64_json' }),
        });
        if(!up.ok){ const t=await up.text().catch(()=>''); return send(res, up.status||502, 'API_ERROR '+up.status+': '+t.slice(0,500)); }
        const d = await up.json();
        const b64 = d?.data?.[0]?.b64_json;
        if(!b64) return send(res, 502, 'UPSTREAM_EMPTY: провайдер не вернул изображение.');
        return send(res, 200, JSON.stringify({dataUrl:'data:image/png;base64,'+b64}), 'application/json; charset=utf-8');
      } else {
        // Qwen/DashScope (Wanxiang) — асинхронный API: сабмит задачи → поллинг статуса →
        // ссылка на картинку (не base64) → сервер сам скачивает и конвертирует в data URL,
        // чтобы контракт ответа был одинаков для всех трёх провайдеров.
        // НИЖЕ УВЕРЕННОСТЬ, ЧЕМ У OPENAI/GEMINI: асинхронный контракт DashScope не проверен
        // живым вызовом (в этой среде нет ключа Qwen) — если эндпоинты/поля успели измениться,
        // здесь первое место для правки.
        const model = b.model || 'wanx2.1-t2i-turbo';
        const submit = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis', {
          method:'POST',
          headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${apiKey}`, 'X-DashScope-Async':'enable' },
          body: JSON.stringify({ model, input:{ prompt }, parameters:{ size: (b.size||'1024x1024').replace('x','*'), n:1 } }),
        });
        if(!submit.ok){ const t=await submit.text().catch(()=>''); return send(res, submit.status||502, 'API_ERROR '+submit.status+': '+t.slice(0,500)); }
        const sd = await submit.json();
        const taskId = sd?.output?.task_id;
        if(!taskId) return send(res, 502, 'UPSTREAM_EMPTY: DashScope не вернул task_id.');
        let resultUrl = null, lastStatus = '';
        for(let i=0; i<40; i++){
          await new Promise(r=>setTimeout(r, 1500));
          const poll = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
            headers:{ 'Authorization':`Bearer ${apiKey}` },
          });
          if(!poll.ok) continue;
          const pd = await poll.json();
          lastStatus = pd?.output?.task_status || '';
          if(lastStatus==='SUCCEEDED'){ resultUrl = pd?.output?.results?.[0]?.url; break; }
          if(lastStatus==='FAILED' || lastStatus==='UNKNOWN') return send(res, 502, 'UPSTREAM_FAIL: DashScope task '+lastStatus);
        }
        if(!resultUrl) return send(res, 504, 'TIMEOUT: DashScope не завершил генерацию за отведённое время (статус: '+(lastStatus||'нет ответа')+').');
        const imgRes = await fetch(resultUrl);
        if(!imgRes.ok) return send(res, 502, 'DOWNLOAD_FAIL: не удалось скачать готовую картинку.');
        const buf = Buffer.from(await imgRes.arrayBuffer());
        const mime = imgRes.headers.get('content-type') || 'image/png';
        return send(res, 200, JSON.stringify({dataUrl:`data:${mime};base64,`+buf.toString('base64')}), 'application/json; charset=utf-8');
      }
    }catch(e){ return send(res, 502, 'UPSTREAM_FAIL: '+e.message); }
  });
}

// ── Анализ изображения (vision-вход, только Gemini) ──
// В отличие от handleGenerateImage (картинка — результат), здесь картинка —
// ВХОД запроса, а результат — обычный текст (JSON с координатами). Используется
// для распознавания пронумерованных меток на карте мира (см. detectMapMarkers
// в world.js) — тот же принцип проксирования, что и у остальных эндпоинтов:
// ключ приходит в теле, сервер ничего не хранит.
async function handleAnalyzeImage(req, res){
  readBody(req, res, 8e6, async (raw)=>{
    let b={}; try{ b=JSON.parse(raw||'{}'); }catch{ return send(res,400,'BAD_JSON'); }
    if(process.env.PROXY_TOKEN && (b.proxyToken||'')!==process.env.PROXY_TOKEN) return send(res, 401, 'UNAUTHORIZED: неверный токен прокси.');
    const apiKey = (b.apiKey||'').trim();
    const prompt = (b.prompt||'').trim();
    const dataUrl = (b.dataUrl||'').trim();
    if(!apiKey) return send(res, 400, 'NO_KEY: не задан API-ключ для анализа изображения.');
    if(!prompt) return send(res, 400, 'NO_PROMPT: пуст промпт для анализа.');
    const m = /^data:([\w/+.-]+);base64,(.+)$/.exec(dataUrl);
    if(!m) return send(res, 400, 'BAD_IMAGE: изображение должно быть data URL (base64).');
    const [, mime, b64] = m;
    const model = b.model || 'gemini-2.5-flash';
    try{
      const up = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ contents:[{ parts:[{ text: prompt }, { inlineData:{ mimeType: mime, data: b64 } }] }] }),
      });
      if(!up.ok){ const t=await up.text().catch(()=>''); return send(res, up.status||502, 'API_ERROR '+up.status+': '+t.slice(0,500)); }
      const d = await up.json();
      const text = (d?.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('');
      if(!text.trim()) return send(res, 502, 'UPSTREAM_EMPTY: провайдер не вернул ответ.');
      return send(res, 200, JSON.stringify({text}), 'application/json; charset=utf-8');
    }catch(e){ return send(res, 502, 'UPSTREAM_FAIL: '+e.message); }
  });
}

function safeFile(name){ return (name||'').replace(/[/\\]/g,'').replace(/[^a-zA-Zа-яА-Я0-9_.-]/g,'_'); }

// ── Синхронизация проектов между устройствами ──
// Данные хранятся в ./data/projects/{id}.json
// Без Railway Volume сбрасываются при рестарте контейнера (настройте Volume на /app/data)

// Лёгкий индекс {id: {id,title,updated,scenes}} рядом с самими проектами —
// GET /api/sync раньше читал и разбирал ПОЛНЫЙ JSON каждого проекта на диске
// только чтобы достать 4 коротких поля (список проектов для настроек). На
// книге с историей прогонов (diagnostics.runs) один файл — 15-20+ МБ, и это
// читалось целиком при КАЖДОМ открытии настроек ⚙ в браузере — заметное
// подвисание интерфейса на ровном месте. Теперь список читает один маленький
// файл; полные файлы проектов трогаются только там, где реально нужны
// (GET одного проекта, сохранение).
const SYNC_INDEX_FILE = path.join(SYNC_DIR, '_index.json');
function readSyncIndex(){
  try{ return JSON.parse(fs.readFileSync(SYNC_INDEX_FILE,'utf8')); }catch{ return null; }
}
function writeSyncIndex(idx){
  try{ fs.writeFileSync(SYNC_INDEX_FILE, JSON.stringify(idx), 'utf8'); }catch{}
}
function indexEntry(d){
  return { id:d.id, title:d.project?.title||'', updated:d.updated||0, scenes:(d.structure||[]).filter(n=>n.type==='scene').length };
}

// Полное сканирование каталога проектов — дорогая операция (десериализует
// каждый файл целиком), используется только для восстановления индекса,
// когда его нет или он повреждён.
function rebuildSyncIndex(){
  const idx = {};
  const files = fs.readdirSync(SYNC_DIR).filter(f=>f.endsWith('.json') && f!=='_index.json');
  files.forEach(f=>{
    try{ const d = JSON.parse(fs.readFileSync(path.join(SYNC_DIR,f),'utf8')); idx[d.id] = indexEntry(d); }catch{}
  });
  return idx;
}

function handleSyncList(req, res){
  ensureDir(SYNC_DIR);
  try{
    // Индекса ещё нет (первый запуск после обновления, или файл потерялся) —
    // построить один раз старым (медленным) способом и закэшировать на диск.
    let idx = readSyncIndex();
    if(!idx){ idx = rebuildSyncIndex(); writeSyncIndex(idx); }
    send(res,200,JSON.stringify(Object.values(idx)),'application/json; charset=utf-8');
  }catch(e){ send(res,500,'LIST_ERROR: '+e.message); }
}

function handleSyncGet(req, res, id){
  const fp = path.join(SYNC_DIR, safeFile(id)+'.json');
  if(!fp.startsWith(SYNC_DIR)) return send(res,403,'FORBIDDEN');
  fs.readFile(fp,'utf8',(e,d)=> e ? send(res,404,'NOT_FOUND') : send(res,200,d,'application/json; charset=utf-8'));
}

function handleSyncSave(req, res, id){
  readBody(req, res, 50e6, (raw)=>{
    try{
      const parsed = JSON.parse(raw);
      if(!parsed.id) return send(res,400,'NO_ID');
      // Файл пишется под id из URL, запись индекса — под id из тела: без этой
      // проверки расхождение (например, будущая фича «дублировать проект»)
      // создало бы «проект-призрак», видимый в списке, но недоступный по GET.
      if(parsed.id !== id) return send(res,400,'ID_MISMATCH');
      ensureDir(SYNC_DIR);
      fs.writeFileSync(path.join(SYNC_DIR,safeFile(id)+'.json'), raw, 'utf8');
      // Если индекс потерян/повреждён — пересобрать полным сканированием
      // каталога, а не начинать с пустого объекта: иначе повреждение
      // _index.json на любом обычном сохранении молча схлопывает список
      // синхронизации до одной записи (сами файлы проектов остаются целы).
      let idx = readSyncIndex();
      if(!idx) idx = rebuildSyncIndex();
      idx[parsed.id] = indexEntry(parsed);
      writeSyncIndex(idx);
      send(res,200,JSON.stringify({ok:true}),'application/json; charset=utf-8');
    }catch(e){ send(res,500,'WRITE_ERROR: '+e.message); }
  });
}

function handleSyncDelete(req, res, id){
  const fp = path.join(SYNC_DIR, safeFile(id)+'.json');
  if(!fp.startsWith(SYNC_DIR)) return send(res,403,'FORBIDDEN');
  try{ fs.unlinkSync(fp); }catch{}
  const idx = readSyncIndex();
  if(idx){ delete idx[id]; writeSyncIndex(idx); }
  send(res,200,JSON.stringify({ok:true}),'application/json; charset=utf-8');
}

// Сортировка файлов по РЕАЛЬНОМУ времени изменения, а не по имени: имя файла
// — «Название_timestamp.json», и CHECKPOINT_DIR общий для всех проектов —
// сортировка одной строкой .sort() шла по алфавиту названия книги, а не по
// дате, из-за чего «оставить 30 последних» могло удалить только что созданный
// чекпоинт одного проекта раньше, чем старые чекпоинты другого (см. аудит).
function sortByMtimeDesc(dir, files){
  return files
    .map(f=>{ let mtime=0; try{ mtime=fs.statSync(path.join(dir,f)).mtimeMs; }catch{} return {f,mtime}; })
    .sort((a,b)=>b.mtime-a.mtime)
    .map(x=>x.f);
}

function handleCheckpointSave(req,res){
  readBody(req, res, 30e6, (raw)=>{
    let b={}; try{ b=JSON.parse(raw||'{}'); }catch{ return send(res,400,'BAD_JSON'); }
    ensureDir(CHECKPOINT_DIR);
    const title=safeFile(b.title||'project').slice(0,60);
    const ts=new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
    const filename=`${title}_${ts}.json`;
    try{
      fs.writeFileSync(path.join(CHECKPOINT_DIR,filename), typeof b.state==='string'?b.state:JSON.stringify(b.state),'utf8');
      // prune to 30 most recent (по реальному mtime, не по имени файла)
      const files=sortByMtimeDesc(CHECKPOINT_DIR, fs.readdirSync(CHECKPOINT_DIR).filter(f=>f.endsWith('.json')));
      files.slice(30).forEach(f=>{ try{ fs.unlinkSync(path.join(CHECKPOINT_DIR,f)); }catch{} });
      send(res,200,JSON.stringify({ok:true,file:filename}),'application/json; charset=utf-8');
    }catch(e){ send(res,500,'WRITE_ERROR: '+e.message); }
  });
}

function handleCheckpointList(req,res){
  ensureDir(CHECKPOINT_DIR);
  try{
    const files=sortByMtimeDesc(CHECKPOINT_DIR, fs.readdirSync(CHECKPOINT_DIR).filter(f=>f.endsWith('.json'))).slice(0,50)
      .map(f=>{ const st=fs.statSync(path.join(CHECKPOINT_DIR,f)); return {name:f,size:st.size,mtime:st.mtime.toISOString()}; });
    send(res,200,JSON.stringify({ok:true,files}),'application/json; charset=utf-8');
  }catch(e){ send(res,500,'READ_ERROR: '+e.message); }
}

function handleCheckpointRead(req,res){
  const url=new URL(req.url,'http://x');
  const filename=safeFile(url.searchParams.get('file'));
  if(!filename||!filename.endsWith('.json')) return send(res,400,'BAD_FILENAME');
  const fp=path.join(CHECKPOINT_DIR,filename);
  if(!fp.startsWith(CHECKPOINT_DIR)) return send(res,403,'FORBIDDEN');
  fs.readFile(fp,'utf8',(e,d)=>e?send(res,404,'NOT_FOUND'):send(res,200,d,'application/json; charset=utf-8'));
}

http.createServer(async (req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return send(res,204,'');
  if(req.method==='POST' && req.url==='/api/generate')    return handleGenerate(req,res);
  if(req.method==='POST' && req.url==='/api/generate-image') return handleGenerateImage(req,res);
  if(req.method==='POST' && req.url==='/api/analyze-image')  return handleAnalyzeImage(req,res);
  if(req.method==='POST' && req.url==='/api/wiki')         return handleWiki(req,res);
  if(req.method==='POST' && req.url==='/api/checkpoint')  return handleCheckpointSave(req,res);
  if(req.method==='GET'  && req.url.startsWith('/api/checkpoints')) return handleCheckpointList(req,res);
  if(req.method==='GET'  && req.url.startsWith('/api/checkpoint?')) return handleCheckpointRead(req,res);
  // Синхронизация проектов
  const syncId = req.url.match(/^\/api\/sync\/([^?/]+)/);
  if(syncId){
    const id = decodeURIComponent(syncId[1]);
    if(req.method==='GET')    return handleSyncGet(req,res,id);
    if(req.method==='POST')   return handleSyncSave(req,res,id);
    if(req.method==='DELETE') return handleSyncDelete(req,res,id);
  }
  if(req.method==='GET' && req.url==='/api/sync') return handleSyncList(req,res);
  if(req.method==='GET') return serveStatic(req,res);
  send(res,405,'Method not allowed');
}).listen(PORT, ()=>{
  console.log(`Литсовет → http://localhost:${PORT}`);
});
