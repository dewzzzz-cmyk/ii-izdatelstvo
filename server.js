'use strict';
/*
 * Универсальный потоковый прокси к LLM (OpenAI-совместимый формат: DeepSeek,
 * OpenAI, и т.п.). Ключ/провайдер/модель приходят в теле каждого запроса —
 * сервер ничего не хранит, только проксирует и стримит ответ во фронт.
 * Нужен, чтобы (а) обойти CORS и (б) не светить ключ в стороннюю выдачу.
 *
 * Запуск:  node server.js   →   http://localhost:8787
 * env: PORT (8787), AUTH_SECRET (генерируется если не задан).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/* ════ AUTH ══════════════════════════════════════════════════════════ */
const AUTH_SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function ensureDataDir(){ try{ fs.mkdirSync(DATA_DIR,{recursive:true}); }catch{} }
function loadUsers(){ ensureDataDir(); try{ return JSON.parse(fs.readFileSync(USERS_FILE,'utf8')); }catch{ return {}; } }
function saveUsers(u){ ensureDataDir(); fs.writeFileSync(USERS_FILE,JSON.stringify(u),'utf8'); }

// In-memory sessions: token → {userId, expires}
const _sessions = {};

function hashPw(pw){ return crypto.pbkdf2Sync(pw, AUTH_SECRET, 50000, 32, 'sha256').toString('hex'); }
function genToken(){ return crypto.randomBytes(32).toString('hex'); }
function parseCookies(h){ const c={}; (h||'').split(';').forEach(p=>{ const [k,...v]=p.trim().split('='); if(k) c[k.trim()]=decodeURIComponent(v.join('=')); }); return c; }

function getSessionUser(req){
  const token = parseCookies(req.headers.cookie).izd_sess;
  if(!token) return null;
  const s = _sessions[token];
  if(!s || s.expires < Date.now()){ if(s) delete _sessions[token]; return null; }
  return s.userId;
}

function authRequired(){ return !!process.env.AUTH_SECRET || Object.keys(loadUsers()).length > 0; }

async function handleAuth(req, res, url, method){
  const json=(code,obj)=>{ res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(obj)); };
  const setCookieJson=(code,obj,cookie)=>{ res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Set-Cookie':cookie}); res.end(JSON.stringify(obj)); };

  if(url==='/api/auth/me' && method==='GET'){
    const userId=getSessionUser(req);
    const users=loadUsers();
    const hasUsers=Object.keys(users).length>0;
    const authEnabled=hasUsers||!!process.env.AUTH_SECRET;
    if(!userId){ json(401,{error:'not_logged_in',authEnabled,hasUsers}); return true; }
    json(200,{userId,authEnabled,hasUsers}); return true;
  }

  if(method!=='POST') return false;
  const body=await new Promise(resolve=>{ let r=''; req.on('data',c=>{r+=c;}); req.on('end',()=>resolve(r)); });
  let b={}; if(body.trim()){ try{ b=JSON.parse(body); }catch{ json(400,{error:'bad_json'}); return true; } }

  if(url==='/api/auth/register'){
    const users=loadUsers();
    if(!process.env.AUTH_OPEN&&Object.keys(users).length>0&&!process.env.AUTH_SECRET){ json(403,{error:'registration_closed'}); return true; }
    const name=(b.username||'').trim().toLowerCase();
    const pw=(b.password||'').trim();
    if(!name||name.length<2||!pw||pw.length<4){ json(400,{error:'too_short'}); return true; }
    if(!/^[a-z0-9_-]+$/.test(name)){ json(400,{error:'invalid_chars'}); return true; }
    if(users[name]){ json(409,{error:'exists'}); return true; }
    users[name]={id:name,hash:hashPw(pw),created:Date.now()};
    saveUsers(users);
    const token=genToken();
    _sessions[token]={userId:name,expires:Date.now()+30*24*3600*1000};
    setCookieJson(200,{ok:true,userId:name},`izd_sess=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${30*24*3600}`);
    return true;
  }

  if(url==='/api/auth/login'){
    const users=loadUsers();
    const name=(b.username||'').trim().toLowerCase();
    const pw=(b.password||'').trim();
    const user=users[name];
    if(!user||user.hash!==hashPw(pw)){ json(401,{error:'invalid'}); return true; }
    const token=genToken();
    _sessions[token]={userId:name,expires:Date.now()+30*24*3600*1000};
    setCookieJson(200,{ok:true,userId:name},`izd_sess=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${30*24*3600}`);
    return true;
  }

  if(url==='/api/auth/logout'){
    const token=parseCookies(req.headers.cookie).izd_sess;
    if(token) delete _sessions[token];
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Set-Cookie':'izd_sess=; Path=/; Max-Age=0'});
    res.end('{"ok":true}');
    return true;
  }

  return false;
}
/* ═════════════════════════════════════════════════════════════════════ */

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

function safeDir(raw){
  const ROOT_BACKUP = DEFAULT_BACKUP_DIR;
  if(!raw||!raw.trim()) return ROOT_BACKUP;
  const resolved = path.resolve(raw.trim());
  // Не позволяем выйти за пределы диска пользователя (простая защита)
  if(resolved.includes('..') || resolved.startsWith('/etc') || resolved.startsWith('/root')){
    return ROOT_BACKUP;
  }
  return resolved;
}

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

// Сохранить готовую книгу как читаемый .md файл рядом с бэкапами
function handleSaveBook(req,res){
  let raw=''; req.on('data',c=>{ raw+=c; if(raw.length>10e6) req.destroy(); });
  req.on('end',()=>{
    let b={}; try{ b=JSON.parse(raw||'{}'); }catch{ return send(res,400,'BAD_JSON'); }
    const dir=safeDir(b.backupDir);
    ensureDir(dir);
    const title=(b.title||'book').replace(/[\\/:*?"<>|]/g,'-').slice(0,60);
    const ts=new Date().toISOString().replace(/[:.]/g,'-').slice(0,10);
    const filename=`${title}_${ts}.md`;
    const fp=path.join(dir,filename);
    try{
      fs.writeFileSync(fp, b.content||'','utf8');
      send(res,200,JSON.stringify({ok:true,file:filename,path:fp}),'application/json; charset=utf-8');
    }catch(e){ send(res,500,'WRITE_ERROR: '+e.message); }
  });
}
http.createServer(async (req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return send(res,204,'');
  const url = req.url.split('?')[0];
  if(url.startsWith('/api/auth')) { const handled=await handleAuth(req,res,url,req.method); if(handled) return; }
  if(req.method==='POST' && req.url==='/api/generate') return handleGenerate(req,res);
  if(req.method==='POST' && req.url==='/api/backup')   return handleBackup(req,res);
  if(req.method==='POST' && req.url==='/api/save-book') return handleSaveBook(req,res);
  if(req.method==='GET'  && req.url.startsWith('/api/backups')) return handleListBackups(req,res);
  if(req.method==='GET'  && req.url.startsWith('/api/backup?')) return handleReadBackup(req,res);
  if(req.method==='GET') return serveStatic(req,res);
  send(res,405,'Method not allowed');
}).listen(PORT, ()=>{
  console.log(`ИИ-Издательство → http://localhost:${PORT}`);
  console.log('Прокси готов. Ключи задаются в интерфейсе студии (Настройки).');
});
