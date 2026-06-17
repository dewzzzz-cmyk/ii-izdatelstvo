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
 *   POST /api/generate     — прокси к LLM (стрим)
 *   POST /api/checkpoint   — сохранить экспорт-чекпоинт проекта на диск
 *   GET  /api/checkpoints  — список чекпоинтов
 *   GET  /api/checkpoint?file=…  — прочитать чекпоинт
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 8788;
const ROOT = __dirname;
const CHECKPOINT_DIR = path.join(ROOT, 'checkpoints');

const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml',
  '.png':'image/png','.ico':'image/x-icon' };

function send(res, code, body, type='text/plain; charset=utf-8'){ res.writeHead(code,{'Content-Type':type}); res.end(body); }
function ensureDir(dir){ try{ fs.mkdirSync(dir,{recursive:true}); }catch{} }

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
  let raw=''; req.on('data',c=>{ raw+=c; if(raw.length>5e5) req.destroy(); });
  req.on('end', async ()=>{
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
      try{ while(true){ const {value, done} = await reader2.read(); if(done) break; fullBody += dec2.decode(value, {stream:true}); } }
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
    try{
      while(true){
        const {value,done}=await reader.read(); if(done) break;
        buf += dec.decode(value,{stream:true});
        const lines=buf.split('\n'); buf=lines.pop();
        for(const line of lines){
          const s=line.trim(); if(!s.startsWith('data:')) continue;
          const data=s.slice(5).trim(); if(data==='[DONE]') continue;
          try{ const d=JSON.parse(data).choices?.[0]?.delta?.content; if(d) res.write(d); }catch{}
        }
      }
    }catch{}
    res.end();
  });
}

function safeFile(name){ return (name||'').replace(/[/\\]/g,'').replace(/[^a-zA-Zа-яА-Я0-9_.-]/g,'_'); }

function handleCheckpointSave(req,res){
  let raw=''; req.on('data',c=>{ raw+=c; if(raw.length>30e6) req.destroy(); });
  req.on('end',()=>{
    let b={}; try{ b=JSON.parse(raw||'{}'); }catch{ return send(res,400,'BAD_JSON'); }
    ensureDir(CHECKPOINT_DIR);
    const title=safeFile(b.title||'project').slice(0,60);
    const ts=new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
    const filename=`${title}_${ts}.json`;
    try{
      fs.writeFileSync(path.join(CHECKPOINT_DIR,filename), typeof b.state==='string'?b.state:JSON.stringify(b.state),'utf8');
      // prune to 30 most recent
      const files=fs.readdirSync(CHECKPOINT_DIR).filter(f=>f.endsWith('.json')).sort().reverse();
      files.slice(30).forEach(f=>{ try{ fs.unlinkSync(path.join(CHECKPOINT_DIR,f)); }catch{} });
      send(res,200,JSON.stringify({ok:true,file:filename}),'application/json; charset=utf-8');
    }catch(e){ send(res,500,'WRITE_ERROR: '+e.message); }
  });
}

function handleCheckpointList(req,res){
  ensureDir(CHECKPOINT_DIR);
  try{
    const files=fs.readdirSync(CHECKPOINT_DIR).filter(f=>f.endsWith('.json')).sort().reverse().slice(0,50)
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
  if(req.method==='POST' && req.url==='/api/checkpoint')  return handleCheckpointSave(req,res);
  if(req.method==='GET'  && req.url.startsWith('/api/checkpoints')) return handleCheckpointList(req,res);
  if(req.method==='GET'  && req.url.startsWith('/api/checkpoint?')) return handleCheckpointRead(req,res);
  if(req.method==='GET') return serveStatic(req,res);
  send(res,405,'Method not allowed');
}).listen(PORT, ()=>{
  console.log(`Литсовет → http://localhost:${PORT}`);
});
