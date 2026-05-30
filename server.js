'use strict';
/*
 * Универсальный потоковый прокси к LLM (OpenAI-совместимый формат: DeepSeek,
 * OpenAI, и т.п.). Ключ/провайдер/модель приходят в теле каждого запроса —
 * сервер ничего не хранит, только проксирует и стримит ответ во фронт.
 * Нужен, чтобы (а) обойти CORS и (б) не светить ключ в стороннюю выдачу.
 *
 * Запуск:  node server.js   →   http://localhost:8787
 * env: PORT (8787). Ключи задаются в интерфейсе студии, не здесь.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 8787;
const ROOT = __dirname;
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml',
  '.png':'image/png','.ico':'image/x-icon' };

function send(res, code, body, type='text/plain; charset=utf-8'){ res.writeHead(code,{'Content-Type':type}); res.end(body); }

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
    if(!apiKey) return send(res, 400, 'NO_KEY: не задан API-ключ для этого агента (откройте настройки агента или глобальные настройки).');
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
      const reader2 = up.body.getReader();
      const dec2 = new TextDecoder();
      try{
        while(true){
          const {value, done} = await reader2.read();
          if(done) break;
          fullBody += dec2.decode(value, {stream:true});
        }
      } catch(e){ return send(res, 502, 'READ_ERROR: '+e.message); }
      // upstream returns JSON when stream:false
      let content = '';
      try {
        const parsed = JSON.parse(fullBody);
        content = parsed.choices?.[0]?.message?.content || '';
      } catch(e) {
        // fallback: parse SSE-style lines
        content = fullBody.split('\n')
          .filter(l => l.startsWith('data: ') && l !== 'data: [DONE]')
          .map(l => { try{ return JSON.parse(l.slice(6)).choices?.[0]?.delta?.content||''; }catch{ return ''; } })
          .join('');
      }
      res.writeHead(200, {'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-cache'});
      res.end(content);
      return;
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

/* ════ BACKUP ════════════════════════════════════════════════════════ */
const DEFAULT_BACKUP_DIR = path.join(ROOT, 'backups');

function ensureDir(dir){ try{ fs.mkdirSync(dir,{recursive:true}); }catch{} }

function pruneBackups(dir, keep=20){
  try{
    const files=fs.readdirSync(dir).filter(f=>f.endsWith('.json')).sort().reverse();
    files.slice(keep).forEach(f=>{ try{ fs.unlinkSync(path.join(dir,f)); }catch{} });
  }catch{}
}

function safeDir(raw){ return path.resolve((raw||'').trim() || DEFAULT_BACKUP_DIR); }

function handleBackup(req,res){
  let raw=''; req.on('data',c=>{ raw+=c; if(raw.length>15e6) req.destroy(); });
  req.on('end',()=>{
    let b={}; try{ b=JSON.parse(raw||'{}'); }catch{ return send(res,400,'BAD_JSON'); }
    const dir=safeDir(b.backupDir);
    ensureDir(dir);
    const ts=new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
    const filename=`backup_${ts}.json`;
    const fp=path.join(dir,filename);
    try{
      fs.writeFileSync(fp, typeof b.state==='string'?b.state:JSON.stringify(b.state),'utf8');
      pruneBackups(dir,20);
      send(res,200,JSON.stringify({ok:true,file:filename,dir}),'application/json; charset=utf-8');
    }catch(e){ send(res,500,'WRITE_ERROR: '+e.message); }
  });
}

function handleListBackups(req,res){
  const url=new URL(req.url,'http://x'); const dir=safeDir(url.searchParams.get('dir'));
  ensureDir(dir);
  try{
    const files=fs.readdirSync(dir).filter(f=>f.endsWith('.json')).sort().reverse().slice(0,50)
      .map(f=>{ const st=fs.statSync(path.join(dir,f)); return {name:f,size:st.size,mtime:st.mtime.toISOString()}; });
    send(res,200,JSON.stringify({ok:true,dir,files}),'application/json; charset=utf-8');
  }catch(e){ send(res,500,'READ_ERROR: '+e.message); }
}

function handleReadBackup(req,res){
  const url=new URL(req.url,'http://x');
  const dir=safeDir(url.searchParams.get('dir'));
  const filename=(url.searchParams.get('file')||'').replace(/[/\\]/g,'');
  if(!filename||!filename.endsWith('.json')) return send(res,400,'BAD_FILENAME');
  const fp=path.join(dir,filename);
  if(!fp.startsWith(dir)) return send(res,403,'FORBIDDEN');
  fs.readFile(fp,'utf8',(e,d)=>e?send(res,404,'NOT_FOUND'):send(res,200,d,'application/json; charset=utf-8'));
}
/* ═════════════════════════════════════════════════════════════════════ */

http.createServer((req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return send(res,204,'');
  if(req.method==='POST' && req.url==='/api/generate') return handleGenerate(req,res);
  if(req.method==='POST' && req.url==='/api/backup')   return handleBackup(req,res);
  if(req.method==='GET'  && req.url.startsWith('/api/backups')) return handleListBackups(req,res);
  if(req.method==='GET'  && req.url.startsWith('/api/backup?')) return handleReadBackup(req,res);
  if(req.method==='GET') return serveStatic(req,res);
  send(res,405,'Method not allowed');
}).listen(PORT, ()=>{
  console.log(`ИИ-Издательство → http://localhost:${PORT}`);
  console.log('Прокси готов. Ключи задаются в интерфейсе студии (Настройки).');
});
