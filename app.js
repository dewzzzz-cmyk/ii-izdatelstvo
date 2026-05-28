'use strict';

/* ============ ШАБЛОНЫ АГЕНТОВ + ПРОМТЫ ============ */
const TEMPLATES = [
  { role:'scout',  name:'Скаут',        title:'Редактор-аквизитор', emoji:'🔎',
    prompt:'Ты — литературный скаут. Оцени потенциал книги под рынок и аудиторию: вердикт (в производство / доработать / отклонить), главный крючок, целевую полку, риски. Без воды.' },
  { role:'dev',    name:'Структурный редактор', title:'Developmental editor', emoji:'🧭',
    prompt:'Ты — структурный редактор. Улучши композицию: сюжет, арки персонажей, темп, логику. Дай конкретные правки списком и перепиши проблемные места.' },
  { role:'writer', name:'Райтер',       title:'Автор / гострайтер', emoji:'✍️',
    prompt:'Ты — писатель-прозаик. Пиши живой образный текст строго по брифу, жанру и «Библии книги», держи единый голос. Выдавай готовую прозу, не план.' },
  { role:'line',   name:'Литред',       title:'Литературный редактор', emoji:'🔧',
    prompt:'Ты — литературный редактор. Убирай воду и штампы, усиливай ритм и образность, сохраняй авторский голос. Возвращай отредактированный текст.' },
  { role:'proof',  name:'Корректор',    title:'Proofreader', emoji:'🔍',
    prompt:'Ты — корректор. Исправь орфографию, пунктуацию, грамматику, единообразие оформления. Верни вычитанный текст и список ключевых правок.' },
  { role:'continuity', name:'Континуитет', title:'Хранитель канона', emoji:'🧩',
    prompt:'Ты — агент-континуитета. Сверь текст с «Библией книги» (персонажи, мир, таймлайн) и материалами коллег. Найди противоречия в именах, деталях, хронологии и логике. Верни список расхождений и исправленный фрагмент.' },
  { role:'factcheck', name:'Фактчек',   title:'Проверка фактов', emoji:'✅',
    prompt:'Ты — фактчекер. Проверь утверждения на достоверность, пометь сомнительные места и предложи корректные формулировки. Для нон-фикшн особенно строго.' },
  { role:'art',    name:'Арт-директор', title:'Дизайнер обложки', emoji:'🎨',
    prompt:'Ты — арт-директор. Составь бриф обложки под жанр и аудиторию: концепция, композиция, палитра, типографика, настроение. Дай 2–3 варианта.' },
  { role:'layout', name:'Верстальщик',  title:'Вёрстка / EPUB', emoji:'📐',
    prompt:'Ты — верстальщик. Опиши параметры вёрстки для EPUB и печати: форматы, шрифты, отступы, оглавление, колонтитулы.' },
  { role:'meta',   name:'Метаданные',   title:'Distribution', emoji:'🏷️',
    prompt:'Ты — специалист по метаданным. Подготовь для площадок (KDP и др.): 2–3 точные категории, 7 ключевых фраз (long-tail, языком читателя — жанр и тропы, не «литературный» язык автора), аннотацию до 200 знаков, рекомендованную цену.' },
  { role:'mkt',    name:'Маркетолог',   title:'SMM / промо', emoji:'📣',
    prompt:'Ты — книжный маркетолог. Спланируй запуск как систему: ниша, идея серии, план первых 7 дней и 3 готовых поста (тизер / цитата / релиз) под целевую аудиторию.' },
  { role:'logedit', name:'Логред',      title:'Редактор логики', emoji:'🔎',
    prompt:'Ты — редактор логики и пространства. Внимательно прочти текст от предыдущего агента и найди:\n1. Пространственные противоречия — персонаж или предмет оказывается в двух местах без объяснения (например, сидит в центре комнаты, но рядом вдруг появляется диван у стены).\n2. Физические невозможности — действия с предметами, которые не могут так работать (например, «ковёр заскрипел»).\n3. Временные нестыковки — события идут в неправильном порядке или без логики.\n4. Непоследовательные действия персонажей — персонаж делает что-то, что противоречит ранее сказанному.\n\nФормат ответа:\n## Найденные противоречия\n[список с цитатами и объяснением]\n\n## Исправленный текст\n[полный текст с внесёнными правками]\n\nЕсли противоречий нет — напиши «Логических нестыковок не обнаружено» и верни текст без изменений.' },
];

const PRICES = { // $ за 1M токенов (вход/выход), грубо для оценки
  'deepseek-chat':{in:0.14,out:0.28}, 'deepseek-reasoner':{in:0.55,out:2.19},
  'gpt-4o-mini':{in:0.15,out:0.60}, 'gpt-4o':{in:2.5,out:10},
};
// Оптимальные температуры по роли (эксперты: Writer — творчество, Proofreader/Meta — точность)
const ROLE_TEMPS = {
  'scout':0.8,'dev':0.7,'writer':1.0,'line':0.7,'proof':0.2,
  'continuity':0.3,'factcheck':0.2,'art':0.9,'layout':0.3,'meta':0.1,'mkt':0.8,'logedit':0.3
};
const KDP_CHECKLIST =
`## Чек-лист публикации (KDP и др.)
- [ ] Указать использование ИИ при загрузке (обязательно, иначе бан)
- [ ] Не более 3 новых книг в день (антифлуд)
- [ ] 2–3 точные категории (не слишком широкие)
- [ ] 7 ключевых фраз языком читателя (жанр/тропы, long-tail)
- [ ] Аннотация до 200 знаков, цепляющая
- [ ] Вычитка корректором пройдена
- [ ] Континуитет проверен (имена, таймлайн, факты)
- [ ] Обложка под жанр и аудиторию
- [ ] План запуска и посты готовы`;

/* ============ СОСТОЯНИЕ ============ */
const KEY='izd_studio_v3';
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
// Оценка условия ребра: JS-выражение с переменной output. Пустая строка = всегда true
function evalCondition(cond,output){
  if(!cond||!cond.trim()) return true;
  try{ return !!new Function('output','return ('+cond+')')(output||''); }
  catch(e){ return false; }
}
function freshNode(t,x,y){ return { id:uid(), name:t.name, role:t.title, emoji:t.emoji, prompt:t.prompt, promptHistory:[],
  x,y, useGlobal:true, baseURL:'',apiKey:'',model:'',temperature:ROLE_TEMPS[t.role]??1.0, requireApproval:false, approved:false,
  output:'', summary:'', status:'idle', error:'', cacheHash:'', tokensIn:0, tokensOut:0, ms:0, outputSchema:'', postProcess:'' }; }
function checkSchema(n){
  if(!n.outputSchema||!n.outputSchema.trim()) return null; // нет схемы → всё ок
  try{
    const schema=JSON.parse(n.outputSchema);
    // Попробуем найти JSON-блок в выводе
    const m=n.output.match(/```json\s*([\s\S]*?)```/i)||n.output.match(/(\{[\s\S]*\})/);
    if(!m) return 'Схема задана, но вывод не содержит JSON';
    const out=JSON.parse(m[1]);
    const missing=Object.keys(schema).filter(k=>!(k in out));
    return missing.length?'Отсутствуют поля схемы: '+missing.join(', '):null;
  }catch(e){ return 'Ошибка схемы: '+String(e.message).slice(0,60); }
}
function defaultState(){
  const nodes=TEMPLATES.filter(t=>!['continuity','factcheck'].includes(t.role)).map((t,i)=>freshNode(t,60+(i%3)*250,40+Math.floor(i/3)*180));
  const edges=[]; for(let i=0;i<nodes.length-1;i++) edges.push({id:uid(),from:nodes[i].id,to:nodes[i+1].id,condition:''});
  return { project:{title:'',genre:'',audience:'',brief:'',mode:'write',input:'',disclosure:'Текст подготовлен с использованием ИИ'},
    bible:[], log:[], runs:[], approvals:[], groups:[], chapters:[], chapterBook:[], chapterCtx:null, dailyRuns:{date:'',count:0}, baseline:null, onboarded:false,
    global:{ baseURL:'https://api.deepseek.com', apiKey:'', apiKeys:'', model:'deepseek-chat', temperature:1.0,
      maxContextChars:8000, maxRetries:2, costCapUSD:0, proxyToken:'', autoSummarize:false, autoBibleExtract:false, autoEval:false, approvalTimeoutMin:0, fallbackURL:'',
      backupDir:'', autoBackup:true, backupIntervalMin:10 },
    nodes, edges };
}
let state=load(); rebuildBibleVecs();
function load(){
  try{
    const s=JSON.parse(localStorage.getItem(KEY));
    if(s&&s.nodes){
      const def=defaultState();
      // Deep-merge global: новые поля из defaultState не затираются старым state
      if(s.global) s.global=Object.assign({},def.global,s.global);
      return Object.assign(def,s);
    }
    return defaultState();
  }catch{ return defaultState(); }
}
// Мьютекс записи: дебаунс 40 мс защищает от параллельных вызовов save() в одной волне
let _saveTimer=null;
function save(){
  // Автоочистка: если лог > 100 записей — обрезаем
  if(state.log.length>100) state.log=state.log.slice(0,100);
  clearTimeout(_saveTimer);
  _saveTimer=setTimeout(()=>{
    const data=JSON.stringify(state,(k,v)=>k==='_vec'?undefined:v);
    if(data.length>4*1024*1024) toast('⚠ Хранилище почти полно ('+Math.round(data.length/1024)+' KB). Очистите журнал или экспортируйте.','warn');
    localStorage.setItem(KEY,data);
  },40);
}

/* ════ BACKUP ════════════════════════════════════════════════════════ */
let _backupTimer=null, _lastBackupHash='';

async function autoBackupNow(silent=false){
  const data=JSON.stringify(state,(k,v)=>k==='_vec'?undefined:v);
  // Избегаем дублирующих копий при отсутствии изменений
  const hash=data.length+'_'+data.slice(-64);
  if(hash===_lastBackupHash){ if(!silent) toast('Нет изменений с последней копии'); return; }
  try{
    const res=await fetch('/api/backup',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({backupDir:state.global.backupDir||'', state:data})});
    if(!res.ok){ const t=await res.text(); if(!silent) toast('Ошибка бэкапа: '+t.slice(0,80),'err'); return; }
    const j=await res.json();
    _lastBackupHash=hash;
    if(!silent) toast('💾 Копия сохранена: '+j.file,'ok');
    else        logRow('Бэкап','ok',j.file);
  }catch(e){ if(!silent) toast('Бэкап недоступен: '+e.message,'err'); }
}

function scheduleBackup(){
  clearInterval(_backupTimer);
  if(!state.global.autoBackup) return;
  const ms=Math.max(1,state.global.backupIntervalMin||10)*60*1000;
  _backupTimer=setInterval(()=>autoBackupNow(true), ms);
}

async function openBackupRestore(){
  const dir=state.global.backupDir||'';
  openDrawer('💾 Резервные копии','<div class="hint">Загрузка…</div>',()=>{});
  let j;
  try{
    const r=await fetch('/api/backups?dir='+encodeURIComponent(dir));
    j=await r.json();
  }catch(e){ return openDrawer('💾 Резервные копии',`<div class="hint" style="color:var(--err)">Ошибка: ${esc(e.message)}</div>`,()=>{}); }

  const files=j.files||[];
  const rows=files.map(f=>{
    const dt=new Date(f.mtime).toLocaleString('ru');
    const kb=Math.round(f.size/1024);
    return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(f.name)}</div>
        <div style="font-size:11px;color:var(--faint)">${dt} · ${kb} KB</div>
      </div>
      <button class="btn ghost sm" data-restore="${esc(f.name)}">Загрузить</button>
    </div>`;
  }).join('');

  openDrawer('💾 Резервные копии',`
    <div class="hint" style="margin:0 0 12px">Папка: <code style="font-size:11px;color:var(--accent)">${esc(j.dir)}</code></div>
    <div style="max-height:340px;overflow-y:auto">
      ${files.length?rows:'<div class="hint" style="color:var(--faint)">Резервных копий пока нет.</div>'}
    </div>
    <div class="actions" style="margin-top:14px">
      <button class="btn ok" id="bk-now">💾 Создать копию сейчас</button>
    </div>
  `,b=>{
    b.querySelector('#bk-now')?.addEventListener('click',()=>autoBackupNow(false));
    b.querySelectorAll('[data-restore]').forEach(btn=>{
      btn.addEventListener('click',async()=>{
        const fn=btn.dataset.restore;
        if(!confirm(`Восстановить из «${fn}»?\n\nТекущее состояние будет перезаписано.`)) return;
        try{
          const r2=await fetch(`/api/backup?file=${encodeURIComponent(fn)}&dir=${encodeURIComponent(dir)}`);
          if(!r2.ok){ toast('Ошибка чтения копии','err'); return; }
          const restored=JSON.parse(await r2.text());
          if(!restored.nodes){ toast('Файл повреждён — нет nodes','err'); return; }
          const def=defaultState();
          if(restored.global) restored.global=Object.assign({},def.global,restored.global);
          Object.assign(state,Object.assign(def,restored));
          rebuildBibleVecs(); save(); render(); closeDrawer();
          toast('✅ Восстановлено из '+fn,'ok');
        }catch(e){ toast('Ошибка восстановления: '+e.message,'err'); }
      });
    });
  });
}
/* ═════════════════════════════════════════════════════════════════════ */

const NW=212, PORT_Y=23;
const node=id=>state.nodes.find(n=>n.id===id);
const $=s=>document.querySelector(s);
const esc=s=>(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// Пул ключей: round-robin ротация (Item 37)
let _keyIdx=0;
const _poolKeys=()=>(state.global.apiKeys||'').split('\n').map(s=>s.trim()).filter(Boolean);
function pickKey(){ const pool=_poolKeys(); if(!pool.length) return state.global.apiKey; const k=pool[_keyIdx%pool.length]; _keyIdx++; return k||state.global.apiKey; }
const cfg=n=>{ if(!n.useGlobal) return { baseURL:n.baseURL||state.global.baseURL, apiKey:n.apiKey||state.global.apiKey,
  model:n.model||state.global.model, temperature:typeof n.temperature==='number'?n.temperature:state.global.temperature };
  return { baseURL:state.global.baseURL, apiKey:pickKey(), model:state.global.model, temperature:state.global.temperature }; };
const hasKey=()=> state.nodes.some(n=>!n.useGlobal&&n.apiKey) || !!state.global.apiKey || _poolKeys().length>0;
const wait=ms=>new Promise(r=>setTimeout(r,ms));

/* ============ КОНТЕКСТ + БИБЛИЯ ============ */
// Умное сжатие: сохраняет начало и конец, убирает середину (модель лучше помнит края)
function smartTrunc(text, maxLen){
  if(!text||text.length<=maxLen) return text||'';
  const half=Math.floor(maxLen*.45);
  return text.slice(0,half)+'\n…[середина сжата для экономии контекста]…\n'+text.slice(-half);
}
const RU_ENDS=['иями','ями','ами','его','ого','ему','ому','ыми','ими','ах','ях','ам','ям','ом','ем','ой','ей','ою','ею','ью','ие','ые','ий','ый','ая','яя','ое','ее','ы','и','а','я','у','ю','е','о','ь','й'];
function stem(w){ w=(w||'').toLowerCase().replace(/ё/g,'е'); for(const e of RU_ENDS){ if(w.length-e.length>=3 && w.endsWith(e)) return w.slice(0,-e.length); } return w; }
function stemSet(text){ const s=new Set(); (text.match(/[a-zа-я0-9]+/gi)||[]).forEach(w=>s.add(stem(w))); return s; }
function keyMatches(key, low, sset){
  return key.split(/\s+/).filter(Boolean).every(p=>{
    const ps=stem(p);
    return low.includes(p)||sset.has(ps)||
      // Префиксный матч для имён: «Александр» → «Александра», «Александру», «Александром»
      (ps.length>=4&&(low.match(/[а-яёa-z]+/gi)||[]).some(w=>stem(w).startsWith(ps)||w.toLowerCase().startsWith(ps)));
  });
}
/* ---- TF-IDF Bible (векторный поиск, pure JS) ---- */
const STOP_RU=new Set('и в на с по за к о не но да из что как то все это при так же был была были если или уже там тут где когда еще от до со для же лишь ни ни то быть'.split(' '));
function tokensOf(text){ return (text||'').toLowerCase().replace(/ё/g,'е').match(/[а-яa-z0-9]+/gi)||[]; }
function tfvec(tokens){ const f={}; tokens.forEach(t=>{ const s=stem(t); if(s.length>2&&!STOP_RU.has(s)) f[s]=(f[s]||0)+1; }); return f; }
function cosine(a,b){ let dot=0,na=0,nb=0; for(const k in a){ dot+=(a[k]||0)*(b[k]||0); na+=a[k]**2; } for(const k in b) nb+=b[k]**2; return na&&nb?dot/Math.sqrt(na*nb):0; }
function rebuildBibleVecs(){ state.bible.forEach(b=>{ b._vec=tfvec(tokensOf((b.keys||'')+' '+(b.text||''))); }); }
function bibleFor(text){
  // Если Bible пустая или < 2 записей — сразу keyword-fallback
  if(!state.bible.length) return '';
  const low=(text||'').toLowerCase(); const sset=stemSet(low);
  const qvec=tfvec(tokensOf(text));
  // Векторный поиск если у записей есть векторы
  const hasVecs=state.bible.some(b=>b._vec&&Object.keys(b._vec).length>0);
  let hits;
  if(hasVecs && Object.keys(qvec).length>=2){
    hits=state.bible.map(b=>({b,score:cosine(qvec,b._vec||{})}))
      .filter(x=>x.score>0.08).sort((a,b2)=>b2.score-a.score).slice(0,5).map(x=>x.b);
    if(!hits.length) hits=state.bible.filter(b=>{ const keys=(b.keys||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean); return !keys.length||keys.some(k=>keyMatches(k,low,sset)); });
  } else {
    hits=state.bible.filter(b=>{ const keys=(b.keys||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean); return !keys.length||keys.some(k=>keyMatches(k,low,sset)); });
  }
  return hits.map(b=>`• ${b.keys||'канон'}: ${b.text}`).join('\n');
}
function parseBibleLines(text){ return (text||'').split('\n').map(l=>l.trim()).filter(l=>l.includes('|'))
  .map(l=>{ const i=l.indexOf('|'); return { keys:l.slice(0,i).replace(/^[-•*\d.)\s]+/,'').trim(), text:l.slice(i+1).trim() }; }).filter(e=>e.text); }
function buildMessages(n){
  const pr=state.project;
  const preds=state.edges.filter(e=>e.to===n.id).map(e=>node(e.from)).filter(Boolean);
  const budget=state.global.maxContextChars||8000;
  const predsWithOutput=preds.filter(p=>p.output);
  const perNode=Math.floor(budget/Math.max(1,predsWithOutput.length));
  let prior=predsWithOutput.map(p=>`— ${p.name}:\n${smartTrunc(p.summary||p.output,perNode)}`).join('\n\n');
  const scan=[pr.title,pr.genre,pr.brief,pr.input,prior].join(' ');
  const bible=bibleFor(scan);
  let user='';
  if(bible) user+=`Библия книги (канон, соблюдать строго):\n${bible}\n\n`;
  user+=`Книга: «${pr.title||'без названия'}»\nЖанр: ${pr.genre||'не задан'}\nАудитория: ${pr.audience||'не задана'}\n`+
    `Режим: ${pr.mode==='write'?'пишем с нуля':'редактируем готовый текст'}\n`+(pr.brief?`Бриф: ${pr.brief}\n`:'');
  if(pr.mode==='edit'&&pr.input&&preds.length===0) user+=`\nИсходный текст:\n${pr.input}\n`;
  if(prior) user+=`\nМатериалы от предыдущих агентов:\n${prior}\n`;
  // Контекст главы (режим глава-за-главой)
  if(state.chapterCtx){ const ch=state.chapterCtx;
    user+=`\nТекущая глава: ${ch.num}. «${ch.title}»`+(ch.brief?`\nЗадача главы: ${ch.brief}`:'')+'\n';
    if(ch.prevSummary) user+=`\nСодержание предыдущих глав:\n${ch.prevSummary}\n`; }
  user+=`\nВыполни свою роль и выдай конкретный результат.`;
  return [ {role:'system',content:n.prompt}, {role:'user',content:user} ];
}
async function callLLM(c, messages){
  const r = await fetch('/api/generate', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      baseURL: c.baseURL || state.global.baseURL,
      apiKey:  c.apiKey  || pickKey(),
      model:   c.model   || state.global.model,
      temperature: c.temperature ?? 0.1,
      messages,
      stream: false
    })
  });
  if(!r.ok) throw new Error(await r.text());
  return await r.text();
}
async function autoBibleUpdate(output, role){
  if(!['writer','logedit','line'].includes(role)) return;
  if(!output || output.length < 200) return;
  if(!state.global.autoBibleExtract) return;
  const msgs = [{
    role: 'system',
    content: 'Ты — архивариус. Извлеки из текста НОВЫЕ факты о персонажах, местах, временной линии и ключевых событиях. Отвечай строго в формате:\nИмя персонажа | факт о нём\nНазвание места | описание\nСобытие | дата или позиция в сюжете\n\nТолько факты, присутствующие в тексте. Не придумывай. Если новых фактов нет — ответь: ПУСТО'
  },{
    role: 'user',
    content: `Уже известно из Библии:\n${state.bible.map(b=>b.keys+'|'+b.text).join('\n') || '(пусто)'}\n\nНовый текст:\n${smartTrunc(output, 3000)}`
  }];
  try {
    const c = { baseURL: state.global.baseURL, apiKey: pickKey(), model: state.global.model, temperature: 0.1 };
    const resp = await callLLM(c, msgs);
    if(!resp || resp.trim() === 'ПУСТО') return;
    const newEntries = parseBibleLines(resp);
    if(!newEntries.length) return;
    const existingKeys = new Set(state.bible.map(b => b.keys.toLowerCase()));
    const toAdd = newEntries.filter(e => !existingKeys.has(e.keys.toLowerCase()));
    if(!toAdd.length) return;
    state.bible.push(...toAdd);
    rebuildBibleVecs();
    save();
    toast(`📚 Библия: +${toAdd.length} новых записей`, 'ok');
  } catch(e){
    console.warn('autoBibleUpdate error', e);
  }
}
const tokEst=s=>{ s=s||''; const cyr=(s.match(/[а-яёА-ЯЁ]/g)||[]).length; return Math.max(1,Math.round(s.length/(cyr/s.length>.5?2:4))); };
const nodeCost=n=>{ const p=PRICES[cfg(n).model]||{in:0.14,out:0.28}; return (n.tokensIn||0)/1e6*p.in+(n.tokensOut||0)/1e6*p.out; };
const projectCost=()=>state.nodes.reduce((s,n)=>s+nodeCost(n),0);
const money=v=>'$'+v.toFixed(v<1?4:2);

/* ============ EPUB / ZIP ============ */
// CRC-32 (IEEE 802.3) — нужен для правильного ZIP
const CRC32_TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c;}return t;})();
function crc32(bytes){let c=0xFFFFFFFF>>>0;for(let i=0;i<bytes.length;i++)c=CRC32_TABLE[(c^bytes[i])&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}

/** Минимальный ZIP-builder (STORE, без сжатия) — достаточен для EPUB */
class ZipBuilder{
  constructor(){this._f=[];}
  add(name,data){const b=typeof data==='string'?new TextEncoder().encode(data):data;this._f.push({name,b});}
  blob(){
    const enc=new TextEncoder();const parts=[];const cd=[];let off=0;
    for(const f of this._f){
      const nb=enc.encode(f.name);const crc=crc32(f.b);const sz=f.b.length;
      const lh=new Uint8Array(30+nb.length);const lv=new DataView(lh.buffer);
      lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);
      lv.setUint32(14,crc,true);lv.setUint32(18,sz,true);lv.setUint32(22,sz,true);
      lv.setUint16(26,nb.length,true);lh.set(nb,30);
      const ce=new Uint8Array(46+nb.length);const cv=new DataView(ce.buffer);
      cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);
      cv.setUint32(16,crc,true);cv.setUint32(20,sz,true);cv.setUint32(24,sz,true);
      cv.setUint16(28,nb.length,true);cv.setUint32(42,off,true);ce.set(nb,46);
      parts.push(lh,f.b);cd.push(ce);off+=lh.length+sz;
    }
    const cdStart=off;let cdSize=0;cd.forEach(c=>cdSize+=c.length);
    const eocd=new Uint8Array(22);const ev=new DataView(eocd.buffer);
    ev.setUint32(0,0x06054b50,true);ev.setUint16(8,this._f.length,true);ev.setUint16(10,this._f.length,true);
    ev.setUint32(12,cdSize,true);ev.setUint32(16,cdStart,true);
    return new Blob([...parts,...cd,eocd],{type:'application/epub+zip'});
  }
}

/** Markdown → корректный XHTML для EPUB (самозакрывающиеся теги) */
function md2xhtml(text){
  if(!text)return'<p></p>';
  const lines=text.split('\n');let html='',inList=false;
  const e=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const il=s=>s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>');
  for(const raw of lines){
    const l=e(raw);
    if(/^#{3,} /.test(raw)){if(inList){html+='</ul>';inList=false;}html+=`<h4>${il(l.replace(/^#{3,} /,''))}</h4>`;}
    else if(/^## /.test(raw)){if(inList){html+='</ul>';inList=false;}html+=`<h3>${il(l.replace(/^## /,''))}</h3>`;}
    else if(/^# /.test(raw)){if(inList){html+='</ul>';inList=false;}html+=`<h2>${il(l.replace(/^# /,''))}</h2>`;}
    else if(/^[-•*] /.test(raw)){if(!inList){html+='<ul>';inList=true;}html+=`<li>${il(l.replace(/^[-•*] /,''))}</li>`;}
    else if(/^[-—*_]{3,}$|^—$/.test(raw.trim())){if(inList){html+='</ul>';inList=false;}html+='<hr/>';}
    else if(!l.trim()){if(inList){html+='</ul>';inList=false;}html+='<p>&#160;</p>';}
    else{if(inList){html+='</ul>';inList=false;}html+=`<p>${il(l)}</p>`;}
  }
  if(inList)html+='</ul>';
  return html;
}

/* ============ MARKDOWN ============ */
function applyInline(s){ return s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>'); }
function md2html(text){
  if(!text) return '';
  const lines=text.split('\n'); let html='',inList=false;
  const e=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  for(const raw of lines){
    const l=e(raw);
    if(/^#{3,} /.test(raw)){if(inList){html+='</ul>';inList=false;}html+=`<h4>${applyInline(l.replace(/^#{3,} /,''))}</h4>`;}
    else if(/^## /.test(raw)){if(inList){html+='</ul>';inList=false;}html+=`<h3>${applyInline(l.replace(/^## /,''))}</h3>`;}
    else if(/^# /.test(raw)){if(inList){html+='</ul>';inList=false;}html+=`<h2>${applyInline(l.replace(/^# /,''))}</h2>`;}
    else if(/^[-•*] /.test(raw)){if(!inList){html+='<ul>';inList=true;}html+=`<li>${applyInline(l.replace(/^[-•*] /,''))}</li>`;}
    else if(/^---+$/.test(raw)){if(inList){html+='</ul>';inList=false;}html+='<hr>';}
    else if(!l.trim()){if(inList){html+='</ul>';inList=false;}html+='<div class="md-br"></div>';}
    else{if(inList){html+='</ul>';inList=false;}html+=`<p>${applyInline(l)}</p>`;}
  }
  if(inList)html+='</ul>';
  return '<div class="md">'+html+'</div>';
}

/* ============ ЖУРНАЛ ============ */
function logRow(node,status,msg,extra={}){ state.log.unshift({t:Date.now(),node,status,msg,...extra}); if(state.log.length>200) state.log.pop(); }

/* ============ РЕНДЕР ============ */
let _currentView='canvas';
const nodesEl=$('#nodes'), edgesEl=$('#edges');
/* CTB state + SPEC_NODES — declared here so renderNodes() can reference them */
let _activeTool='select', _snapGrid=false, _showMinimap=false, _zoomLevel=100;
const SPEC_NODES={
  branch:   {emoji:'⎇', name:'Ветвь',     desc:'Параллельный поток',    color:'#60a5fa', prompt:'Раздели задачу на N параллельных подзадач. Выведи список — каждая на новой строке.'},
  condition:{emoji:'◇', name:'Условие',   desc:'if / else развилка',    color:'#fbbf24', prompt:'Оцени текст и реши: продолжать → выведи PASS, вернуть на доработку → выведи FAIL. Объясни решение.'},
  loop:     {emoji:'↻', name:'Повтор',    desc:'Цикл до N итераций',    color:'#f87171', prompt:'Улучши текст и выведи исправленную версию. Если текст уже хорош — напиши DONE в первой строке.'},
  gate:     {emoji:'⏸', name:'Ожидание',  desc:'Пауза для одобрения',   color:'#34d399', prompt:'', requireApproval:true},
  note:     {emoji:'✏', name:'Заметка',   desc:'Аннотация (не выполн.)',color:'#8d92a8', prompt:''},
  merge:    {emoji:'⬡', name:'Слияние',   desc:'Объединить потоки',     color:'#19d3c5', prompt:'Объедини все входящие тексты в единый связный документ. Сохрани структуру.'},
  distill:  {emoji:'🗜',name:'Дистилл.',  desc:'Сжать контекст',        color:'#6c63ff', prompt:'Сожми предыдущий текст до 200–300 слов: главные события, ключевые факты о персонажах, открытые линии. Маркированный список.'},
};
function render(){
  // Статус в заголовке вкладки
  const done=state.nodes.filter(n=>n.status==='done').length, total=state.nodes.length;
  const runPfx=running?'⏳ ':'';
  document.title=runPfx+(state.project.title?state.project.title+' · ':'')+'ИИ-Издательство'+(running?' ('+done+'/'+total+')':'');
  $('#proj-title').value=state.project.title; $('#proj-genre').value=state.project.genre;
  $('#proj-aud').value=state.project.audience; $('#proj-brief').value=state.project.brief;
  const _ecb=$('#proj-edit-mode'); if(_ecb) _ecb.checked=state.project.mode==='edit';
  const ks=$('#api-state'); ks.textContent=hasKey()?'● ключ задан':'● ключ не задан'; ks.classList.toggle('ok',hasKey());
  $('#cost-state').textContent='Σ '+money(projectCost());
  const paused=isPaused();
  const rb=$('#run-btn'); rb.textContent=paused?'▶ Продолжить':'▶ Запустить';
  const sb=$('#stop-btn'); if(sb){ sb.style.display=running?'':'none'; }
  $('#canvas-hint').textContent='Тяни блок за шапку • соединяй кружки (выход→вход) • клик по связи — удалить';
  renderNodes(); renderEdges();
  if(_currentView==='reader') renderReader();
}
function renderNodes(){
  const collapsedIds=new Set((state.groups||[]).filter(g=>g.collapsed).flatMap(g=>g.nodeIds));
  nodesEl.innerHTML=state.nodes.filter(n=>!collapsedIds.has(n.id)).map(n=>{
    // Special node type support
    const sp=n.nodeType?SPEC_NODES[n.nodeType]:null;
    const badge=sp?`<span class="ntype-badge" style="background:${sp.color}1a;color:${sp.color}">${sp.name}</span>`:'';
    const ntAttr=n.nodeType?` data-ntype="${n.nodeType}"`:'';
    // Note nodes: simplified read-only card
    if(n.nodeType==='note'){
      return `<div class="node idle${ntAttr}" data-node="${n.id}" style="left:${n.x}px;top:${n.y}px">${badge}
        <div class="node-head" data-drag="${n.id}">
          <div class="node-emoji">${n.emoji}</div>
          <div><div class="node-name">${esc(n.name)}</div><div class="node-role">${esc(n.role)}</div></div>
        </div>
        <div class="node-body ${n.prompt?'':'empty'}">${n.prompt?esc(n.prompt):'Двойной клик — редактировать'}</div>
        <div class="node-foot"><button class="btn ghost sm" data-action="open-node" data-id="${n.id}">✎ Изменить</button></div>
      </div>`;
    }
    // Standard + special nodes
    const out=n.error?`⚠ ${esc(n.error)}`:n.status==='running'&&!n.output?'<span class="thinking"><span></span><span></span><span></span></span>':(n.output?md2html(n.output):'нет результата');
    const meta=(n.tokensIn||n.tokensOut)?`<span>${(n.tokensIn+n.tokensOut)} ток.</span><span>${money(nodeCost(n))}</span>${n.ms?`<span>${(n.ms/1000).toFixed(1)}с</span>`:''}`:'';
    const appr=n.status==='review'?`<div class="node-foot"><button class="btn ok sm" data-action="approve" data-id="${n.id}">✅ Принять</button><button class="btn ghost sm" data-action="open-node" data-id="${n.id}">✍ Правка</button></div>`:
      `<div class="node-foot"><button class="btn ghost sm" data-action="open-node" data-id="${n.id}">⚙ Настроить</button><button class="btn ghost sm" data-action="run-node" data-id="${n.id}">▶ Прогнать</button></div>`;
    return `<div class="node ${n.status}"${ntAttr} data-node="${n.id}" style="left:${n.x}px;top:${n.y}px">
      ${badge}
      <div class="port in" data-port="in" data-id="${n.id}"></div>
      <div class="port out" data-port="out" data-id="${n.id}"></div>
      <div class="node-head" data-drag="${n.id}">
        <div class="node-emoji">${n.emoji}</div>
        <div><div class="node-name">${esc(n.name)}${n.requireApproval?' 🔒':''}</div><div class="node-role">${esc(n.role)}</div></div>
        <div class="node-status"></div>
      </div>
      <div class="node-body ${n.output||n.error?'':'empty'}" id="body-${n.id}">${out}</div>
      ${meta?`<div class="node-meta">${meta}</div>`:''}
      ${appr}
    </div>`;
  }).join('');
  if(_showMinimap) renderMinimap();
}
function portPos(id,side){ const n=node(id); return {x:n.x+(side==='out'?NW:0), y:n.y+PORT_Y+7}; }
function edgePath(a,b){ const dx=Math.max(40,Math.abs(b.x-a.x)*0.5); return `M ${a.x} ${a.y} C ${a.x+dx} ${a.y}, ${b.x-dx} ${b.y}, ${b.x} ${b.y}`; }
function renderEdges(){
  const collapsedIds=new Set((state.groups||[]).filter(g=>g.collapsed).flatMap(g=>g.nodeIds));
  edgesEl.innerHTML=renderGroups()+state.edges.filter(e=>!collapsedIds.has(e.from)&&!collapsedIds.has(e.to)).map(e=>{ if(!node(e.from)||!node(e.to)) return '';
    const d=edgePath(portPos(e.from,'out'),portPos(e.to,'in'));
    const flow=node(e.from).status==='running'||node(e.to).status==='running';
    const cond=e.condition&&e.condition.trim()?'conditional':'';
    return `<path class="edge ${flow?'flow':''} ${cond}" d="${d}"></path><path class="edge hit" d="${d}" data-edge="${e.id}" title="${cond?'Условие: '+esc(e.condition):''}"></path>`; }).join('');
}
const GROUP_COLORS=['#6c63ff','#19d3c5','#34d399','#fbbf24','#f87171','#a78bfa'];
function renderGroups(){
  return (state.groups||[]).map(g=>{
    const members=g.nodeIds.map(id=>node(id)).filter(Boolean);
    if(!members.length) return '';
    const xMin=Math.min(...members.map(n=>n.x)), yMin=Math.min(...members.map(n=>n.y));
    const xMax=Math.max(...members.map(n=>n.x+NW)), yMax=Math.max(...members.map(n=>n.y+160));
    if(g.collapsed){
      const bx=xMin-20,by=yMin-20,bw=xMax+20-bx,bh=yMax+20-by,cx=bx+bw/2,cy=by+bh/2;
      return `<g><rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="18" style="fill:${g.color}22;stroke:${g.color};stroke-width:2;cursor:pointer" data-group-click="${g.id}"/>
        <text x="${cx}" y="${cy-6}" text-anchor="middle" style="fill:${g.color};font-size:13px;font-weight:700;pointer-events:none">${esc(g.name)}</text>
        <text x="${cx}" y="${cy+12}" text-anchor="middle" style="fill:${g.color}99;font-size:11px;pointer-events:none">${members.length} агентов</text>
        <text x="${bx+bw-20}" y="${by+17}" style="fill:${g.color};font-size:14px;cursor:pointer" data-toggle="${g.id}">▸</text></g>`;
    }
    const pad=22,bx=xMin-pad,by=yMin-pad-20,bw=xMax+pad-bx,bh=yMax+pad+20-by;
    const lw=Math.min(g.name.length*7.5+54,200);
    return `<g><rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="14" style="fill:${g.color}12;stroke:${g.color};stroke-width:1.5;stroke-dasharray:5 4"/>
      <rect x="${bx}" y="${by}" width="${lw}" height="20" rx="5" style="fill:${g.color}28;stroke:${g.color};stroke-width:1" data-group-drag="${g.id}"/>
      <text x="${bx+8}" y="${by+14}" style="fill:${g.color};font-size:11px;font-weight:700;pointer-events:none">${esc(g.name)}</text>
      <text x="${bx+lw-14}" y="${by+15}" style="fill:${g.color};font-size:13px;cursor:pointer" data-toggle="${g.id}">▾</text></g>`;
  }).join('');
}

/* ============ DRAG + СВЯЗИ ============ */
const canvas=$('#canvas'); let drag=null, wire=null, groupDrag=null;
function updateGroupMembership(movedId){
  const n=node(movedId); if(!n||!state.groups||!state.groups.length) return;
  const cx=n.x+NW/2,cy=n.y+80;
  state.groups.forEach(g=>{
    if(g.collapsed) return;
    const others=g.nodeIds.filter(id=>id!==movedId).map(id=>node(id)).filter(Boolean);
    if(!others.length){ g.nodeIds=g.nodeIds.filter(id=>id!==movedId); return; }
    const pad=28;
    const bx=Math.min(...others.map(m=>m.x))-pad, by=Math.min(...others.map(m=>m.y))-pad;
    const bw=Math.max(...others.map(m=>m.x+NW))+pad-bx, bh=Math.max(...others.map(m=>m.y+160))+pad-by;
    const inside=cx>bx&&cx<bx+bw&&cy>by&&cy<by+bh;
    if(inside&&!g.nodeIds.includes(movedId)) g.nodeIds.push(movedId);
    else if(!inside&&g.nodeIds.includes(movedId)) g.nodeIds=g.nodeIds.filter(id=>id!==movedId);
  });
}
nodesEl.addEventListener('mousedown',e=>{
  const p=e.target.closest('.port.out'); if(p){ wire={from:p.dataset.id}; e.stopPropagation(); e.preventDefault(); return; }
  const h=e.target.closest('[data-drag]'); if(!h) return;
  const n=node(h.dataset.drag); const pt=canvasPoint(e); drag={id:n.id,dx:pt.x-n.x,dy:pt.y-n.y}; e.preventDefault();
});
edgesEl.addEventListener('mousedown',e=>{
  const p=e.target.closest('[data-group-drag]'); if(!p) return;
  const g=(state.groups||[]).find(x=>x.id===p.dataset.groupDrag); if(!g) return;
  const pt=canvasPoint(e);
  const starts=g.nodeIds.map(id=>node(id)).filter(Boolean).map(n=>({id:n.id,x:n.x,y:n.y}));
  groupDrag={id:g.id,ox:pt.x,oy:pt.y,starts};
  e.preventDefault(); e.stopPropagation();
});
function canvasPoint(e){ const r=canvas.getBoundingClientRect(); return {x:e.clientX-r.left+canvas.scrollLeft, y:e.clientY-r.top+canvas.scrollTop}; }
window.addEventListener('mousemove',e=>{
  if(drag){ const n=node(drag.id); const pt=canvasPoint(e); n.x=Math.max(0,pt.x-drag.dx); n.y=Math.max(0,pt.y-drag.dy);
    const el=nodesEl.querySelector(`[data-node="${n.id}"]`); if(el){ el.style.left=n.x+'px'; el.style.top=n.y+'px'; } renderEdges(); }
  else if(groupDrag){ const pt=canvasPoint(e); const dx=pt.x-groupDrag.ox,dy=pt.y-groupDrag.oy;
    groupDrag.starts.forEach(s=>{ const n=node(s.id); if(n){ n.x=Math.max(0,s.x+dx); n.y=Math.max(0,s.y+dy); } }); renderNodes(); renderEdges(); }
  else if(wire){ const a=portPos(wire.from,'out'),b=canvasPoint(e); let t=edgesEl.querySelector('.edge-temp');
    if(!t){ t=document.createElementNS('http://www.w3.org/2000/svg','path'); t.setAttribute('class','edge-temp'); edgesEl.appendChild(t); } t.setAttribute('d',edgePath(a,b)); }
});
window.addEventListener('mouseup',e=>{
  if(drag){ const dId=drag.id; drag=null; updateGroupMembership(dId); save(); }
  if(groupDrag){ groupDrag=null; save(); }
  if(wire){ const tgt=document.elementFromPoint(e.clientX,e.clientY); const ip=tgt&&tgt.closest&&tgt.closest('.port.in');
    if(ip) addEdge(wire.from,ip.dataset.id); wire=null; const t=edgesEl.querySelector('.edge-temp'); if(t)t.remove(); renderEdges(); }
});
function addEdge(from,to){ if(from===to) return toast('Нельзя соединить агента с собой','err');
  if(state.edges.some(x=>x.from===from&&x.to===to)) return;
  if(wouldCycle(from,to)) return toast('Связь создаёт петлю — отклонено','err');
  state.edges.push({id:uid(),from,to,condition:''}); save(); renderEdges(); }
function wouldCycle(from,to){ const seen=new Set(),st=[to]; while(st.length){ const c=st.pop(); if(c===from) return true; if(seen.has(c)) continue; seen.add(c); state.edges.filter(e=>e.from===c).forEach(e=>st.push(e.to)); } return false; }
edgesEl.addEventListener('click',e=>{
  const tog=e.target.closest('[data-toggle]'); if(tog){ const g=(state.groups||[]).find(x=>x.id===tog.dataset.toggle); if(g){ g.collapsed=!g.collapsed; save(); render(); return; } }
  const gc=e.target.closest('[data-group-click]'); if(gc){ openGroupEditor(gc.dataset.groupClick); return; }
  const p=e.target.closest('[data-edge]'); if(!p) return;
  const ed=state.edges.find(x=>x.id===p.dataset.edge); if(!ed) return;
  const src=node(ed.from); const dst=node(ed.to);
  openDrawer('⚡ Связь: '+esc((src?.name||'?')+' → '+(dst?.name||'?')),`
    <div class="field"><label>Условие (JS)</label>
      <textarea id="ec-cond" rows="3" placeholder="Оставьте пустым — всегда активна&#10;Пример: output.includes('отклонить')">${esc(ed.condition||'')}</textarea>
      <div class="hint">Переменная <code>output</code> — текст вывода агента-источника. При <code>false</code> этот путь пропускается.</div></div>
    <div class="actions">
      <button class="btn ok" id="ec-save">Сохранить</button>
      <button class="btn ghost" id="ec-test">▶ Тест</button>
      <button class="btn danger" id="ec-del">🗑 Удалить связь</button>
    </div>`,
  b=>{
    b.querySelector('#ec-save').onclick=()=>{ ed.condition=b.querySelector('#ec-cond').value.trim(); save(); renderEdges(); closeDrawer(); toast('Условие сохранено','ok'); };
    b.querySelector('#ec-test').onclick=()=>{ const cond=b.querySelector('#ec-cond').value.trim(); const r=evalCondition(cond,src?.output); toast(cond?(r?'✅ true — ребро активно':'❌ false — ребро пропущено'):'(пусто) → всегда активно',r?'ok':'err'); };
    b.querySelector('#ec-del').onclick=()=>{ state.edges=state.edges.filter(x=>x.id!==ed.id); save(); renderEdges(); closeDrawer(); toast('Связь удалена'); };
  });
});

/* ============ ГЕНЕРАЦИЯ ============ */
async function runNode(id){
  const n=node(id); const c=cfg(n);
  if(!c.apiKey){ n.status='error'; n.error='не задан API-ключ'; logRow(n.name,'error','нет ключа'); save(); renderNodes(); openSettings(); return false; }
  const msgs=buildMessages(n); const hash=JSON.stringify([msgs,c.model,c.temperature]);
  if(n.cacheHash===hash && n.output){ n.status='done'; n.error=''; logRow(n.name,'cache','из кэша (без вызова)'); save(); renderNodes(); renderEdges(); return true; }
  n.status='running'; n.output=''; n.error=''; save(); renderNodes(); renderEdges();
  if(!abortCtrl) abortCtrl=new AbortController(); // fallback для одиночного прогона узла
  const maxR=state.global.maxRetries|0, t0=performance.now();
  for(let attempt=0; attempt<=maxR; attempt++){
    let acc='';
    try{
      let res=await fetch('/api/generate',{ method:'POST', headers:{'Content-Type':'application/json'},
        signal:abortCtrl.signal,
        body:JSON.stringify({ baseURL:c.baseURL, apiKey:c.apiKey, model:c.model, temperature:c.temperature, proxyToken:state.global.proxyToken, messages:msgs }) });
      if(!res.ok){ const t=await res.text(); const retri=res.status===429||res.status>=500;
        if(retri&&attempt<maxR){ logRow(n.name,'retry',`HTTP ${res.status}, повтор #${attempt+1}`); await wait(1000*2**attempt); continue; }
        // Fallback при 502: пробуем альтернативный провайдер
        if((res.status===502||res.status===503) && state.global.fallbackURL && c.baseURL!==state.global.fallbackURL){
          logRow(n.name,'retry','502 → fallback: '+state.global.fallbackURL);
          res=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},signal:abortCtrl.signal,
            body:JSON.stringify({baseURL:state.global.fallbackURL,apiKey:c.apiKey,model:c.model,temperature:c.temperature,proxyToken:state.global.proxyToken,messages:msgs})});
          if(!res.ok) throw new Error('Fallback HTTP '+res.status+': '+(await res.text()).slice(0,120));
        } else {
          throw new Error('HTTP '+res.status+': '+t.slice(0,160));
        }
      }
      const reader=res.body.getReader(), dec=new TextDecoder(); let lastPartialSave=0;
      while(true){ const {value,done}=await reader.read(); if(done) break; acc+=dec.decode(value,{stream:true});
        const b=document.getElementById('body-'+id); if(b){ b.classList.remove('empty'); b.textContent=acc; b.scrollTop=b.scrollHeight; }
        n.output=acc; const now=Date.now(); if(now-lastPartialSave>2000){ save(); lastPartialSave=now; } }
      if(!acc.trim()) throw new Error('пустой ответ от модели');
      n.output=acc; n.summary=acc.length>600?acc.slice(0,600)+'…':acc; n.cacheHash=hash;
      if(state.global.autoSummarize&&acc.length>800){
        try{ const sc=cfg(n);
          const sr=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({baseURL:sc.baseURL,apiKey:sc.apiKey,model:sc.model,temperature:0.3,proxyToken:state.global.proxyToken,
              messages:[{role:'system',content:'Сожми в 3–5 предложений, сохрани ключевые факты. Только саммари, без предисловий.'},
                {role:'user',content:acc.slice(0,6000)}]})});
          if(sr.ok){const rd=sr.body.getReader(),dc2=new TextDecoder();let sm='';
            while(true){const{value:v,done:d}=await rd.read();if(d)break;sm+=dc2.decode(v,{stream:true});}
            if(sm.trim())n.summary=sm.trim();}
        }catch{} // саммари-ошибка не должна рушить пайплайн
      }
      // Постпроцессор вывода
      if(n.postProcess&&n.postProcess.trim()){ try{ const r=new Function('output',n.postProcess)(acc); if(typeof r==='string'&&r){acc=r;n.output=acc;} }catch(e){ logRow(n.name,'warn','postProcess: '+String(e.message).slice(0,80)); } }
      n.tokensIn=tokEst(msgs.map(m=>m.content).join('')); n.tokensOut=tokEst(acc); n.ms=Math.round(performance.now()-t0);
      n.status= n.requireApproval && !n.approved ? 'review' : 'done'; n.error='';
      logRow(n.name,'ok',`${n.tokensIn+n.tokensOut} ток., ${(n.ms/1000).toFixed(1)}с`,{cost:nodeCost(n)});
      // Верификация Bible: логируем ключи, которые должны были использоваться
      const relevantBible=bibleFor(acc); if(relevantBible) logRow(n.name,'bible','Проверьте каноны: '+bibleFor(acc).split('\n').map(l=>l.split(':')[0].replace('•','').trim()).filter(Boolean).join(', '));
      // Проверка JSON-схемы выхода (если задана)
      const schemaErr=checkSchema(n); if(schemaErr) logRow(n.name,'warn','⚠ Схема: '+schemaErr);
      save(); renderNodes(); renderEdges();
      // Auto-bible update (non-blocking, fire-and-forget)
      autoBibleUpdate(n.output, TEMPLATES.find(t=>t.name===n.name)?.role || '').catch(()=>{});
      return true;
    }catch(err){
      if(err.name==='AbortError'){ n.status='idle'; n.error=''; if(acc) n.output=acc; logRow(n.name,'error','остановлено'); save(); renderNodes(); renderEdges(); return false; }
      if(attempt<maxR && /network|fetch|Failed/i.test(String(err.message))){ logRow(n.name,'retry','сеть, повтор #'+(attempt+1)); await wait(1000*2**attempt); continue; }
      n.status='error'; n.error=String(err.message||err); n.output=acc; logRow(n.name,'error',n.error);
      save(); renderNodes(); renderEdges(); toast('Ошибка «'+n.name+'»: '+n.error,'err'); return false;
    }
  }
  return false;
}
function topoOrder(){
  const indeg=new Map(state.nodes.map(n=>[n.id,0])); state.edges.forEach(e=>indeg.set(e.to,(indeg.get(e.to)||0)+1));
  const q=state.nodes.filter(n=>indeg.get(n.id)===0).map(n=>n.id), order=[];
  while(q.length){ const id=q.shift(); order.push(id); state.edges.filter(e=>e.from===id).forEach(e=>{ indeg.set(e.to,indeg.get(e.to)-1); if(indeg.get(e.to)===0) q.push(e.to); }); }
  return order.length===state.nodes.length? order : state.nodes.map(n=>n.id);
}
const isPaused=()=>state.nodes.some(n=>n.status==='review');
let running=false; let abortCtrl=null;
// Находит узлы, готовые к запуску: idle + все зависимости done (или ошибочные — пропустить)
function runnableNodes(){
  return state.nodes.filter(n=>{
    if(n.status!=='idle') return false;
    const inEdges=state.edges.filter(e=>e.to===n.id);
    if(!inEdges.length) return true; // нет зависимостей — сразу готов
    // Все predecessors должны завершиться (done/error/skip)
    const allDone=inEdges.map(e=>node(e.from)).filter(Boolean).every(d=>d.status==='done'||d.status==='error'||d.status==='skip');
    if(!allDone) return false;
    // Если есть условные рёбра — хотя бы одно должно быть активным
    const hasConditions=inEdges.some(e=>e.condition&&e.condition.trim());
    if(!hasConditions) return true;
    const anyActive=inEdges.some(e=>evalCondition(e.condition, node(e.from)?.output));
    if(!anyActive){ n.status='skip'; logRow(n.name,'skip','все условия рёбер → false, узел пропущен'); save(); return false; }
    return true;
  });
}
async function runPipeline(resume){
  if(running) return;
  if(!hasKey()){ toast('Сначала задайте API-ключ','err'); return openSettings(); }
  if(!resume){
    // Напоминание о незаполненных полях (не блокирует, но предупреждает)
    const missing=[];
    if(!state.project.title.trim()) missing.push('название книги');
    if(!state.project.audience.trim()) missing.push('аудиторию');
    if(!state.project.brief.trim()) missing.push('описание (О чём книга)');
    if(missing.length) toast('💡 Не заполнено: '+missing.join(', ')+' — результат будет хуже','warn');
  }
  if(!resume){
    // Счётчик дневных прогонов (KDP: не более 3 книг/день)
    const today=new Date().toISOString().slice(0,10);
    if(!state.dailyRuns||state.dailyRuns.date!==today) state.dailyRuns={date:today,count:0};
    state.dailyRuns.count++;
    if(state.dailyRuns.count>3) toast(`Прогон #${state.dailyRuns.count} за сегодня. KDP рекомендует не более 3 публикаций/день.`,'warn');
    // Снэпшот перед прогоном (история, макс. 5)
    if(!state.runs) state.runs=[];
    state.runs.unshift({t:Date.now(),nodes:JSON.parse(JSON.stringify(state.nodes)),edges:JSON.parse(JSON.stringify(state.edges))});
    if(state.runs.length>5) state.runs.pop();
    state.nodes.forEach(n=>{n.status='idle';n.error='';n.approved=false;});
    hideCompletionBanner();
    save(); renderNodes(); renderEdges();
    // Предоценка стоимости
    const estCost=state.nodes.reduce((sum,n)=>{const p=PRICES[cfg(n).model]||{in:0.14,out:0.28};return sum+(n.tokensIn||2000)/1e6*p.in+(n.tokensOut||1500)/1e6*p.out;},0);
    if(estCost>0.001) toast('Расчётная стоимость: ~'+money(estCost)+(state.global.costCapUSD>0&&estCost>state.global.costCapUSD*0.8?' ⚠ близко к лимиту!':''),'');
    // Hard pre-check бюджета
    if(state.global.costCapUSD>0 && estCost>state.global.costCapUSD){ toast('Расчётная стоимость '+money(estCost)+' превышает лимит '+money(state.global.costCapUSD),'err'); return; }
  }
  abortCtrl=new AbortController();
  running=true; $('#run-btn').disabled=true; $('#run-btn').textContent='⏳ Работает…'; render();
  let cacheHits=0, totalRan=0;
  while(true){
    if(state.global.costCapUSD>0 && projectCost()>=state.global.costCapUSD){ toast('Достигнут лимит бюджета '+money(state.global.costCapUSD),'err'); break; }
    const wave=runnableNodes(); if(!wave.length) break;
    // Параллельный запуск независимых узлов одной волны
    const results=await Promise.all(wave.map(async n=>{
      const wasAborted=abortCtrl.signal.aborted;
      if(wasAborted){ n.status='idle'; return 'abort'; }
      const ok=await runNode(n.id);
      if(ok && n.cacheHash && !n.ms) cacheHits++;
      totalRan++;
      // 3.4: при ошибке не останавливаем весь пайплайн — ставим skip, даём downstream пустой контекст
      if(!ok && n.status==='error' && !abortCtrl.signal.aborted){
        n.status='error'; // downstream получит пустой output — это нормально
        return 'error';
      }
      return ok?'ok':'abort';
    }));
    if(results.includes('abort')) break;
    if(state.nodes.some(n=>n.status==='review')){
      toast('Агент ждёт приёмки 🔒','warn');
      // Таймаут approval
      const toMin=state.global.approvalTimeoutMin;
      if(toMin>0){ setTimeout(()=>{ if(state.nodes.some(n=>n.status==='review')){ toast('Таймаут приёмки ('+toMin+' мин) — пайплайн остановлен','err'); if(abortCtrl) abortCtrl.abort(); } }, toMin*60000); }
      break;
    }
    // Если ни один узел в волне не прошёл и нет idle-узлов — выход
    if(results.every(r=>r==='error') && !runnableNodes().length) break;
  }
  running=false; $('#run-btn').disabled=false; render();
  // 3.5: итог в журнале с cache hit rate
  const done=state.nodes.filter(n=>n.status==='done').length, total=state.nodes.length;
  if(totalRan>0) logRow('Пайплайн','ok',`${done}/${total} агентов · кэш: ${cacheHits}/${totalRan}`);
  if(state.nodes.every(n=>n.status==='done'||n.status==='error')){
    toast(done===total?'Конвейер завершён ✓':'Завершён с ошибками: '+done+'/'+total,done===total?'ok':'warn');
    if(done>0) showCompletionBanner();
  }
  // Авто-оценка: если флаг включён и есть результаты — фоновый LLM-judge
  if(state.global.autoEval && done>0 && hasKey()) autoEvalPipeline();
  // Авто-бэкап после каждого успешного прогона
  if(state.global.autoBackup && done>0) autoBackupNow(true);
}
async function autoEvalPipeline(){
  const c=state.global; const pr=state.project;
  const outputs=state.nodes.filter(n=>n.output).slice(0,4).map(n=>`${n.name}: ${(n.output||'').slice(0,600)}`).join('\n\n');
  try{
    const res=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({baseURL:c.baseURL,apiKey:c.apiKey,model:c.model,temperature:0.2,proxyToken:c.proxyToken,
        messages:[
          {role:'system',content:'Ты — старший редактор. Дай краткую оценку (1 строка на критерий):\n— Соответствие брифу (1–10)\n— Структура и логика (1–10)\n— Качество текста (1–10)\n— Готовность к публикации (1–10)\nИтого: XX/40. Главная рекомендация: 1 предложение.'},
          {role:'user',content:`Проект: «${pr.title}»\nБриф: ${pr.brief}\n\n${outputs}`}]})});
    if(!res.ok) return;
    const rd=res.body.getReader(),dc=new TextDecoder();let acc='';
    while(true){const{value,done}=await rd.read();if(done)break;acc+=dc.decode(value,{stream:true});}
    if(acc.trim()){
      const scoreMatch=acc.match(/итого[:\s]+(\d+)\s*\/\s*40/i)||acc.match(/(\d+)\s*\/\s*40/i);
      const score=scoreMatch?parseInt(scoreMatch[1]):null;
      // Сохраняем счёт с временной меткой для корреляции с историей промтов
      if(!state.evalHistory) state.evalHistory=[];
      state.evalHistory.unshift({t:Date.now(),score,text:acc.trim().slice(0,400)});
      if(state.evalHistory.length>20) state.evalHistory.pop();
      logRow('Авто-оценка','ok',(score?`${score}/40 — `:'')+acc.trim().split('\n').filter(Boolean).join(' · ').slice(0,200));
    }
    save();
  }catch{}
}
function approveNode(id){ const n=node(id); n.approved=true; n.status='done'; logRow(n.name,'ok','принято вручную');
  // Аудит-трейл
  if(!state.approvals) state.approvals=[];
  state.approvals.push({t:Date.now(), node:n.name, nodeId:id, tokens:n.tokensIn+n.tokensOut, cost:nodeCost(n)});
  save(); render(); runPipeline(true); }

/* ============ PROMPT DIFF (Item 34) ============ */
function promptDiff(a,b){
  const la=(a||'').split('\n'), lb=(b||'').split('\n'), max=Math.max(la.length,lb.length);
  let html='<div style="font-family:ui-monospace,monospace;font-size:11.5px;line-height:1.7;white-space:pre-wrap;overflow:auto;max-height:360px;background:var(--panel2);border-radius:9px;padding:10px">';
  for(let i=0;i<max;i++){
    const oa=la[i],nb=lb[i];
    if(oa===nb){ html+=`<div style="color:var(--faint)">&nbsp;${esc(oa??'')}</div>`; }
    else{
      if(oa!==undefined) html+=`<div style="color:var(--err);background:rgba(248,113,113,.09);border-radius:3px">- ${esc(oa)}</div>`;
      if(nb!==undefined) html+=`<div style="color:var(--ok);background:rgba(52,211,153,.09);border-radius:3px">+ ${esc(nb)}</div>`;
    }
  }
  return html+'</div>';
}

/* ============ DRAWER ============ */
const drawer=$('#drawer'), scrim=$('#scrim');
function openDrawer(title,html,mount){ $('#drawer-title').textContent=title; const b=$('#drawer-body'); b.innerHTML=html;
  drawer.classList.add('show'); scrim.classList.add('show'); if(mount) mount(b); }
function closeDrawer(){ drawer.classList.remove('show'); scrim.classList.remove('show'); }
$('#drawer-close').onclick=closeDrawer; scrim.onclick=closeDrawer;
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeDrawer(); });

function openNode(id){
  const n=node(id);
  const outBlock=n.error?`<div class="deliverable err"><div class="label">Ошибка</div>${esc(n.error)}</div>`:(n.output?`<div class="deliverable"><div class="label">Результат · ${n.tokensIn+n.tokensOut} ток. · ${money(nodeCost(n))}</div>${md2html(n.output)}</div>`:'');
  // Корреляция: рядом с каждой версией промта показываем ближайший eval-score
  const evalHist=state.evalHistory||[];
  const nearestEval=t=>{ const e=evalHist.filter(x=>x.t>=t).sort((a,b)=>a.t-b.t)[0]; return e&&e.score?` · ⭐${e.score}/40`:''; };
  const hist=n.promptHistory.length?`<div class="section-label">История промта (${n.promptHistory.length})</div>`+
    n.promptHistory.slice(0,5).map((h,i)=>`<div class="histrow"><span>${new Date(h.t).toLocaleString('ru-RU')}${nearestEval(h.t)}</span><button class="btn ghost sm" data-revert="${i}">↩ вернуть</button></div>`).join(''):'';
  openDrawer(`${n.emoji} ${esc(n.name)}`,`
    <div class="row2"><div class="field"><label>Имя</label><input id="f-name" value="${esc(n.name)}"></div>
      <div class="field"><label>Должность</label><input id="f-role" value="${esc(n.role)}"></div></div>
    <div class="field"><label>Системный промт</label><textarea id="f-prompt" rows="6">${esc(n.prompt)}</textarea>
      <div class="hint">Кто этот агент и как работает. Получает контекст книги, библию и результаты предыдущих агентов.</div></div>
    <div class="field"><label>JSON-схема выхода (необязательно)</label>
      <textarea id="f-schema" rows="2" placeholder='{"hero": "string", "rating": "number"}'>${esc(n.outputSchema||'')}</textarea>
      <div class="hint">Если задана — после прогона проверяется, что вывод содержит JSON с этими ключами. Предупреждение в журнале.</div></div>
    <div class="field"><label>Постпроцессор вывода (JS)</label>
      <textarea id="f-post" rows="2" placeholder="// вернёт строку — заменит вывод&#10;return output.trim().toUpperCase()">${esc(n.postProcess||'')}</textarea>
      <div class="hint">Переменная <code>output</code> — строка вывода агента. Если функция возвращает строку — заменяет вывод.</div></div>
    <label class="check"><input type="checkbox" id="f-appr" ${n.requireApproval?'checked':''}> Требовать мою приёмку (пауза конвейера)</label>
    <div class="section-label">Подключение (API)</div>
    <label class="check"><input type="checkbox" id="f-global" ${n.useGlobal?'checked':''}> Использовать глобальные настройки</label>
    <div id="own-cfg" style="${n.useGlobal?'display:none':''}">
      <div class="field"><label>API base URL</label><input id="f-base" value="${esc(n.baseURL)}" placeholder="${esc(state.global.baseURL)}"></div>
      <div class="row2"><div class="field"><label>Модель</label><input id="f-model" value="${esc(n.model)}" placeholder="${esc(state.global.model)}"></div>
        <div class="field"><label>Температура</label><input id="f-temp" type="number" step="0.1" min="0" max="2" value="${n.temperature}"></div></div>
      <div class="field"><label>API-ключ агента</label><input id="f-key" type="password" value="${esc(n.apiKey)}" placeholder="пусто — глобальный"></div>
    </div>
    <div class="actions"><button class="btn ok" id="f-save">Сохранить</button>
      <button class="btn ghost" id="f-diff">± Diff промта</button>
      <button class="btn ghost" id="f-run">▶ Прогнать</button>
      <button class="btn ghost" id="f-preview">👁 Промт</button>
      <button class="btn ghost" id="f-clone">⧉ Дублировать</button>
      <button class="btn danger" id="f-del">Удалить</button></div>
    ${hist}
    <div class="section-label">Текущий результат</div>
    ${outBlock||'<div class="hint" style="color:var(--faint)">Пока пусто.</div>'}
  `,b=>{
    b.querySelector('#f-global').onchange=ev=>{ b.querySelector('#own-cfg').style.display=ev.target.checked?'none':''; };
    const collect=()=>{ const np=b.querySelector('#f-prompt').value; if(np!==n.prompt){ n.promptHistory.unshift({t:Date.now(),prompt:n.prompt}); if(n.promptHistory.length>20) n.promptHistory.pop(); }
      n.name=b.querySelector('#f-name').value.trim()||n.name; n.role=b.querySelector('#f-role').value.trim(); n.prompt=np;
      n.outputSchema=b.querySelector('#f-schema').value.trim();
      n.postProcess=b.querySelector('#f-post').value.trim();
      n.requireApproval=b.querySelector('#f-appr').checked; n.useGlobal=b.querySelector('#f-global').checked;
      n.baseURL=b.querySelector('#f-base').value.trim(); n.model=b.querySelector('#f-model').value.trim();
      n.apiKey=b.querySelector('#f-key').value.trim(); const tv=parseFloat(b.querySelector('#f-temp').value); n.temperature=isNaN(tv)?1:tv; };
    b.querySelector('#f-save').onclick=()=>{ collect(); n.cacheHash=''; save(); render(); toast('Сохранено','ok'); };
    b.querySelector('#f-diff').onclick=()=>{
      const newP=b.querySelector('#f-prompt').value;
      if(newP===n.prompt){ toast('Промт не изменился'); return; }
      openDrawer('± Diff промта — '+esc(n.name),
        `<div class="hint" style="margin-bottom:8px">Красным — удалено, зелёным — добавлено (построчно)</div>`+promptDiff(n.prompt,newP)+
        `<div class="actions" style="margin-top:12px">
          <button class="btn ok" id="diff-accept">✓ Принять и сохранить</button>
          <button class="btn ghost" id="diff-back">← Назад</button></div>`,
        b2=>{
          b2.querySelector('#diff-accept').onclick=()=>{ if(newP!==n.prompt){ n.promptHistory.unshift({t:Date.now(),prompt:n.prompt}); if(n.promptHistory.length>20) n.promptHistory.pop(); }
            n.prompt=newP; n.cacheHash=''; save(); render(); toast('Промт обновлён','ok'); closeDrawer(); };
          b2.querySelector('#diff-back').onclick=()=>openNode(n.id);
        });
    };
    b.querySelector('#f-run').onclick=()=>{ collect(); n.cacheHash=''; save(); render(); runNode(n.id); };
    b.querySelector('#f-preview').onclick=()=>{ collect(); const msgs=buildMessages(n);
      openDrawer('👁 Предпросмотр промта — '+esc(n.name),
        `<div class="section-label">System</div><pre style="white-space:pre-wrap;font-size:11.5px;color:var(--dim);background:var(--panel2);padding:10px;border-radius:8px;overflow:auto;max-height:200px">${esc(msgs[0].content)}</pre>
         <div class="section-label">User</div><pre style="white-space:pre-wrap;font-size:11.5px;color:var(--dim);background:var(--panel2);padding:10px;border-radius:8px;overflow:auto;max-height:300px">${esc(msgs[1].content)}</pre>
         <div class="hint">Это именно то, что получит модель. ~${tokEst(msgs.map(m=>m.content).join(''))} токенов.</div>`); };
    b.querySelector('#f-del').onclick=()=>{ state.nodes=state.nodes.filter(x=>x.id!==n.id); state.edges=state.edges.filter(e=>e.from!==n.id&&e.to!==n.id); save(); render(); closeDrawer(); toast('Агент удалён'); };
    b.querySelector('#f-clone').onclick=()=>{ collect(); const copy=JSON.parse(JSON.stringify(n)); copy.id=uid(); copy.x=n.x+30; copy.y=n.y+30; copy.output=''; copy.summary=''; copy.cacheHash=''; copy.tokensIn=0; copy.tokensOut=0; copy.ms=0; copy.status='idle'; copy.error=''; copy.approved=false; copy.promptHistory=[]; state.nodes.push(copy); save(); render(); closeDrawer(); toast('Агент скопирован','ok'); };
    b.querySelectorAll('[data-revert]').forEach(btn=>btn.onclick=()=>{ const h=n.promptHistory[+btn.dataset.revert]; if(h){ b.querySelector('#f-prompt').value=h.prompt; toast('Версия подставлена — нажмите Сохранить'); } });
  });
}
function openSettings(){
  const g=state.global;
  openDrawer('⚙ Глобальные настройки',`
    <div class="field"><label>API base URL</label><input id="g-base" value="${esc(g.baseURL)}"></div>
    <div class="row2"><div class="field"><label>Модель</label><input id="g-model" value="${esc(g.model)}"></div>
      <div class="field"><label>Температура</label><input id="g-temp" type="number" step="0.1" min="0" max="2" value="${g.temperature}"></div></div>
    <div class="field"><label>API-ключ (общий / резервный)</label><input id="g-key" type="password" value="${esc(g.apiKey)}" placeholder="sk-...">
      <div class="hint">Хранится только в этом браузере и уходит на локальный прокси, не в сторонние сервисы.</div></div>
    <div class="field"><label>Пул API-ключей (ротация, один на строку)</label>
      <textarea id="g-keys" rows="3" placeholder="sk-key-1&#10;sk-key-2&#10;sk-key-3">${esc(g.apiKeys||'')}</textarea>
      <div class="hint">Если заполнено — ключи чередуются по кругу между агентами. «API-ключ» выше используется как резервный.</div></div>
    <div class="field"><label>Пресет провайдера</label><select id="g-preset"><option value="">— выбрать —</option>
      <option value="https://api.deepseek.com|deepseek-chat">DeepSeek (deepseek-chat)</option>
      <option value="https://api.deepseek.com|deepseek-reasoner">DeepSeek R1 (deepseek-reasoner)</option>
      <option value="https://api.openai.com/v1|gpt-4o-mini">OpenAI (gpt-4o-mini)</option>
      <option value="https://openrouter.ai/api/v1|deepseek/deepseek-chat">OpenRouter → DeepSeek</option>
      <option value="https://openrouter.ai/api/v1|anthropic/claude-3-5-haiku">OpenRouter → Claude Haiku</option></select></div>
    <div class="field"><label>Fallback API URL (при 502)</label><input id="g-fallback" value="${esc(g.fallbackURL||'')}" placeholder="https://openrouter.ai/api/v1">
      <div class="hint">Если основной провайдер недоступен — автоматически используется этот. Ключ — тот же глобальный.</div></div>
    <div class="section-label">Лимиты и надёжность</div>
    <div class="row2"><div class="field"><label>Бюджет контекста (символов)</label><input id="g-ctx" type="number" value="${g.maxContextChars}"></div>
      <div class="field"><label>Ретраи при сбое</label><input id="g-retry" type="number" min="0" max="5" value="${g.maxRetries}"></div></div>
    <div class="row2"><div class="field"><label>Лимит бюджета, $ (0 = без)</label><input id="g-cap" type="number" step="0.1" value="${g.costCapUSD}"></div>
      <div class="field"><label>Токен прокси (если выложен в сеть)</label><input id="g-ptok" value="${esc(g.proxyToken)}" placeholder="не обязательно"></div></div>
    <label class="check"><input type="checkbox" id="g-summ" ${g.autoSummarize?'checked':''}> Авто-саммари узлов (доп. вызов LLM после каждого агента)</label>
    <label class="check"><input type="checkbox" id="g-bible-extract" ${g.autoBibleExtract?'checked':''}> Авто-Библия: извлекать персонажей и факты после каждой главы</label>
    <label class="check"><input type="checkbox" id="g-eval" ${g.autoEval?'checked':''}> Авто-оценка после пайплайна (LLM-judge: 4 критерия, запись в журнал)</label>
    <div class="field"><label>Таймаут приёмки, мин (0 = без)</label><input id="g-aptout" type="number" min="0" value="${g.approvalTimeoutMin||0}">
      <div class="hint">Если агент ждёт одобрения дольше — пайплайн прерывается автоматически.</div></div>
    <div class="section-label">💾 Резервные копии</div>
    <div class="field"><label>Папка резервных копий</label>
      <input id="g-bkdir" value="${esc(g.backupDir||'')}" placeholder="По умолчанию: backups/ рядом с server.js">
      <div class="hint">Абсолютный или относительный путь на этом компьютере. Оставьте пустым — используется папка <code>backups/</code> рядом с server.js.</div></div>
    <div class="row2">
      <div class="field"><label>Интервал авто-копии, мин</label><input id="g-bkint" type="number" min="1" value="${g.backupIntervalMin||10}"></div>
      <div class="field" style="display:flex;align-items:flex-end;padding-bottom:6px">
        <label class="check"><input type="checkbox" id="g-bkauto" ${g.autoBackup!==false?'checked':''}> Авто-копия после прогона и по таймеру</label>
      </div>
    </div>
    <button class="btn ghost" id="g-bkopen" style="margin-bottom:12px">📂 Открыть список копий</button>
    <div class="actions"><button class="btn ok" id="g-save">Сохранить</button></div>
  `,b=>{
    b.querySelector('#g-preset').onchange=ev=>{ if(!ev.target.value) return; const [u,m]=ev.target.value.split('|'); b.querySelector('#g-base').value=u; b.querySelector('#g-model').value=m; };
    b.querySelector('#g-bkopen').onclick=()=>{ closeDrawer(); setTimeout(openBackupRestore,120); };
    b.querySelector('#g-save').onclick=()=>{ g.baseURL=b.querySelector('#g-base').value.trim()||g.baseURL; g.model=b.querySelector('#g-model').value.trim()||g.model;
      g.apiKey=b.querySelector('#g-key').value.trim(); const t=parseFloat(b.querySelector('#g-temp').value); g.temperature=isNaN(t)?1:t;
      g.maxContextChars=parseInt(b.querySelector('#g-ctx').value)||8000; g.maxRetries=parseInt(b.querySelector('#g-retry').value)||0;
      g.costCapUSD=parseFloat(b.querySelector('#g-cap').value)||0; g.proxyToken=b.querySelector('#g-ptok').value.trim();
      g.autoSummarize=b.querySelector('#g-summ').checked;
      g.autoBibleExtract=b.querySelector('#g-bible-extract').checked;
      g.autoEval=b.querySelector('#g-eval').checked;
      g.fallbackURL=b.querySelector('#g-fallback').value.trim();
      g.approvalTimeoutMin=parseInt(b.querySelector('#g-aptout').value)||0;
      g.apiKeys=b.querySelector('#g-keys').value; _keyIdx=0;
      g.backupDir=b.querySelector('#g-bkdir').value.trim();
      g.backupIntervalMin=parseInt(b.querySelector('#g-bkint').value)||10;
      g.autoBackup=b.querySelector('#g-bkauto').checked;
      scheduleBackup();
      save(); render(); toast('Настройки сохранены','ok'); }; });
}
function openBible(){
  const rows=state.bible.map(b=>`<div class="bible-row" data-bid="${b.id}">
    <input class="bk" value="${esc(b.keys)}" placeholder="ключи: имя, прозвище (пусто = всегда)">
    <textarea class="bt" rows="2" placeholder="канон: факт о персонаже / мире / таймлайне">${esc(b.text)}</textarea>
    <button class="icon-btn" data-delbible="${b.id}">✕</button></div>`).join('');
  openDrawer('📖 Библия книги',`
    <p class="hint" style="margin-top:0">Канон книги. Запись подмешивается в контекст агента, когда её ключ встречается в тексте (пустые ключи — всегда). Защищает от противоречий и дрейфа.</p>
    <div id="bible-list">${rows||'<div class="hint" style="color:var(--faint)">Пока пусто.</div>'}</div>
    <div class="actions" style="margin-top:14px"><button class="btn ghost" id="b-add">＋ Запись</button>
      <button class="btn ghost" id="b-auto">🪄 Собрать из текста</button>
      <button class="btn ok" id="b-save">Сохранить</button></div>
    <div class="hint">«Собрать из текста» — архивариус извлечёт канон из исходника и результатов агентов (нужен API-ключ).</div>
  `,b=>{
    b.querySelector('#b-add').onclick=()=>{ state.bible.push({id:uid(),keys:'',text:''}); save(); openBible(); };
    b.querySelector('#b-auto').onclick=autoBuildBible;
    b.querySelectorAll('[data-delbible]').forEach(x=>x.onclick=()=>{ state.bible=state.bible.filter(e=>e.id!==x.dataset.delbible); save(); openBible(); });
    b.querySelector('#b-save').onclick=()=>{ b.querySelectorAll('.bible-row').forEach(r=>{ const e=state.bible.find(x=>x.id===r.dataset.bid); if(e){ e.keys=r.querySelector('.bk').value.trim(); e.text=r.querySelector('.bt').value.trim(); } }); rebuildBibleVecs(); save(); toast('Библия сохранена','ok'); closeDrawer(); }; });
}
async function autoBuildBible(){
  if(!hasKey()){ toast('Задайте API-ключ','err'); return openSettings(); }
  const src=[state.project.input, ...state.nodes.filter(n=>n.output).map(n=>n.output)].filter(Boolean).join('\n\n');
  if(!src.trim()){ toast('Нет текста: заполните исходник или запустите агентов','err'); return; }
  const c=state.global;
  const msgs=[ {role:'system',content:'Ты — архивариус издательства. Извлеки канон книги: персонажи, места, правила мира, важные факты, таймлайн. Верни строки строго в формате «КЛЮЧИ | ФАКТ», где ключи — имена/слова через запятую, по которым факт находится. Только строки, без нумерации и пояснений.'},
    {role:'user',content:'Текст:\n'+src.slice(0,12000)} ];
  toast('Собираю библию…');
  try{
    const res=await fetch('/api/generate',{ method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ baseURL:c.baseURL, apiKey:c.apiKey, model:c.model, temperature:0.3, proxyToken:c.proxyToken, messages:msgs }) });
    if(!res.ok) throw new Error('HTTP '+res.status+': '+(await res.text()).slice(0,120));
    const reader=res.body.getReader(), dec=new TextDecoder(); let acc='';
    while(true){ const {value,done}=await reader.read(); if(done) break; acc+=dec.decode(value,{stream:true}); }
    const entries=parseBibleLines(acc);
    if(!entries.length) throw new Error('не удалось разобрать ответ модели');
    entries.forEach(e=>state.bible.push({id:uid(),keys:e.keys,text:e.text}));
    rebuildBibleVecs();
    logRow('Архивариус','ok','библия: +'+entries.length); save(); openBible(); toast('Добавлено записей: '+entries.length,'ok');
  }catch(err){ logRow('Архивариус','error',String(err.message)); toast('Не удалось: '+err.message,'err'); }
}
function openLog(){
  function logRows(q){
    const f=q?(state.log.filter(l=>l.node.toLowerCase().includes(q)||l.status.toLowerCase().includes(q)||l.msg.toLowerCase().includes(q))):state.log;
    return f.length?f.map(l=>`<div class="logrow l-${l.status}"><span class="lt">${new Date(l.t).toLocaleTimeString('ru-RU')}</span>
      <span class="ln">${esc(l.node)}</span><span class="ls">${l.status}</span><span class="lm">${esc(l.msg)}</span></div>`).join('')
      :'<div class="hint" style="color:var(--faint)">'+(q?'Нет совпадений.':'Журнал пуст.')+'</div>';
  }
  openDrawer('📋 Журнал вызовов',`
    <input id="log-q" placeholder="🔍 Агент / статус / текст…" style="width:100%;background:var(--panel2);border:1px solid var(--line2);color:var(--txt);border-radius:9px;padding:9px 12px;font-size:13px;margin-bottom:10px">
    <div class="log" id="log-rows">${logRows('')}</div>
    <div class="actions" style="margin-top:14px"><button class="btn ghost" id="log-clear">Очистить</button></div>
  `,b=>{
    b.querySelector('#log-q').oninput=ev=>{ b.querySelector('#log-rows').innerHTML=logRows(ev.target.value.toLowerCase()); };
    b.querySelector('#log-clear').onclick=()=>{ state.log=[]; save(); openLog(); };
  });
}
function openInput(){
  openDrawer('📄 Исходный текст',`<div class="hint" style="color:var(--warn);margin-bottom:10px">⚠ Вставляйте только текст книги. Инструкции вида «Игнорируй предыдущие задания…» в исходнике могут влиять на поведение агентов (prompt injection).</div>
    <div class="field"><label>Рукопись для редактирования</label>
    <textarea id="i-text" rows="15" placeholder="Вставьте текст…">${esc(state.project.input)}</textarea></div>
    <div class="actions"><button class="btn ok" id="i-save">Сохранить</button></div>`,
    b=>{ b.querySelector('#i-save').onclick=()=>{ state.project.input=b.querySelector('#i-text').value; save(); toast('Исходник сохранён','ok'); closeDrawer(); }; });
}
function openExport(){
  openDrawer('⬇ Экспорт / импорт',`
    <div class="section-label" style="border:0;margin-top:0;padding:0">Готовая книга</div>
    <div class="field"><label>Раскрытие ИИ (для площадок)</label><input id="x-disc" value="${esc(state.project.disclosure)}"></div>
    <div class="actions"><button class="btn ok" id="x-book">📕 Скачать книгу (.md)</button>
      <button class="btn ok" id="x-docx">📄 Скачать Word (.doc)</button>
      <button class="btn ok" id="x-epub">📗 Скачать EPUB</button></div>
    <div class="section-label">Схема пайплайна</div>
    <div class="actions"><button class="btn ghost" id="x-exp">⬇ Экспорт проекта (.json)</button>
      <button class="btn ghost" id="x-pipe">⬇ Только пайплайн (без данных)</button>
      <label class="btn ghost" style="cursor:pointer">📥 Импорт<input type="file" id="x-imp" accept="application/json" hidden></label></div>
    <div class="hint">Экспорт сохраняет агентов, промты, связи, библию и настройки (кроме ключей лучше чистить вручную).</div>
    <div class="section-label">Базлайн / регресс</div>
    <p class="hint">Сохраните результаты как эталон. После следующего прогона — сравните изменения по каждому агенту.</p>
    <div class="actions"><button class="btn ghost" id="x-bl-save">💾 Сохранить базлайн</button>
      ${state.baseline?`<button class="btn ghost" id="x-bl-cmp">📊 Сравнить с базлайном</button><span style="font-size:11px;color:var(--faint);margin-left:4px">от ${new Date(state.baseline.t).toLocaleString('ru-RU')}</span>`:''}
    </div>
    <div class="section-label">История прогонов</div>
    <div id="runs-list">${(state.runs||[]).length?
      (state.runs||[]).map((r,i)=>`<div class="histrow"><span>${new Date(r.t).toLocaleString('ru-RU')} · ${r.nodes.length} агентов</span><button class="btn ghost sm" data-restore="${i}">↩ Восстановить</button></div>`).join('')
      :'<div class="hint" style="color:var(--faint)">Прогонов ещё не было.</div>'}</div>
  `,b=>{
    b.querySelector('#x-disc').onchange=ev=>{ state.project.disclosure=ev.target.value; save(); };
    b.querySelector('#x-book').onclick=exportBook;
    b.querySelector('#x-docx').onclick=exportDocx;
    b.querySelector('#x-epub').onclick=exportEpub;
    b.querySelector('#x-exp').onclick=()=>download((state.project.title||'pipeline')+'.json', JSON.stringify(state,(k,v)=>k==='_vec'?undefined:v,2));
    b.querySelector('#x-pipe').onclick=()=>{
      const clean={nodes:state.nodes.map(n=>({...n,output:'',summary:'',error:'',cacheHash:'',tokensIn:0,tokensOut:0,ms:0,apiKey:'',approved:false,status:'idle'})),edges:state.edges,bible:state.bible,groups:state.groups||[],global:{...state.global,apiKey:'',proxyToken:''}};
      download((state.project.title||'pipeline')+'-pipeline.json',JSON.stringify(clean,null,2)); toast('Пайплайн экспортирован (без ключей и данных)','ok');};
    b.querySelectorAll('[data-restore]').forEach(btn=>btn.onclick=()=>{ const r=(state.runs||[])[+btn.dataset.restore]; if(!r)return;
      if(!confirm('Восстановить состояние агентов из этого прогона?')) return;
      state.nodes=r.nodes; state.edges=r.edges; save(); render(); closeDrawer(); toast('Прогон восстановлен','ok'); });
    b.querySelector('#x-imp').onchange=ev=>{ const f=ev.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=()=>{ try{ state=Object.assign(defaultState(),JSON.parse(r.result)); save(); render(); closeDrawer(); toast('Проект импортирован','ok'); }catch{ toast('Не удалось прочитать файл','err'); } }; r.readAsText(f); };
    b.querySelector('#x-bl-save').onclick=()=>{ saveBaseline(); openExport(); };
    if(state.baseline) b.querySelector('#x-bl-cmp').onclick=openBaselineCompare;
  });
}
function download(name,text,mime='text/plain'){ const u=URL.createObjectURL(new Blob([text],{type:mime})); const a=document.createElement('a'); a.href=u; a.download=name; a.click(); URL.revokeObjectURL(u); }
// Типографический постпроцессинг: ASCII-символы → типографические
function typo(s){
  return (s||'')
    .replace(/---/g,'—').replace(/--/g,'–')
    .replace(/"([^"]+)"/g,'«$1»')          // "текст" → «текст»
    .replace(/[^\S\r\n]{2,}/g,' ')           // двойные пробелы (только пробелы, не переносы строк)
    .replace(/\.{3}/g,'…')                  // три точки → многоточие
    .replace(/(\d)\s*x\s*(\d)/gi,'$1×$2'); // 2 x 3 → 2×3
}
function exportBook(){
  if(!state.project.disclosure.trim()){ toast('Заполните поле «Раскрытие ИИ» перед экспортом — требование KDP','err'); return; }
  const pr=state.project;
  const term=state.nodes.filter(n=>!state.edges.some(e=>e.from===n.id)); // конечные узлы
  const body=state.nodes.filter(n=>n.output).map(n=>`### ${n.emoji} ${n.name} — ${n.role}\n\n${typo(n.output)}`).join('\n\n---\n\n');
  download((pr.title||'book')+'.md',
    `# ${typo(pr.title||'Без названия')}\n\n> Раскрытие: ${pr.disclosure}\n\nЖанр: ${pr.genre} · Аудитория: ${pr.audience}\n\n${KDP_CHECKLIST}\n\n---\n\n${body||'(нет результатов — запустите конвейер)'}\n`);
  toast('Книга собрана','ok');
}
function exportDocx(){
  if(!state.project.disclosure.trim()){ toast('Заполните поле «Раскрытие ИИ»','err'); return; }
  const pr=state.project;
  const body=state.nodes.filter(n=>n.output).map(n=>`<h2>${esc(n.emoji+' '+n.name)} <span style="font-weight:normal;font-size:11pt">— ${esc(n.role)}</span></h2>${md2html(typo(n.output))}<hr>`).join('');
  const html=`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8">
    <style>body{font-family:"Times New Roman",serif;font-size:12pt;line-height:1.6;margin:2cm}
    h1{font-size:18pt;text-align:center}h2{font-size:14pt;margin-top:18pt}
    p{margin:0 0 6pt}ul{margin:0 0 6pt 18pt}li{margin:2pt 0}
    hr{border:none;border-top:1px solid #999;margin:12pt 0}</style></head><body>
    <h1>${esc(typo(pr.title||'Без названия'))}</h1>
    <p style="text-align:center;color:#666"><em>Раскрытие: ${esc(pr.disclosure)}</em></p>
    <p style="text-align:center">Жанр: ${esc(pr.genre)} · Аудитория: ${esc(pr.audience)}</p><hr>
    ${body||'<p>(нет результатов)</p>'}
    </body></html>`;
  download((pr.title||'book')+'.doc', '﻿'+html, 'application/msword');
  toast('Word-документ готов','ok');
}

function exportEpub(){
  if(!state.project.disclosure.trim()){toast('Заполните поле «Раскрытие ИИ»','err');return;}
  const pr=state.project;
  const chapters=state.nodes.filter(n=>n.output);
  if(!chapters.length){toast('Нет результатов для EPUB — запустите конвейер','err');return;}
  const title=typo(pr.title||'Без названия');
  const E=s=>(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const bookId='urn:uuid:'+uid()+'-'+uid();
  const now=new Date().toISOString().replace(/\.\d+Z$/,'Z');

  // Главы
  const chs=chapters.map((n,i)=>{
    const fn='ch'+String(i+1).padStart(3,'0')+'.xhtml';
    const cht=E(n.emoji+' '+n.name+' — '+n.role);
    const body=md2xhtml(typo(n.output));
    return {fn,cht,xhtml:`<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><meta charset="utf-8"/><title>${cht}</title><link rel="stylesheet" href="../style.css"/></head><body><h2>${cht}</h2>\n${body}\n</body></html>`};
  });

  const manifestItems=chs.map((c,i)=>`<item id="ch${i+1}" href="chapters/${c.fn}" media-type="application/xhtml+xml"/>`).join('\n    ');
  const spineItems=chs.map((_,i)=>`<itemref idref="ch${i+1}"/>`).join('\n    ');
  const navItems=chs.map(c=>`<li><a href="chapters/${c.fn}">${c.cht}</a></li>`).join('\n      ');
  const ncxPoints=chs.map((c,i)=>`<navPoint id="np${i+1}" playOrder="${i+1}"><navLabel><text>${c.cht}</text></navLabel><content src="chapters/${c.fn}"/></navPoint>`).join('\n  ');

  const css=`body{font-family:Georgia,serif;font-size:1em;line-height:1.7;margin:1.2em}
h1{font-size:1.8em;text-align:center;margin:1em 0}h2{font-size:1.3em;margin:1.2em 0 .5em}
h3{font-size:1.15em;margin:1em 0 .4em}h4{font-size:1em;font-weight:bold;margin:.8em 0 .3em}
p{margin:.3em 0 .6em;text-indent:1.4em}p:first-child,h2+p,h3+p{text-indent:0}
ul{margin:.3em 0 .6em 1.8em}li{margin:.2em 0}hr{border:none;border-top:1px solid #aaa;margin:1em 0}`;

  const container=`<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;

  const opf=`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${E(title)}</dc:title>
    <dc:creator>ИИ-Издательство</dc:creator>
    <dc:language>ru</dc:language>
    <dc:identifier id="bookid">${bookId}</dc:identifier>
    <dc:description>${E(pr.brief||'')}</dc:description>
    <meta property="dcterms:modified">${now}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    ${manifestItems}
  </manifest>
  <spine toc="ncx">${spineItems}</spine>
</package>`;

  const nav=`<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><meta charset="utf-8"/><title>Содержание</title></head><body><nav epub:type="toc" id="toc"><h1>Содержание</h1><ol>\n      ${navItems}\n    </ol></nav></body></html>`;

  const ncx=`<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${bookId}"/></head><docTitle><text>${E(title)}</text></docTitle><navMap>\n  ${ncxPoints}\n</navMap></ncx>`;

  const zip=new ZipBuilder();
  zip.add('mimetype','application/epub+zip');          // должен быть первым и без сжатия
  zip.add('META-INF/container.xml',container);
  zip.add('OEBPS/content.opf',opf);
  zip.add('OEBPS/nav.xhtml',nav);
  zip.add('OEBPS/toc.ncx',ncx);
  zip.add('OEBPS/style.css',css);
  chs.forEach(c=>zip.add('OEBPS/chapters/'+c.fn,c.xhtml));

  const blob=zip.blob();
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=(pr.title||'book').replace(/[^\wЀ-ӿ\s\-]/g,'_').trim()+'.epub';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
  toast('EPUB готов — '+chs.length+' глав','ok');
  logRow('Экспорт','ok','EPUB: '+chs.length+' глав, '+Math.round(blob.size/1024)+' КБ');
}

/* ============ SELF-EVAL ============ */
async function runSelfEval(){
  if(!hasKey()){ toast('Нужен API-ключ','err'); return openSettings(); }
  const outputs=state.nodes.filter(n=>n.output).map(n=>`${n.name}:\n${n.output}`).join('\n\n---\n\n');
  if(!outputs.trim()){ toast('Нет результатов для оценки','err'); return; }
  toast('Оцениваю качество…');
  const c=state.global;
  try{
    const res=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({baseURL:c.baseURL,apiKey:c.apiKey,model:c.model,temperature:0.3,proxyToken:c.proxyToken,
        messages:[
          {role:'system',content:'Ты — старший редактор издательства. Оцени результаты работы команды ИИ-агентов строго по 5 критериям (от 1 до 10). Формат вывода:\n★ Соответствие брифу: X/10 — краткий вывод\n★ Структура и логика: X/10 — краткий вывод\n★ Качество текста: X/10 — краткий вывод\n★ Достоверность фактов: X/10 — краткий вывод\n★ Готовность к публикации: X/10 — краткий вывод\n\nИтого: XX/50\n\nГлавная рекомендация: одно предложение.'},
          {role:'user',content:`Проект: «${state.project.title}»\nБриф: ${state.project.brief}\nЖанр: ${state.project.genre}\n\nРезультаты:\n${outputs.slice(0,9000)}`}
        ]})});
    if(!res.ok) throw new Error('HTTP '+res.status);
    const reader=res.body.getReader(),dec=new TextDecoder();let acc='';
    while(true){const{value,done}=await reader.read();if(done)break;acc+=dec.decode(value,{stream:true});}
    openDrawer('⭐ Самооценка пайплайна',`<div style="white-space:pre-wrap;font-size:13.5px;line-height:1.8;color:var(--txt)">${esc(acc)}</div>`);
    logRow('Self-eval','ok','оценка качества получена');
  }catch(err){toast('Не удалось: '+err.message,'err');}
}

/* ============ ТОСТЫ ============ */
let toastT; function toast(m,k=''){ const t=$('#toast'); t.textContent=m; t.className='toast show '+k; clearTimeout(toastT); toastT=setTimeout(()=>t.className='toast '+k,2600); }

/* ============ СОБЫТИЯ ============ */
document.addEventListener('click',e=>{ const t=e.target.closest('[data-action]'); if(!t) return; const a=t.dataset.action,id=t.dataset.id;
  if(a==='run'){ isPaused()?runPipeline(true):runPipeline(false); }
  else if(a==='stop'){ if(abortCtrl) abortCtrl.abort(); }
  else if(a==='settings') openSettings(); else if(a==='add-node') addNodePicker(); else if(a==='auto-layout') autoLayout(); else if(a==='templates') openTemplates(); else if(a==='group') openGroupCreator(); else if(a==='chapters') openChapters(); else if(a==='guide') openGuide(); else if(a==='entities') openEntities();
  else if(a==='switch-view') switchView(t.dataset.view);
  else if(a==='edit-input') openInput(); else if(a==='open-node') openNode(id); else if(a==='run-node') runNode(id);
  else if(a==='approve') approveNode(id); else if(a==='bible') openBible(); else if(a==='log') openLog(); else if(a==='export') openExport(); else if(a==='selfeval') runSelfEval();
});
function bindProj(sel,key){ const el=$(sel); el.addEventListener('change',()=>{ state.project[key]=el.value; save(); render(); }); }
['title','genre','audience','brief'].forEach(k=>bindProj('#proj-'+(k==='audience'?'aud':k),k));
// Чекбокс режима редактирования (заменяет select#proj-mode)
(function(){
  const editModeCb = document.querySelector('#proj-edit-mode');
  if(editModeCb){
    editModeCb.checked = state.project.mode === 'edit';
    editModeCb.onchange = () => {
      state.project.mode = editModeCb.checked ? 'edit' : 'write';
      save();
      if(editModeCb.checked) openInput();
    };
  }
})();
const PROJECT_TPLS = {
  solo:{ label:'🤖 Соло-агент', roles:['writer'], genre:'', brief:'Один агент — задаёте промт, получаете результат' },
  story:{ label:'📖 Рассказ', roles:['scout','writer','logedit','proof'], genre:'Рассказ', brief:'Короткий рассказ до 5000 слов' },
  nonfic:{ label:'📚 Нон-фикшн', roles:['scout','dev','writer','factcheck','meta'], genre:'Нон-фикшн', brief:'Книга на основе экспертизы автора' },
  novel:{ label:'✍️ Роман', roles:['scout','dev','writer','logedit','line','proof','continuity','art','layout','meta','mkt'], genre:'Роман', brief:'Полный производственный цикл' }
};
function applyTemplate(key){
  // Map template key to agent roles
  const roleMap = {
    'solo':  ['writer'],
    'story': ['dev','writer','proof'],
    'novel': ['scout','dev','writer','line','proof','continuity','meta','mkt'],
  };
  const roles = roleMap[key] || roleMap['story'];
  const tpls = roles.map(r => TEMPLATES.find(t => t.role === r)).filter(Boolean);
  if(!tpls.length) return;
  state.nodes = tpls.map((tp,i) => freshNode(tp, 60+(i%3)*260, 40+Math.floor(i/3)*190));
  state.edges = [];
  for(let i=0; i<state.nodes.length-1; i++)
    state.edges.push({id:uid(), from:state.nodes[i].id, to:state.nodes[i+1].id, condition:''});
  save(); render();
}

let _simpTpl = 'story';
function initSimplifiedMode(){
  const row = document.querySelector('#simp-tpl-row');
  if(!row) return;
  row.innerHTML = '';
  [{key:'solo',label:'⚡ Соло',desc:'1 агент, быстро'},
   {key:'story',label:'📖 Рассказ',desc:'3 агента'},
   {key:'novel',label:'✍️ Роман',desc:'полный цикл'}
  ].forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'simp-tpl-btn' + (t.key === _simpTpl ? ' selected' : '');
    btn.textContent = t.label;
    btn.title = t.desc;
    btn.onclick = () => {
      _simpTpl = t.key;
      row.querySelectorAll('.simp-tpl-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    };
    row.appendChild(btn);
  });
  const sti=document.querySelector('#simp-title'), sb=document.querySelector('#simp-brief');
  const sg=document.querySelector('#simp-genre'), sa=document.querySelector('#simp-aud');
  if(sti) sti.value = state.project.title || '';
  if(sb)  sb.value  = state.project.brief || '';
  if(sg)  sg.value  = state.project.genre || '';
  if(sa)  sa.value  = state.project.audience || '';
  const runBtn = document.querySelector('#simp-run');
  if(runBtn) runBtn.onclick = () => {
    const brief = document.querySelector('#simp-brief')?.value.trim();
    if(!brief){ toast('Опишите книгу — хотя бы в двух словах','warn'); return; }
    state.project.title    = document.querySelector('#simp-title')?.value.trim() || state.project.title;
    state.project.brief    = brief;
    state.project.genre    = document.querySelector('#simp-genre')?.value.trim() || '';
    state.project.audience = document.querySelector('#simp-aud')?.value.trim()   || '';
    save();
    applyTemplate(_simpTpl);
    switchView('canvas');
    runPipeline();
  };
  const expertBtn = document.querySelector('#simp-to-expert');
  if(expertBtn) expertBtn.onclick = () => switchView('canvas');
}

function openTemplates(){
  openDrawer('🗂 Шаблоны проекта',`
    <p class="hint" style="margin-top:0">Выберите стартовый пакет. Текущий холст будет заменён.</p>
    ${Object.entries(PROJECT_TPLS).map(([k,t])=>`
      <div style="margin-bottom:12px"><button class="btn ghost" style="width:100%;text-align:left;padding:12px 14px" data-tpl="${k}">
        <strong>${t.label}</strong><br><span style="color:var(--dim);font-size:12px">${t.roles.map(r=>TEMPLATES.find(x=>x.role===r)?.name).filter(Boolean).join(' → ')}</span>
      </button></div>`).join('')}`,
  b=>{ b.querySelectorAll('[data-tpl]').forEach(btn=>btn.onclick=()=>{
    const t=PROJECT_TPLS[btn.dataset.tpl]; if(!t) return;
    const tpls=t.roles.map(r=>TEMPLATES.find(x=>x.role===r)).filter(Boolean);
    state.nodes=tpls.map((tp,i)=>freshNode(tp,60+(i%3)*260,40+Math.floor(i/3)*190));
    state.edges=[]; for(let i=0;i<state.nodes.length-1;i++) state.edges.push({id:uid(),from:state.nodes[i].id,to:state.nodes[i+1].id});
    state.project.genre=t.genre; state.project.brief=t.brief;
    save(); render(); closeDrawer(); toast(t.label+' — пайплайн создан','ok');
  }); });
}
function autoLayout(){ state.nodes.forEach((n,i)=>{ n.x=60+(i%3)*250; n.y=40+Math.floor(i/3)*180; });
  state.edges=[]; for(let i=0;i<state.nodes.length-1;i++) state.edges.push({id:uid(),from:state.nodes[i].id,to:state.nodes[i+1].id}); save(); render(); toast('Схема выстроена в цепочку'); }
function colorChips(sel,elId){
  return `<div id="${elId}" style="display:flex;gap:8px;flex-wrap:wrap">`+
    GROUP_COLORS.map(c=>`<div data-color="${c}" data-sel="${c===sel?'1':'0'}" style="width:28px;height:28px;border-radius:8px;background:${c};cursor:pointer;box-shadow:${c===sel?'0 0 0 3px #fff,0 0 0 5px '+c:'none'}" onclick="this.parentNode.querySelectorAll('[data-color]').forEach(function(x){x.dataset.sel='0';x.style.boxShadow='none'});this.dataset.sel='1';this.style.boxShadow='0 0 0 3px #fff,0 0 0 5px '+this.dataset.color"></div>`).join('')+
    '</div>';
}
function pickedColor(b,elId){ return b.querySelector('#'+elId+' [data-sel="1"]')?.dataset.color||GROUP_COLORS[0]; }
function openGroupCreator(){
  openDrawer('⊞ Новая группа',`
    <div class="field"><label>Название</label><input id="g-name" placeholder="Редактура" value="Группа"></div>
    <div class="field"><label>Цвет</label>${colorChips(GROUP_COLORS[0],'g-colors')}</div>
    <div class="field"><label>Агенты</label>
      ${state.nodes.map(n=>`<label class="check"><input type="checkbox" data-node-pick="${n.id}"> ${n.emoji} ${esc(n.name)}</label>`).join('')}</div>
    <div class="actions"><button class="btn ok" id="g-create">Создать</button></div>
  `,b=>{
    b.querySelector('#g-create').onclick=()=>{
      const name=b.querySelector('#g-name').value.trim()||'Группа';
      const color=pickedColor(b,'g-colors');
      const nodeIds=[...b.querySelectorAll('[data-node-pick]:checked')].map(x=>x.dataset.nodePick);
      if(!state.groups) state.groups=[];
      state.groups.push({id:uid(),name,color,nodeIds,collapsed:false});
      save(); render(); closeDrawer(); toast('Группа «'+name+'» создана','ok');
    };
  });
}
function openGroupEditor(id){
  const g=(state.groups||[]).find(x=>x.id===id); if(!g) return;
  openDrawer('✏️ Группа: '+esc(g.name),`
    <div class="field"><label>Название</label><input id="ge-name" value="${esc(g.name)}"></div>
    <div class="field"><label>Цвет</label>${colorChips(g.color,'ge-colors')}</div>
    <div class="field"><label>Агенты</label>
      ${state.nodes.map(n=>`<label class="check"><input type="checkbox" data-node-pick="${n.id}" ${g.nodeIds.includes(n.id)?'checked':''}> ${n.emoji} ${esc(n.name)}</label>`).join('')}</div>
    <div class="actions">
      <button class="btn ok" id="ge-save">Сохранить</button>
      <button class="btn danger" id="ge-del">🗑 Удалить группу</button>
    </div>
  `,b=>{
    b.querySelector('#ge-save').onclick=()=>{
      g.name=b.querySelector('#ge-name').value.trim()||g.name;
      g.color=pickedColor(b,'ge-colors');
      g.nodeIds=[...b.querySelectorAll('[data-node-pick]:checked')].map(x=>x.dataset.nodePick);
      save(); render(); closeDrawer(); toast('Группа сохранена','ok');
    };
    b.querySelector('#ge-del').onclick=()=>{ state.groups=(state.groups||[]).filter(x=>x.id!==id); save(); render(); closeDrawer(); toast('Группа удалена'); };
  });
}
function addNodePicker(){
  openDrawer('＋ Добавить агента',`<div class="field"><label>Готовая роль</label><select id="add-tpl">
    ${TEMPLATES.map((t,i)=>`<option value="${i}">${t.emoji} ${t.name} — ${t.title}</option>`).join('')}
    <option value="custom">⚙️ Произвольный агент</option></select></div>
    <div class="hint">Появится на холсте. Свяжите вручную или «Авто-схема».</div>
    <div class="actions" style="margin-top:16px"><button class="btn ok" id="add-go">Добавить</button></div>`,
    b=>{ b.querySelector('#add-go').onclick=()=>{ const v=b.querySelector('#add-tpl').value;
      const t=v==='custom'?{name:'Новый агент',title:'роль',emoji:'🤖',prompt:'Ты — агент издательства. Опиши свою роль.'}:TEMPLATES[+v];
      state.nodes.push(freshNode(t,canvas.scrollLeft+80,canvas.scrollTop+80)); save(); render(); closeDrawer(); toast('Агент добавлен'); }; });
}

/* ============ ТРЕКЕР СУЩНОСТЕЙ (Item 15) ============ */
function openEntities(){
  // Извлекаем слова с заглавной буквы (4+ символа, 2+ упоминаний) из всех результатов агентов
  const freq={};
  state.nodes.filter(n=>n.output).forEach(n=>{
    const words=n.output.match(/[А-ЯЁ][а-яёА-ЯЁ]{3,}/g)||[];
    words.forEach(w=>{
      if(!freq[w]) freq[w]={count:0,nodes:[]};
      freq[w].count++;
      if(!freq[w].nodes.includes(n.name)) freq[w].nodes.push(n.name);
    });
  });
  const ents=Object.entries(freq).filter(([,v])=>v.count>=2).sort((a,b)=>b[1].count-a[1].count).slice(0,100);
  if(!ents.length){
    openDrawer('🗃 Сущности','<div class="hint" style="color:var(--faint);margin-top:0">Запустите конвейер — сущности извлекаются из результатов агентов. Будут показаны слова с заглавной буквы (2+ упоминаний).</div>');
    return;
  }
  openDrawer('🗃 Сущности',`
    <p class="hint" style="margin-top:0">Персонажи, топонимы, объекты — слова с заглавной буквы, встреченные 2+ раза. Всего уникальных: ${ents.length}.</p>
    <input id="ent-filter" placeholder="Поиск…" style="width:100%;background:var(--panel2);border:1px solid var(--line2);color:var(--txt);border-radius:8px;padding:8px 11px;font-size:13px;margin-bottom:10px">
    <div id="ent-list">${ents.map(([w,v])=>`<div class="histrow" data-ent style="flex-wrap:wrap;gap:4px">
      <b style="min-width:130px">${esc(w)}</b>
      <span style="color:var(--accent2);font-size:11px">${v.count}×</span>
      <span style="color:var(--faint);font-size:11px;flex:1">в: ${v.nodes.slice(0,4).map(esc).join(', ')}</span>
    </div>`).join('')}</div>
  `,b=>{
    b.querySelector('#ent-filter').oninput=ev=>{
      const q=ev.target.value.toLowerCase();
      b.querySelectorAll('[data-ent]').forEach(r=>r.style.display=r.textContent.toLowerCase().includes(q)?'':'none');
    };
  });
}

/* ============ ГАЙД ============ */
function openGuide(){
  openDrawer('? Быстрый гайд',`
    <div class="md">
    <h2>🚀 Быстрый старт</h2>
    <ol style="margin:4px 0 10px 16px;padding:0">
      <li>⚙ Настройки → вставьте API-ключ, выберите модель</li>
      <li>🗂 Шаблоны → выберите пакет (Соло / Рассказ / Роман)</li>
      <li>Заполните <b>название</b>, жанр, аудиторию, бриф в шапке</li>
      <li>▶ Запустить — кнопка слева в шапке</li>
      <li>⬇ Экспорт → скачайте книгу (.md / .docx / .epub)</li>
    </ol>
    <h2>🎛 Холст</h2>
    <ul>
      <li><b>Тяни шапку узла</b> — перемещение</li>
      <li><b>Кружок справа → кружок слева</b> — связать агентов</li>
      <li><b>Клик по связи</b> — задать JS-условие (if/else ветвление)</li>
      <li><b>⊞ Группа</b> — сгруппировать узлы, свернуть блок</li>
    </ul>
    <h2>📖 Библия</h2>
    <p>Канон книги: имена, мир, таймлайн. Автоматически подмешивается в контекст агента. «🪄 Собрать из текста» — архивариус извлечёт факты из готовых результатов.</p>
    <h2>📚 Главы</h2>
    <p>Режим «глава-за-главой»: пайплайн прогоняется последовательно для каждой главы. Контекст накапливается. Экспорт всей книги в .md.</p>
    <h2>⚡ Условные рёбра</h2>
    <p>Кликните по связи → введите JS-выражение с <code>output</code>. Например: <code>output.includes('одобрено')</code>. При <code>false</code> → следующий узел получает статус <b>skip</b>.</p>
    <h2>🔧 Постпроцессор</h2>
    <p>В настройках узла → «Постпроцессор (JS)»: трансформирует вывод до передачи downstream. Пример: <code>return output.trim()</code></p>
    <h2>💡 Горячие клавиши</h2>
    <ul><li><b>Esc</b> — закрыть панель</li><li><b>Авто-схема</b> — выстроить узлы в цепочку</li></ul>
    </div>
  `);
}

/* ============ ГЛАВА-ЗА-ГЛАВОЙ ============ */
function openChapters(){
  const chs=state.chapters||[];
  const rows=chs.map((ch,i)=>`<div class="bible-row" data-chid="${ch.id}" style="align-items:center">
    <input class="bk" value="${esc(ch.title)}" placeholder="Название главы ${i+1}">
    <textarea class="bt" rows="2" placeholder="Задача / краткое содержание (необязательно)">${esc(ch.brief||'')}</textarea>
    <button class="icon-btn" data-delch="${ch.id}">✕</button></div>`).join('');
  const bookDone=(state.chapterBook||[]).length;
  openDrawer('📚 Главы',`
    <p class="hint" style="margin-top:0">Пайплайн прогоняется по каждой главе последовательно. Библия и контекст накапливаются между главами.</p>
    <div id="ch-list">${rows||'<div class="hint" style="color:var(--faint)">Глав пока нет.</div>'}</div>
    <div class="actions" style="margin-top:10px">
      <button class="btn ghost" id="ch-add">＋ Глава</button>
      <button class="btn ok" id="ch-save">Сохранить список</button>
    </div>
    ${bookDone?`<div class="section-label">Результаты (${bookDone} глав)</div>
    <div style="font-size:12px;color:var(--dim);margin-bottom:8px">${(state.chapterBook||[]).map(c=>`${c.num}. ${esc(c.title)}`).join(' · ')}</div>
    <div class="actions"><button class="btn ghost" id="ch-export">📕 Экспорт книги по главам (.md)</button>
      <button class="btn danger sm" id="ch-clear">Очистить результаты</button></div>`:''}
    <div class="actions" style="margin-top:16px">
      <button class="btn primary" id="ch-run" ${chs.length?'':'disabled'}>▶ Запустить все главы (${chs.length})</button>
    </div>
  `,b=>{
    b.querySelector('#ch-add').onclick=()=>{ if(!state.chapters) state.chapters=[]; state.chapters.push({id:uid(),title:'Глава '+(state.chapters.length+1),brief:''}); save(); openChapters(); };
    b.querySelectorAll('[data-delch]').forEach(x=>x.onclick=()=>{ state.chapters=state.chapters.filter(c=>c.id!==x.dataset.delch); save(); openChapters(); });
    b.querySelector('#ch-save').onclick=()=>{ b.querySelectorAll('[data-chid]').forEach(r=>{ const c=(state.chapters||[]).find(x=>x.id===r.dataset.chid); if(c){ c.title=r.querySelector('.bk').value.trim()||c.title; c.brief=r.querySelector('.bt').value.trim(); } }); save(); toast('Список глав сохранён','ok'); };
    if(bookDone){ b.querySelector('#ch-export').onclick=exportChapterBook; b.querySelector('#ch-clear').onclick=()=>{ state.chapterBook=[]; save(); openChapters(); }; }
    b.querySelector('#ch-run').onclick=()=>{
      b.querySelectorAll('[data-chid]').forEach(r=>{ const c=(state.chapters||[]).find(x=>x.id===r.dataset.chid); if(c){ c.title=r.querySelector('.bk').value.trim()||c.title; c.brief=r.querySelector('.bt').value.trim(); } });
      save(); closeDrawer(); runChapterMode();
    };
  });
}
async function runChapterMode(){
  const chs=state.chapters||[]; if(!chs.length){ toast('Нет глав','err'); return; }
  if(!hasKey()){ toast('Нужен API-ключ','err'); return; }
  if(running){ toast('Пайплайн уже запущен','err'); return; }
  state.chapterBook=[]; const prevSummaries=[];
  for(let i=0;i<chs.length;i++){
    const ch=chs[i];
    toast(`📖 Глава ${i+1}/${chs.length}: «${ch.title}»`);
    logRow('Главы','ok',`Старт главы ${i+1}: «${ch.title}»`);
    state.nodes.forEach(n=>{ n.status='idle'; n.output=''; n.error=''; n.approved=false; n.cacheHash=''; });
    state.chapterCtx={num:i+1,title:ch.title,brief:ch.brief||'',prevSummary:prevSummaries.slice(-3).join('\n')};
    save(); render();
    runPipeline(false);
    await new Promise(res=>{ const poll=setInterval(()=>{ if(!running){ clearInterval(poll); res(); } },250); });
    const outputs={}; state.nodes.filter(n=>n.output).forEach(n=>{ outputs[n.id]={name:n.name,output:n.output}; });
    state.chapterBook.push({id:uid(),chapterId:ch.id,title:ch.title,num:i+1,outputs,t:Date.now()});
    const sm=state.nodes.filter(n=>n.output).map(n=>`${n.name}: ${(n.output||'').slice(0,300)}`).join(' | ');
    prevSummaries.push(`Глава ${i+1} «${ch.title}»: ${sm.slice(0,500)}`);
    save();
  }
  state.chapterCtx=null; save(); render();
  toast(`Все ${chs.length} глав готовы ✓`,'ok');
  logRow('Главы','ok',`Завершено: ${chs.length} глав`);
}
function exportChapterBook(){
  const book=state.chapterBook||[]; if(!book.length){ toast('Нет результатов по главам','err'); return; }
  const pr=state.project;
  let md=`# ${typo(pr.title||'Без названия')}\n\n> Раскрытие: ${pr.disclosure||''}\n\nЖанр: ${pr.genre} · Аудитория: ${pr.audience}\n\n`;
  book.forEach(ch=>{
    md+=`---\n\n## Глава ${ch.num}: ${typo(ch.title)}\n\n`;
    Object.values(ch.outputs).forEach(o=>{ md+=`### ${esc(o.name)}\n\n${typo(o.output)}\n\n`; });
  });
  md+=`\n${KDP_CHECKLIST}`;
  download((pr.title||'book')+'-chapters.md',md);
  toast('Книга по главам экспортирована','ok');
}

/* ============ БАЗЛАЙН / РЕГРЕСС (Item 30) ============ */
function saveBaseline(){
  const active=state.nodes.filter(n=>n.output);
  if(!active.length){ toast('Нет результатов для базлайна','err'); return; }
  state.baseline={t:Date.now(),nodes:{}};
  active.forEach(n=>{ state.baseline.nodes[n.id]={name:n.name,output:n.output,len:n.output.length,
    words:(n.output.match(/\S+/g)||[]).length}; });
  save(); toast(`Базлайн сохранён: ${active.length} агентов`,'ok');
}
function openBaselineCompare(){
  const bl=state.baseline;
  if(!bl){ toast('Нет базлайна — сначала сохраните','err'); return; }
  const rows=Object.entries(bl.nodes).map(([id,bln])=>{
    const cur=node(id);
    if(!cur||!cur.output) return `<div class="histrow"><b>${esc(bln.name)}</b> <span style="color:var(--faint);font-size:11px">— нет нового результата</span></div>`;
    const delta=cur.output.length-bln.len;
    const pct=bln.len>0?Math.round(delta/bln.len*100):0;
    const wc=(cur.output.match(/\S+/g)||[]).length;
    const dw=wc-bln.words;
    const col=delta>0?'var(--ok)':delta<0?'var(--err)':'var(--faint)';
    const sign=delta>=0?'+':'';
    return `<div class="histrow" style="flex-wrap:wrap;gap:4px">
      <b style="min-width:130px">${esc(cur.name)}</b>
      <span style="color:${col};font-size:11px">${sign}${delta} симв. (${sign}${pct}%)</span>
      <span style="color:var(--faint);font-size:11px">${sign}${dw} слов · было ${bln.len}→стало ${cur.output.length}</span>
    </div>`;
  }).join('');
  const newNodes=state.nodes.filter(n=>n.output&&!bl.nodes[n.id]);
  const newRows=newNodes.map(n=>`<div class="histrow"><b>${esc(n.name)}</b> <span style="color:var(--accent2);font-size:11px">— новый агент (${n.output.length} симв.)</span></div>`).join('');
  openDrawer('📊 Сравнение с базлайном',`
    <p class="hint" style="margin-top:0">Базлайн сохранён: ${new Date(bl.t).toLocaleString('ru-RU')}</p>
    <div class="section-label">Изменения по агентам</div>
    ${rows||'<div class="hint" style="color:var(--faint)">Нет данных для сравнения.</div>'}
    ${newRows?`<div class="section-label">Новые агенты</div>${newRows}`:''}
  `);
}

/* ============ ПЕРЕКЛЮЧЕНИЕ ВИДА (Холст / Книга / Просто) ============ */
function switchView(view){
  _currentView=view;
  const canvas=$('#canvas'), reader=$('#reader');
  const simp=$('#simplified');
  const tabC=$('#tab-canvas'), tabR=$('#tab-reader'), tabS=$('#tab-simple');
  if(canvas) canvas.style.display='none';
  if(reader) reader.style.display='none';
  if(simp)   simp.style.display='none';
  [tabC,tabR,tabS].forEach(t=>t?.classList.remove('active'));
  if(view==='reader'){
    if(reader) reader.style.display='block';
    tabR?.classList.add('active');
    renderReader();
  } else if(view==='simple'){
    if(simp) simp.style.display='';
    tabS?.classList.add('active');
    initSimplifiedMode();
  } else {
    if(canvas) canvas.style.display='';
    tabC?.classList.add('active');
  }
}

function renderReader(){
  const pr=state.project;
  const order=topoOrder().map(id=>node(id)).filter(n=>n&&n.output);
  const wordCount=order.reduce((s,n)=>s+(n.output.match(/\S+/g)||[]).length,0);
  let html=`<div style="margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid var(--line)">
    <h1 style="font-size:24px;font-weight:800;margin:0 0 6px;color:var(--txt)">${esc(pr.title||'Без названия')}</h1>
    ${pr.genre?`<div style="color:var(--dim);font-size:13px">${esc(pr.genre)}${pr.audience?' · '+esc(pr.audience):''}</div>`:''}
    <div style="color:var(--faint);font-size:12px;margin-top:6px">
      ~${wordCount.toLocaleString('ru-RU')} слов · ${order.length} разделов · ${money(projectCost())}
    </div>
    <div class="actions" style="margin-top:14px">
      <button class="btn ok sm" onclick="exportDocx()">📄 Скачать Word</button>
      <button class="btn ok sm" onclick="exportEpub()">📗 Скачать EPUB</button>
      <button class="btn ghost sm" onclick="exportBook()">📕 Скачать .md</button>
    </div>
  </div>`;
  if(!order.length){
    html+=`<div style="text-align:center;padding:60px 0;color:var(--faint)">
      <div style="font-size:48px;margin-bottom:14px">✍️</div>
      <div style="font-size:16px;font-weight:700;color:var(--dim);margin-bottom:8px">Книга ещё не написана</div>
      <div style="font-size:13px">Нажмите <strong style="color:var(--txt)">▶ Запустить</strong> — агенты создадут текст, и он появится здесь</div>
    </div>`;
  } else {
    order.forEach(n=>{
      const words=(n.output.match(/\S+/g)||[]).length;
      html+=`<div style="margin-bottom:40px">
        <div style="display:flex;align-items:center;gap:9px;margin-bottom:12px;padding-bottom:9px;border-bottom:1px solid var(--line)">
          <span style="font-size:20px">${n.emoji}</span>
          <div>
            <div style="font-weight:700;font-size:14px;color:var(--txt)">${esc(n.name)}</div>
            <div style="font-size:11px;color:var(--faint)">${esc(n.role)} · ~${words.toLocaleString('ru-RU')} слов</div>
          </div>
        </div>
        <div class="reader-text">${md2html(n.output)}</div>
      </div>`;
    });
  }
  $('#reader-inner').innerHTML=html;
}

/* ============ БАННЕР ЗАВЕРШЕНИЯ ============ */
function showCompletionBanner(){
  const done=state.nodes.filter(n=>n.output);
  if(!done.length) return;
  const words=done.reduce((s,n)=>s+(n.output.match(/\S+/g)||[]).length,0);
  $('#cb-stats').textContent=`${done.length} агентов · ~${words.toLocaleString('ru-RU')} слов · ${money(projectCost())}`;
  $('#completion-banner').style.display='flex';
}
function hideCompletionBanner(){ const b=$('#completion-banner'); if(b) b.style.display='none'; }

/* ============ ОНБОРДИНГ ============ */
function showOnboarding(){
  if(document.getElementById('onboarding-overlay')) return;
  const el=document.createElement('div');
  el.className='onboarding-overlay'; el.id='onboarding-overlay';
  el.innerHTML=`<div class="onboarding-card">
    <div class="onboarding-title">📚 <span>ИИ-Издательство</span></div>
    <p class="onboarding-sub">Настройте за 30 секунд — и начните создавать свою книгу</p>
    <div class="onboarding-step">
      <label>1. API-ключ и провайдер</label>
      <div style="display:flex;gap:8px">
        <input id="ob-key" type="password" placeholder="sk-… вставьте ключ" style="flex:1;background:var(--panel2);border:1px solid var(--line2);color:var(--txt);border-radius:9px;padding:10px 12px;font-size:13.5px;font-family:inherit">
        <select id="ob-preset" style="background:var(--panel2);border:1px solid var(--line2);color:var(--txt);border-radius:9px;padding:9px 10px;font-size:12.5px;font-family:inherit;flex-shrink:0">
          <option value="">Провайдер…</option>
          <option value="https://api.deepseek.com|deepseek-chat">DeepSeek (~$0.01/кн.)</option>
          <option value="https://api.openai.com/v1|gpt-4o-mini">OpenAI GPT-4o mini</option>
          <option value="https://openrouter.ai/api/v1|deepseek/deepseek-chat">OpenRouter</option>
        </select>
      </div>
      <div class="onboarding-hint">Ключ хранится только в браузере, уходит на локальный прокси — не в сторонние сервисы.</div>
    </div>
    <div class="onboarding-step">
      <label>2. Что создаём?</label>
      <div class="onboarding-tpls">
        <button class="onboarding-tpl selected" data-tpl="story">📖 Рассказ</button>
        <button class="onboarding-tpl" data-tpl="novel">✍️ Роман</button>
        <button class="onboarding-tpl" data-tpl="nonfic">📚 Нон-фикшн</button>
        <button class="onboarding-tpl" data-tpl="solo">🤖 Соло</button>
      </div>
      <div class="onboarding-hint">Загрузит готовую цепочку агентов. Можно изменить после.</div>
    </div>
    <div class="onboarding-actions">
      <button class="btn ok" id="ob-start" style="flex:1">▶ Начать создавать книгу</button>
      <button class="btn ghost" id="ob-skip">Пропустить</button>
    </div>
  </div>`;
  document.body.appendChild(el);

  el.querySelector('#ob-preset').onchange=ev=>{
    if(!ev.target.value) return;
    const [url,model]=ev.target.value.split('|');
    state.global.baseURL=url; state.global.model=model;
  };
  let selectedTpl='story';
  el.querySelectorAll('.onboarding-tpl').forEach(btn=>btn.onclick=()=>{
    el.querySelectorAll('.onboarding-tpl').forEach(b=>b.classList.remove('selected'));
    btn.classList.add('selected'); selectedTpl=btn.dataset.tpl;
  });
  const dismiss=()=>{ el.remove(); state.onboarded=true; save(); };
  el.querySelector('#ob-skip').onclick=dismiss;
  el.querySelector('#ob-start').onclick=()=>{
    const key=el.querySelector('#ob-key').value.trim();
    if(!key){ const ki=el.querySelector('#ob-key'); ki.style.borderColor='var(--err)'; ki.focus(); return; }
    state.global.apiKey=key;
    const t=PROJECT_TPLS[selectedTpl];
    if(t){
      const tpls=t.roles.map(r=>TEMPLATES.find(x=>x.role===r)).filter(Boolean);
      state.nodes=tpls.map((tp,i)=>freshNode(tp,60+(i%3)*260,40+Math.floor(i/3)*190));
      state.edges=[]; for(let i=0;i<state.nodes.length-1;i++) state.edges.push({id:uid(),from:state.nodes[i].id,to:state.nodes[i+1].id});
      state.project.genre=t.genre; state.project.brief=t.brief;
    }
    dismiss(); render();
    toast('Готово! Укажите название книги и нажмите ▶ Запустить','ok');
  };
}
function showOnboardingIfNeeded(){ if(!hasKey()&&!state.onboarded) showOnboarding(); }

render();
// Кнопки баннера завершения
$('#cb-read').onclick=()=>switchView('reader');
$('#cb-docx').onclick=exportDocx;
$('#cb-epub').onclick=exportEpub;
$('#cb-dismiss').onclick=hideCompletionBanner;
showOnboardingIfNeeded();
// Меню «⋯ Ещё»
const moreBtn=$('#more-btn'), moreDrop=$('#more-dropdown');
if(moreBtn&&moreDrop){
  moreBtn.onclick=e=>{ e.stopPropagation(); moreDrop.classList.toggle('show'); };
  document.addEventListener('click',()=>moreDrop.classList.remove('show'));
  moreDrop.addEventListener('click',e=>{ if(e.target.closest('[data-action]')) moreDrop.classList.remove('show'); });
}

/* ═══════════════════════════════════════════════════
   CANVAS TOOLBAR — special node types + toolbar logic
═══════════════════════════════════════════════════ */

/* ── Spec node factory ── */
function freshSpecNode(type,x,y){
  const s=SPEC_NODES[type]; if(!s) return null;
  return {id:uid(), nodeType:type, name:s.name, role:s.desc, emoji:s.emoji,
    x:ctbSnap(x), y:ctbSnap(y), useGlobal:true, baseURL:'', apiKey:'', model:'',
    temperature:0.7, requireApproval:!!s.requireApproval, approved:false,
    output:'', summary:'', status:'idle', error:'', cacheHash:'',
    tokensIn:0, tokensOut:0, ms:0, outputSchema:'', postProcess:'',
    promptHistory:[], prompt:s.prompt||''};
}

function ctbSnap(v){ return _snapGrid ? Math.round(v/26)*26 : v; }

/* ── Toolbar state sync ── */
function ctbSync(){
  const ctb=$('#ctb'); if(!ctb) return;
  ctb.querySelectorAll('[data-tool]').forEach(btn=>{
    const t=btn.dataset.tool;
    btn.classList.toggle('active',
      t===_activeTool ||
      (t==='add'&&_activeTool==='add') ||
      (t==='snap'&&_snapGrid) ||
      (t==='minimap'&&_showMinimap));
    if(t==='snap')    btn.classList.toggle('ctb-snap-on',_snapGrid);
    if(t==='minimap') btn.classList.toggle('ctb-mini-on',_showMinimap);
  });
  const zl=$('#ctb-zoom-lbl'); if(zl) zl.childNodes[0].textContent=_zoomLevel+'%';
}

/* ── Set active tool ── */
function ctbSetTool(t){
  _activeTool=t;
  ctbSync();
  const cv=$('#canvas');
  if(cv) cv.classList.toggle('ctb-placing', t.startsWith('place-'));
  const hint=$('#ctb-place-hint');
  if(hint){
    if(t.startsWith('place-')){
      const type=t.replace('place-','');
      const s=SPEC_NODES[type]; if(s) hint.textContent=`Кликните на доске — поставить «${s.name}»`;
      hint.classList.add('show');
    } else hint.classList.remove('show');
  }
  if(t!=='add') ctbClosePalette();
}

/* ── Main action dispatcher ── */
function ctbAction(tool){
  switch(tool){
    case 'select': case 'pan': ctbSetTool(tool); break;
    case 'add': ctbTogglePalette(); break;
    case 'add-branch':    ctbSetTool('place-branch');    break;
    case 'add-condition': ctbSetTool('place-condition'); break;
    case 'add-loop':      ctbSetTool('place-loop');      break;
    case 'add-gate':      ctbSetTool('place-gate');      break;
    case 'add-note':      ctbSetTool('place-note');      break;
    case 'add-merge':     ctbSetTool('place-merge');     break;
    case 'layout-chain':  ctbLayoutChain(); break;
    case 'layout-tree':   ctbLayoutTree();  break;
    case 'fit-screen':    ctbFitScreen();   break;
    case 'snap':
      _snapGrid=!_snapGrid; ctbSync();
      toast(_snapGrid?'⊞ Привязка к сетке':'Привязка отключена');
      break;
    case 'zoom-in':    ctbZoom(1.2);  break;
    case 'zoom-out':   ctbZoom(1/1.2); break;
    case 'zoom-reset': ctbZoomReset(); break;
    case 'minimap':
      _showMinimap=!_showMinimap;
      const mm=$('#minimap-wrap');
      if(mm) mm.style.display=_showMinimap?'block':'none';
      if(_showMinimap) renderMinimap();
      ctbSync();
      break;
  }
}

/* ── Canvas click → place node ── */
canvas.addEventListener('click',e=>{
  if(!_activeTool.startsWith('place-')) return;
  const type=_activeTool.replace('place-','');
  const pt=canvasPoint(e);
  const n=freshSpecNode(type, pt.x-106, pt.y-60);
  if(n){ state.nodes.push(n); save(); render(); }
  ctbSetTool('select');
  e.stopPropagation();
});

/* ── Layout: chain ── */
function ctbLayoutChain(){
  if(!state.nodes.length) return;
  const visited=new Set(), order=[];
  const topo=id=>{ if(visited.has(id))return; visited.add(id);
    state.edges.filter(e=>e.to===id).forEach(e=>topo(e.from)); order.push(id); };
  state.nodes.forEach(n=>topo(n.id));
  order.forEach((id,i)=>{ const n=node(id); if(n){n.x=60+i*280;n.y=120;} });
  save(); render(); toast('⤢ Цепочка выстроена','ok');
}

/* ── Layout: tree ── */
function ctbLayoutTree(){
  if(!state.nodes.length){ return ctbLayoutChain(); }
  const hasIn=new Set(state.edges.map(e=>e.to));
  const roots=state.nodes.filter(n=>!hasIn.has(n.id));
  if(!roots.length) return ctbLayoutChain();
  const levels={}, placed=new Set();
  const q=roots.map(r=>({id:r.id,lvl:0}));
  while(q.length){
    const {id,lvl}=q.shift(); if(placed.has(id)) continue;
    placed.add(id);
    if(!levels[lvl]) levels[lvl]=[];
    levels[lvl].push(id);
    state.edges.filter(e=>e.from===id).forEach(e=>{ if(!placed.has(e.to)) q.push({id:e.to,lvl:lvl+1}); });
  }
  // Place remaining nodes (disconnected)
  state.nodes.forEach(n=>{ if(!placed.has(n.id)){ if(!levels[0]) levels[0]=[]; levels[0].push(n.id); } });
  Object.entries(levels).forEach(([lvl,ids])=>{
    const xPos=60+parseInt(lvl)*290;
    const totalH=ids.length*190, startY=Math.max(40,(600-totalH)/2);
    ids.forEach((id,i)=>{ const n=node(id); if(n){n.x=xPos; n.y=startY+i*190;} });
  });
  save(); render(); toast('⊤ Дерево готово','ok');
}

/* ── Fit screen ── */
function ctbFitScreen(){
  if(!state.nodes.length) return;
  const cv=$('#canvas'); if(!cv) return;
  const vw=cv.clientWidth-120, vh=cv.clientHeight-80;
  const minX=Math.min(...state.nodes.map(n=>n.x));
  const minY=Math.min(...state.nodes.map(n=>n.y));
  const maxX=Math.max(...state.nodes.map(n=>n.x+212));
  const maxY=Math.max(...state.nodes.map(n=>n.y+200));
  const cw=maxX-minX, ch=maxY-minY;
  if(cw<=0||ch<=0) return;
  const scale=Math.min(1, vw/cw, vh/ch);
  _zoomLevel=Math.round(scale*100);
  state.nodes.forEach(n=>{ n.x=(n.x-minX)*scale+60; n.y=(n.y-minY)*scale+40; });
  save(); render(); cv.scrollTo(0,0); ctbSync();
  toast('⊙ Вместил всё на экран');
}

/* ── Zoom (scales node coordinates) ── */
function ctbZoom(factor){
  _zoomLevel=Math.round(Math.max(25,Math.min(300,_zoomLevel*factor)));
  if(!state.nodes.length){ ctbSync(); return; }
  const cx=state.nodes.reduce((s,n)=>s+n.x+106,0)/state.nodes.length;
  const cy=state.nodes.reduce((s,n)=>s+n.y+80,0)/state.nodes.length;
  state.nodes.forEach(n=>{ n.x=Math.max(0,cx+(n.x+106-cx)*factor-106); n.y=Math.max(0,cy+(n.y+80-cy)*factor-80); });
  save(); render(); ctbSync();
}
function ctbZoomReset(){ ctbZoom((100/_zoomLevel)); _zoomLevel=100; ctbSync(); }

/* ── Palette ── */
function ctbTogglePalette(){
  const pal=$('#ctb-palette'); if(!pal) return;
  if(pal.classList.contains('show')) ctbClosePalette();
  else ctbOpenPalette();
}
function ctbClosePalette(){ $('#ctb-palette')?.classList.remove('show'); }
function ctbOpenPalette(){
  const pal=$('#ctb-palette'); if(!pal) return;
  // Build palette HTML
  let h=`<div class="ctb-pal-hdr"><b>Палитра</b><button class="icon-btn" id="pal-x">✕</button></div>
    <p class="ctb-pal-hint">Нажмите или перетащите на доску</p>
    <div class="ctb-pal-sec">🤖 Агенты</div>
    <div class="ctb-pal-grid">`;
  TEMPLATES.forEach(t=>{
    h+=`<div class="ctb-pal-item" data-agent="${esc(t.name)}" title="${esc(t.title)}">
      <span class="ctb-pal-emoji">${t.emoji}</span>
      <span class="ctb-pal-name">${esc(t.name)}</span>
    </div>`;
  });
  h+=`</div><div class="ctb-pal-sec">⚙ Спец. узлы</div><div class="ctb-pal-grid">`;
  Object.entries(SPEC_NODES).forEach(([type,s])=>{
    h+=`<div class="ctb-pal-item" data-spectype="${type}" title="${esc(s.desc)}" style="border-color:${s.color}33">
      <span class="ctb-pal-emoji">${s.emoji}</span>
      <span class="ctb-pal-name" style="color:${s.color}">${s.name}</span>
    </div>`;
  });
  h+=`</div>`;
  pal.innerHTML=h;
  pal.classList.add('show');

  $('#pal-x')?.addEventListener('click',()=>ctbClosePalette());

  // Click to add at canvas center
  pal.querySelectorAll('.ctb-pal-item').forEach(item=>{
    item.addEventListener('click',()=>{
      const cv=$('#canvas');
      const cx=(cv?.scrollLeft||0)+(cv?.clientWidth||800)/2-106;
      const cy=(cv?.scrollTop||0)+(cv?.clientHeight||600)/2-80;
      if(item.dataset.spectype){
        const n=freshSpecNode(item.dataset.spectype,cx,cy);
        if(n){ state.nodes.push(n); save(); render(); toast(`${SPEC_NODES[item.dataset.spectype].emoji} «${SPEC_NODES[item.dataset.spectype].name}» добавлен`,'ok'); }
      } else if(item.dataset.agent){
        const tpl=TEMPLATES.find(t=>t.name===item.dataset.agent);
        if(tpl){ const n=freshNode(tpl,ctbSnap(cx),ctbSnap(cy)); state.nodes.push(n); save(); render(); toast(`${tpl.emoji} «${tpl.name}» добавлен`,'ok'); }
      }
      ctbClosePalette();
    });
  });

  // Drag to canvas
  ctbInitDrag(pal);
}

/* ── Drag-to-canvas from palette ── */
function ctbInitDrag(pal){
  let ghost=null, dragData=null;
  pal.querySelectorAll('.ctb-pal-item').forEach(item=>{
    item.addEventListener('mousedown',e=>{
      if(e.button!==0) return;
      dragData={agent:item.dataset.agent, spectype:item.dataset.spectype,
        emoji:item.querySelector('.ctb-pal-emoji')?.textContent||'',
        name:item.querySelector('.ctb-pal-name')?.textContent||''};
      ghost=document.createElement('div');
      ghost.className='ctb-drag-ghost';
      ghost.innerHTML=`${dragData.emoji} ${esc(dragData.name)}`;
      document.body.appendChild(ghost);
      moveGhost(e);
      e.preventDefault(); e.stopPropagation();
    });
  });
  const moveGhost=e=>{ if(ghost){ ghost.style.left=(e.clientX+12)+'px'; ghost.style.top=(e.clientY-20)+'px'; } };
  const _mm=e=>moveGhost(e);
  const _mu=e=>{
    if(ghost){ ghost.remove(); ghost=null; }
    if(!dragData) return; dragData=null;
    const cv=$('#canvas'); if(!cv) return;
    const r=cv.getBoundingClientRect();
    if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom) return;
    const x=e.clientX-r.left+cv.scrollLeft-106;
    const y=e.clientY-r.top+cv.scrollTop-60;
    const dd=dragData||{};
    if(dd.spectype){
      const n=freshSpecNode(dd.spectype,x,y); if(n){ state.nodes.push(n); save(); render(); toast(`${SPEC_NODES[dd.spectype].emoji} «${SPEC_NODES[dd.spectype].name}» добавлен`,'ok'); }
    } else if(dd.agent){
      const tpl=TEMPLATES.find(t=>t.name===dd.agent);
      if(tpl){ const n=freshNode(tpl,ctbSnap(x),ctbSnap(y)); state.nodes.push(n); save(); render(); toast(`${tpl.emoji} «${tpl.name}» добавлен`,'ok'); }
    }
    ctbClosePalette();
  };
  // Store handlers so they can be cleaned up; reuse global ones
  if(!window._ctbDragHandlers){
    window._ctbDragHandlers=true;
    document.addEventListener('mousemove',e=>{ if(ghost) moveGhost(e); });
    document.addEventListener('mouseup',e=>{ if(ghost){ ghost.remove(); ghost=null; }
      if(!dragData) return;
      const cv=$('#canvas'); if(!cv){ dragData=null; return; }
      const r=cv.getBoundingClientRect();
      if(e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom){
        const x=e.clientX-r.left+cv.scrollLeft-106;
        const y=e.clientY-r.top+cv.scrollTop-60;
        const dd=dragData; dragData=null;
        if(dd.spectype){
          const n=freshSpecNode(dd.spectype,x,y); if(n){ state.nodes.push(n); save(); render(); toast(`${SPEC_NODES[dd.spectype].emoji} «${SPEC_NODES[dd.spectype].name}» добавлен`,'ok'); }
        } else if(dd.agent){
          const tpl=TEMPLATES.find(t=>t.name===dd.agent);
          if(tpl){ const n=freshNode(tpl,ctbSnap(x),ctbSnap(y)); state.nodes.push(n); save(); render(); toast(`${tpl.emoji} «${tpl.name}» добавлен`,'ok'); }
        }
        ctbClosePalette();
      } else { dragData=null; }
    });
  }
}

/* ── Minimap ── */
function renderMinimap(){
  const cv=document.getElementById('minimap-canvas'); if(!cv||!state.nodes.length) return;
  const ctx=cv.getContext('2d'); const W=150,H=96;
  cv.width=W; cv.height=H;
  ctx.clearRect(0,0,W,H);
  const minX=Math.min(...state.nodes.map(n=>n.x));
  const minY=Math.min(...state.nodes.map(n=>n.y));
  const maxX=Math.max(...state.nodes.map(n=>n.x+212));
  const maxY=Math.max(...state.nodes.map(n=>n.y+190));
  const scale=Math.min((W-8)/Math.max(1,maxX-minX),(H-8)/Math.max(1,maxY-minY));
  const tx=v=>4+(v-minX)*scale, ty=v=>4+(v-minY)*scale;
  // Edges
  ctx.strokeStyle='rgba(74,82,128,.45)'; ctx.lineWidth=.8;
  state.edges.forEach(e=>{ const f=node(e.from),t=node(e.to); if(!f||!t) return;
    ctx.beginPath(); ctx.moveTo(tx(f.x+106),ty(f.y+15)); ctx.lineTo(tx(t.x+106),ty(t.y)); ctx.stroke(); });
  // Nodes
  state.nodes.forEach(n=>{
    const nx=tx(n.x),ny=ty(n.y),nw=Math.max(4,212*scale),nh=Math.max(3,28*scale);
    let col='#1f2331';
    if(n.status==='running') col='#60a5fa';
    else if(n.status==='done') col='#34d399';
    else if(n.status==='error') col='#f87171';
    else if(n.nodeType) col=SPEC_NODES[n.nodeType]?.color||col;
    ctx.fillStyle=col;
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(nx,ny,nw,nh,2); else ctx.rect(nx,ny,nw,nh);
    ctx.fill();
  });
}

/* ── Toolbar init ── */
function initCtb(){
  const ctb=$('#ctb'); if(!ctb) return;
  ctb.addEventListener('click',e=>{
    const btn=e.target.closest('[data-tool]'); if(!btn) return;
    e.stopPropagation(); ctbAction(btn.dataset.tool);
  });
  // Placement hint div
  if(!$('#ctb-place-hint')){
    const hint=document.createElement('div');
    hint.className='ctb-place-hint'; hint.id='ctb-place-hint';
    document.body.appendChild(hint);
  }
  // Close palette on outside click
  document.addEventListener('click',e=>{
    const pal=$('#ctb-palette');
    if(pal?.classList.contains('show')&&!pal.contains(e.target)&&!e.target.closest('[data-tool="add"]'))
      ctbClosePalette();
  });
  // Escape = select tool
  document.addEventListener('keydown',e=>{
    if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
    if(e.key==='Escape'&&_activeTool!=='select') ctbSetTool('select');
    if(e.key==='v'||e.key==='V') ctbSetTool('select');
    if(e.key==='h'||e.key==='H') ctbSetTool('pan');
    if(e.key==='a'||e.key==='A') ctbTogglePalette();
    if(e.key==='b'||e.key==='B') ctbSetTool('place-branch');
    if(e.key==='c'&&!e.ctrlKey&&!e.metaKey) ctbSetTool('place-condition');
    if(e.key==='l'||e.key==='L') ctbSetTool('place-loop');
    if(e.key==='g'||e.key==='G') ctbSetTool('place-gate');
    if(e.key==='n'&&!e.ctrlKey&&!e.metaKey) ctbSetTool('place-note');
    if(e.key==='m'&&!e.ctrlKey&&!e.metaKey) ctbSetTool('place-merge');
    if(e.key==='f'||e.key==='F') ctbFitScreen();
    if(e.key==='+'||e.key==='=') ctbZoom(1.2);
    if(e.key==='-') ctbZoom(1/1.2);
  });
  ctbSync();
}

// Show/hide toolbar based on view
const _origSwitchView=switchView;
switchView=function(view){
  _origSwitchView(view);
  const ctb=$('#ctb');
  if(ctb) ctb.classList.toggle('ctb-visible', view==='canvas');
};

initCtb();
// Show toolbar on canvas view on first load
if(_currentView==='canvas') $('#ctb')?.classList.add('ctb-visible');

// Canvas context menu (right-click on empty canvas)
(function(){
  const _canvasEl = document.querySelector('#canvas');
  if(!_canvasEl) return;
  _canvasEl.addEventListener('contextmenu', e => {
    if(e.target.closest('.node-card,.ctb')) return; // only on empty canvas
    e.preventDefault();
    const old = document.getElementById('_cvs-ctx');
    if(old) old.remove();
    const menu = document.createElement('div');
    menu.id = '_cvs-ctx';
    menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:9999;background:var(--panel2);border:1px solid var(--line2);border-radius:10px;padding:4px;display:flex;flex-direction:column;gap:2px;box-shadow:0 4px 16px rgba(0,0,0,.3);min-width:160px`;
    [
      {label:'⤢ Выровнять узлы', fn:()=>autoLayout()},
      {label:'⊞ Создать группу',  fn:()=>openGroupCreator()},
      {label:'＋ Добавить агента', fn:()=>addNodePicker()},
    ].forEach(item=>{
      const btn=document.createElement('button');
      btn.className='btn ghost';
      btn.style.cssText='width:100%;text-align:left;padding:8px 12px;border-radius:7px;font-size:13px';
      btn.textContent=item.label;
      btn.onclick=()=>{ menu.remove(); item.fn(); };
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    setTimeout(()=>document.addEventListener('click',()=>menu.remove(),{once:true}),0);
  });
})();

// Запуск таймера авто-бэкапа
scheduleBackup();
