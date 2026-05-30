'use strict';

/* ============ ШАБЛОНЫ АГЕНТОВ + ПРОМТЫ ============ */
const TEMPLATES = [
  { role:'scout',  name:'Скаут',        title:'Редактор-аквизитор', emoji:'🔎',
    prompt:'Ты — литературный скаут. Оцени потенциал книги под рынок и аудиторию: вердикт (в производство / доработать / отклонить), главный крючок, целевую полку, риски. Без воды.' },
  { role:'dev',    name:'Структурный редактор', title:'Developmental editor', emoji:'🧭',
    prompt:'Ты — структурный редактор. Улучши композицию: сюжет, арки персонажей, темп, логику. Дай конкретные правки списком и перепиши проблемные места.' },
  { role:'writer', name:'Райтер',       title:'Автор / гострайтер', emoji:'✍️',
    prompt:'Ты — писатель-прозаик. Пиши живой образный текст строго по брифу, жанру и «Библии книги», держи единый голос. Выдавай ТОЛЬКО готовую прозу — без вступлений, без пояснений, без фраз «вот текст» или «как просили». Сразу первая строка произведения.' },
  { role:'line',   name:'Литред',       title:'Литературный редактор', emoji:'🔧',
    prompt:'Ты — литературный редактор. Убирай воду и штампы, усиливай ритм и образность, сохраняй авторский голос. Верни ТОЛЬКО исправленный текст без вступлений, без фраз «вот отредактированный текст» и любых пояснений — сразу первая строка.' },
  { role:'proof',  name:'Корректор',    title:'Proofreader', emoji:'🔍',
    prompt:'Ты — корректор. Исправь орфографию, пунктуацию, грамматику, единообразие оформления. Верни ТОЛЬКО вычитанный текст без вступлений и пояснений — сразу первая строка. Список правок добавь в самом конце после маркера «---ПРАВКИ:».' },
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
  { role:'distill', name:'Дистиллятор', title:'Context compressor', emoji:'🗜️',
    prompt:'Сожми предыдущий текст до 200-300 слов: главные события, ключевые факты о персонажах, открытые сюжетные линии. Формат: маркированный список. Это резюме будет передано следующим агентам.' },
  { role:'fanout', name:'Параллельные главы', title:'Fanout writer', emoji:'🔀',
    prompt:'Ты — писатель. Напиши главу по заданию. Придерживайся стиля и общего сюжета.' },
  {id:'beatsheet',emoji:'🎬',name:'Битовая схема',role:'beatsheet',
    prompt:'Ты — эксперт по структуре «Save The Cat» Блейка Снайдера. Создай детальную битовую схему романа из 15 битов.\n\nДля каждого бита дай:\n- Название и позицию (% от книги)\n- Описание сцены (3–5 предложений)\n- Эмоциональный удар для читателя\n\nБИТЫ:\n1. Открывающий образ (1%) — первая сцена, задаёт тон\n2. Изложение темы (5%) — кто-то озвучивает смысл истории\n3. Установка (1–10%) — мир до перемен, герой в своей «колее»\n4. Катализатор (12%) — удар судьбы, всё меняется\n5. Дискуссия (12–25%) — герой сомневается, нужно ли меняться\n6. Второй акт: начало (25%) — герой принимает вызов\n7. B-история (30%) — побочная линия (любовь, наставник, антагонист)\n8. Веселье и игры (30–55%) — обещание жанра, герой в новом мире\n9. Середина (50%) — ложная победа или ложное поражение\n10. Плохие парни усиливаются (55–75%) — давление нарастает\n11. Всё потеряно (75%) — всё рушится, герой на дне\n12. Тёмная ночь души (75–80%) — кризис, переосмысление\n13. Второй акт: финал (80%) — герой находит решение изнутри\n14. Финал (80–99%) — герой применяет новый подход, побеждает\n15. Финальный образ (99–100%) — зеркало открывающего образа, изменение доказано\n\nИспользуй название книги, жанр и бриф из контекста проекта.'}
];

const PRICES = { // $ за 1M токенов (вход/выход), грубо для оценки
  'deepseek-chat':{in:0.14,out:0.28}, 'deepseek-reasoner':{in:0.55,out:2.19},
  'gpt-4o-mini':{in:0.15,out:0.60}, 'gpt-4o':{in:2.5,out:10},
};
// Оптимальные температуры по роли (эксперты: Writer — творчество, Proofreader/Meta — точность)
const ROLE_TEMPS = {
  'scout':0.8,'dev':0.7,'writer':1.0,'line':0.7,'proof':0.2,
  'continuity':0.3,'factcheck':0.2,'art':0.9,'layout':0.3,'meta':0.1,'mkt':0.8,'logedit':0.3,'distill':0.1,'fanout':1.0,'beatsheet':0.8
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
// Replacer для безопасной сериализации: вырезает векторы и секреты (ключи, токены).
const SECRET_KEYS=new Set(['apiKey','apiKeys','proxyToken','gdriveClientId']);
function safeReplacer(k,v){ if(k==='_vec') return undefined; if(SECRET_KEYS.has(k)) return ''; return v; }
// Оценка условия ребра: JS-выражение с переменной output. Пустая строка = всегда true
function evalCondition(cond,output){
  if(!cond||!cond.trim()) return true;
  try{ return !!new Function('output','return ('+cond+')')(output||''); }
  catch(e){ return false; }
}
// Включать ли вывод этого агента в собранную книгу (по роли).
// true для пишущих/редактирующих прозу ролей; false для служебных (скаут, арт, метаданные и т.п.)
const BOOK_ROLES=new Set(['writer','line','logedit','proof','merge','beatsheet','fanout']);
function defaultIncludeInBook(role){ return BOOK_ROLES.has(role); }
function freshNode(t,x,y){ return { id:uid(), name:t.name, role:t.title, emoji:t.emoji, prompt:t.prompt, promptHistory:[],
  x,y, useGlobal:true, baseURL:'',apiKey:'',model:'',temperature:ROLE_TEMPS[t.role]??1.0, requireApproval:false, approved:false,
  output:'', summary:'', status:'idle', error:'', cacheHash:'', tokensIn:0, tokensOut:0, ms:0, outputSchema:'', postProcess:'', outputVersions:[],
  variants:1, fanoutCount:0, fanoutOutputs:[], collapsed:false, includeInBook:defaultIncludeInBook(t.role), chapterTitle:'', verdictGate:(t.role==='scout') }; }
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
  // #32: минимальный осмысленный старт — Битовая схема → Райтер → Литред.
  // Полный пайплайн новичок получает через выбор шаблона (PROJECT_TPLS).
  const startRoles=['beatsheet','writer','line'];
  const startTpls=startRoles.map(r=>TEMPLATES.find(t=>t.role===r)).filter(Boolean);
  const nodes=startTpls.map((t,i)=>freshNode(t,60+(i%3)*250,40+Math.floor(i/3)*180));
  const edges=[]; for(let i=0;i<nodes.length-1;i++) edges.push({id:uid(),from:nodes[i].id,to:nodes[i+1].id,condition:'',maxRetries:0,_retryCount:0});
  return { _bookId:'',
    project:{title:'',genre:'',audience:'',author:'',brief:'',mode:'write',input:'',disclosure:'Текст подготовлен с использованием ИИ',styleRef:'',stylePassport:'',engagementPatterns:'',styleSourceName:'',styleMix:[],cover:'',isbn:'',annotation:'',bisac:'',series:'',fb2genre:'',concept:{setting:'',characters:[],plotTurns:'',tone:''}},
    styleLibrary:[],
    bible:[], log:[], runs:[], approvals:[], groups:[], chapters:[], chapterBook:[], chapterCtx:null, dailyRuns:{date:'',count:0}, baseline:null, onboarded:false, attention:[],
    userTemplates:[], snippets:[], auxTokens:0, auxCost:0,
    global:{ baseURL:'https://api.deepseek.com', apiKey:'', apiKeys:'', model:'deepseek-chat', temperature:1.0,
      maxContextChars:8000, maxRetries:2, costCapUSD:0, proxyToken:'', autoSummarize:false, autoBibleExtract:false, autoDistill:false, autoEval:false, approvalTimeoutMin:0, fallbackURL:'',
      backupDir:'', autoBackup:true, backupIntervalMin:10, lastBackupTs:0, gdriveClientId:'', gdriveLastBackup:null, banList:'',
      maxConcurrent:3, onErrorPolicy:'continue', judgeModel:'', judgeBaseURL:'', judgeApiKey:'' },
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
      // Deep-merge project: новые поля (stylePassport/engagementPatterns/…) подхватываются старыми проектами
      if(s.project) s.project=Object.assign({},def.project,s.project);
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
    // Транзиентные поля не сериализуем: _vec (TF-IDF), служебные поля петли (Item 25/29),
    // а также #48 lastRequest/lastRawOutput (точный снимок последнего вызова — только для UI).
    const data=JSON.stringify(state,(k,v)=>(k==='_vec'||k==='_bestOutput'||k==='_scoreHistory'||k==='_loopPrev'||k==='lastRequest'||k==='lastRawOutput')?undefined:v);
    if(data.length>4*1024*1024) toast('⚠ Хранилище почти полно ('+Math.round(data.length/1024)+' KB). Очистите журнал или экспортируйте.','warn');
    localStorage.setItem(KEY,data);
    // #BOOKLIB: тихое автосохранение текущей книги в библиотеку (если уже сохранялась).
    autoSyncBook();
  },40);
}

/* ════ БИБЛИОТЕКА КНИГ ═══════════════════════════════════════════════
   Активный проект по-прежнему живёт в localStorage[KEY]. Дополнительно
   BOOKS_KEY хранит массив снимков сохранённых книг:
   {id, title, genre, words, ts, data}  где data = снимок state без
   транзиентных полей и без секретов (тот же replacer что в save() + safeReplacer). */
const BOOKS_KEY='izd_books';
// Транзиентные поля state, которые не сериализуем (синхронно со списком в save()).
const _TRANSIENT=new Set(['_vec','_bestOutput','_scoreHistory','_loopPrev','lastRequest','lastRawOutput']);
function _bookReplacer(k,v){
  if(_TRANSIENT.has(k)) return undefined;
  // secrets → '' (ключи и токены не храним в библиотеке; они в global активного проекта)
  if(SECRET_KEYS.has(k)) return '';
  return v;
}
function loadBooks(){ try{ const a=JSON.parse(localStorage.getItem(BOOKS_KEY)); return Array.isArray(a)?a:[]; }catch{ return []; } }
function saveBooks(arr){ try{ localStorage.setItem(BOOKS_KEY,JSON.stringify(arr)); }catch(e){ toast('⚠ Не удалось сохранить библиотеку: '+String(e.message||e).slice(0,60),'warn'); } }
// Снимок текущего состояния: сериализуем тем же способом что save(), затем парсим обратно.
function snapshotCurrent(){ return JSON.parse(JSON.stringify(state,_bookReplacer)); }
// Подсчёт слов книги по главам (чистая проза).
function _bookWords(){
  try{ return bookNodes().reduce((s,n)=>s+((cleanProse(n)||'').match(/\S+/g)||[]).length,0); }
  catch{ return 0; }
}
// Сохранить текущий проект в библиотеку (создать запись или обновить существующую по _bookId).
// НЕ вызывает save() — чтобы не зациклить автосинк.
function saveCurrentBook(){
  if(!state._bookId) state._bookId=uid();
  const rec={ id:state._bookId, title:(state.project.title||'').trim()||'Без названия',
    genre:(state.project.genre||'').trim(), words:_bookWords(), ts:Date.now(), data:snapshotCurrent() };
  const books=loadBooks();
  const i=books.findIndex(b=>b.id===rec.id);
  if(i>=0) books[i]=rec; else books.push(rec);
  saveBooks(books);
  return rec;
}
// #BOOKLIB: тихий debounce-автосинк из save(). Обновляет запись, только если книга
// уже в библиотеке (есть _bookId И запись существует) ИЛИ есть осмысленный контент.
let _autoSyncTimer=null;
function autoSyncBook(){
  clearTimeout(_autoSyncTimer);
  _autoSyncTimer=setTimeout(()=>{
    if(!state._bookId) return; // ещё не сохранялась вручную — не плодим записи автоматически
    const books=loadBooks();
    if(!books.some(b=>b.id===state._bookId)) return; // запись удалена — не воскрешаем
    saveCurrentBook();
  },800);
}
// Открыть сохранённую книгу (сначала сохраняем текущую, чтобы не потерять).
function openBook(id){
  saveCurrentBook();
  const book=loadBooks().find(b=>b.id===id);
  if(!book){ toast('Книга не найдена','warn'); return; }
  state=Object.assign(defaultState(), book.data);
  state._bookId=id;
  if(state.project) state.project=Object.assign({},defaultState().project,state.project);
  rebuildBibleVecs();
  save(); render(); closeDrawer();
  toast('Открыта книга «'+(book.title||'Без названия')+'»');
}
// Создать новую книгу (текущую сохраняем).
function newBook(){
  saveCurrentBook();
  state=defaultState(); state._bookId=uid();
  rebuildBibleVecs();
  save(); render(); closeDrawer();
  toast('Новая книга создана');
}
// Удалить книгу из библиотеки (без нативного confirm — перерисовываем drawer).
function deleteBook(id){
  const books=loadBooks().filter(b=>b.id!==id);
  saveBooks(books);
  toast('Книга удалена');
  openBookLibrary(); // перерисовать список
}
// Дублировать книгу (новый id, пометка «копия»).
function duplicateBook(id){
  const src=loadBooks().find(b=>b.id===id);
  if(!src) return;
  const copy=JSON.parse(JSON.stringify(src));
  copy.id=uid(); copy.ts=Date.now();
  copy.title=(src.title||'Без названия')+' (копия)';
  if(copy.data) copy.data._bookId=copy.id;
  const books=loadBooks(); books.push(copy); saveBooks(books);
  toast('Книга скопирована');
  openBookLibrary();
}
// Состояние фильтра жанров в drawer (на время жизни drawer).
let _bookFilterGenre='';
function openBookLibrary(){
  const books=loadBooks().slice().sort((a,b)=>(b.ts||0)-(a.ts||0));
  // Список присутствующих жанров для чипов-фильтров.
  const genres=[...new Set(books.map(b=>(b.genre||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
  if(_bookFilterGenre && _bookFilterGenre!=='__all' && !genres.includes(_bookFilterGenre)) _bookFilterGenre='';
  const filterVal=_bookFilterGenre||'__all';
  const shown=books.filter(b=>filterVal==='__all'?true:((b.genre||'').trim()===filterVal));
  const chip=(val,label)=>`<button class="bl-chip${filterVal===val?' active':''}" data-book-filter="${esc(val)}">${esc(label)}</button>`;
  const chips=[chip('__all','Все')].concat(genres.map(g=>chip(g,g))).join('');
  let cards;
  if(!books.length){
    cards=`<div class="bl-empty">Библиотека пуста.<br>Сохраните текущую книгу или создайте новую.</div>`;
  } else if(!shown.length){
    cards=`<div class="bl-empty">Нет книг в жанре «${esc(filterVal)}».</div>`;
  } else {
    cards=shown.map(b=>{
      const cur=(b.id===state._bookId);
      const dt=b.ts?new Date(b.ts).toLocaleString('ru-RU'):'';
      return `<div class="bl-card${cur?' current':''}" data-book-id="${esc(b.id)}">
        <div class="bl-card-main">
          <div class="bl-card-title">${esc(b.title||'Без названия')}${cur?'<span class="bl-cur">● текущая</span>':''}</div>
          <div class="bl-card-meta">
            ${b.genre?`<span class="bl-tag">${esc(b.genre)}</span>`:''}
            <span class="bl-words">~${(b.words||0).toLocaleString('ru-RU')} сл.</span>
            <span class="bl-date">${esc(dt)}</span>
          </div>
        </div>
        <div class="bl-card-acts">
          <button class="btn ok bl-open" data-book-open="${esc(b.id)}"${cur?' disabled':''}>Открыть</button>
          <button class="btn ghost bl-dup" data-book-dup="${esc(b.id)}" title="Дублировать">⧉</button>
          <button class="btn ghost bl-del" data-book-del="${esc(b.id)}" title="Удалить">🗑</button>
        </div>
      </div>`;
    }).join('');
  }
  openDrawer('📚 Мои книги',`
    <div class="bl-top">
      <button class="btn ok" data-book-new>➕ Новая книга</button>
      <button class="btn ghost" data-book-save>💾 Сохранить текущую в библиотеку</button>
    </div>
    ${books.length?`<div class="bl-filters">${chips}</div>`:''}
    <div class="bl-list">${cards}</div>`,
  b=>{
    b.querySelector('[data-book-new]')?.addEventListener('click',newBook);
    b.querySelector('[data-book-save]')?.addEventListener('click',()=>{ saveCurrentBook(); openBookLibrary(); toast('Текущая книга сохранена в библиотеку'); });
    b.querySelectorAll('[data-book-filter]').forEach(el=>el.onclick=()=>{ _bookFilterGenre=el.dataset.bookFilter; openBookLibrary(); });
    b.querySelectorAll('[data-book-open]').forEach(el=>el.onclick=()=>openBook(el.dataset.bookOpen));
    b.querySelectorAll('[data-book-dup]').forEach(el=>el.onclick=()=>duplicateBook(el.dataset.bookDup));
    b.querySelectorAll('[data-book-del]').forEach(el=>el.onclick=()=>deleteBook(el.dataset.bookDel));
  });
}

/* ════ BACKUP ════════════════════════════════════════════════════════ */
let _backupTimer=null, _lastBackupHash='';
// #50: устойчивый индикатор надёжности бэкапа
let _backupErrorNotified=false; // одноразовый тост при первой silent-ошибке

/* ── #50: мини-обёртка IndexedDB (без библиотек) ──
   localStorage ограничен ~5МБ и может молча падать на больших проектах;
   дублируем снимок состояния в IndexedDB, который этому лимиту не подвластен. */
const IDB_NAME='izd_backup', IDB_STORE='kv';
let _idbPromise=null;
function _idbOpen(){
  if(_idbPromise) return _idbPromise;
  _idbPromise=new Promise((resolve,reject)=>{
    if(!('indexedDB' in window)) return reject(new Error('IndexedDB недоступен'));
    const req=indexedDB.open(IDB_NAME,1);
    req.onupgradeneeded=()=>{ const db=req.result; if(!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE); };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('open failed'));
  });
  return _idbPromise;
}
function idbSet(key,val){
  return _idbOpen().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(IDB_STORE,'readwrite');
    tx.objectStore(IDB_STORE).put(val,key);
    tx.oncomplete=()=>resolve(true);
    tx.onerror=()=>reject(tx.error||new Error('put failed'));
  }));
}
function idbGet(key){
  return _idbOpen().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(IDB_STORE,'readonly');
    const r=tx.objectStore(IDB_STORE).get(key);
    r.onsuccess=()=>resolve(r.result);
    r.onerror=()=>reject(r.error||new Error('get failed'));
  }));
}

// #50: дублируем снимок в IndexedDB под ключом 'autosave'
async function idbBackupNow(){
  try{
    const data=JSON.stringify(state,safeReplacer);
    await idbSet('autosave',{ts:Date.now(),title:state.project.title||'',data});
    return true;
  }catch(e){ console.warn('idbBackupNow failed',e); return false; }
}

async function autoBackupNow(silent=false){
  const data=JSON.stringify(state,safeReplacer);
  // Дублируем в IndexedDB всегда (быстро, локально, без сети)
  idbBackupNow();
  // Избегаем дублирующих копий при отсутствии изменений
  const hash=data.length+'_'+data.slice(-64);
  if(hash===_lastBackupHash){ if(!silent) toast('Нет изменений с последней копии'); return; }
  try{
    const res=await fetch('/api/backup',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({backupDir:state.global.backupDir||'', state:data})});
    if(!res.ok){ const t=await res.text(); _onBackupFail(silent,'Ошибка бэкапа: '+t.slice(0,80)); return; }
    const j=await res.json();
    _lastBackupHash=hash;
    state.global.lastBackupTs=Date.now();
    _backupErrorNotified=false;
    if(!silent) toast('💾 Копия сохранена: '+j.file,'ok');
    else        logRow('Бэкап','ok',j.file);
    updateBackupState();
  }catch(e){ _onBackupFail(silent,'Бэкап недоступен: '+e.message); }
}
// #50: при ошибке (в т.ч. silent) НЕ молчим — журнал + одноразовый тост + индикатор
function _onBackupFail(silent,msg){
  logRow('Бэкап','error',msg);
  if(!silent){ toast(msg,'err'); }
  else if(!_backupErrorNotified){ _backupErrorNotified=true; toast('⚠ '+msg+' — копии в файл не идут (но дубль в браузере сохранён)','warn'); }
  updateBackupState();
}

// #50: устойчивый индикатор статуса бэкапа в шапке (id=backup-state)
function updateBackupState(){
  const el=$('#backup-state'); if(!el) return;
  if(!state.global.autoBackup){ el.style.display='none'; return; }
  el.style.display='';
  const ts=state.global.lastBackupTs||0;
  const ageMin=ts?(Date.now()-ts)/60000:Infinity;
  if(ageMin>10){
    el.textContent=ts?'⚠ бэкап не идёт':'⚠ нет копий';
    el.className='hint-pill backup-warn';
    el.title=ts?('Последняя успешная копия в файл: '+new Date(ts).toLocaleString('ru-RU')+' (>10 мин назад). Дубль в браузере (IndexedDB) сохраняется.'):'Файловых копий ещё не было. Проверьте папку бэкапа в настройках.';
  } else {
    el.textContent='💾';
    el.className='hint-pill backup-ok';
    el.title='Бэкап работает. Последняя копия: '+new Date(ts).toLocaleString('ru-RU');
  }
}

function scheduleBackup(){
  clearInterval(_backupTimer);
  if(!state.global.autoBackup){ updateBackupState(); return; }
  const ms=Math.max(1,state.global.backupIntervalMin||10)*60*1000;
  _backupTimer=setInterval(()=>autoBackupNow(true), ms);
  updateBackupState();
}
// #50: проверять «свежесть» индикатора раз в минуту, даже без новых бэкапов
setInterval(()=>{ try{ updateBackupState(); }catch(e){} }, 60000);

// #50: при загрузке — если localStorage пуст/повреждён, предложить восстановление из IndexedDB
async function checkIdbRecovery(){
  try{
    const raw=localStorage.getItem(KEY);
    let lsBad=false;
    if(!raw){ lsBad=true; }
    else { try{ const p=JSON.parse(raw); if(!p||!p.nodes) lsBad=true; }catch{ lsBad=true; } }
    if(!lsBad) return;
    const snap=await idbGet('autosave');
    if(!snap||!snap.data) return;
    let parsed; try{ parsed=JSON.parse(snap.data); }catch{ return; }
    if(!parsed||!parsed.nodes) return;
    const when=new Date(snap.ts).toLocaleString('ru-RU');
    if(confirm(`Локальное хранилище пусто или повреждено.\n\nНайдена резервная копия в браузере (IndexedDB) от ${when}`+(snap.title?` — «${snap.title}»`:'')+`.\n\nВосстановить?`)){
      const def=defaultState();
      if(parsed.global) parsed.global=Object.assign({},def.global,parsed.global);
      state=Object.assign(def,parsed);
      rebuildBibleVecs(); save(); render();
      toast('✅ Восстановлено из резервной копии браузера','ok');
    }
  }catch(e){ console.warn('checkIdbRecovery failed',e); }
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

// Item 27: семафор параллелизма — запускает не более limit задач одновременно
async function runWithLimit(tasks, limit){
  limit=Math.max(1,limit|0||1);
  const results=new Array(tasks.length);
  let idx=0;
  async function worker(){
    while(idx<tasks.length){
      const cur=idx++;
      results[cur]=await tasks[cur]();
    }
  }
  const workers=[]; for(let i=0;i<Math.min(limit,tasks.length);i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

// Item 11: пост-проверка стоп-слов. Учитывает словоформы через stem (префиксный матч основы).
function scanBanList(text){
  const raw=(state.global.banList||'').split(/[,\n]/).map(s=>s.trim()).filter(Boolean);
  if(!raw.length||!text) return [];
  const words=(text.toLowerCase().replace(/ё/g,'е').match(/[а-яa-z0-9-]+/gi)||[]);
  const stems=words.map(stem);
  const hits=[];
  for(const ban of raw){
    const banWords=ban.toLowerCase().replace(/ё/g,'е').split(/\s+/).filter(Boolean);
    let count=0;
    if(banWords.length>1){
      // многословная фраза — ищем по подстроке основ
      const low=text.toLowerCase().replace(/ё/g,'е');
      const re=new RegExp(banWords.map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s+'),'gi');
      count=(low.match(re)||[]).length;
    } else {
      const bs=stem(banWords[0]||ban);
      if(bs.length<3) count=words.filter(w=>w===banWords[0]).length;
      else count=stems.filter(s=>s===bs||s.startsWith(bs)).length;
    }
    if(count>0) hits.push({word:ban, count});
  }
  return hits;
}

// ─── Undo/Redo for canvas ───
const _undoStack = [];
const _redoStack = [];
const MAX_UNDO = 20;
function pushUndo(){
  _undoStack.push(JSON.stringify(state.nodes.map(n=>({id:n.id,x:n.x,y:n.y}))));
  _redoStack.length = 0;
  if(_undoStack.length > MAX_UNDO) _undoStack.shift();
}
function undoCanvas(){
  if(!_undoStack.length) return;
  _redoStack.push(JSON.stringify(state.nodes.map(n=>({id:n.id,x:n.x,y:n.y}))));
  JSON.parse(_undoStack.pop()).forEach(s=>{ const n=node(s.id); if(n){n.x=s.x;n.y=s.y;} });
  save(); render();
}
function redoCanvas(){
  if(!_redoStack.length) return;
  _undoStack.push(JSON.stringify(state.nodes.map(n=>({id:n.id,x:n.x,y:n.y}))));
  JSON.parse(_redoStack.pop()).forEach(s=>{ const n=node(s.id); if(n){n.x=s.x;n.y=s.y;} });
  save(); render();
}

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
// #44: Подстановка переменных {{...}} в промте. ctx — словарь значений.
// Поддерживает {{prev.ИмяАгента}} (точка) и кириллицу в именах.
function interpolate(tpl, ctx){
  if(!tpl) return tpl||'';
  return tpl.replace(/\{\{([\w.:а-яА-ЯёЁ]+)\}\}/g, (m, key)=>{
    if(Object.prototype.hasOwnProperty.call(ctx, key) && ctx[key]!=null) return String(ctx[key]);
    // prev.ИмяАгента — берём из словаря предков по имени
    if(key.startsWith('prev.')){
      const name=key.slice(5);
      const byName=ctx._prevByName||{};
      if(byName[name]!=null) return String(byName[name]);
      return ''; // нет такого предка → пусто
    }
    return m; // неизвестная переменная — оставляем как есть
  });
}
// Замысел книги → блок канона для инжекции во ВСЕХ агентов. '' если пусто.
function conceptBlock(){
  const c=(state.project&&state.project.concept)||{};
  const setting=(c.setting||'').trim();
  const plotTurns=(c.plotTurns||'').trim();
  const tone=(c.tone||'').trim();
  const chars=(Array.isArray(c.characters)?c.characters:[]).filter(p=>p&&((p.name||'').trim()||(p.role||'').trim()||(p.brief||'').trim()));
  if(!setting&&!plotTurns&&!tone&&!chars.length) return '';
  const charsStr=chars.map(p=>{
    const nm=(p.name||'').trim(); const rl=(p.role||'').trim(); const br=(p.brief||'').trim();
    return nm+(rl?` (${rl})`:'')+(br?` — ${br}`:'');
  }).join('; ');
  let out='ЗАМЫСЕЛ КНИГИ (канон — соблюдать строго):';
  if(setting) out+=`\nМесто и время: ${setting}`;
  if(charsStr) out+=`\nПерсонажи: ${charsStr}`;
  if(plotTurns) out+=`\nКлючевые повороты: ${plotTurns}`;
  if(tone) out+=`\nТон: ${tone}`;
  return out;
}
async function buildMessages(n){
  const pr=state.project;
  // #21: образец стиля — берём начало целиком до 3000 симв (без вырезания середины), прогоняем через typo()
  let styleSample='';
  if(pr.styleRef){
    styleSample=pr.styleRef.slice(0,3000);
    if(typeof typo==='function'){ try{ styleSample=typo(styleSample); }catch(e){} }
  }
  const styleBlock = pr.styleRef
    ? `\n\nСТИЛЬ АВТОРА (имитируй этот голос — ритм, лексику, длину предложений):\n"""\n${styleSample}\n"""`
    : '';
  // 🎓 Школа стиля: профиль(и) стиля инжектятся только в пишущие роли
  const wr=['writer','line','logedit','fanout','beatsheet'].includes(roleKeyOf(n));
  let passportBlock='';
  if(wr){
    const lib=Array.isArray(state.styleLibrary)?state.styleLibrary:[];
    const mix=(Array.isArray(pr.styleMix)?pr.styleMix:[])
      .map(m=>({ w:m.weight, e:lib.find(x=>x.id===m.id) })).filter(x=>x.e).slice(0,3);
    if(mix.length){
      // Нормализуем веса к 100; доминирующий — с максимальным весом.
      const sum=mix.reduce((a,x)=>a+(x.w||0),0)||1;
      mix.forEach(x=>{ x.pct=Math.round((x.w||0)/sum*100); });
      mix.sort((a,b)=>b.pct-a.pct);
      // Бюджет на стиль/сюжет тем меньше, чем больше стилей (блок ≤ ~2500 симв).
      const styleCap = mix.length>=3?420:(mix.length===2?620:900);
      const plotCap  = mix.length>=3?260:(mix.length===2?360:520);
      const lines=mix.map(x=>{
        const st=(x.e.style||'').slice(0,styleCap);
        const pl=(x.e.plot||'').slice(0,plotCap);
        return `• ${x.pct}% — «${x.e.name||'стиль'}»:\n  Стиль: ${st}`+(pl?`\n  Сюжетные приёмы: ${pl}`:'');
      }).join('\n');
      passportBlock='\n\nСПЛАВ СТИЛЕЙ (следуй пропорциям, доминирует стиль с наибольшим весом):\n'+lines+
        '\n\nПиши СВОИМ сюжетом и словами в этом сплаве, не копируй источники.';
      // Паттерны вовлечения — от доминирующего стиля.
      const domEng=(mix[0].e.engagement||'').slice(0,700);
      if(domEng) passportBlock+='\n\nПРИЁМЫ ВОВЛЕЧЕНИЯ (применяй):\n'+domEng;
    } else if(pr.stylePassport){
      // Обратная совместимость: старое поле без библиотеки/микса.
      passportBlock='\n\nПАСПОРТ СТИЛЯ (пиши строго в этой манере, но СВОИМ сюжетом и словами — не копируй источник):\n'+pr.stylePassport + (pr.engagementPatterns?'\n\nПРИЁМЫ ВОВЛЕЧЕНИЯ (применяй):\n'+pr.engagementPatterns:'');
    }
  }
  const preds=state.edges.filter(e=>e.to===n.id).map(e=>node(e.from)).filter(Boolean);
  const budget=state.global.maxContextChars||8000;
  const predsWithOutput=preds.filter(p=>p.output);
  const perNode=Math.floor(budget/Math.max(1,predsWithOutput.length));
  // #44: словарь вывода предков по имени для {{prev.Имя}}
  const _prevByName={};
  predsWithOutput.forEach(p=>{ _prevByName[p.name]=smartTrunc(p.summary||p.output,perNode); });
  let prior=predsWithOutput.map(p=>`— ${p.name}:\n${smartTrunc(p.summary||p.output,perNode)}`).join('\n\n');
  // Авто-сжатие контекста если prior слишком длинный
  if(prior && prior.length > budget * 0.7 && state.global.autoDistill && hasKey()){
    try {
      const distilled = await callLLM(cfg(n), [
        { role:'system', content:'Сожми до 250 слов. Только факты, события, персонажи. Маркированный список.' },
        { role:'user',   content: prior }
      ]);
      if(distilled && distilled.trim()) prior = '📌 Резюме предыдущих агентов:\n' + distilled;
    } catch(e){ /* fallback — оставить как есть */ }
  }
  const scan=[pr.title,pr.genre,pr.brief,pr.input,prior].join(' ');
  const bible=bibleFor(scan);
  // #44: контекст для подстановки переменных {{...}} в промте
  const ctx={
    title:pr.title||'', genre:pr.genre||'', audience:pr.audience||'', brief:pr.brief||'',
    input:pr.input||'', prev:prior||'', bible:bible||'',
    'chapter.title':state.chapterCtx?(state.chapterCtx.title||''):'',
    _prevByName
  };
  // Если автор использует {{prev}} — он сам управляет вставкой материалов предков, авто-блок не дублируем
  const usesPrevVar=/\{\{\s*prev(\.[\w.а-яА-ЯёЁ]+)?\s*\}\}/.test(n.prompt||'');
  let user='';
  if(bible) user+=`Библия книги (канон, соблюдать строго):\n${bible}\n\n`;
  const concept=conceptBlock();
  if(concept) user+=concept+'\n\n';
  user+=`Книга: «${pr.title||'без названия'}»\nЖанр: ${pr.genre||'не задан'}\nАудитория: ${pr.audience||'не задана'}\n`+
    `Режим: ${pr.mode==='write'?'пишем с нуля':'редактируем готовый текст'}\n`+(pr.brief?`Бриф: ${pr.brief}\n`:'');
  if(pr.mode==='edit'&&pr.input&&preds.length===0) user+=`\nИсходный текст:\n${pr.input}\n`;
  if(prior && !usesPrevVar) user+=`\nМатериалы от предыдущих агентов:\n${prior}\n`;
  // Контекст главы (режим глава-за-главой)
  if(state.chapterCtx){ const ch=state.chapterCtx;
    user+=`\nТекущая глава: ${ch.num}. «${ch.title}»`+(ch.brief?`\nЗадача главы: ${ch.brief}`:'')+'\n';
    if(ch.prevSummary) user+=`\nСодержание предыдущих глав:\n${ch.prevSummary}\n`; }
  user+=`\nВыполни свою роль и выдай конкретный результат.`;
  const banBlock = state.global.banList
    ? `\n\nСТОП-СЛОВА — НЕЛЬЗЯ использовать в тексте (ни в каком виде): ${state.global.banList.replace(/\n/g,', ')}`
    : '';
  // #44: прогоняем промт через interpolate ПЕРЕД отправкой
  const sysPrompt=interpolate(n.prompt||'', ctx);
  return [ {role:'system',content:sysPrompt + styleBlock + passportBlock + banBlock}, {role:'user',content:user} ];
}
// #35: человеческие тексты ошибок. Сырой код прячем (в лог можно положить полный).
function humanError(status, rawText){
  const s=parseInt(status)||0;
  let msg;
  if(s===401||s===403) msg='Ключ не подходит — проверьте, что скопировали его целиком';
  else if(s===402) msg='Кончились средства на балансе провайдера — пополните счёт';
  else if(s===429) msg='Слишком часто — подождём и повторим';
  else if(s>=500) msg='Провайдер временно недоступен — попробуйте через минуту';
  else if(s===400) msg='Запрос не принят провайдером — проверьте модель и настройки';
  else {
    const detail=(rawText||'').replace(/\s+/g,' ').trim().slice(0,80);
    msg='Что-то пошло не так'+(detail?` (подробности: ${detail})`:'');
  }
  return msg;
}
// Извлекает HTTP-статус из строки ошибки вида «HTTP 401: …» / «Fallback HTTP 502: …»
function statusFromError(errText){ const m=String(errText||'').match(/(?:HTTP)\s+(\d{3})/i); return m?parseInt(m[1]):0; }
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
  if(!r.ok) throw new Error('HTTP '+r.status+': '+(await r.text()).slice(0,160));
  const resp = await r.text();
  // #47: callLLM обслуживает скрытые (служебные) вызовы — autoDistill / autoBibleUpdate /
  // runAutoEval. Они платные, но не привязаны к узлу, поэтому учитываем их отдельно.
  trackAux((messages||[]).map(m=>m.content).join(' '), resp, (c&&c.model)||state.global.model, 'Служебный вызов');
  return resp;
}
// Item 31: отдельная конфигурация судьи (если judgeModel задан — используем его, иначе cfg узла)
function judgeCfg(n){
  const base=cfg(n);
  const g=state.global;
  if(g.judgeModel&&g.judgeModel.trim()){
    return { baseURL:g.judgeBaseURL&&g.judgeBaseURL.trim()?g.judgeBaseURL.trim():base.baseURL,
      apiKey:g.judgeApiKey&&g.judgeApiKey.trim()?g.judgeApiKey.trim():base.apiKey,
      model:g.judgeModel.trim(), temperature:0.1 };
  }
  return base;
}
// Возвращает {score, reason}. Item 25: судья отдаёт «балл|краткая причина»
async function runAutoEval(output, n){
  const c=judgeCfg(n);
  const resp=await callLLM(c,[
    {role:'system',content:'Ты — строгий редактор. Оцени текст по критериям: логическая связность, соответствие брифу, качество нарратива, отсутствие противоречий. Ответь СТРОГО в формате «балл|краткая причина», где балл — целое число от 1 до 10, а причина — одно короткое предложение. Пример: «7|Хороший ритм, но провисает середина».'},
    {role:'user',content:`Проект: «${state.project.title||'без названия'}»\nБриф: ${state.project.brief||'не задан'}\n\nТекст:\n${smartTrunc(output||'',3000)}`}
  ]);
  const num=parseInt((resp||'').match(/\d+/)?.[0]||'0');
  const score=Math.min(10,Math.max(1,num||5));
  let reason='';
  const pipe=(resp||'').indexOf('|');
  if(pipe>=0) reason=(resp||'').slice(pipe+1).trim().slice(0,160);
  else reason=(resp||'').replace(/^\D*\d+\D*/,'').trim().slice(0,160);
  return {score, reason};
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
// #47: единый учёт скрытых (служебных) LLM-вызовов, которые идут мимо узлов.
// label — что это за вызов (для журнала), model — модель для расценок.
function trackAux(inText,outText,model,label){
  try{
    const tIn=tokEst(inText||''), tOut=tokEst(outText||'');
    const p=PRICES[model||state.global.model]||{in:0.14,out:0.28};
    const cost=tIn/1e6*p.in + tOut/1e6*p.out;
    state.auxTokens=(state.auxTokens||0)+tIn+tOut;
    state.auxCost=(state.auxCost||0)+cost;
    logRow(label||'Служебный вызов','aux',`~${tIn+tOut} ток. · ${money(cost)} (${model||state.global.model})`,{cost});
    return cost;
  }catch(e){ return 0; }
}
const nodeCost=n=>{ const p=PRICES[cfg(n).model]||{in:0.14,out:0.28}; return (n.tokensIn||0)/1e6*p.in+(n.tokensOut||0)/1e6*p.out; };
const projectCost=()=>state.nodes.reduce((s,n)=>s+nodeCost(n),0);
const money=v=>'$'+v.toFixed(v<1?4:2);

async function showPromptPreview(n){
  const msgs = await buildMessages(n);
  let html = '';
  msgs.forEach(m => {
    const roleLabel = m.role === 'system' ? '⚙ System' : m.role === 'user' ? '👤 User' : '🤖 Assistant';
    html += `<div class="pp-msg">
      <div class="pp-role">${roleLabel}</div>
      <pre class="pp-content">${esc(m.content)}</pre>
    </div>`;
  });
  const fullText = msgs.map(m => m.content).join(' ');
  const toks = tokEst(fullText);
  const c = cfg(n);
  const priceIn = PRICES[c.model]?.in || 0.15;
  const cost = (toks / 1e6 * priceIn).toFixed(4);
  html += `<div class="pp-stats">~${toks} токенов · ~$${cost}</div>`;
  openDrawer('Предпросмотр промпта: ' + esc(n.name), html);
}

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

/* ============ «ТРЕБУЕТ ВНИМАНИЯ» ============
   Решения для человека: агент находит нестыковку → пайплайн паузится →
   человек выбирает вариант в нижней панели → решение уходит в контекст узла. */
function raiseAttention({nodeId,title,detail,options,kind}){
  if(!state.attention) state.attention=[];
  const item={ id:uid(), nodeId, kind:kind||'', title:String(title||'').slice(0,160), detail:String(detail||''),
    options:(options||[]).map(o=>({label:String(o.label||o.value||o),value:String(o.value||o.label||o)})),
    status:'open', choice:'', ts:Date.now() };
  state.attention.unshift(item);
  logRow(node(nodeId)?.name||'Согласование','warn','🔔 нужно решение: '+item.title);
  save(); renderAttention();
  return item.id;
}
function resolveAttention(id,choice){
  if(!state.attention) return;
  const it=state.attention.find(a=>a.id===id); if(!it||it.status==='resolved') return;
  choice=String(choice||'').trim(); if(!choice) return;
  it.status='resolved'; it.choice=choice;
  const n=node(it.nodeId);
  // === Согласование «Замысел книги» на автостарте ===
  if(it.kind==='concept'){
    logRow('Замысел','ok','✔ '+choice.slice(0,60));
    save(); renderAttention(); render();
    if(choice==='edit'){ openConcept(); }
    else { toast('Замысел принят — нажмите ▶ Запустить','ok'); }
    return;
  }
  // === Вердикт-пауза решающего агента ===
  if(it.kind==='verdict'){
    logRow(n?.name||'Вердикт','ok','✔ '+choice.slice(0,60));
    if(n){
      if(choice==='continue'){ n.status='done'; n.error=''; toast('Продолжаем несмотря на вердикт','ok'); }
      else if(choice==='stop'){ n.status='review'; toast('Конвейер остановлен по вердикту','warn'); }
      else if(choice==='revise'){ n.status='review'; openConcept(); toast('Поправьте замысел/бриф','warn'); }
      else { n.status='review'; }
    }
    save(); renderAttention(); render();
    return;
  }
  if(n){
    n.attentionChoice=choice;
    // Дописываем решение в контекст узла, чтобы downstream его получил.
    const line='РЕШЕНИЕ РЕДАКТОРА ('+it.title+'): '+choice;
    n.output=(n.output?n.output+'\n\n':'')+line;
  }
  logRow(n?.name||'Согласование','ok','✔ решение: '+choice.slice(0,80));
  // Если это decision-узел в review и у него больше нет открытых вопросов — достроить узел.
  if(n && n.nodeType==='decision' && n.status==='review'){
    const stillOpen=state.attention.some(a=>a.nodeId===n.id && a.status==='open');
    if(!stillOpen){
      const resolved=state.attention.filter(a=>a.nodeId===n.id && a.status==='resolved');
      n.output='РЕШЕНИЯ:\n'+resolved.map(a=>'- '+a.detail+' → '+a.choice).join('\n');
      n.status='done'; n.error='';
      logRow(n.name,'ok','согласование завершено ('+resolved.length+' реш.)');
    }
  }
  save(); renderAttention(); render();
  // Подсказка «можно продолжить», когда все открытые вопросы закрыты.
  if(!state.attention.some(a=>a.status==='open')){
    toast('Все решения приняты — нажмите ▶ Продолжить','ok');
  } else {
    toast('Решение применено','ok');
  }
}
function renderAttention(){
  const bar=$('#attention-bar'); if(!bar) return;
  const open=(state.attention||[]).filter(a=>a.status==='open');
  if(!open.length){ bar.style.display='none'; bar.innerHTML=''; return; }
  if(_attentionCollapsed){
    bar.style.display='';
    bar.innerHTML=`<div class="att-head att-head-collapsed">
      <span class="att-badge">🔔 ${open.length}</span>
      <span class="att-title">Требует внимания</span>
      <button class="icon-btn att-toggle" data-action="att-expand" title="Развернуть">▴</button>
    </div>`;
    return;
  }
  const cards=open.map(a=>{
    const opts=a.options.map(o=>
      `<button class="att-opt" data-action="att-choose" data-id="${a.id}" data-val="${esc(o.value)}">${esc(o.label)}</button>`
    ).join('');
    return `<div class="att-card">
      <div class="att-card-t">${esc(a.title)}</div>
      ${a.detail&&a.detail!==a.title?`<div class="att-card-d">${esc(a.detail)}</div>`:''}
      <div class="att-opts">${opts}</div>
      <div class="att-custom">
        <input class="att-input" data-id="${a.id}" placeholder="свой вариант…" />
        <button class="att-apply" data-action="att-apply" data-id="${a.id}">Применить</button>
      </div>
    </div>`;
  }).join('');
  bar.style.display='';
  bar.innerHTML=`<div class="att-head">
      <span class="att-badge">🔔 ${open.length}</span>
      <span class="att-title">Требует внимания: ${open.length}</span>
      <button class="icon-btn att-toggle" data-action="att-collapse" title="Свернуть">▾</button>
    </div>
    <div class="att-cards">${cards}</div>`;
}

/* ============ РЕНДЕР ============ */
const _VIEWS=['canvas','reader','simple'];
let _currentView=(()=>{ const h=location.hash.slice(1); if(_VIEWS.includes(h)) return h;
  const hasOutput=(state.nodes||[]).some(n=>n.output&&n.output.trim());
  return hasOutput?'reader':'simple'; })();
const nodesEl=$('#nodes'), edgesEl=$('#edges');
/* CTB state + SPEC_NODES — declared here so renderNodes() can reference them */
let _activeTool='select', _snapGrid=false, _showMinimap=false, _zoomLevel=100;
let _attentionCollapsed=false;
const SPEC_NODES={
  branch:   {emoji:'⎇', name:'Ветвь',     desc:'Параллельный поток',    color:'#60a5fa', prompt:'Раздели задачу на N параллельных подзадач. Выведи список — каждая на новой строке.'},
  condition:{emoji:'◇', name:'Условие',   desc:'if / else развилка',    color:'#fbbf24', prompt:'Оцени текст и реши: продолжать → выведи PASS, вернуть на доработку → выведи FAIL. Объясни решение.'},
  loop:     {emoji:'↻', name:'Повтор',    desc:'Цикл до N итераций',    color:'#f87171', prompt:'Улучши текст и выведи исправленную версию. Если текст уже хорош — напиши DONE в первой строке.'},
  gate:     {emoji:'⏸', name:'Ожидание',  desc:'Пауза для одобрения',   color:'#34d399', prompt:'', requireApproval:true},
  note:     {emoji:'✏', name:'Заметка',   desc:'Аннотация (не выполн.)',color:'#8d92a8', prompt:''},
  merge:    {emoji:'⬡', name:'Слияние',   desc:'Объединить потоки',     color:'#19d3c5', prompt:'Объедини все входящие тексты в единый связный документ. Сохрани структуру.'},
  distill:  {emoji:'🗜',name:'Дистилл.',  desc:'Сжать контекст',        color:'#6c63ff', prompt:'Сожми предыдущий текст до 200–300 слов: главные события, ключевые факты о персонажах, открытые линии. Маркированный список.'},
  fanout:   {emoji:'🔀',name:'Fanout',    desc:'Параллельный запуск по списку задач', color:'#7c3aed', badge:'FAN', prompt:'Ты — писатель. Напиши главу по заданию. Придерживайся стиля и общего сюжета.'},
  decision: {emoji:'🔔',name:'Согласование', desc:'Спросить решение у человека', color:'#fbbf24', prompt:'Сравни входные материалы, найди логические нестыковки/противоречия/развилки, требующие решения автора. Для КАЖДОЙ выдай JSON-массив: [{"issue":"что не так","options":["вариант 1","вариант 2","вариант 3"]}]. Только JSON, без пояснений.'},
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
  // #47: Σ = стоимость узлов + скрытые служебные вызовы (autoDistill/autoEval/…)
  const _pc=projectCost(), _ac=state.auxCost||0;
  const _cs=$('#cost-state');
  if(_cs){
    _cs.textContent='Σ '+money(_pc+_ac)+(_ac>0?' (+'+money(_ac)+' вспом.)':'');
    _cs.title=_ac>0?`Узлы: ${money(_pc)} · служебные вызовы: ${money(_ac)} (~${state.auxTokens||0} ток.)`:'Суммарная стоимость токенов';
  }
  updateBackupState();
  const paused=isPaused();
  const rb=$('#run-btn'); rb.textContent=paused?'▶ Продолжить':'▶ Запустить';
  const sb=$('#stop-btn'); if(sb){ sb.style.display=running?'':'none'; }
  // #38: скрываем технический хинт, пока холст пуст
  const hintEl=$('#canvas-hint');
  if(hintEl){
    const empty=state.nodes.length===0;
    hintEl.style.display=empty?'none':'';
    hintEl.textContent='Тяни блок за шапку • соединяй кружки (выход→вход) • клик по связи — удалить';
  }
  renderNodes(); renderEdges(); renderLoopCards();
  if(_panelNodeId){ const pn=node(_panelNodeId); if(pn && pn.status!=='running') refreshNodePanel(); }
  if(_currentView==='reader') renderReader();
  if(_currentView==='simple') renderSimpleProgress();
  updateStyleRefBadge();
  renderLeftRail();
  renderBookInspector();
  renderAttention();
}
/* ============ ЛЕВАЯ КОЛОНКА «КАБИНЕТ АВТОРА» ============
   Структура книги (главы/агенты) + навигация. Чисто аддитивно:
   зовёт существующие функции open... и switchView. Не падает на пустом проекте. */
// Метка активного стиля (микс из библиотеки или одиночный паспорт) — чтобы стиль не применялся «молча»
function activeStyleLabel(){
  const pr=state.project||{}; const lib=state.styleLibrary||[];
  if(pr.styleMix && pr.styleMix.length){
    const names=pr.styleMix.map(m=>{ const s=lib.find(x=>x.id===m.id); return s?s.name:null; }).filter(Boolean);
    if(names.length) return names.join(' + ');
  }
  if(pr.stylePassport && pr.stylePassport.trim()) return pr.styleSourceName||'свой стиль';
  if(pr.styleRef && pr.styleRef.trim()) return 'образец автора';
  return '';
}
function renderLeftRail(){
  const rail=$('#lr-body'); if(!rail) return;
  const pr=state.project||{};
  const styleLbl=activeStyleLabel();
  const chapters=(typeof bookNodes==='function')?bookNodes():[];
  const STAT={done:'✓',error:'❌',running:'⏳',review:'⏳',variants:'⏳',skip:'•',idle:'•'};
  const SCLS={done:'s-done',error:'s-error',running:'s-running',review:'s-running',variants:'s-running'};
  let chapHtml;
  if(!chapters.length){
    chapHtml=`<div class="lr-empty">Глав пока нет.<br>Запустите конвейер — главы появятся здесь.</div>`;
  } else {
    chapHtml=chapters.map((n,i)=>{
      const st=n.status||'idle';
      const ic=STAT[st]||'•';
      const scls=SCLS[st]||'s-idle';
      const words=((typeof cleanProse==='function'?cleanProse(n):(n.output||'')).match(/\S+/g)||[]).length;
      const title=(typeof chapterTitleOf==='function')?chapterTitleOf(n,i):(n.name||('Глава '+(i+1)));
      const active=(_panelNodeId===n.id)?' active':'';
      return `<div class="lr-chapter${active}" data-action="rail-chapter" data-id="${n.id}" title="${esc(title)}">
        <span class="lr-ch-ic ${scls}">${ic}</span>
        <span class="lr-ch-name">${esc(title)}</span>
        <span class="lr-ch-words">${words?words.toLocaleString('ru-RU'):''}</span>
      </div>`;
    }).join('');
  }
  rail.innerHTML=`
    <div class="lr-head">
      <div class="lr-title">📖 ${esc(pr.title||'Без названия')}</div>
      ${chapters.length?`<div class="lr-sub">${chapters.length} ${chapters.length===1?'глава':'глав'}</div>`:''}
      ${styleLbl?`<div class="lr-style-badge" data-action="style-school" title="Активный стиль письма подмешивается во всех агентов. Нажмите чтобы изменить/снять.">✍️ Стиль: ${esc(styleLbl)} <span class="lr-style-x" data-action="clear-style" title="Снять стиль">✕</span></div>`:''}
    </div>
    <div class="lr-chapters">
      <div class="lr-sec-label">Структура книги</div>
      ${chapHtml}
    </div>
    <div class="lr-nav">
      <button class="lr-nav-btn lr-nav-new" data-action="new-book"><span class="lr-nav-ic">➕</span> Новая книга</button>
      <button class="lr-nav-btn" data-action="book-library"><span class="lr-nav-ic">📚</span> Мои книги</button>
      <button class="lr-nav-btn" data-action="templates"><span class="lr-nav-ic">🗂</span> Шаблоны</button>
      <button class="lr-nav-btn" data-action="concept"><span class="lr-nav-ic">🧭</span> Замысел</button>
      <button class="lr-nav-btn" data-action="bible"><span class="lr-nav-ic">📖</span> Библия</button>
      <button class="lr-nav-btn" data-action="style-school"><span class="lr-nav-ic">🎓</span> Школа стиля</button>
      <button class="lr-nav-btn" data-action="text-analysis"><span class="lr-nav-ic">📊</span> Анализ текста</button>
      <button class="lr-nav-btn" data-action="chapters"><span class="lr-nav-ic">📚</span> Главы</button>
      <button class="lr-nav-btn" data-action="entities"><span class="lr-nav-ic">🗃</span> Сущности</button>
      <button class="lr-nav-btn" data-action="add-node"><span class="lr-nav-ic">＋</span> Агент</button>
      <button class="lr-nav-btn" data-action="log"><span class="lr-nav-ic">📋</span> Журнал</button>
      <button class="lr-nav-btn" data-action="guide"><span class="lr-nav-ic">?</span> Гайд</button>
    </div>
    <div class="lr-foot">
      <button class="lr-nav-btn" data-action="settings"><span class="lr-nav-ic">⚙</span> Настройки</button>
      <button class="lr-nav-btn" data-action="export"><span class="lr-nav-ic">⬇</span> Экспорт</button>
    </div>`;
}
/* ============ КОНТЕКСТНЫЙ ИНСПЕКТОР (правая колонка, только режим «Книга») ============
   Ничего не выбрано → обзор книги. Выбрана глава (_panelNodeId) → инспектор главы.
   Не трогает выезжающую панель холста (#node-panel). Колонка скрыта css вне reader. */
function renderBookInspector(){
  const el=$('#book-inspector'); if(!el) return;
  if(_currentView!=='reader'){ el.innerHTML=''; return; }
  const pr=state.project||{};
  const chapters=(typeof bookNodes==='function')?bookNodes():[];
  const sel=_panelNodeId?node(_panelNodeId):null;

  if(sel){
    // ── ИНСПЕКТОР ГЛАВЫ ──
    const idx=chapters.findIndex(n=>n.id===sel.id);
    const title=(typeof chapterTitleOf==='function')?chapterTitleOf(sel,idx<0?0:idx):(sel.name||'Глава');
    const prose=(typeof cleanProse==='function')?cleanProse(sel):(sel.output||'');
    const words=(prose.match(/\S+/g)||[]).length;
    const toks=(sel.tokensIn||0)+(sel.tokensOut||0);
    const nVer=(sel.outputVersions||[]).length;
    const preview=sel.error
      ? `<div class="bi-empty-out">⚠ ${esc(sel.error)}</div>`
      : (sel.output
          ? `<div class="bi-preview">${esc(prose.slice(0,400))}${prose.length>400?'…':''}</div>`
          : `<div class="bi-empty-out">✍️ Глава ещё не написана.<br>Нажмите «▶ Прогнать».</div>`);
    el.innerHTML=`
      <div class="bi-head">
        <div class="bi-emoji">${sel.emoji||'📄'}</div>
        <div class="bi-titles">
          <div class="bi-name">${esc(title)}</div>
          <div class="bi-role">${esc(sel.name||'')}${sel.role?' · '+esc(sel.role):''}</div>
        </div>
        <button class="icon-btn" data-action="bi-overview" title="К обзору книги">✕</button>
      </div>
      ${(toks||words)?`
      <div class="bi-stat"><span>~ Слов</span><span class="bi-v">${words.toLocaleString('ru-RU')}</span></div>
      ${toks?`<div class="bi-stat"><span>Токены</span><span class="bi-v">${toks.toLocaleString('ru-RU')}</span></div>
      <div class="bi-stat"><span>Стоимость</span><span class="bi-v">${money(nodeCost(sel))}</span></div>`:''}`:''}
      ${preview}
      <div class="bi-sec-label">Действия</div>
      <div class="bi-actions">
        <button class="btn ok sm" data-action="bi-run" data-id="${sel.id}">▶ Прогнать</button>
        <button class="btn ghost sm" data-action="bi-rerun" data-id="${sel.id}" title="Игнорировать кэш — другой вариант">🎲 Заново</button>
        ${sel.output?`<button class="btn ghost sm" data-action="bi-edit" data-id="${sel.id}">✎ Править</button>`:''}
        ${nVer>1?`<button class="btn ghost sm" data-action="bi-ver" data-id="${sel.id}">± Версии (${nVer})</button>`:''}
        <button class="btn ghost sm" data-action="bi-cfg" data-id="${sel.id}">⚙ Настроить</button>
        <button class="btn ghost sm" data-action="bi-runfrom" data-id="${sel.id}">▶▶ Прогнать отсюда</button>
      </div>`;
    return;
  }

  // ── ОБЗОР КНИГИ ──
  const totalWords=chapters.reduce((s,n)=>{
    const p=(typeof cleanProse==='function')?cleanProse(n):(n.output||'');
    return s+((p.match(/\S+/g)||[]).length);
  },0);
  const doneCh=chapters.filter(n=>n.status==='done').length;
  const cost=projectCost()+(state.auxCost||0);
  el.innerHTML=`
    <div class="bi-overview">
      <div class="bi-title">📖 ${esc(pr.title||'Без названия')}</div>
      ${(pr.genre||pr.audience)?`<div class="bi-genre">${esc([pr.genre,pr.audience].filter(Boolean).join(' · '))}</div>`:''}
      <div class="bi-sec-label">Обзор книги</div>
      <div class="bi-stat"><span>~ Всего слов</span><span class="bi-v">${totalWords.toLocaleString('ru-RU')}</span></div>
      <div class="bi-stat"><span>Готовность</span><span class="bi-v">${doneCh} из ${chapters.length} глав</span></div>
      <div class="bi-stat"><span>Стоимость</span><span class="bi-v">${money(cost)}</span></div>
      <div class="bi-sec-label">Инструменты</div>
      <div class="bi-actions">
        <button class="btn ghost sm" data-action="text-analysis">📊 Анализ текста</button>
        <button class="btn ghost sm" data-action="style-school">🎓 Школа стиля</button>
        <button class="btn ghost sm" data-action="export">📋 Метаданные / Экспорт</button>
        <button class="btn ok sm" data-action="export">⬇ Экспорт</button>
      </div>
    </div>`;
}
function updateStyleRefBadge(){
  const badge = document.querySelector('#style-ref-badge');
  if(badge) badge.style.display = state.project.styleRef ? '' : 'none';
}
function loopBadge(n){
  const loopEdge = state.edges.find(e=>e.from===n.id&&(e.isLoop||e.maxRetries>0));
  if(!loopEdge||!(loopEdge._retryCount||0)) return '';
  return `<span class="loop-iter-badge">🔁 ${loopEdge._retryCount}/${loopEdge.maxRetries}</span>`;
}
function renderNodes(){
  // #38: пустой холст — крупная заглушка с быстрыми действиями
  if(state.nodes.length===0){
    nodesEl.innerHTML=`<div class="canvas-empty">
      <div class="ce-emoji">📚</div>
      <div class="ce-title">Холст пуст — с чего начнём?</div>
      <div class="ce-sub">Загрузите готовую команду агентов или добавьте первого вручную</div>
      <div class="ce-btns">
        <button class="btn ok" data-action="templates">🗂 Загрузить шаблон</button>
        <button class="btn ghost" data-action="switch-view" data-view="simple">✨ Простой режим</button>
        <button class="btn ghost" data-action="add-node">＋ Первый агент</button>
      </div>
    </div>`;
    if(_currentView==='simple') renderSimpleProgress();
    return;
  }
  const collapsedIds=new Set((state.groups||[]).filter(g=>g.collapsed).flatMap(g=>g.nodeIds));
  nodesEl.innerHTML=state.nodes.filter(n=>!collapsedIds.has(n.id)).map(n=>{
    // Special node type support
    const sp=n.nodeType?SPEC_NODES[n.nodeType]:null;
    const badge=sp?`<span class="ntype-badge" style="background:${sp.color}1a;color:${sp.color}">${sp.name}</span>`:'';
    const ntAttr=n.nodeType?` data-ntype="${n.nodeType}"`:'';
    // Note nodes: simplified read-only card
    const selCls=_selected.has(n.id)?' selected':'';
    if(n.nodeType==='note'){
      return `<div class="node idle${selCls}"${ntAttr} data-node="${n.id}" style="left:${n.x}px;top:${n.y}px">${badge}
        <div class="node-head" data-drag="${n.id}">
          <div class="node-emoji">${n.emoji}</div>
          <div><div class="node-name">${esc(n.name)}</div><div class="node-role">${esc(n.role)}</div></div>
          <button class="node-btn node-del" data-action="delete-node" data-id="${n.id}" title="Удалить">×</button>
        </div>
        <div class="node-body ${n.prompt?'':'empty'}">${n.prompt?esc(n.prompt):'Двойной клик — редактировать'}</div>
        <div class="node-foot"><button class="btn ghost sm" data-action="open-node" data-id="${n.id}">✎ Изменить</button></div>
      </div>`;
    }
    // Standard + special nodes
    const out=n.error?`⚠ ${esc(n.error)}`:n.status==='running'&&!n.output?'<span class="thinking"><span></span><span></span><span></span></span>':(n.output?md2html(n.output):'нет результата');
    const meta=(n.tokensIn||n.tokensOut)?`<span>${(n.tokensIn+n.tokensOut)} ток.</span><span>${money(nodeCost(n))}</span>${n.ms?`<span>${(n.ms/1000).toFixed(1)}с</span>`:''}`:'';
    const appr=n.status==='review'?`<div class="node-foot"><button class="btn ok sm" data-action="approve" data-id="${n.id}">✅ Принять</button><button class="btn ghost sm" data-action="open-node" data-id="${n.id}">✍ Правка</button></div>`:
      n.status==='variants'?`<div class="node-foot"><button class="btn ok sm" data-action="open-variants" data-id="${n.id}">🔀 Выбрать вариант</button></div>`:
      `<div class="node-foot"><button class="btn ghost sm" data-action="open-node" data-id="${n.id}">⚙ Настроить</button><button class="btn ghost sm" data-action="run-node" data-id="${n.id}">▶ Прогнать</button></div>`;
    return `<div class="node ${n.status}${selCls}"${ntAttr} data-node="${n.id}" style="left:${n.x}px;top:${n.y}px">
      ${badge}
      <div class="port in" data-port="in" data-id="${n.id}"></div>
      <div class="port out" data-port="out" data-id="${n.id}"></div>
      <div class="node-head" data-drag="${n.id}">
        <div class="node-emoji">${n.emoji}</div>
        <div><div class="node-name">${esc(n.name)}${n.requireApproval?' 🔒':''}</div><div class="node-role">${esc(n.role)}</div></div>
        ${loopBadge(n)}
        <button class="node-btn node-collapse" data-action="toggle-collapse" data-id="${n.id}" title="${n.collapsed?'Развернуть':'Свернуть'}">${n.collapsed?'▸':'▾'}</button>
        <button class="node-btn node-del" data-action="delete-node" data-id="${n.id}" title="Удалить узел">×</button>
        <div class="node-status"></div>
      </div>
      ${n.collapsed?'':`<div class="node-body ${n.output||n.error?'':'empty'}" id="body-${n.id}">${out}</div>
      ${meta?`<div class="node-meta">${meta}</div>`:''}`}
      ${appr}
    </div>`;
  }).join('');
  if(_showMinimap) renderMinimap();
  // #33: держим прогресс «Просто» в актуальном состоянии при смене статусов узлов
  if(_currentView==='simple') renderSimpleProgress();
}
function portPos(id,side){ const n=node(id); return {x:n.x+(side==='out'?NW:0), y:n.y+PORT_Y+7}; }
function edgePath(a,b){ const dx=Math.max(40,Math.abs(b.x-a.x)*0.5); return `M ${a.x} ${a.y} C ${a.x+dx} ${a.y}, ${b.x-dx} ${b.y}, ${b.x} ${b.y}`; }
function renderEdges(){
  const collapsedIds=new Set((state.groups||[]).filter(g=>g.collapsed).flatMap(g=>g.nodeIds));
  edgesEl.innerHTML=`<defs><marker id="loop-arr" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#4f46e5"/></marker></defs>`+renderGroups()+state.edges.filter(e=>!collapsedIds.has(e.from)&&!collapsedIds.has(e.to)).map(e=>{ if(!node(e.from)||!node(e.to)) return '';
    const p1=portPos(e.from,'out'), p2=portPos(e.to,'in');
    const d=edgePath(p1,p2);
    const flow=node(e.from).status==='running'||node(e.to).status==='running';
    const cond=e.condition&&e.condition.trim()?'conditional':'';
    const isCyclic=(e.maxRetries||0)>0;
    // For loop (backward) edges, use a curved arc that goes below nodes
    if(e.isLoop){
      const fx=p1.x, fy=p1.y, tx=p2.x, ty=p2.y;
      const dLoop=`M ${fx} ${fy} C ${fx+60} ${fy+120}, ${tx-60} ${ty+120}, ${tx} ${ty}`;
      return `<path class="edge loop-back" d="${dLoop}" style="stroke:#4f46e5;stroke-dasharray:8 4;fill:none" marker-end="url(#loop-arr)"></path>
        <path class="edge hit" d="${dLoop}" data-edge="${e.id}" title="Петля: ${esc(e.condition||'всегда')} (${e._retryCount||0}/${e.maxRetries||5})"></path>`;
    }
    const cyclicStyle=isCyclic?` style="stroke:#f59e0b;stroke-dasharray:8 4 2 4"`:'';
    const midX=(p1.x+p2.x)/2, midY=(p1.y+p2.y)/2;
    const badge=isCyclic?`<text x="${midX}" y="${midY-6}" text-anchor="middle" fill="#f59e0b" font-size="10" font-family="monospace" style="pointer-events:none">↩${e._retryCount||0}/${e.maxRetries}</text>`:'';
    return `<path class="edge ${flow?'flow':''} ${isCyclic?'cyclic':cond}" d="${d}"${cyclicStyle}></path><path class="edge hit" d="${d}" data-edge="${e.id}" title="${isCyclic?'Повторы: '+(e._retryCount||0)+'/'+e.maxRetries+(cond?' | Условие: '+esc(e.condition):''):cond?'Условие: '+esc(e.condition):''}"></path>${badge}`; }).join('');
}
function renderLoopCards(){
  // Remove existing loop cards
  document.querySelectorAll('.loop-card').forEach(el=>el.remove());
  const NW=212;
  state.edges.filter(e=>e.isLoop).forEach(e=>{
    const fromNode=node(e.from); const toNode=node(e.to);
    if(!fromNode||!toNode) return;
    const card=document.createElement('div');
    card.className='loop-card';
    card.dataset.loopEdge=e.id;
    card.style.cssText=`left:${fromNode.x+NW+24}px;top:${fromNode.y}px;position:absolute;`;
    const toName=esc(toNode.name||'?');
    const iterText=e._retryCount?`Итерация ${e._retryCount} из ${e.maxRetries||5}`:'Ожидание';
    const scoreText=e._autoScore!=null?` · оценка ${e._autoScore}/10`:'';
    card.innerHTML=`
      <div class="loop-card-title">🔁 Петля → ${toName}</div>
      <div class="loop-card-field">
        <div class="loop-card-label">Условие выхода (JS):</div>
        <div class="loop-card-val mono">${e.condition?esc(e.condition):'<span style="color:var(--faint)">не задано</span>'}</div>
      </div>
      <div class="loop-card-row">
        <span>Авто-оценка:</span>
        <span style="color:${e.autoEval?'var(--ok)':'var(--faint)'}">${e.autoEval?'✅ вкл.':'выкл.'}</span>
      </div>
      ${e.autoEval?`<div class="loop-card-row"><span>Порог:</span><span>${e.evalThreshold||7}/10</span></div>`:''}
      <div class="loop-card-row"><span>Макс. итераций:</span><span>${e.maxRetries||5}</span></div>
      <div class="loop-card-status">${iterText}${scoreText}</div>
      <button class="btn ghost sm" style="width:100%;margin-top:6px" data-action="open-edge" data-id="${e.id}">⚙ Настроить</button>
    `;
    document.getElementById('canvas').appendChild(card);
  });
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
const canvas=$('#canvas'); let drag=null, wire=null, groupDrag=null, boxSel=null, _dragMoved=false, _panelNodeId=null;
// #46: множественное выделение
const _selected=new Set();
function clearSelection(){ if(_selected.size){ _selected.clear(); renderNodes(); } }
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
  if(e.target.closest('button,input,textarea,select')) return; // не перехватывать клики по кнопкам внутри шапки
  _dragMoved=false;
  const n=node(h.dataset.drag); const pt=canvasPoint(e); pushUndo();
  // #46: если тащим выделенный узел — двигаем всю группу выделения
  if(_selected.has(n.id) && _selected.size>1){
    const starts=[..._selected].map(id=>node(id)).filter(Boolean).map(m=>({id:m.id,x:m.x,y:m.y}));
    drag={id:n.id,dx:pt.x-n.x,dy:pt.y-n.y,multi:starts,ox:pt.x,oy:pt.y};
  } else {
    // Клик по невыделенному узлу — снимаем прежнее выделение
    if(!_selected.has(n.id)) clearSelection();
    drag={id:n.id,dx:pt.x-n.x,dy:pt.y-n.y};
  }
  e.preventDefault();
});
// Клик по телу/шапке плитки (без перетаскивания) → боковая панель текста
nodesEl.addEventListener('click',e=>{
  if(e.target.closest('button,input,textarea,select,.port')) return; // кнопки/порты — своя логика
  if(_dragMoved){ _dragMoved=false; return; }                        // это было перетаскивание, не клик
  const card=e.target.closest('.node'); if(!card) return;
  const id=card.dataset.node; if(id) openNodePanel(id);
});
function openNodePanel(id){
  const n=node(id); if(!n) return;
  _panelNodeId=id;
  const out=n.error?`<div class="np-empty"><div class="np-empty-ic">⚠</div>${esc(n.error)}</div>`
    :(n.output?`<div class="md">${md2html(typeof typo==='function'?typo(n.output):n.output)}</div>`
      :`<div class="np-empty"><div class="np-empty-ic">✍️</div>Этот агент ещё не запускался.<br>Нажмите «▶ Прогнать» ниже.</div>`);
  const words=n.output?(n.output.match(/\S+/g)||[]).length:0;
  const meta=(n.tokensIn||n.tokensOut||words)?`<div class="np-meta"><span>~${words.toLocaleString('ru-RU')} слов</span>${(n.tokensIn||n.tokensOut)?`<span>${(n.tokensIn+n.tokensOut)} ток.</span><span>${money(nodeCost(n))}</span>`:''}${n.ms?`<span>${(n.ms/1000).toFixed(1)}с</span>`:''}</div>`:'';
  const nVer=(n.outputVersions||[]).length;
  const p=$('#node-panel');
  p.innerHTML=`
    <div class="np-head">
      <div class="np-emoji">${n.emoji}</div>
      <div class="np-titles"><div class="np-name">${esc(n.name)}</div><div class="np-role">${esc(n.role||'')}</div></div>
      <button class="icon-btn" id="np-close" title="Закрыть">✕</button>
    </div>
    ${meta}
    <div class="np-body" id="np-body">${out}</div>
    <div class="np-foot">
      <button class="btn ok sm" id="np-run">▶ Прогнать</button>
      <button class="btn ghost sm" id="np-rerun" title="Игнорировать кэш — получить другой вариант">🎲 Заново</button>
      ${n.output?'<button class="btn ghost sm" id="np-edit">✎ Править</button>':''}
      ${nVer>1?`<button class="btn ghost sm" id="np-ver">± Версии (${nVer})</button>`:''}
      <button class="btn ghost sm" id="np-cfg">⚙ Настроить</button>
    </div>`;
  p.classList.add('show'); p.setAttribute('aria-hidden','false');
  nodesEl.querySelectorAll('.node.panel-active').forEach(el=>el.classList.remove('panel-active'));
  nodesEl.querySelector(`[data-node="${id}"]`)?.classList.add('panel-active');
  $('#np-close').onclick=closeNodePanel;
  $('#np-run').onclick=()=>{ runNode(id); };
  $('#np-rerun').onclick=()=>{ n.cacheHash=''; n._loopPrev=''; runNode(id); };
  const eb=$('#np-edit'); if(eb) eb.onclick=()=>{ closeNodePanel(); openManualEdit(id); };
  const vb=$('#np-ver'); if(vb) vb.onclick=()=>{ const vs=n.outputVersions; if(vs&&vs.length>1) openWordDiff('Версии: '+esc(n.name), vs[1].output, n.output, ()=>openNodePanel(id)); };
  $('#np-cfg').onclick=()=>{ openNode(id); };
}
function closeNodePanel(){ const p=$('#node-panel'); p.classList.remove('show'); p.setAttribute('aria-hidden','true'); _panelNodeId=null;
  nodesEl.querySelectorAll('.node.panel-active').forEach(el=>el.classList.remove('panel-active')); }
function refreshNodePanel(){ if(_panelNodeId && $('#node-panel').classList.contains('show')) openNodePanel(_panelNodeId); }
edgesEl.addEventListener('mousedown',e=>{
  const p=e.target.closest('[data-group-drag]'); if(!p) return;
  const g=(state.groups||[]).find(x=>x.id===p.dataset.groupDrag); if(!g) return;
  const pt=canvasPoint(e);
  const starts=g.nodeIds.map(id=>node(id)).filter(Boolean).map(n=>({id:n.id,x:n.x,y:n.y}));
  groupDrag={id:g.id,ox:pt.x,oy:pt.y,starts};
  e.preventDefault(); e.stopPropagation();
});
// #46: прямоугольное выделение — drag по ПУСТОМУ холсту при инструменте select
canvas.addEventListener('mousedown',e=>{
  if(e.button!==0) return;
  if(drag||wire||groupDrag) return; // нода/порт/группа уже перехватили
  if(_activeTool!=='select') return;
  // только по пустому месту: не по ноде, порту, карточке петли, кнопке, группе
  if(e.target.closest('.node,.port,.loop-card,button,[data-group-drag],[data-group-click],[data-toggle]')) return;
  if(e.target.closest('[data-edge],path.edge')) return; // клик по связи — её обработчик
  const pt=canvasPoint(e);
  boxSel={sx:pt.x,sy:pt.y,cx:pt.x,cy:pt.y,additive:e.shiftKey,moved:false};
  if(!boxSel.additive) clearSelection();
});
function getSelectBoxEl(){
  let el=document.getElementById('_select-box');
  if(!el){ el=document.createElement('div'); el.id='_select-box'; el.className='select-box'; nodesEl.appendChild(el); }
  return el;
}
function updateSelectBox(){
  if(!boxSel) return;
  boxSel.moved=true;
  const x=Math.min(boxSel.sx,boxSel.cx), y=Math.min(boxSel.sy,boxSel.cy);
  const w=Math.abs(boxSel.cx-boxSel.sx), h=Math.abs(boxSel.cy-boxSel.sy);
  const el=getSelectBoxEl();
  el.style.cssText=`position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
}
function finalizeBoxSelect(){
  const bs=boxSel; boxSel=null;
  const el=document.getElementById('_select-box'); if(el) el.remove();
  if(!bs||!bs.moved){ if(!bs.additive) clearSelection(); return; } // просто клик по пустому — снять выделение
  const x1=Math.min(bs.sx,bs.cx), y1=Math.min(bs.sy,bs.cy), x2=Math.max(bs.sx,bs.cx), y2=Math.max(bs.sy,bs.cy);
  const collapsedIds=new Set((state.groups||[]).filter(g=>g.collapsed).flatMap(g=>g.nodeIds));
  state.nodes.forEach(n=>{
    if(collapsedIds.has(n.id)) return;
    const nx1=n.x, ny1=n.y, nx2=n.x+NW, ny2=n.y+120;
    const inside=nx1>=x1&&ny1>=y1&&nx2<=x2&&ny2<=y2;
    const overlap=nx1<x2&&nx2>x1&&ny1<y2&&ny2>y1;
    if(inside||overlap) _selected.add(n.id);
  });
  renderNodes();
}
function canvasPoint(e){ const r=canvas.getBoundingClientRect(); const s=(_zoomLevel||100)/100;
  return {x:(e.clientX-r.left+canvas.scrollLeft)/s, y:(e.clientY-r.top+canvas.scrollTop)/s}; }
// #43: подсветка валидных входных портов при протяжке связи
function highlightValidPorts(fromId){
  nodesEl.querySelectorAll('.port.in').forEach(p=>{
    p.classList.toggle('port-valid', p.dataset.id!==fromId);
  });
}
function clearPortHighlight(){ nodesEl.querySelectorAll('.port-valid').forEach(p=>p.classList.remove('port-valid')); }
window.addEventListener('mousemove',e=>{
  if(drag){ _dragMoved=true; const pt=canvasPoint(e);
    if(drag.multi){ const dx=pt.x-drag.ox, dy=pt.y-drag.oy;
      drag.multi.forEach(s=>{ const m=node(s.id); if(m){ m.x=Math.max(0,s.x+dx); m.y=Math.max(0,s.y+dy);
        const el=nodesEl.querySelector(`[data-node="${m.id}"]`); if(el){ el.style.left=m.x+'px'; el.style.top=m.y+'px'; } } });
    } else { const n=node(drag.id); n.x=Math.max(0,pt.x-drag.dx); n.y=Math.max(0,pt.y-drag.dy);
      const el=nodesEl.querySelector(`[data-node="${n.id}"]`); if(el){ el.style.left=n.x+'px'; el.style.top=n.y+'px'; } }
    renderEdges(); }
  else if(boxSel){ const pt=canvasPoint(e); boxSel.cx=pt.x; boxSel.cy=pt.y; updateSelectBox(); }
  else if(groupDrag){ const pt=canvasPoint(e); const dx=pt.x-groupDrag.ox,dy=pt.y-groupDrag.oy;
    groupDrag.starts.forEach(s=>{ const n=node(s.id); if(n){ n.x=Math.max(0,s.x+dx); n.y=Math.max(0,s.y+dy); } }); renderNodes(); renderEdges(); }
  else if(wire){ const a=portPos(wire.from,'out'),b=canvasPoint(e); let t=edgesEl.querySelector('.edge-temp');
    if(!t){ t=document.createElementNS('http://www.w3.org/2000/svg','path'); t.setAttribute('class','edge-temp'); edgesEl.appendChild(t); } t.setAttribute('d',edgePath(a,b));
    highlightValidPorts(wire.from); }
});
window.addEventListener('mouseup',e=>{
  if(drag){ const ids=drag.multi?drag.multi.map(s=>s.id):[drag.id]; drag=null; ids.forEach(updateGroupMembership); save(); }
  if(boxSel){ finalizeBoxSelect(); }
  if(groupDrag){ groupDrag=null; save(); }
  if(wire){ const tgt=document.elementFromPoint(e.clientX,e.clientY); const ip=tgt&&tgt.closest&&tgt.closest('.port.in');
    const from=wire.from; wire=null; clearPortHighlight();
    const t=edgesEl.querySelector('.edge-temp'); if(t)t.remove(); renderEdges();
    if(ip) addEdge(from,ip.dataset.id,e.clientX,e.clientY); }
});
function addEdge(from,to,clientX,clientY){
  if(from===to) return toast('Нельзя соединить агента с собой','err');
  if(state.edges.some(x=>x.from===from&&x.to===to)) return;
  if(wouldCycle(from,to)){
    // Backward edge — НЕ создаём петлю молча. Спросим у пользователя через мини-поповер.
    showLoopConfirm(from,to,clientX,clientY);
    return;
  }
  createNormalEdge(from,to);
}
function createNormalEdge(from,to){
  state.edges.push({id:uid(),from,to,condition:'',maxRetries:0,_retryCount:0,
    isLoop:false,autoEval:false,evalThreshold:7,_autoScore:null});
  save(); renderEdges();
}
function createLoopEdge(from,to){
  state.edges.push({id:uid(),from,to,condition:"output.includes('DONE')",maxRetries:5,_retryCount:0,
    isLoop:true,autoEval:false,evalThreshold:7,_autoScore:null});
  save(); renderEdges();
  toast('🔁 Петля создана — настройте условие выхода','ok');
}
// Мини-поповер подтверждения у курсора (НЕ нативный confirm — он блокирует).
let _loopPopEl=null;
function closeLoopConfirm(){ if(_loopPopEl){ _loopPopEl.remove(); _loopPopEl=null; } }
function showLoopConfirm(from,to,clientX,clientY){
  closeLoopConfirm();
  const x=(typeof clientX==='number'?clientX:window.innerWidth/2);
  const y=(typeof clientY==='number'?clientY:window.innerHeight/2);
  const pop=document.createElement('div');
  pop.className='loop-confirm';
  pop.style.cssText=`position:fixed;left:${x}px;top:${y}px;z-index:10000`;
  pop.innerHTML=`
    <div class="loop-confirm-title">Обратная связь</div>
    <button class="loop-confirm-btn loop" data-lc="loop">🔁 Создать петлю (повтор до улучшения)</button>
    <button class="loop-confirm-btn" data-lc="normal">Обычная связь</button>`;
  document.body.appendChild(pop);
  _loopPopEl=pop;
  // Не вылезать за правый/нижний край
  const r=pop.getBoundingClientRect();
  if(r.right>window.innerWidth-8) pop.style.left=(window.innerWidth-r.width-8)+'px';
  if(r.bottom>window.innerHeight-8) pop.style.top=(window.innerHeight-r.height-8)+'px';
  pop.addEventListener('click',ev=>{
    const b=ev.target.closest('[data-lc]'); if(!b) return;
    ev.stopPropagation();
    if(b.dataset.lc==='loop') createLoopEdge(from,to); else createNormalEdge(from,to);
    closeLoopConfirm();
  });
  // Клик вне поповера — отмена (связь не создаётся)
  setTimeout(()=>document.addEventListener('mousedown',function onAway(ev){
    if(_loopPopEl&&!_loopPopEl.contains(ev.target)){ closeLoopConfirm(); document.removeEventListener('mousedown',onAway); }
    else if(!_loopPopEl){ document.removeEventListener('mousedown',onAway); }
  }),0);
}
function wouldCycle(from,to){ const seen=new Set(),st=[to]; while(st.length){ const c=st.pop(); if(c===from) return true; if(seen.has(c)) continue; seen.add(c); state.edges.filter(e=>e.from===c).forEach(e=>st.push(e.to)); } return false; }
// Удаление узлов с авто-перелинковкой: для каждой пары (pred→узел→succ) создаём pred→succ
// (если ребра ещё нет и оно не образует недопустимую петлю). Возвращает true, если что-то перелинковали.
function deleteNodesWithRelink(ids){
  const del=new Set(ids);
  let relinked=false;
  del.forEach(id=>{
    const preds=state.edges.filter(e=>e.to===id&&!del.has(e.from)).map(e=>e.from);
    const succs=state.edges.filter(e=>e.from===id&&!del.has(e.to)).map(e=>e.to);
    preds.forEach(p=>succs.forEach(s=>{
      if(p===s) return;
      if(state.edges.some(x=>x.from===p&&x.to===s)) return;
      if(wouldCycle(p,s)) return; // не плодим петли при перелинковке
      state.edges.push({id:uid(),from:p,to:s,condition:'',maxRetries:0,_retryCount:0,
        isLoop:false,autoEval:false,evalThreshold:7,_autoScore:null});
      relinked=true;
    }));
  });
  state.nodes=state.nodes.filter(x=>!del.has(x.id));
  state.edges=state.edges.filter(e=>!del.has(e.from)&&!del.has(e.to));
  // Чистим выделение и группы
  if(typeof _selected!=='undefined') ids.forEach(id=>_selected.delete(id));
  (state.groups||[]).forEach(g=>{ g.nodeIds=g.nodeIds.filter(nid=>!del.has(nid)); });
  return relinked;
}
edgesEl.addEventListener('click',e=>{
  const tog=e.target.closest('[data-toggle]'); if(tog){ const g=(state.groups||[]).find(x=>x.id===tog.dataset.toggle); if(g){ g.collapsed=!g.collapsed; save(); render(); return; } }
  const gc=e.target.closest('[data-group-click]'); if(gc){ openGroupEditor(gc.dataset.groupClick); return; }
  const p=e.target.closest('[data-edge]'); if(!p) return;
  const ed=state.edges.find(x=>x.id===p.dataset.edge); if(!ed) return;
  const src=node(ed.from); const dst=node(ed.to);
  openDrawer('⚡ Связь: '+esc((src?.name||'?')+' → '+(dst?.name||'?')),
`<div class="cond-builder">
  <div class="section-label" style="margin-top:0">🧩 Конструктор условия</div>
  <div class="hint" style="margin:0 0 8px">Соберите условие выхода без кода. JS-выражение сгенерируется автоматически.</div>
  <div class="row2">
    <div class="field"><label>Тип условия</label>
      <select id="cb-type">
        <option value="">— не задавать (только авто-оценка) —</option>
        <option value="contains">Вывод содержит текст</option>
        <option value="notcontains">Вывод НЕ содержит текст</option>
        <option value="longer">Длиннее N слов</option>
        <option value="score">Оценка ≥ N (нужна авто-оценка)</option>
        <option value="exactly">Повторять ровно N раз</option>
        <option value="approved">Пока редактор не напишет ОДОБРЕНО</option>
      </select>
    </div>
    <div class="field" id="cb-val-wrap" style="display:none"><label id="cb-val-label">Значение</label>
      <input id="cb-val" placeholder="">
    </div>
  </div>
  <button class="btn ghost sm" id="cb-apply" style="margin-top:2px">↧ Применить в условие</button>
</div>
<details class="cond-advanced"${(ed.condition&&ed.condition.trim())?' open':''}>
<summary>⚙ Продвинутый режим — сырой JS</summary>
<div class="field" style="margin-top:8px"><label>Условие выхода (JS)</label>
  <textarea id="ec-cond" rows="3" placeholder="output.includes('PASS')&#10;Оставьте пустым — выходить только по авто-оценке">${esc(ed.condition||'')}</textarea>
  <div class="hint">⚠ Выполняется как JS. Переменная <code>output</code> — текст вывода. <code>true</code> = выйти из петли, <code>false</code> = повторить.</div>
</div>
</details>
${ed.isLoop?`
<div class="section-label" style="margin-top:12px">⚙ Настройки петли</div>
<div class="row2">
  <div class="field"><label>Макс. итераций</label>
    <input type="number" min="1" max="20" id="ec-retries" value="${ed.maxRetries||5}" style="width:80px">
  </div>
  <div class="field"><label>Возврат к</label>
    <span style="font-size:12px;color:var(--txt2)">${esc(node(ed.to)?.name||'?')}</span>
  </div>
</div>
<label class="check" style="margin:8px 0"><input type="checkbox" id="ec-autoeval" ${ed.autoEval?'checked':''}> Авто-оценка LLM (проверяет качество после каждой итерации)</label>
<div id="ec-thresh-wrap" style="${ed.autoEval?'':'display:none'}">
  <div class="field"><label>Порог выхода (1–10)</label>
    <div style="display:flex;align-items:center;gap:8px">
      <input type="number" min="1" max="10" id="ec-thresh" value="${ed.evalThreshold||7}" style="width:60px">
      <span style="font-size:11px;color:var(--dim)">Цикл прекращается когда оценка ≥ порога</span>
    </div>
  </div>
</div>
${ed._autoScore!=null?`<div style="font-size:11px;color:var(--accent);margin-top:4px">Последняя оценка: ${ed._autoScore}/10</div>`:''}
`:`
<div class="field"><label>Повторы при fail</label>
  <div style="display:flex;align-items:center;gap:8px">
    <input type="number" min="0" max="10" id="ec-retries" value="${ed.maxRetries||0}" style="width:60px">
    <span style="font-size:11px;color:var(--dim)">перезапусков источника (0 = нет)</span>
  </div>
</div>`}
<div class="actions" style="margin-top:12px">
  <button class="btn ok" id="ec-save">Сохранить</button>
  <button class="btn ghost" id="ec-test">▶ Тест условия</button>
  <button class="btn danger" id="ec-del">🗑 Удалить связь</button>
</div>`,
  b=>{
    // Toggle auto-eval threshold visibility
    const autoCb=b.querySelector('#ec-autoeval');
    const threshWrap=b.querySelector('#ec-thresh-wrap');
    if(autoCb) autoCb.onchange=()=>{ if(threshWrap) threshWrap.style.display=autoCb.checked?'':'none'; };
    // #24: конструктор условий без кода
    const cbType=b.querySelector('#cb-type');
    const cbValWrap=b.querySelector('#cb-val-wrap');
    const cbVal=b.querySelector('#cb-val');
    const cbValLabel=b.querySelector('#cb-val-label');
    if(cbType){
      const meta={
        contains:{label:'Текст',ph:'PASS',type:'text'},
        notcontains:{label:'Текст',ph:'СТОП',type:'text'},
        longer:{label:'N слов',ph:'500',type:'num'},
        score:{label:'Порог (1–10)',ph:'7',type:'num'},
        exactly:{label:'N раз',ph:'3',type:'num'},
        approved:{label:'',ph:'',type:'none'},
      };
      cbType.onchange=()=>{
        const m=meta[cbType.value];
        if(!m||m.type==='none'){ cbValWrap.style.display='none'; }
        else { cbValWrap.style.display=''; cbValLabel.textContent=m.label; cbVal.placeholder=m.ph; cbVal.value=''; }
      };
      b.querySelector('#cb-apply').onclick=()=>{
        const t=cbType.value; const v=(cbVal?.value||'').trim();
        const esq=s=>String(s).replace(/'/g,"\\'");
        if(!t){ b.querySelector('#ec-cond').value=''; toast('Условие очищено — выход только по авто-оценке'); return; }
        if(t==='contains'){ if(!v){ toast('Введите текст','err'); return; } b.querySelector('#ec-cond').value=`output.includes('${esq(v)}')`; }
        else if(t==='notcontains'){ if(!v){ toast('Введите текст','err'); return; } b.querySelector('#ec-cond').value=`!output.includes('${esq(v)}')`; }
        else if(t==='longer'){ const n2=parseInt(v)||0; b.querySelector('#ec-cond').value=`output.split(/\\s+/).length > ${n2}`; }
        else if(t==='approved'){ b.querySelector('#ec-cond').value=`output.includes('ОДОБРЕНО')`; }
        else if(t==='exactly'){ const n2=Math.max(1,parseInt(v)||1); b.querySelector('#ec-cond').value=''; const ri=b.querySelector('#ec-retries'); if(ri) ri.value=n2; toast('Условие пустое + макс. итераций = '+n2,'ok'); return; }
        else if(t==='score'){ const n2=Math.min(10,Math.max(1,parseInt(v)||7));
          // спец-маркер: включаем авто-оценку и ставим порог (петля); JS-условие не нужно
          b.querySelector('#ec-cond').value='';
          if(autoCb){ autoCb.checked=true; if(threshWrap) threshWrap.style.display=''; }
          const th=b.querySelector('#ec-thresh'); if(th) th.value=n2;
          toast(autoCb?'Авто-оценка вкл., порог '+n2:'Порог '+n2+' — включите авто-оценку (петля)','ok'); return;
        }
        toast('JS-условие сгенерировано','ok');
      };
    }
    b.querySelector('#ec-save').onclick=()=>{
      ed.condition=b.querySelector('#ec-cond').value.trim();
      ed.maxRetries=parseInt(b.querySelector('#ec-retries')?.value)||0;
      if(ed.isLoop){
        ed.autoEval=b.querySelector('#ec-autoeval')?.checked||false;
        ed.evalThreshold=parseInt(b.querySelector('#ec-thresh')?.value)||7;
      }
      save(); renderEdges(); closeDrawer(); toast('Настройки петли сохранены','ok');
    };
    b.querySelector('#ec-test').onclick=()=>{
      const cond=b.querySelector('#ec-cond').value.trim();
      const r=evalCondition(cond,src?.output);
      toast(cond?(r?'✅ true — выходим из петли':'🔁 false — повторяем'):'(пусто) → только по авто-оценке',r?'ok':'');
    };
    b.querySelector('#ec-del').onclick=()=>{
      state.edges=state.edges.filter(x=>x.id!==ed.id);
      save(); renderEdges(); closeDrawer(); toast('Связь удалена');
    };
  });
});

/* ============ ГЕНЕРАЦИЯ ============ */
async function runNode(id){
  const n=node(id); const c=cfg(n);
  if(!c.apiKey){ n.status='error'; n.error='Нужен API-ключ'; logRow(n.name,'error','нет ключа'); toast('Добавьте API-ключ в настройках','err'); save(); renderNodes(); openSettings(); return false; }
  const msgs=await buildMessages(n);
  // Item 29: накопление правок в цикле — передаём предыдущий вывод как контекст для улучшения
  if(n._loopPrev){
    msgs.push({role:'user',content:'Предыдущая версия (улучши её, не пиши с нуля):\n'+n._loopPrev});
  }
  const hash=JSON.stringify([msgs,c.model,c.temperature]);
  if(n.cacheHash===hash && n.output){ n.status='done'; n.error=''; logRow(n.name,'cache','из кэша (без вызова)'); save(); renderNodes(); renderEdges(); return true; }

  // ── T11: Multi-variant mode ──────────────────────────────────────────────
  if((n.variants||1) > 1){
    const varCount = Math.min(n.variants, 5);
    n.status = 'running'; save(); renderNodes();
    try {
      const results = await Promise.all(
        Array.from({length: varCount}, (_, i) =>
          callLLM({...cfg(n), temperature: Math.min(1.5, (cfg(n).temperature||1.0) + i * 0.15)}, msgs)
            .catch(e => `[Вариант ${i+1} не удался: ${e.message}]`)
        )
      );
      n.status = 'variants';
      n.variantOutputs = results;
      n.output = results[0];
      if(!n.outputVersions) n.outputVersions = [];
      results.forEach((r,i) => n.outputVersions.unshift({ts:Date.now()+i, output:r, tokensIn:tokEst(msgs.map(m=>m.content).join(' ')), tokensOut:tokEst(r)}));
      if(n.outputVersions.length > 5) n.outputVersions = n.outputVersions.slice(0,5);
      save(); renderNodes();
      openVariantPicker(n);
      return true;
    } catch(e){
      n.status='error'; n.error=String(e.message); save(); renderNodes();
      return false;
    }
  }

  // ── T12: Fanout mode ─────────────────────────────────────────────────────
  const isFanout = (n.nodeType === 'fanout') || (TEMPLATES.find(t=>t.name===n.name)?.role === 'fanout');
  if(isFanout){
    const preds = state.edges.filter(e=>e.to===n.id).map(e=>node(e.from)).filter(p=>p?.output);
    let tasks = [];
    if(preds.length > 0){
      const src = preds[0].output;
      try {
        const parsed = JSON.parse(src.match(/\[[\s\S]*\]/)?.[0] || src);
        if(Array.isArray(parsed)) tasks = parsed.map(t => String(t));
      } catch(e){
        tasks = src.split('\n').map(l=>l.trim()).filter(l=>l.length > 10).slice(0, 20);
      }
    }
    if(!tasks.length){
      tasks = ['Напиши главу 1', 'Напиши главу 2', 'Напиши главу 3'];
    }
    const maxTasks = n.fanoutCount > 0 ? Math.min(n.fanoutCount, tasks.length) : Math.min(tasks.length, 20);
    tasks = tasks.slice(0, maxTasks);

    n.status = 'running';
    save(); renderNodes();

    try {
      const fc = cfg(n);
      const fanoutResults = await Promise.all(tasks.map((task, i) => {
        const taskMsgs = [
          { role: 'system', content: n.prompt || 'Ты — писатель. Выполни задание.' },
          { role: 'user',   content: `${task}\n\nКонтекст проекта:\nКнига: «${state.project.title||''}»\nЖанр: ${state.project.genre||''}\nБриф: ${state.project.brief||''}` }
        ];
        return callLLM(fc, taskMsgs).catch(e => `[Глава ${i+1} не удалась: ${e.message}]`);
      }));

      n.fanoutOutputs = fanoutResults.map((out, i) => ({ task: tasks[i], output: out }));
      n.output = fanoutResults.map((out, i) => `## ${tasks[i]}\n\n${out}`).join('\n\n---\n\n');
      n.status = 'done';

      if(!n.outputVersions) n.outputVersions = [];
      n.outputVersions.unshift({ ts: Date.now(), output: n.output, tokensIn: 0, tokensOut: tokEst(n.output) });
      if(n.outputVersions.length > 5) n.outputVersions = n.outputVersions.slice(0,5);

      logRow(n.name, 'ok', `Fanout: ${fanoutResults.length} глав написано`);
      save(); renderNodes(); renderEdges();
      return true;
    } catch(e){
      n.status='error'; n.error=String(e.message||e);
      save(); renderNodes();
      return false;
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── «Согласование»: спросить решение у человека ──────────────────────────
  if(n.nodeType==='decision'){
    n.status='running'; n.output=''; n.error=''; save(); renderNodes();
    try{
      const raw=await callLLM(cfg(n), msgs);
      n.tokensIn=tokEst(msgs.map(m=>m.content).join('')); n.tokensOut=tokEst(raw);
      let issues=[];
      try{
        const m=raw.match(/\[[\s\S]*\]/);
        const parsed=JSON.parse(m?m[0]:raw);
        if(Array.isArray(parsed)) issues=parsed.filter(x=>x&&x.issue);
      }catch{}
      // Очистим прежние открытые вопросы этого узла (на случай повторного прогона)
      if(state.attention) state.attention=state.attention.filter(a=>!(a.nodeId===n.id&&a.status==='open'));
      if(issues.length){
        issues.forEach(iss=>{
          const opts=(Array.isArray(iss.options)?iss.options:[]).map(o=>({label:String(o),value:String(o)}));
          raiseAttention({ nodeId:n.id, title:n.name+': '+String(iss.issue).slice(0,60), detail:String(iss.issue),
            options:opts.length?opts:[{label:'Принять',value:'Принять'}] });
        });
        n.status='review'; n.error='';
        logRow(n.name,'warn','🔔 нужно решение: '+issues.length+' вопрос(ов)');
        save(); renderNodes(); renderEdges();
        toast('🔔 Требуется ваше решение — внизу','warn');
        return true;
      } else {
        // Нет вопросов — узел просто завершён с выводом как есть.
        n.output=raw; n.status='done'; n.error='';
        logRow(n.name,'ok','нестыковок не найдено');
        save(); renderNodes(); renderEdges();
        return true;
      }
    }catch(err){
      n.status='error'; n.error=String(err.message||err); save(); renderNodes(); return false;
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

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
        if(_panelNodeId===id){ const pb=document.getElementById('np-body'); if(pb){ pb.textContent=acc; pb.scrollTop=pb.scrollHeight; } }
        n.output=acc; const now=Date.now(); if(now-lastPartialSave>2000){ save(); lastPartialSave=now; } }
      if(!acc.trim()) throw new Error('пустой ответ от модели');
      // #48: фиксируем ТО, ЧТО РЕАЛЬНО ушло и вернулось (для секции «📡 Что ушло/вернулось»).
      // Транзиентные поля — исключены из save() (рядом с _vec/_loopPrev).
      n.lastRequest={ messages: msgs, model: c.model, temperature: c.temperature, ts: Date.now() };
      n.lastRawOutput=acc; // сырой ответ ДО postProcess
      n.output=acc; n.summary=acc.length>600?acc.slice(0,600)+'…':acc; n.cacheHash=hash;
      if(state.global.autoSummarize&&acc.length>800){
        try{ const sc=cfg(n);
          const sr=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({baseURL:sc.baseURL,apiKey:sc.apiKey,model:sc.model,temperature:0.3,proxyToken:state.global.proxyToken,
              messages:[{role:'system',content:'Сожми в 3–5 предложений, сохрани ключевые факты. Только саммари, без предисловий.'},
                {role:'user',content:acc.slice(0,6000)}]})});
          if(sr.ok){const rd=sr.body.getReader(),dc2=new TextDecoder();let sm='';
            while(true){const{value:v,done:d}=await rd.read();if(d)break;sm+=dc2.decode(v,{stream:true});}
            if(sm.trim())n.summary=sm.trim();
            trackAux(acc.slice(0,6000), sm, sc.model, 'Авто-саммари');}
        }catch{} // саммари-ошибка не должна рушить пайплайн
      }
      // Постпроцессор вывода
      if(n.postProcess&&n.postProcess.trim()){ try{ const r=new Function('output',n.postProcess)(acc); if(typeof r==='string'&&r){acc=r;n.output=acc;} }catch(e){ logRow(n.name,'warn','postProcess: '+String(e.message).slice(0,80)); } }
      n.tokensIn=tokEst(msgs.map(m=>m.content).join('')); n.tokensOut=tokEst(acc); n.ms=Math.round(performance.now()-t0);
      n.status= n.requireApproval && !n.approved ? 'review' : 'done'; n.error='';
      logRow(n.name,'ok',`${n.tokensIn+n.tokensOut} ток., ${(n.ms/1000).toFixed(1)}с`,{cost:nodeCost(n)});
      // Путь 2: авто-маркер ⚠ВОПРОС: — любой агент может поднять вопрос на согласование.
      // Формат: строка «⚠ВОПРОС: <вопрос>», затем строки «- <вариант>».
      const qm=acc.match(/⚠ВОПРОС:\s*([\s\S]*)$/);
      if(qm){
        const lines=qm[1].split('\n').map(l=>l.trim()).filter(Boolean);
        const question=lines.shift()||'Требуется решение';
        const opts=lines.filter(l=>/^[-•*]/.test(l)).map(l=>{const v=l.replace(/^[-•*]\s*/,'').trim();return{label:v,value:v};});
        if(state.attention) state.attention=state.attention.filter(a=>!(a.nodeId===n.id&&a.status==='open'));
        raiseAttention({ nodeId:n.id, title:n.name+': '+question.slice(0,60), detail:question,
          options:opts.length?opts:[{label:'Принять как есть',value:'Принять как есть'}] });
        n.status='review';
        toast('🔔 Требуется ваше решение — внизу','warn');
      }
      // Верификация Bible: логируем ключи, которые должны были использоваться
      const relevantBible=bibleFor(acc); if(relevantBible) logRow(n.name,'bible','Проверьте каноны: '+bibleFor(acc).split('\n').map(l=>l.split(':')[0].replace('•','').trim()).filter(Boolean).join(', '));
      // Проверка JSON-схемы выхода (если задана)
      const schemaErr=checkSchema(n); if(schemaErr) logRow(n.name,'warn','⚠ Схема: '+schemaErr);
      // Save output version history
      if(n.output){
        if(!n.outputVersions) n.outputVersions = [];
        n.outputVersions.unshift({
          ts: Date.now(),
          output: n.output,
          tokensIn: n.tokensIn || 0,
          tokensOut: n.tokensOut || 0,
        });
        if(n.outputVersions.length > 5) n.outputVersions = n.outputVersions.slice(0, 5);
      }
      // Item 11: пост-проверка стоп-слов в выводе
      n.banHits=scanBanList(n.output);
      if(n.banHits.length){
        const tot=n.banHits.reduce((s,h)=>s+h.count,0);
        logRow(n.name,'warn',`найдено ${tot} запрещённых слов: `+n.banHits.map(h=>`${h.word}×${h.count}`).join(', '));
      }
      // ⚖ Вердикт-пауза: решающий агент рекомендует ОТКЛОНИТЬ → пауза, спросить человека.
      if(n.verdictGate && n.status==='done' && /отклон|reject|не\s+в\s+производств|вердикт[:\s]+отклон/i.test(acc)){
        let frag=''; const vm=acc.match(/.*(?:отклон|reject|не\s+в\s+производств).*/i);
        frag=(vm?vm[0]:acc).trim().slice(0,200);
        if(state.attention) state.attention=state.attention.filter(a=>!(a.nodeId===n.id&&a.status==='open'));
        raiseAttention({ nodeId:n.id, kind:'verdict', title:n.name+' рекомендует ОТКЛОНИТЬ', detail:frag,
          options:[{label:'⏹ Остановить конвейер',value:'stop'},{label:'▶ Продолжить всё равно',value:'continue'},{label:'✏ Поправить бриф/замысел',value:'revise'}] });
        n.status='review';
        toast('🔔 Вердикт «отклонить» — нужно ваше решение','warn');
      }
      save(); renderNodes(); renderEdges();
      // Auto-eval for outgoing loop edges (Item 25: regression-guard + best-output)
      const loopEdges=state.edges.filter(e=>e.from===n.id && e.isLoop && e.autoEval);
      for(const le of loopEdges){
        try{
          const {score,reason}=await runAutoEval(n.output, n);
          le._autoScore=score;
          if(!le._scoreHistory) le._scoreHistory=[];
          le._scoreHistory.push(score);
          // Запоминаем лучшую версию вывода (Item 25: regression-guard)
          if(le._bestScore==null || score>le._bestScore){ le._bestScore=score; le._bestOutput=n.output; }
          logRow(n.name,'ok',`авто-оценка: ${score}/10${reason?' — '+reason:''}`);
          save();
        }catch(err){ console.warn('auto-eval failed',err); }
      }
      // Auto-bible update (non-blocking, fire-and-forget)
      const _role=TEMPLATES.find(t=>t.name===n.name)?.role || '';
      autoBibleUpdate(n.output, _role).catch(()=>{});
      // #50: после каждого успешного prose-узла дублируем снимок в IndexedDB (надёжность)
      if(BOOK_ROLES.has(_role) && n.output && n.output.length>200) idbBackupNow();
      return true;
    }catch(err){
      if(err.name==='AbortError'){ n.status='idle'; n.error=''; if(acc) n.output=acc; logRow(n.name,'error','остановлено'); save(); renderNodes(); renderEdges(); return false; }
      if(attempt<maxR && /network|fetch|Failed/i.test(String(err.message))){ logRow(n.name,'retry','сеть, повтор #'+(attempt+1)); await wait(1000*2**attempt); continue; }
      const raw=String(err.message||err); n.status='error'; n.output=acc;
      const httpStatus=statusFromError(raw);
      const human=httpStatus?humanError(httpStatus,raw):(/network|fetch|Failed/i.test(raw)?'Нет связи — проверьте интернет и адрес провайдера':humanError(0,raw));
      n.error=human; logRow(n.name,'error',human+' · '+raw.slice(0,160)); // полный текст — в лог
      save(); renderNodes(); renderEdges(); toast('Ошибка «'+n.name+'»: '+human,'err'); return false;
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
const isPaused=()=>state.nodes.some(n=>n.status==='review'||n.status==='variants')||(state.attention||[]).some(a=>a.status==='open');
let running=false; let abortCtrl=null;
// Находит узлы, готовые к запуску: idle + все зависимости done (или ошибочные — пропустить)
// Узлы из цепочки target→…→checker (по прямым, НЕ петлевым рёбрам), включая концы.
function chainBetween(fromId,toId){
  const fwd=new Set(); let st=[fromId];
  while(st.length){ const c=st.pop(); if(fwd.has(c)) continue; fwd.add(c); state.edges.filter(e=>!e.isLoop&&e.from===c).forEach(e=>st.push(e.to)); }
  const bwd=new Set(); st=[toId];
  while(st.length){ const c=st.pop(); if(bwd.has(c)) continue; bwd.add(c); state.edges.filter(e=>!e.isLoop&&e.to===c).forEach(e=>st.push(e.from)); }
  const res=new Set([...fwd].filter(x=>bwd.has(x))); res.add(fromId); res.add(toId);
  return [...res];
}
// Фаза перепроверки: для каждого петлевого/повторного ребра, когда проверяющий завершился,
// решаем — выходим (порог пройден / попытки исчерпаны) или возвращаем цепочку на доработку.
// ВАЖНО: вызывается ДО runnableNodes в цикле прогона.
function resolveLoops(){
  const reEdges=state.edges.filter(e=>e.isLoop || ((e.condition&&e.condition.trim())&&(e.maxRetries||0)>0));
  for(const e of reEdges){
    const checker=node(e.from), target=node(e.to);
    if(!checker||!target) continue;
    if(checker.status!=='done') continue;          // ждём завершения проверяющего
    const out=checker.output||'';
    const jsPass = (e.condition&&e.condition.trim()) ? evalCondition(e.condition,out) : (e.isLoop?false:true);
    // авто-оценка: историю пополняем один раз на каждое завершение проверяющего
    if(e.isLoop && e.autoEval && e._autoScore!=null){
      e._scoreHistory=e._scoreHistory||[];
      if(e._lastScored!==e._autoScore){ e._scoreHistory.push(e._autoScore); e._lastScored=e._autoScore;
        if(e._bestScore==null||e._autoScore>e._bestScore){ e._bestScore=e._autoScore; e._bestOutput=target.output; } }
    }
    const evalPass = e.isLoop && e.autoEval && e._autoScore!=null && e._autoScore>=(e.evalThreshold||7);
    const pass = jsPass || evalPass;
    // регресс / плато для авто-оценочных петель
    let stop=false;
    if(e.isLoop && e.autoEval){ const h=e._scoreHistory||[];
      if(h.length>=2){ const a=h[h.length-1],b=h[h.length-2]; if(a<b) stop=true; if(h.length>=3&&a<=b&&b<=h[h.length-3]) stop=true; } }
    if(pass || (e._retryCount||0)>=(e.maxRetries||0) || stop){
      // Петля завершена. Если копили лучшую версию target — вернём её.
      if(e.isLoop && e.autoEval && e._bestOutput!=null && target.output!==e._bestOutput){
        logRow(target.name,'ok',`Петля завершена — лучшая версия (балл ${e._bestScore}/10)`);
        target.output=e._bestOutput;
      }
      if(target._loopPrev!=null) delete target._loopPrev;
      continue;
    }
    // Возврат на доработку: сбрасываем цепочку target..checker
    e._retryCount=(e._retryCount||0)+1;
    e._lastScored=null;
    const chain=chainBetween(target.id,checker.id);
    chain.forEach(id=>{ const x=node(id); if(!x) return;
      if(x.id===target.id) x._loopPrev=x.output||'';   // #29: прошлый текст → в контекст доработки
      x.status='idle'; x.output=''; x.cacheHash=''; });
    logRow(checker.name,'retry',`Повтор ${e._retryCount}/${e.maxRetries} — на доработку к «${target.name}»`);
    save();
  }
}
function runnableNodes(){
  return state.nodes.filter(n=>{
    if(n.status!=='idle') return false;
    // ПЕТЛЕВЫЕ рёбра НЕ являются зависимостью — иначе цель петли «ждёт» проверяющего, который идёт после неё (дедлок)
    const fwd=state.edges.filter(e=>e.to===n.id && !e.isLoop);
    if(!fwd.length) return true;                       // нет прямых зависимостей — готов
    const allDone=fwd.map(e=>node(e.from)).filter(Boolean).every(d=>['done','error','skip'].includes(d.status));
    if(!allDone) return false;
    // Условные прямые рёбра: хотя бы одно активно → запускаем; все false → skip
    const conds=fwd.filter(e=>e.condition&&e.condition.trim());
    if(!conds.length) return true;
    const anyActive=fwd.some(e=>!e.condition||!e.condition.trim()||evalCondition(e.condition,node(e.from)?.output));
    if(anyActive) return true;
    n.status='skip'; logRow(n.name,'skip','условия всех путей → false'); save(); return false;
  });
}
async function runPipeline(resume){
  if(running) return;
  if(!hasKey()){ toast('Сначала добавьте API-ключ — без него агенты не смогут писать','err'); return openSettings(); }
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
    state.nodes.forEach(n=>{n.status='idle';n.error='';n.approved=false;delete n._loopPrev;n.failedWithDownstream=false;delete n.attentionChoice;});
    state.attention=[]; // новый полный прогон — сбрасываем накопленные решения/вопросы
    renderAttention();
    state.edges.forEach(e=>{ e._retryCount=0; e._scoreHistory=[]; e._bestScore=null; e._bestOutput=null; e._lastScored=null; });
    // #47: сбрасываем счётчик скрытых служебных вызовов на новый прогон
    state.auxTokens=0; state.auxCost=0;
    hideCompletionBanner();
    save(); renderNodes(); renderEdges();
    // Предоценка стоимости
    const estCost=state.nodes.reduce((sum,n)=>{const p=PRICES[cfg(n).model]||{in:0.14,out:0.28};return sum+(n.tokensIn||2000)/1e6*p.in+(n.tokensOut||1500)/1e6*p.out;},0);
    if(estCost>0.001) toast('Расчётная стоимость: ~'+money(estCost)+(state.global.costCapUSD>0&&estCost>state.global.costCapUSD*0.8?' ⚠ близко к лимиту!':''),'');
    // Hard pre-check бюджета
    if(state.global.costCapUSD>0 && estCost>state.global.costCapUSD){ toast('Расчётная стоимость '+money(estCost)+' превышает лимит '+money(state.global.costCapUSD),'err'); return; }
    // 🧭 Замысел книги — фундамент. Если есть бриф, но замысла нет — собираем его и просим утвердить ПЕРЕД писаниной.
    if(!conceptBlock() && state.project.brief && state.project.brief.trim()){
      toast('Сначала соберём замысел книги…');
      try{ await generateConcept(true); }catch(e){ /* не блокируем старт при ошибке генерации */ }
      const c=(state.project.concept)||{};
      if(conceptBlock()){
        const charsStr=(Array.isArray(c.characters)?c.characters:[]).map(p=>p.name||p.role).filter(Boolean).slice(0,6).join(', ');
        const detail=[c.setting?('Место/время: '+c.setting):'', charsStr?('Персонажи: '+charsStr):''].filter(Boolean).join('\n').slice(0,400)||'Замысел подготовлен.';
        const firstId=(state.nodes[0]&&state.nodes[0].id)||null;
        raiseAttention({ nodeId:firstId, kind:'concept', title:'Замысел книги готов — проверьте', detail,
          options:[{label:'✅ Принять и писать',value:'accept'},{label:'✏ Открыть и поправить',value:'edit'}] });
        return; // ждём решения человека; повторный запуск пройдёт мимо (concept уже не пуст)
      }
    }
  }
  abortCtrl=new AbortController();
  running=true; $('#run-btn').disabled=true; $('#run-btn').textContent='⏳ Работает…'; render();
  let cacheHits=0, totalRan=0;
  while(true){
    if(state.global.costCapUSD>0 && (projectCost()+(state.auxCost||0))>=state.global.costCapUSD){ toast('Достигнут лимит бюджета '+money(state.global.costCapUSD),'err'); break; }
    resolveLoops();                                   // фаза перепроверки: возвраты на доработку до подбора волны
    const wave=runnableNodes(); if(!wave.length) break;
    // Параллельный запуск независимых узлов одной волны (Item 27: семафор ограничивает конкурентность)
    const runOne=async n=>{
      const wasAborted=abortCtrl.signal.aborted;
      if(wasAborted){ n.status='idle'; return 'abort'; }
      const ok=await runNode(n.id);
      if(ok && n.cacheHash && !n.ms) cacheHits++;
      totalRan++;
      // 3.4: при ошибке не останавливаем весь пайплайн — ставим skip, даём downstream пустой контекст
      if(!ok && n.status==='error' && !abortCtrl.signal.aborted){
        n.status='error'; // downstream получит пустой output — это нормально
        // Item 28: помечаем узел, у которого есть downstream-потребители
        if(state.edges.some(e=>e.from===n.id)){
          n.failedWithDownstream=true;
          logRow(n.name,'error','⚠ АГЕНТ УПАЛ — у него есть зависимые узлы, контекст для них будет пустым'+
            (state.global.onErrorPolicy==='pause'?' (политика: ПАУЗА)':''));
        }
        return 'error';
      }
      return ok?'ok':'abort';
    };
    const results=await runWithLimit(wave.map(n=>()=>runOne(n)), state.global.maxConcurrent||3);
    // Item 28: при политике "pause" останавливаем пайплайн, если упал узел с downstream
    if(state.global.onErrorPolicy==='pause' && state.nodes.some(n=>n.status==='error'&&n.failedWithDownstream)){
      toast('⏸ Пайплайн на паузе: агент упал (политика «пауза при провале»)','err');
      break;
    }
    if(results.includes('abort')) break;
    if((state.attention||[]).some(a=>a.status==='open')){
      toast('🔔 Требуется ваше решение — внизу','warn');
      break;
    }
    if(state.nodes.some(n=>n.status==='variants')){
      toast('Выберите вариант — пайплайн ждёт 🔀','warn');
      break;
    }
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
  const errCount=state.nodes.filter(n=>n.status==='error').length;
  if(totalRan>0) logRow('Пайплайн',errCount?'warn':'ok',`${done}/${total} агентов · кэш: ${cacheHits}/${totalRan}`+(errCount?` · упало: ${errCount}`:''));
  if(errCount) logRow('Пайплайн','warn',`Готово частично: ${done} из ${total} (упавшие: ${state.nodes.filter(n=>n.status==='error').map(n=>n.name).join(', ')})`);
  if(state.nodes.every(n=>n.status==='done'||n.status==='error'||n.status==='skip')){
    toast(errCount===0?'Книга готова ✓':'Готово частично: '+done+' из '+total,errCount===0?'ok':'warn');
    if(done>0) showCompletionBanner();
  }
  // Авто-оценка: если флаг включён и есть результаты — фоновый LLM-judge
  if(state.global.autoEval && done>0 && hasKey()) autoEvalPipeline();
  // Авто-бэкап после каждого успешного прогона
  if(state.global.autoBackup && done>0) autoBackupNow(true);
}
// Item 30: прогон подграфа «отсюда вниз» — узел + все его потомки (BFS)
async function runFromNode(id){
  if(running){ toast('Пайплайн уже выполняется','warn'); return; }
  if(!hasKey()){ toast('Сначала задайте API-ключ','err'); return openSettings(); }
  const start=node(id); if(!start) return;
  // BFS: собрать целевой узел + всех потомков
  const sub=new Set([id]), q=[id];
  while(q.length){
    const cur=q.shift();
    state.edges.filter(e=>e.from===cur && !e.isLoop).forEach(e=>{ if(!sub.has(e.to)){ sub.add(e.to); q.push(e.to); } });
  }
  // Сбросить ТОЛЬКО узлы подграфа (предков не трогаем — они останутся done)
  state.nodes.forEach(n=>{
    if(sub.has(n.id)){ n.status='idle'; n.error=''; n.approved=false; n.cacheHash=''; delete n._loopPrev; n.failedWithDownstream=false; }
  });
  state.edges.forEach(e=>{ if(sub.has(e.from)){ e._retryCount=0; e._scoreHistory=[]; e._bestScore=null; e._bestOutput=null; } });
  hideCompletionBanner();
  save(); renderNodes(); renderEdges();
  abortCtrl=new AbortController();
  running=true; $('#run-btn').disabled=true; $('#run-btn').textContent='⏳ Работает…'; render();
  logRow(start.name,'ok',`▶▶ Прогон отсюда вниз: ${sub.size} узлов`);
  let totalRan=0;
  while(true){
    if(state.global.costCapUSD>0 && (projectCost()+(state.auxCost||0))>=state.global.costCapUSD){ toast('Достигнут лимит бюджета '+money(state.global.costCapUSD),'err'); break; }
    // Волны, ограниченные подмножеством sub (runnableNodes уже ждёт готовых предков)
    resolveLoops();
    const wave=runnableNodes().filter(n=>sub.has(n.id));
    if(!wave.length) break;
    const runOne=async n=>{
      if(abortCtrl.signal.aborted){ n.status='idle'; return 'abort'; }
      const ok=await runNode(n.id); totalRan++;
      if(!ok && n.status==='error' && !abortCtrl.signal.aborted){
        if(state.edges.some(e=>e.from===n.id)) n.failedWithDownstream=true;
        return 'error';
      }
      return ok?'ok':'abort';
    };
    const results=await runWithLimit(wave.map(n=>()=>runOne(n)), state.global.maxConcurrent||3);
    if(results.includes('abort')) break;
    if(state.nodes.some(n=>n.status==='variants'||n.status==='review')||(state.attention||[]).some(a=>a.status==='open')){ toast('Пайплайн ждёт действия','warn'); break; }
  }
  running=false; $('#run-btn').disabled=false; render();
  const done=state.nodes.filter(n=>sub.has(n.id)&&n.status==='done').length;
  if(totalRan>0) logRow('Пайплайн','ok',`Прогон отсюда: ${done}/${sub.size} узлов выполнено`);
  if(done>0) showCompletionBanner();
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
    trackAux(`Проект: «${pr.title}»\nБриф: ${pr.brief}\n\n${outputs}`, acc, c.model, 'Авто-оценка пайплайна');
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
function openVariantPicker(n){
  if(!n.variantOutputs?.length) return;
  let html = `<p class="hint" style="margin-top:0">Выберите лучший вариант — он станет выводом агента и передастся дальше.</p>`;
  n.variantOutputs.forEach((v, i) => {
    const wc = Math.round((v||'').split(/\s+/).length);
    const preview = esc((v||'').slice(0, 200)) + ((v||'').length > 200 ? '…' : '');
    html += `<div class="variant-card ${i===0?'variant-selected':''}" data-vi="${i}">
      <div class="variant-head">
        <span class="variant-label">Вариант ${i+1}</span>
        <span class="variant-meta">${wc} слов</span>
        ${i>0?`<button class="btn ghost sm" data-vdiff="${i}">± vs В1</button>`:''}
        <button class="btn ${n.output===v?'ok':'ghost'} sm" data-action="pick-variant" data-id="${n.id}" data-vi="${i}">
          ${n.output===v?'✓ Выбран':'Выбрать'}
        </button>
      </div>
      <pre class="variant-preview">${preview}</pre>
    </div>`;
  });
  openDrawer('Варианты: ' + esc(n.name), html, b=>{
    b.querySelectorAll('[data-vdiff]').forEach(btn=>btn.onclick=()=>{
      const i=+btn.dataset.vdiff;
      openWordDiff(`± Вариант 1 ↔ Вариант ${i+1} — ${esc(n.name)}`,
        n.variantOutputs[0]||'', n.variantOutputs[i]||'', ()=>openVariantPicker(n));
    });
  });
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

/* ============ WORD DIFF (Item 17) ============ */
// Пословный diff (LCS — динамика по словам, как у Myers для коротких текстов).
// Возвращает HTML с <del class="wd"> (удалено) и <ins class="wd"> (добавлено).
function wordDiff(oldText, newText){
  // Токенизируем, сохраняя слова и разделители (пробелы/переносы) как отдельные токены —
  // так структура текста (абзацы) не ломается.
  const tok=s=>(s||'').match(/\s+|[^\s]+/g)||[];
  const a=tok(oldText), b=tok(newText);
  const n=a.length, m=b.length;
  // LCS-таблица. Для очень длинных текстов ограничиваем, чтобы не съесть память.
  if(n*m>4_000_000){
    // Грубый fallback: показываем целиком как замену.
    return `<del class="wd">${esc(oldText||'')}</del><ins class="wd">${esc(newText||'')}</ins>`;
  }
  const dp=Array.from({length:n+1},()=>new Uint32Array(m+1));
  for(let i=n-1;i>=0;i--)
    for(let j=m-1;j>=0;j--)
      dp[i][j]=a[i]===b[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
  let i=0,j=0,html='',delBuf='',insBuf='';
  const flush=()=>{
    if(delBuf){ html+=`<del class="wd">${esc(delBuf)}</del>`; delBuf=''; }
    if(insBuf){ html+=`<ins class="wd">${esc(insBuf)}</ins>`; insBuf=''; }
  };
  while(i<n&&j<m){
    if(a[i]===b[j]){ flush(); html+=esc(a[i]); i++; j++; }
    else if(dp[i+1][j]>=dp[i][j+1]){ delBuf+=a[i]; i++; }
    else { insBuf+=b[j]; j++; }
  }
  while(i<n){ delBuf+=a[i]; i++; }
  while(j<m){ insBuf+=b[j]; j++; }
  flush();
  return html;
}
// Открывает блок сравнения двух текстов через wordDiff.
function openWordDiff(title, oldText, newText, backFn){
  const dw=( (newText||'').match(/\S+/g)||[] ).length-( (oldText||'').match(/\S+/g)||[] ).length;
  const dc=(newText||'').length-(oldText||'').length;
  const human=(v,unit)=> (v>0?'+':'')+v+' '+unit;
  openDrawer(title,
    `<div class="hint" style="margin-bottom:8px">Красным — удалено, зелёным — добавлено (по словам). `+
    `${human(dw,'сл.')} · ${human(dc,'симв.')}</div>`+
    `<div class="diff-box">${wordDiff(oldText,newText)}</div>`+
    (backFn?`<div class="actions" style="margin-top:12px"><button class="btn ghost" id="wd-back">← Назад</button></div>`:''),
    backFn?b=>{ b.querySelector('#wd-back').onclick=backFn; }:undefined);
}

/* ============ DRAWER ============ */
const drawer=$('#drawer'), scrim=$('#scrim');
function openDrawer(title,html,mount){ $('#drawer-title').textContent=title; const b=$('#drawer-body'); b.innerHTML=html;
  drawer.classList.add('show'); scrim.classList.add('show'); if(mount) mount(b); }
function closeDrawer(){ drawer.classList.remove('show'); scrim.classList.remove('show'); }
$('#drawer-close').onclick=closeDrawer; scrim.onclick=closeDrawer;
// ─── Keyboard shortcuts ───
document.addEventListener('keydown', e => {
  if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if(ctrl && e.key==='z'){ e.preventDefault(); undoCanvas(); return; }
  if(ctrl && e.key==='y'){ e.preventDefault(); redoCanvas(); return; }
  if(ctrl && e.key==='Enter'){ e.preventDefault(); runPipeline(); return; }
  if(e.key==='Escape'){ if(_panelNodeId) closeNodePanel(); closeDrawer(); return; }
  if(e.key==='r' && !ctrl){
    switchView(typeof _currentView!=='undefined' && _currentView==='reader'?'canvas':'reader');
    return;
  }
  // #46: Delete удаляет всех выделенных (с авто-перелинковкой)
  if((e.key==='Delete'||e.key==='Backspace') && _selected.size){
    e.preventDefault();
    const ids=[..._selected];
    const relinked=deleteNodesWithRelink(ids);
    save(); render();
    toast(`Удалено агентов: ${ids.length}`+(relinked?' · связи перенаправлены':''));
    return;
  }
  if(e.key==='Escape' && _selected.size){ clearSelection(); return; }
});

function openNode(id){
  const n=node(id);
  const outBlock=n.error?`<div class="deliverable err"><div class="label">Ошибка</div>${esc(n.error)}</div>`:(n.output?`<div class="deliverable"><div class="label">Результат · ${n.tokensIn+n.tokensOut} ток. · ${money(nodeCost(n))}</div>${md2html(n.output)}</div>`:'');
  // Корреляция: рядом с каждой версией промта показываем ближайший eval-score
  const evalHist=state.evalHistory||[];
  const nearestEval=t=>{ const e=evalHist.filter(x=>x.t>=t).sort((a,b)=>a.t-b.t)[0]; return e&&e.score?` · ⭐${e.score}/40`:''; };
  const hist=n.promptHistory.length?`<div class="section-label">История промта (${n.promptHistory.length})</div>`+
    n.promptHistory.slice(0,5).map((h,i)=>`<div class="histrow"><span>${new Date(h.t).toLocaleString('ru-RU')}${nearestEval(h.t)}</span><button class="btn ghost sm" data-revert="${i}">↩ вернуть</button></div>`).join(''):'';
  let versSection = '';
  if(n.outputVersions && n.outputVersions.length > 1){
    versSection = `<div class="set-section"><div class="set-section-title">🕐 Версии вывода (${n.outputVersions.length})</div>`;
    n.outputVersions.forEach((v, i) => {
      const d = new Date(v.ts);
      const label = i === 0 ? '(текущая)' : 'от ' + d.toLocaleTimeString('ru');
      const wc = Math.round((v.output||'').split(/\s+/).length);
      versSection += `<div class="ver-row">
        <span class="ver-label">Версия ${n.outputVersions.length - i} ${esc(label)}${v.manual?' <span class="ver-tag">✎ ручная</span>':''}</span>
        <span class="ver-meta">${wc} сл.</span>
        ${i > 0 ? `<button class="btn ghost xs" data-action="diff-version" data-node="${n.id}" data-ver="${i}" title="Сравнить с текущей">±</button>` : ''}
        ${i > 0 ? `<button class="btn ghost xs" data-action="restore-version" data-node="${n.id}" data-ver="${i}">↩</button>` : ''}
      </div>`;
    });
    versSection += '</div>';
  }
  // #48: «Что реально ушло/вернулось» — точный снимок последнего РЕАЛЬНОГО вызова.
  let wireSection='';
  if(n.lastRequest && Array.isArray(n.lastRequest.messages)){
    const lr=n.lastRequest;
    const msgsHtml=lr.messages.map(m=>{
      const lbl=m.role==='system'?'⚙ System':m.role==='user'?'👤 User':m.role==='assistant'?'🤖 Assistant':esc(m.role);
      return `<div class="wire-msg"><div class="wire-role">${lbl}</div><pre class="wire-pre">${esc(m.content)}</pre></div>`;
    }).join('');
    const raw=n.lastRawOutput||'';
    const processed=n.output||'';
    const wasPostProcessed=(n.postProcess&&n.postProcess.trim())&&raw!==processed;
    let outHtml;
    if(wasPostProcessed){
      outHtml=`<div class="wire-diff">
        <div class="wire-diff-col"><div class="wire-role">Сырой ответ (до постпроцесса)</div><pre class="wire-pre">${esc(raw)}</pre></div>
        <div class="wire-diff-col"><div class="wire-role">После постпроцесса</div><pre class="wire-pre">${esc(processed)}</pre></div>
      </div>`;
    } else {
      outHtml=`<div class="wire-msg"><div class="wire-role">🤖 Ответ модели</div><pre class="wire-pre">${esc(raw||processed)}</pre></div>`;
    }
    const meta=`${esc(lr.model||'?')} · t°${lr.temperature ?? '?'} · ${new Date(lr.ts).toLocaleString('ru-RU')}`;
    wireSection=`<div class="section-label">📡 Что ушло/вернулось</div>
      <div class="hint" style="margin-bottom:6px">Точный снимок последнего реального вызова (не прогноз). ${meta}</div>
      <details class="wire-details"><summary>📤 Отправленные сообщения (${lr.messages.length})</summary>${msgsHtml}</details>
      <details class="wire-details" open><summary>📥 Ответ${wasPostProcessed?' (с постпроцессом — было/стало)':''}</summary>${outHtml}</details>`;
  } else {
    wireSection=`<div class="section-label">📡 Что ушло/вернулось</div>
      <div class="hint" style="color:var(--faint)">Ещё не было реального вызова. Прогоните агента — здесь появятся точные отправленные сообщения и сырой ответ.</div>`;
  }
  openDrawer(`${n.emoji} ${esc(n.name)}`,`
    <div class="row2"><div class="field"><label>Имя</label><input id="f-name" value="${esc(n.name)}"></div>
      <div class="field"><label>Должность</label><input id="f-role" value="${esc(n.role)}"></div></div>
    <div class="field"><label>Системный промт</label><textarea id="f-prompt" rows="6">${esc(n.prompt)}</textarea>
      <div class="hint">Кто этот агент и как работает. Получает контекст книги, библию и результаты предыдущих агентов.</div>
      <div class="var-legend">
        <span class="var-legend-title">Переменные (клик — вставить):</span>
        ${['{{title}}','{{genre}}','{{audience}}','{{brief}}','{{input}}','{{prev}}','{{bible}}','{{chapter.title}}'].map(v=>`<span class="var-chip" data-var="${esc(v)}">${esc(v)}</span>`).join('')}
      </div>
      <div class="snip-block">
        <div class="snip-head"><span class="var-legend-title">Сниппеты</span>
          <button type="button" class="btn ghost xs" id="snip-add" title="Добавить выделение/строку как сниппет">＋ из выделения</button></div>
        <div id="snip-list" class="snip-list"></div>
      </div>
    </div>
    <div class="field"><label>JSON-схема выхода (необязательно)</label>
      <textarea id="f-schema" rows="2" placeholder='{"hero": "string", "rating": "number"}'>${esc(n.outputSchema||'')}</textarea>
      <div class="hint">Если задана — после прогона проверяется, что вывод содержит JSON с этими ключами. Предупреждение в журнале.</div></div>
    <div class="field"><label>Постпроцессор вывода (JS)</label>
      <textarea id="f-post" rows="2" placeholder="// вернёт строку — заменит вывод&#10;return output.trim().toUpperCase()">${esc(n.postProcess||'')}</textarea>
      <div class="hint">Переменная <code>output</code> — строка вывода агента. Если функция возвращает строку — заменяет вывод.</div></div>
    <div class="field">
      <label>Вариантов</label>
      <input type="number" id="f-variants" min="1" max="5" value="${n.variants||1}" style="width:60px">
      <span style="font-size:11px;color:var(--dim)">параллельных вариантов (1 = обычный режим)</span>
    </div>
    <div class="field" id="f-fanout-wrap" style="${(n.nodeType==='fanout'||TEMPLATES.find(t=>t.name===n.name)?.role==='fanout')?'':'display:none'}">
      <label>Макс. глав</label>
      <input type="number" id="f-fanout-count" min="0" max="20" value="${n.fanoutCount||0}" style="width:60px">
      <span style="font-size:11px;color:var(--dim)">0 = авто из списка (до 20)</span>
    </div>
    <label class="check"><input type="checkbox" id="f-appr" ${n.requireApproval?'checked':''}> Требовать мою приёмку (пауза конвейера)</label>
    <label class="check"><input type="checkbox" id="f-verdict" ${n.verdictGate?'checked':''}> ⚖ Решающий: вердикт «отклонить» останавливает конвейер</label>
    <label class="check"><input type="checkbox" id="f-inbook" ${(typeof n.includeInBook==='boolean'?n.includeInBook:defaultIncludeInBook(roleKeyOf(n)))?'checked':''}> 📖 Включать в книгу</label>
    <div class="field"><label>Заголовок главы (для книги)</label>
      <input id="f-chtitle" value="${esc(n.chapterTitle||'')}" placeholder="авто — из первого заголовка вывода или «Глава N»">
      <div class="hint">Используется в EPUB/Word/.md/Reader вместо имени агента.</div></div>
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
      <button class="btn ghost" data-action="run-from" data-id="${n.id}">▶▶ Прогнать отсюда вниз</button>
      <button class="btn ghost" id="f-preview">👁 Промт</button>
      ${n.output?`<button class="btn ghost" id="f-edit">✎ Править вручную</button>`:''}
      <button class="btn ghost" id="f-clone">⧉ Дублировать</button>
      <button class="btn ghost" id="f-tpl">⭐ Сохранить как шаблон</button>
      <button class="btn danger" id="f-del">Удалить</button></div>
    ${hist}
    <div class="section-label">Текущий результат</div>
    ${outBlock||'<div class="hint" style="color:var(--faint)">Пока пусто.</div>'}
    ${versSection}
    ${wireSection}
  `,b=>{
    b.querySelector('#f-global').onchange=ev=>{ b.querySelector('#own-cfg').style.display=ev.target.checked?'none':''; };
    const collect=()=>{ const np=b.querySelector('#f-prompt').value; if(np!==n.prompt){ n.promptHistory.unshift({t:Date.now(),prompt:n.prompt}); if(n.promptHistory.length>20) n.promptHistory.pop(); }
      n.name=b.querySelector('#f-name').value.trim()||n.name; n.role=b.querySelector('#f-role').value.trim(); n.prompt=np;
      n.outputSchema=b.querySelector('#f-schema').value.trim();
      n.postProcess=b.querySelector('#f-post').value.trim();
      n.requireApproval=b.querySelector('#f-appr').checked; n.useGlobal=b.querySelector('#f-global').checked;
      n.verdictGate=b.querySelector('#f-verdict').checked;
      n.includeInBook=b.querySelector('#f-inbook').checked; n.chapterTitle=b.querySelector('#f-chtitle').value.trim();
      n.baseURL=b.querySelector('#f-base').value.trim(); n.model=b.querySelector('#f-model').value.trim();
      n.apiKey=b.querySelector('#f-key').value.trim(); const tv=parseFloat(b.querySelector('#f-temp').value); n.temperature=isNaN(tv)?1:tv;
      n.variants = parseInt(b.querySelector('#f-variants')?.value) || 1;
      n.fanoutCount = parseInt(b.querySelector('#f-fanout-count')?.value) || 0; };
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
    b.querySelector('#f-preview').onclick=()=>{ collect(); showPromptPreview(n).catch(e=>console.warn('preview error',e)); };
    b.querySelector('#f-del').onclick=()=>{ state.nodes=state.nodes.filter(x=>x.id!==n.id); state.edges=state.edges.filter(e=>e.from!==n.id&&e.to!==n.id); save(); render(); closeDrawer(); toast('Агент удалён'); };
    b.querySelector('#f-clone').onclick=()=>{ collect(); const copy=JSON.parse(JSON.stringify(n)); copy.id=uid(); copy.x=n.x+30; copy.y=n.y+30; copy.output=''; copy.summary=''; copy.cacheHash=''; copy.tokensIn=0; copy.tokensOut=0; copy.ms=0; copy.status='idle'; copy.error=''; copy.approved=false; copy.promptHistory=[]; state.nodes.push(copy); save(); render(); closeDrawer(); toast('Агент скопирован','ok'); };
    b.querySelector('#f-edit')?.addEventListener('click',()=>openManualEdit(n.id));
    b.querySelectorAll('[data-revert]').forEach(btn=>btn.onclick=()=>{ const h=n.promptHistory[+btn.dataset.revert]; if(h){ b.querySelector('#f-prompt').value=h.prompt; toast('Версия подставлена — нажмите Сохранить'); } });
    // #44: вставка переменной в позицию курсора по клику на чип
    const ta=b.querySelector('#f-prompt');
    const insertAtCursor=text=>{
      const s=ta.selectionStart??ta.value.length, e=ta.selectionEnd??ta.value.length;
      ta.value=ta.value.slice(0,s)+text+ta.value.slice(e);
      ta.focus(); const pos=s+text.length; ta.setSelectionRange(pos,pos);
    };
    b.querySelectorAll('.var-chip').forEach(ch=>ch.onclick=()=>insertAtCursor(ch.dataset.var));
    // #45: сниппеты
    const renderSnips=()=>{
      const list=b.querySelector('#snip-list');
      const snips=state.snippets||[];
      if(!snips.length){ list.innerHTML='<span class="snip-empty">Нет сниппетов. Выделите текст в промте и нажмите «＋ из выделения».</span>'; return; }
      list.innerHTML=snips.map((s,i)=>`<span class="snip-chip" data-snip="${i}" title="Клик — вставить в промт">${esc(s.length>40?s.slice(0,40)+'…':s)}<button type="button" class="snip-del" data-snip-del="${i}" title="Удалить">×</button></span>`).join('');
      list.querySelectorAll('[data-snip]').forEach(el=>el.onclick=ev=>{ if(ev.target.closest('[data-snip-del]')) return; insertAtCursor(state.snippets[+el.dataset.snip]); });
      list.querySelectorAll('[data-snip-del]').forEach(el=>el.onclick=ev=>{ ev.stopPropagation(); state.snippets.splice(+el.dataset.snipDel,1); save(); renderSnips(); });
    };
    renderSnips();
    b.querySelector('#snip-add').onclick=()=>{
      const s=ta.selectionStart, e=ta.selectionEnd;
      let frag=(s!=null&&e!=null&&e>s)?ta.value.slice(s,e):'';
      if(!frag.trim()){ // нет выделения — берём строку под курсором
        const before=ta.value.lastIndexOf('\n',(ta.selectionStart||1)-1)+1;
        let after=ta.value.indexOf('\n',ta.selectionStart||0); if(after<0) after=ta.value.length;
        frag=ta.value.slice(before,after);
      }
      frag=frag.trim();
      if(!frag){ toast('Нечего сохранять — выделите текст','err'); return; }
      if(!state.snippets) state.snippets=[];
      state.snippets.unshift(frag); if(state.snippets.length>50) state.snippets.length=50;
      save(); renderSnips(); toast('Сниппет добавлен','ok');
    };
    // #45: сохранить узел как пользовательский шаблон
    b.querySelector('#f-tpl').onclick=()=>{
      collect();
      if(!state.userTemplates) state.userTemplates=[];
      state.userTemplates.unshift({ name:n.name, emoji:n.emoji, prompt:n.prompt, temperature:n.temperature, role:n.role });
      if(state.userTemplates.length>50) state.userTemplates.length=50;
      save(); toast('⭐ Сохранено в «Мои агенты»','ok');
    };
  });
}
/* ============ РУЧНАЯ ПРАВКА ВЫВОДА (Item 18/19) ============ */
function pushOutputVersion(n,extra={}){
  if(!n.outputVersions) n.outputVersions=[];
  n.outputVersions.unshift(Object.assign({ts:Date.now(),output:n.output,tokensIn:0,tokensOut:tokEst(n.output)},extra));
  if(n.outputVersions.length>5) n.outputVersions=n.outputVersions.slice(0,5);
}
function openManualEdit(id){
  const n=node(id); if(!n) return;
  openDrawer(`✎ Правка вывода — ${esc(n.name)}`,`
    <div class="hint" style="margin-top:0">Отредактируйте текст. Сохранение создаёт новую версию (помечена «ручная»). Выделите фрагмент и нажмите «🔄 Переписать выделенное» для точечной перегенерации через ИИ.</div>
    <textarea id="me-text" class="manual-edit-ta" rows="18">${esc(n.output||'')}</textarea>
    <div class="actions" style="margin-top:10px">
      <button class="btn ok" id="me-save">💾 Сохранить правку</button>
      <button class="btn ghost" id="me-regen">🔄 Переписать выделенное</button>
      <button class="btn ghost" id="me-back">← Назад</button>
    </div>
    <div class="hint" id="me-status" style="min-height:16px"></div>
  `,b=>{
    const ta=b.querySelector('#me-text');
    b.querySelector('#me-save').onclick=()=>{
      const val=ta.value;
      if(val===n.output){ toast('Текст не изменился'); return; }
      pushOutputVersion(n,{manual:true}); // фиксируем ПРЕДЫДУЩИЙ вывод как версию
      n.output=val; n.error=''; if(n.status==='idle') n.status='done';
      save(); render();
      toast('Правка сохранена как новая версия','ok');
      openNode(n.id);
    };
    b.querySelector('#me-back').onclick=()=>openNode(n.id);
    b.querySelector('#me-regen').onclick=async()=>{
      const s=ta.selectionStart, e=ta.selectionEnd;
      const frag=ta.value.slice(s,e);
      if(!frag.trim()){ toast('Сначала выделите фрагмент в тексте','err'); return; }
      if(!hasKey()){ toast('Не задан API-ключ','err'); return; }
      const st=b.querySelector('#me-status'); st.textContent='🔄 Переписываю выделенное…';
      const btn=b.querySelector('#me-regen'); btn.disabled=true;
      try{
        const res=await callLLM(cfg(n),[
          {role:'system',content:'Улучши этот фрагмент художественного текста, верни ТОЛЬКО переписанный фрагмент без пояснений.'},
          {role:'user',content:frag}
        ]);
        const repl=(res||'').trim();
        if(!repl){ st.textContent=''; toast('Пустой ответ модели','err'); return; }
        ta.value=ta.value.slice(0,s)+repl+ta.value.slice(e);
        // Выделяем вставленный фрагмент
        ta.focus(); ta.setSelectionRange(s,s+repl.length);
        st.textContent='✅ Фрагмент переписан. Не забудьте «Сохранить правку».';
      }catch(err){ st.textContent=''; toast('Ошибка: '+err.message,'err'); }
      finally{ btn.disabled=false; }
    };
  });
}
function openSettings(){
  const g=state.global;
  openDrawer('⚙ Настройки',`
    <div class="set-tabs">
      <button class="set-tab active" data-settab="basic" type="button">Основное</button>
      <button class="set-tab" data-settab="adv" type="button">Продвинутое</button>
    </div>
    <div class="set-pane" data-pane="basic">
    <div class="field"><label>Пресет провайдера</label><select id="g-preset"><option value="">— выбрать —</option>
      <option value="https://api.deepseek.com|deepseek-chat">DeepSeek (deepseek-chat)</option>
      <option value="https://api.deepseek.com|deepseek-reasoner">DeepSeek R1 (deepseek-reasoner)</option>
      <option value="https://api.openai.com/v1|gpt-4o-mini">OpenAI (gpt-4o-mini)</option>
      <option value="https://openrouter.ai/api/v1|deepseek/deepseek-chat">OpenRouter → DeepSeek</option>
      <option value="https://openrouter.ai/api/v1|anthropic/claude-3-5-haiku">OpenRouter → Claude Haiku</option></select></div>
    <div class="field"><label>API base URL</label><input id="g-base" value="${esc(g.baseURL)}"></div>
    <div class="row2"><div class="field"><label>Модель</label><input id="g-model" value="${esc(g.model)}"></div>
      <div class="field"><label>Температура</label><input id="g-temp" type="number" step="0.1" min="0" max="2" value="${g.temperature}"></div></div>
    <div class="field"><label>API-ключ (общий / резервный)</label><input id="g-key" type="password" value="${esc(g.apiKey)}" placeholder="sk-...">
      <div class="hint">Хранится только в этом браузере и уходит на локальный прокси, не в сторонние сервисы.</div></div>
    <div class="field"><label>Лимит бюджета, $ (0 = без)</label><input id="g-cap" type="number" step="0.1" value="${g.costCapUSD}"></div>
    <div class="set-section" style="margin-top:16px;border-top:1px solid var(--line2);padding-top:16px">
      <div class="set-section-title" style="font-size:13px;font-weight:700;color:var(--txt);margin-bottom:6px">✍️ Стиль автора</div>
      <p class="set-hint" style="font-size:12px;color:var(--txt2);margin:0 0 8px">Вставьте 300–500 слов своего текста — агенты будут писать в этом стиле</p>
      <textarea id="set-style-ref" rows="6" placeholder="Вставьте фрагмент своего текста…"
        style="width:100%;background:var(--panel);border:1px solid var(--line2);border-radius:8px;padding:10px;color:var(--txt);font-family:inherit;font-size:13px;resize:vertical"
      >${esc(state.project.styleRef||'')}</textarea>
      <div style="font-size:12px;color:var(--txt2);margin-top:4px">
        ${state.project.styleRef ? '✅ Стиль-ориентир задан (' + state.project.styleRef.split(/\s+/).length + ' слов)' : ''}
      </div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button class="btn ghost sm" id="set-style-save">💾 Сохранить стиль</button>
        <button class="btn ghost sm" id="set-style-clear">🗑 Очистить</button>
      </div>
    </div>
    <div class="set-section" style="margin-top:16px;border-top:1px solid var(--line2);padding-top:16px">
      <div class="set-section-title" style="font-size:13px;font-weight:700;color:var(--txt);margin-bottom:6px">🚫 Стоп-слова</div>
      <p class="set-hint" style="font-size:12px;color:var(--txt2);margin:0 0 8px">Слова и фразы через запятую или с новой строки. Агентам запрещено их использовать в тексте.</p>
      <textarea id="set-banlist" rows="4" placeholder="клише, штамп, например, по сути…"
        style="width:100%;background:var(--panel);border:1px solid var(--line2);border-radius:8px;padding:10px;color:var(--txt);font-family:inherit;font-size:13px;resize:vertical"
      >${esc(state.global.banList||'')}</textarea>
      <div style="margin-top:6px"><button class="btn ghost sm" id="set-banlist-save">💾 Сохранить стоп-слова</button></div>
    </div>
    </div><!-- /basic -->
    <div class="set-pane" data-pane="adv" style="display:none">
    <div class="field"><label>Fallback API URL (при 502)</label><input id="g-fallback" value="${esc(g.fallbackURL||'')}" placeholder="https://openrouter.ai/api/v1">
      <div class="hint">Если основной провайдер недоступен — автоматически используется этот. Ключ — тот же глобальный.</div></div>
    <div class="field"><label>Пул API-ключей (ротация, один на строку)</label>
      <textarea id="g-keys" rows="3" placeholder="sk-key-1&#10;sk-key-2&#10;sk-key-3">${esc(g.apiKeys||'')}</textarea>
      <div class="hint">Если заполнено — ключи чередуются по кругу между агентами. «API-ключ» из «Основное» используется как резервный.</div></div>
    <div class="section-label">Лимиты и надёжность</div>
    <div class="row2"><div class="field"><label>Бюджет контекста (символов)</label><input id="g-ctx" type="number" value="${g.maxContextChars}"></div>
      <div class="field"><label>Ретраи при сбое</label><input id="g-retry" type="number" min="0" max="5" value="${g.maxRetries}"></div></div>
    <div class="field"><label>Токен прокси (если выложен в сеть)</label><input id="g-ptok" value="${esc(g.proxyToken)}" placeholder="не обязательно"></div>
    <label class="check"><input type="checkbox" id="g-summ" ${g.autoSummarize?'checked':''}> Авто-саммари узлов (доп. вызов LLM после каждого агента)</label>
    <label class="check"><input type="checkbox" id="g-bible-extract" ${g.autoBibleExtract?'checked':''}> Авто-Библия: извлекать персонажей и факты после каждой главы</label>
    <label class="check"><input type="checkbox" id="g-auto-distill" ${g.autoDistill?'checked':''}> Авто-сжатие: сжимать длинный контекст перед передачей агентам</label>
    <label class="check"><input type="checkbox" id="g-eval" ${g.autoEval?'checked':''}> Авто-оценка после пайплайна (LLM-judge: 4 критерия, запись в журнал)</label>
    <div class="field"><label>Таймаут приёмки, мин (0 = без)</label><input id="g-aptout" type="number" min="0" value="${g.approvalTimeoutMin||0}">
      <div class="hint">Если агент ждёт одобрения дольше — пайплайн прерывается автоматически.</div></div>
    <div class="row2">
      <div class="field"><label>Макс. одновременных запросов</label><input id="g-maxconc" type="number" min="1" max="20" value="${g.maxConcurrent||3}">
        <div class="hint">Семафор: ограничивает параллельные вызовы LLM в одной волне (защита от 429 / rate-limit).</div></div>
      <div class="field"><label>При провале агента</label>
        <select id="g-onerr">
          <option value="continue" ${g.onErrorPolicy!=='pause'?'selected':''}>Продолжить (downstream с пустым контекстом)</option>
          <option value="pause" ${g.onErrorPolicy==='pause'?'selected':''}>Пауза, если есть зависимые узлы</option>
        </select></div>
    </div>
    <div class="section-label">⚖️ Отдельный судья авто-оценки (необязательно)</div>
    <div class="field"><label>Модель судьи</label><input id="g-judge-model" value="${esc(g.judgeModel||'')}" placeholder="пусто — модель агента">
      <div class="hint">Если задана — авто-оценку петель делает эта модель, а не та, что писала текст.</div></div>
    <div class="row2">
      <div class="field"><label>Base URL судьи</label><input id="g-judge-base" value="${esc(g.judgeBaseURL||'')}" placeholder="пусто — как у агента"></div>
      <div class="field"><label>API-ключ судьи</label><input id="g-judge-key" type="password" value="${esc(g.judgeApiKey||'')}" placeholder="пусто — как у агента"></div>
    </div>
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
    <div class="set-section" style="margin-top:8px;border-top:1px solid var(--line2);padding-top:16px">
      <div class="set-section-title" style="font-size:13px;font-weight:700;color:var(--txt);margin-bottom:6px">☁️ Google Drive</div>
      <p class="set-hint" style="font-size:12px;color:var(--txt2);margin:0 0 8px">Бэкап проекта в облако. Нужен Client ID OAuth 2.0 (тип «Веб-приложение», разрешённый origin: http://localhost:8787, redirect URI: http://localhost:8787/oauth-callback.html).</p>
      <div class="field"><label>Client ID</label>
        <input id="set-gdrive-cid" value="${esc(g.gdriveClientId||'')}" placeholder="xxxx.apps.googleusercontent.com">
      </div>
      ${g.gdriveLastBackup?`<div style="font-size:12px;color:var(--txt2);margin-bottom:8px">✅ Последний бэкап: ${new Date(g.gdriveLastBackup).toLocaleString('ru-RU')}</div>`:''}
      <div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap">
        <button class="btn ghost sm" id="set-gdrive-auth">🔑 Подключить Google Drive</button>
        <button class="btn ghost sm" id="set-gdrive-backup">☁️ Бэкап сейчас</button>
        <button class="btn ghost sm" id="set-gdrive-revoke">🔓 Выйти</button>
      </div>
    </div>
    </div><!-- /adv -->
    <div class="actions" style="margin-top:16px;border-top:1px solid var(--line2);padding-top:14px"><button class="btn ok" id="g-save">Сохранить</button></div>
  `,b=>{
    // #36: переключение вкладок настроек
    b.querySelectorAll('.set-tab').forEach(tab=>tab.onclick=()=>{
      b.querySelectorAll('.set-tab').forEach(x=>x.classList.toggle('active',x===tab));
      b.querySelectorAll('.set-pane').forEach(p=>p.style.display=p.dataset.pane===tab.dataset.settab?'':'none');
    });
    b.querySelector('#g-preset').onchange=ev=>{ if(!ev.target.value) return; const [u,m]=ev.target.value.split('|'); b.querySelector('#g-base').value=u; b.querySelector('#g-model').value=m; };
    b.querySelector('#g-bkopen').onclick=()=>{ closeDrawer(); setTimeout(openBackupRestore,120); };
    b.querySelector('#g-save').onclick=()=>{ g.baseURL=b.querySelector('#g-base').value.trim()||g.baseURL; g.model=b.querySelector('#g-model').value.trim()||g.model;
      g.apiKey=b.querySelector('#g-key').value.trim(); const t=parseFloat(b.querySelector('#g-temp').value); g.temperature=isNaN(t)?1:t;
      g.maxContextChars=parseInt(b.querySelector('#g-ctx').value)||8000; g.maxRetries=parseInt(b.querySelector('#g-retry').value)||0;
      g.costCapUSD=parseFloat(b.querySelector('#g-cap').value)||0; g.proxyToken=b.querySelector('#g-ptok').value.trim();
      g.autoSummarize=b.querySelector('#g-summ').checked;
      g.autoBibleExtract=b.querySelector('#g-bible-extract').checked;
      g.autoDistill=b.querySelector('#g-auto-distill')?.checked ?? false;
      g.autoEval=b.querySelector('#g-eval').checked;
      g.fallbackURL=b.querySelector('#g-fallback').value.trim();
      g.approvalTimeoutMin=parseInt(b.querySelector('#g-aptout').value)||0;
      g.maxConcurrent=Math.max(1,parseInt(b.querySelector('#g-maxconc')?.value)||3);
      g.onErrorPolicy=b.querySelector('#g-onerr')?.value==='pause'?'pause':'continue';
      g.judgeModel=b.querySelector('#g-judge-model')?.value.trim()||'';
      g.judgeBaseURL=b.querySelector('#g-judge-base')?.value.trim()||'';
      g.judgeApiKey=b.querySelector('#g-judge-key')?.value.trim()||'';
      g.apiKeys=b.querySelector('#g-keys').value; _keyIdx=0;
      g.backupDir=b.querySelector('#g-bkdir').value.trim();
      g.backupIntervalMin=parseInt(b.querySelector('#g-bkint').value)||10;
      g.autoBackup=b.querySelector('#g-bkauto').checked;
      g.gdriveClientId=b.querySelector('#set-gdrive-cid')?.value.trim()||g.gdriveClientId||'';
      // стиль и стоп-слова сохраняем заодно с общим «Сохранить»
      state.project.styleRef=b.querySelector('#set-style-ref')?.value.trim()||'';
      g.banList=b.querySelector('#set-banlist')?.value||'';
      scheduleBackup();
      save(); render(); updateStyleRefBadge(); toast('Настройки сохранены','ok'); };
    b.querySelector('#set-style-save')?.addEventListener('click', () => {
      state.project.styleRef = b.querySelector('#set-style-ref')?.value.trim() || '';
      save(); toast('Стиль-ориентир сохранён', 'ok'); updateStyleRefBadge(); });
    b.querySelector('#set-style-clear')?.addEventListener('click', () => {
      state.project.styleRef = '';
      const ta = b.querySelector('#set-style-ref');
      if(ta) ta.value = '';
      save(); toast('Стиль-ориентир очищен'); updateStyleRefBadge(); });
    b.querySelector('#set-gdrive-auth')?.addEventListener('click', () => {
      const cid=(b.querySelector('#set-gdrive-cid')?.value||g.gdriveClientId||'').trim();
      if(!cid){toast('Введите Google Client ID','err');return;}
      g.gdriveClientId=cid; save();
      gdriveAuth(cid);
    });
    b.querySelector('#set-gdrive-backup')?.addEventListener('click', ()=>backupToDrive());
    b.querySelector('#set-gdrive-revoke')?.addEventListener('click', ()=>{
      localStorage.removeItem('gdrive_token'); toast('Выход из Google Drive выполнен');
    });
    b.querySelector('#set-banlist-save')?.addEventListener('click', () => {
      state.global.banList = b.querySelector('#set-banlist')?.value || '';
      save(); toast('Стоп-слова сохранены', 'ok');
    }); });
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
/* ============ ЗАМЫСЕЛ КНИГИ ============
   Фундамент: мир, персонажи, повороты, тон. Уходит каноном во ВСЕХ агентов (conceptBlock). */
function openConcept(){
  const c=(state.project.concept)||(state.project.concept={setting:'',characters:[],plotTurns:'',tone:''});
  if(!Array.isArray(c.characters)) c.characters=[];
  const charRows=c.characters.map((p,i)=>`<div class="concept-char-row" data-ci="${i}">
    <input class="cc-name" value="${esc(p.name||'')}" placeholder="Имя">
    <input class="cc-role" value="${esc(p.role||'')}" placeholder="Роль">
    <input class="cc-brief" value="${esc(p.brief||'')}" placeholder="Краткая характеристика">
    <button class="icon-btn" data-delchar="${i}">✕</button></div>`).join('');
  openDrawer('🧭 Замысел книги',`
    <p class="hint" style="margin-top:0">Фундамент книги: мир, персонажи, ключевые повороты. Заполните сами или сгенерируйте ИИ из брифа — он уйдёт каноном во всех агентов.</p>
    <div class="actions" style="margin:0 0 12px"><button class="btn ghost" id="cn-gen">🪄 Сгенерировать из брифа</button></div>
    <label class="fld-label">Место и время действия</label>
    <textarea id="cn-setting" rows="2" placeholder="Где и когда происходит действие">${esc(c.setting||'')}</textarea>
    <label class="fld-label" style="margin-top:12px">Персонажи</label>
    <div id="concept-chars">${charRows||'<div class="hint" style="color:var(--faint)">Пока никого. Добавьте персонажа.</div>'}</div>
    <button class="btn ghost" id="cn-addchar" style="margin-top:8px">＋ персонаж</button>
    <label class="fld-label" style="margin-top:12px">Ключевые повороты сюжета</label>
    <textarea id="cn-plot" rows="3" placeholder="3-5 ключевых поворотов">${esc(c.plotTurns||'')}</textarea>
    <label class="fld-label" style="margin-top:12px">Тон / настроение</label>
    <input id="cn-tone" value="${esc(c.tone||'')}" placeholder="Например: мрачный, ироничный, тёплый">
    <div class="actions" style="margin-top:16px">
      <button class="btn ok" id="cn-save">💾 Сохранить</button>
      <button class="btn ghost" id="cn-clear">🗑 Очистить</button></div>
  `,b=>{
    const collect=()=>{
      c.setting=b.querySelector('#cn-setting').value.trim();
      c.plotTurns=b.querySelector('#cn-plot').value.trim();
      c.tone=b.querySelector('#cn-tone').value.trim();
      c.characters=[...b.querySelectorAll('.concept-char-row')].map(r=>({
        name:r.querySelector('.cc-name').value.trim(),
        role:r.querySelector('.cc-role').value.trim(),
        brief:r.querySelector('.cc-brief').value.trim()
      })).filter(p=>p.name||p.role||p.brief);
    };
    b.querySelector('#cn-addchar').onclick=()=>{ collect(); c.characters.push({name:'',role:'',brief:''}); save(); openConcept(); };
    b.querySelectorAll('[data-delchar]').forEach(x=>x.onclick=()=>{ collect(); c.characters.splice(+x.dataset.delchar,1); save(); openConcept(); });
    b.querySelector('#cn-gen').onclick=()=>generateConcept();
    b.querySelector('#cn-save').onclick=()=>{ collect(); save(); toast('Замысел сохранён','ok'); closeDrawer(); };
    b.querySelector('#cn-clear').onclick=()=>{ c.setting='';c.characters=[];c.plotTurns='';c.tone=''; save(); openConcept(); toast('Замысел очищен'); };
  });
}
// Генерация замысла из брифа. silent=true — без перерисовки drawer (для автостарта).
async function generateConcept(silent){
  if(!hasKey()){ toast('Задайте API-ключ','err'); return openSettings(); }
  const pr=state.project;
  const c=cfg({useGlobal:true});
  c.temperature=0.7;
  const sys='Ты — редактор-разработчик. На основе брифа, жанра и аудитории создай ЗАМЫСЕЛ книги. Верни СТРОГО JSON: {"setting":"место и время","characters":[{"name":"","role":"","brief":"кратко 1 предложение"}],"plotTurns":"3-5 ключевых поворотов списком","tone":"тон/настроение"}. Только JSON.';
  const usr=`Бриф: ${pr.brief||'не задан'}\nЖанр: ${pr.genre||'не задан'}\nАудитория: ${pr.audience||'не задана'}`;
  if(!silent) toast('Генерирую замысел…');
  try{
    const resp=await callLLM(c,[{role:'system',content:sys},{role:'user',content:usr}]);
    let txt=String(resp||'').trim();
    const m=txt.match(/```(?:json)?\s*([\s\S]*?)```/i); if(m) txt=m[1].trim();
    const j0=txt.indexOf('{'), j1=txt.lastIndexOf('}'); if(j0>=0&&j1>j0) txt=txt.slice(j0,j1+1);
    const data=JSON.parse(txt);
    const concept=state.project.concept||(state.project.concept={setting:'',characters:[],plotTurns:'',tone:''});
    concept.setting=String(data.setting||'').trim();
    concept.plotTurns=String(data.plotTurns||'').trim();
    concept.tone=String(data.tone||'').trim();
    concept.characters=(Array.isArray(data.characters)?data.characters:[]).map(p=>({
      name:String(p.name||'').trim(), role:String(p.role||'').trim(), brief:String(p.brief||'').trim()
    })).filter(p=>p.name||p.role||p.brief);
    save();
    if(!silent){ openConcept(); toast('Замысел сгенерирован','ok'); }
    return concept;
  }catch(err){
    logRow('Замысел','error',String(err.message||err));
    if(!silent) toast('Не удалось разобрать ответ модели','err');
    throw err;
  }
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
// #39: извлечь текст из .docx (ZIP) без библиотек.
// ZIP central directory → найти word/document.xml → inflate через DecompressionStream('deflate-raw') → текст из <w:t>.
async function docxToText(file){
  const buf=new Uint8Array(await file.arrayBuffer());
  const dv=new DataView(buf.buffer);
  // Найти End Of Central Directory (сигнатура 0x06054b50), идём с конца
  let eocd=-1;
  for(let i=buf.length-22;i>=0;i--){ if(dv.getUint32(i,true)===0x06054b50){ eocd=i; break; } }
  if(eocd<0) throw new Error('не похоже на docx (нет ZIP-каталога)');
  const cdCount=dv.getUint16(eocd+10,true);
  let p=dv.getUint32(eocd+16,true); // смещение central directory
  let target=null;
  for(let i=0;i<cdCount;i++){
    if(dv.getUint32(p,true)!==0x02014b50) break;
    const method=dv.getUint16(p+10,true);
    const compSize=dv.getUint32(p+20,true);
    const nameLen=dv.getUint16(p+28,true);
    const extraLen=dv.getUint16(p+30,true);
    const commLen=dv.getUint16(p+32,true);
    const lho=dv.getUint32(p+42,true); // смещение локального заголовка
    const name=new TextDecoder().decode(buf.subarray(p+46,p+46+nameLen));
    if(name==='word/document.xml'){ target={method,compSize,lho}; break; }
    p+=46+nameLen+extraLen+commLen;
  }
  if(!target) throw new Error('в docx не найден word/document.xml');
  // Локальный заголовок: вычисляем начало данных
  const lh=target.lho;
  if(dv.getUint32(lh,true)!==0x04034b50) throw new Error('повреждённый локальный заголовок');
  const lNameLen=dv.getUint16(lh+26,true), lExtraLen=dv.getUint16(lh+28,true);
  const dataStart=lh+30+lNameLen+lExtraLen;
  const comp=buf.subarray(dataStart,dataStart+target.compSize);
  let xmlBytes;
  if(target.method===0){ xmlBytes=comp; } // STORE
  else if(target.method===8){ // DEFLATE
    if(typeof DecompressionStream==='undefined') throw new Error('браузер не умеет распаковывать docx (нет DecompressionStream)');
    const ds=new DecompressionStream('deflate-raw');
    const stream=new Blob([comp]).stream().pipeThrough(ds);
    xmlBytes=new Uint8Array(await new Response(stream).arrayBuffer());
  } else throw new Error('неизвестный метод сжатия docx');
  const xml=new TextDecoder().decode(xmlBytes);
  // Параграфы <w:p> → перенос строки; текст из <w:t>; <w:tab/> → таб; <w:br/> → перенос
  const parts=[];
  const pRe=/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g;
  let m;
  const paras=xml.match(pRe)||[xml];
  for(const para of paras){
    let line='';
    const tRe=/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/?>|<w:br\/?>/g;
    let tm;
    while((tm=tRe.exec(para))){
      if(tm[1]!=null) line+=tm[1];
      else if(/tab/.test(tm[0])) line+='\t';
      else line+='\n';
    }
    parts.push(line);
  }
  const txt=parts.join('\n')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'")
    .replace(/\n{3,}/g,'\n\n').trim();
  if(!txt) throw new Error('текст не извлечён (пустой документ?)');
  return txt;
}

function openInput(){
  openDrawer('📄 Исходный текст',`<div class="hint" style="color:var(--warn);margin-bottom:10px">⚠ Вставляйте только текст книги. Инструкции вида «Игнорируй предыдущие задания…» в исходнике могут влиять на поведение агентов (prompt injection).</div>
    <div class="dropzone" id="i-drop">
      <div class="dropzone-icon">📥</div>
      <div class="dropzone-text">Перетащите файл сюда или <label class="dz-link">выберите<input type="file" id="i-file" accept=".txt,.md,.docx" hidden></label></div>
      <div class="dropzone-hint">.txt · .md · .docx</div>
    </div>
    <div class="field"><label>Рукопись для редактирования</label>
    <textarea id="i-text" rows="15" placeholder="Вставьте текст…">${esc(state.project.input)}</textarea></div>
    <div class="actions"><button class="btn ok" id="i-save">Сохранить</button></div>`,
    b=>{
      const ta=b.querySelector('#i-text');
      const dz=b.querySelector('#i-drop');
      const fileInput=b.querySelector('#i-file');
      const handleFile=async f=>{
        if(!f) return;
        const name=(f.name||'').toLowerCase();
        try{
          if(name.endsWith('.txt')||name.endsWith('.md')){
            const text=await f.text();
            ta.value=text; toast('Файл загружен: '+f.name,'ok');
          } else if(name.endsWith('.docx')){
            toast('Распаковка .docx…','');
            try{
              const text=await docxToText(f);
              ta.value=text; toast('📄 .docx распознан: '+f.name,'ok');
            }catch(err){
              console.warn('docx parse failed',err);
              toast('Не удалось прочитать .docx ('+err.message+'). Сохраните как .txt из Word.','err');
            }
          } else {
            toast('Поддерживаются .txt, .md, .docx','warn');
          }
        }catch(e){ toast('Ошибка чтения файла: '+e.message,'err'); }
      };
      fileInput.onchange=e=>handleFile(e.target.files[0]);
      ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{ e.preventDefault(); e.stopPropagation(); dz.classList.add('dragover'); }));
      ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{ e.preventDefault(); e.stopPropagation(); dz.classList.remove('dragover'); }));
      dz.addEventListener('drop',e=>{ const f=e.dataTransfer?.files?.[0]; handleFile(f); });
      b.querySelector('#i-save').onclick=()=>{ state.project.input=ta.value; save(); toast('Исходник сохранён','ok'); closeDrawer(); };
    });
}
function openExport(){
  openDrawer('⬇ Экспорт / импорт',`
    <div class="section-label" style="border:0;margin-top:0;padding:0">Готовая книга</div>
    <div class="field"><label>Раскрытие ИИ (для площадок)</label><input id="x-disc" value="${esc(state.project.disclosure)}"></div>
    <div class="actions"><button class="btn ok" id="x-book">📕 Скачать книгу (.md)</button>
      <button class="btn ok" id="x-docx">📄 Скачать Word (.doc)</button>
      <button class="btn ok" id="x-epub">📗 Скачать EPUB</button>
      <button class="btn ok" id="x-pdf">🖨 PDF</button>
      <button class="btn ok" id="x-fb2">📱 FB2</button></div>
    <div class="section-label">Обложка</div>
    <div class="cover-row">
      <div class="cover-preview" id="x-cover-prev">${state.project.cover?`<img src="${esc(state.project.cover)}">`:'<span class="cover-empty">нет обложки</span>'}</div>
      <div class="cover-ctrls">
        <label class="btn ghost" style="cursor:pointer">📁 Загрузить<input type="file" id="x-cover-file" accept="image/*" hidden></label>
        <button class="btn ghost" id="x-cover-gen">🎨 Сгенерировать обложку</button>
        <button class="btn ghost" id="x-cover-clear">🗑 Очистить обложку</button>
      </div>
    </div>
    <div class="hint">Обложка кладётся первой страницей в EPUB (cover-image). Генератор рисует 1600×2560 на основе жанра, названия и автора.</div>
    <div class="section-label">Метаданные книги</div>
    <div class="meta-form">
      <div class="field"><label>Автор</label><input id="x-meta-author" value="${esc(state.project.author)}" placeholder="Имя Фамилия"></div>
      <div class="field"><label>ISBN</label><input id="x-meta-isbn" value="${esc(state.project.isbn)}" placeholder="978-…"></div>
      <div class="field"><label>Серия</label><input id="x-meta-series" value="${esc(state.project.series)}" placeholder="Название серии"></div>
      <div class="field"><label>Категории / BISAC</label><input id="x-meta-bisac" value="${esc(state.project.bisac)}" placeholder="FIC000000, Художественная проза"></div>
      <div class="field"><label>Жанр FB2</label><select id="x-meta-fb2genre">
        ${[['','— по строке жанра —'],['sf','Научная фантастика'],['fantasy','Фэнтези'],['detective','Детектив'],['thriller','Триллер'],['prose_contemporary','Современная проза'],['prose_classic','Классическая проза'],['love','Любовный роман'],['adventure','Приключения'],['child_prose','Детская проза'],['nonfiction','Нон-фикшн'],['sci_history','История'],['poetry','Поэзия'],['humor','Юмор'],['horror','Ужасы']].map(([v,l])=>`<option value="${v}"${state.project.fb2genre===v?' selected':''}>${l}</option>`).join('')}
      </select></div>
      <div class="field"><label>Аннотация</label><textarea id="x-meta-annot" rows="4" placeholder="Краткое описание книги для магазинов">${esc(state.project.annotation)}</textarea></div>
      <div class="actions"><button class="btn ghost" id="x-meta-fill">📋 Заполнить из агента «Метаданные»</button></div>
    </div>
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
    b.querySelector('#x-pdf').onclick=exportPDF;
    b.querySelector('#x-fb2').onclick=exportFb2;
    b.querySelector('#x-exp').onclick=()=>download((state.project.title||'pipeline')+'.json', JSON.stringify(state,safeReplacer,2));
    b.querySelector('#x-pipe').onclick=()=>{
      const clean={nodes:state.nodes.map(n=>({...n,output:'',summary:'',error:'',cacheHash:'',tokensIn:0,tokensOut:0,ms:0,apiKey:'',approved:false,status:'idle'})),edges:state.edges,bible:state.bible,groups:state.groups||[],global:{...state.global,apiKey:'',proxyToken:''}};
      download((state.project.title||'pipeline')+'-pipeline.json',JSON.stringify(clean,null,2)); toast('Пайплайн экспортирован (без ключей и данных)','ok');};
    b.querySelectorAll('[data-restore]').forEach(btn=>btn.onclick=()=>{ const r=(state.runs||[])[+btn.dataset.restore]; if(!r)return;
      if(!confirm('Восстановить состояние агентов из этого прогона?')) return;
      state.nodes=r.nodes; state.edges=r.edges; save(); render(); closeDrawer(); toast('Прогон восстановлен','ok'); });
    b.querySelector('#x-imp').onchange=ev=>{ const f=ev.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=()=>{ try{ state=Object.assign(defaultState(),JSON.parse(r.result)); save(); render(); closeDrawer(); toast('Проект импортирован','ok'); }catch{ toast('Не удалось прочитать файл','err'); } }; r.readAsText(f); };
    b.querySelector('#x-bl-save').onclick=()=>{ saveBaseline(); openExport(); };
    if(state.baseline) b.querySelector('#x-bl-cmp').onclick=openBaselineCompare;
    // ── Обложка ──
    b.querySelector('#x-cover-file').onchange=ev=>{
      const f=ev.target.files[0]; if(!f) return;
      const r=new FileReader();
      r.onload=()=>{ state.project.cover=r.result; save(); openExport(); toast('Обложка загружена','ok'); };
      r.readAsDataURL(f);
    };
    b.querySelector('#x-cover-clear').onclick=()=>{ state.project.cover=''; save(); openExport(); toast('Обложка удалена'); };
    b.querySelector('#x-cover-gen').onclick=()=>{ generateCover(); openExport(); };
    // ── Метаданные ──
    const syncMeta=()=>{
      state.project.author=b.querySelector('#x-meta-author').value;
      state.project.isbn=b.querySelector('#x-meta-isbn').value;
      state.project.series=b.querySelector('#x-meta-series').value;
      state.project.bisac=b.querySelector('#x-meta-bisac').value;
      state.project.fb2genre=b.querySelector('#x-meta-fb2genre').value;
      state.project.annotation=b.querySelector('#x-meta-annot').value;
      save();
    };
    ['x-meta-author','x-meta-isbn','x-meta-series','x-meta-bisac','x-meta-fb2genre','x-meta-annot']
      .forEach(id=>{ const el=b.querySelector('#'+id); if(el) el.onchange=syncMeta; });
    b.querySelector('#x-meta-fill').onclick=()=>{ fillMetaFromAgent(); openExport(); };
  });
}
/* Канвас-генератор обложки 1600×2560 + парсер метаданных из агента */
const GENRE_PALETTE={
  'детектив':['#1a1a2e','#16213e'],'триллер':['#1a1a2e','#16213e'],'ужас':['#0d0d0d','#2b0000'],
  'фэнтези':['#2d1b4e','#5b2c8a'],'фантастик':['#0a1a2f','#1b3a5f'],'sf':['#0a1a2f','#1b3a5f'],
  'любов':['#5b1a3a','#a83255'],'роман':['#3a2a4a','#6b4a7a'],'детск':['#2a5a8a','#4ab0e0'],
  'нон-фикшн':['#1e3a2e','#2e6b4e'],'нонфикшн':['#1e3a2e','#2e6b4e'],'истори':['#3a2e1a','#6b5a2e']
};
function genrePalette(genre){
  const g=(genre||'').toLowerCase();
  for(const k in GENRE_PALETTE) if(g.includes(k)) return GENRE_PALETTE[k];
  return ['#2c2c44','#454566'];
}
function generateCover(){
  const pr=state.project;
  const W=1600,H=2560;
  const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
  const ctx=cv.getContext('2d');
  const [c1,c2]=genrePalette(pr.genre);
  const grad=ctx.createLinearGradient(0,0,W,H);
  grad.addColorStop(0,c1); grad.addColorStop(1,c2);
  ctx.fillStyle=grad; ctx.fillRect(0,0,W,H);
  // декоративная рамка
  ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=8;
  ctx.strokeRect(60,60,W-120,H-120);
  ctx.textAlign='center';
  // Название — по центру, перенос по словам
  const title=(pr.title||'Без названия').toUpperCase();
  ctx.fillStyle='#fff';
  let fs=140; ctx.font='bold '+fs+'px Georgia, serif';
  const words=title.split(/\s+/), lines=[]; let line='';
  for(const w of words){ const test=line?line+' '+w:w; if(ctx.measureText(test).width>W-280&&line){lines.push(line);line=w;}else line=test; }
  if(line) lines.push(line);
  ctx.shadowColor='rgba(0,0,0,0.5)'; ctx.shadowBlur=20;
  let y=H*0.40-(lines.length-1)*fs*0.6;
  for(const l of lines){ ctx.fillText(l,W/2,y); y+=fs*1.2; }
  ctx.shadowBlur=0;
  // разделительная линия
  ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.lineWidth=4;
  ctx.beginPath(); ctx.moveTo(W/2-200,y+40); ctx.lineTo(W/2+200,y+40); ctx.stroke();
  // Автор — внизу
  const author=(pr.author||'').trim();
  if(author){ ctx.font='italic 70px Georgia, serif'; ctx.fillStyle='rgba(255,255,255,0.9)'; ctx.fillText(author,W/2,H-220); }
  // Жанр — мелким снизу
  if(pr.genre){ ctx.font='40px Georgia, serif'; ctx.fillStyle='rgba(255,255,255,0.6)'; ctx.fillText(pr.genre.toUpperCase(),W/2,H-130); }
  state.project.cover=cv.toDataURL('image/jpeg',0.9);
  save();
  toast('Обложка сгенерирована','ok');
}
function fillMetaFromAgent(){
  const n=state.nodes.find(x=>roleKeyOf(x)==='meta'&&x.output);
  if(!n){ toast('Нет узла роли «Метаданные» с результатом','err'); return; }
  const out=n.output;
  const grab=re=>{ const m=out.match(re); return m?m[1].trim():''; };
  const author=grab(/Автор[:\s]+(.+)/i);
  const isbn=grab(/ISBN[:\s]+([\d\-Xx]+)/i);
  const annot=grab(/Аннотаци[яи][:\s]+([\s\S]+?)(?:\n\s*\n|\n[А-ЯЁ][а-яё]+:|$)/i);
  const bisac=grab(/(?:Категори[ия]|BISAC|Жанр)[:\s]+(.+)/i);
  const series=grab(/Сери[яи][:\s]+(.+)/i);
  if(author) state.project.author=author;
  if(isbn) state.project.isbn=isbn;
  if(annot) state.project.annotation=annot;
  if(bisac) state.project.bisac=bisac;
  if(series) state.project.series=series;
  save();
  toast((author||isbn||annot||bisac||series)?'Метаданные заполнены из агента':'Ничего не распознано в выводе агента',(author||isbn||annot||bisac||series)?'ok':'warn');
}
function exportPDF(){
  remindDisclosure();
  const pr=state.project;
  const chapters=bookNodes();
  if(!chapters.length){toast('Нет прозы для PDF — запустите конвейер','err');return;}
  const body=chapters.map((n,i)=>`<h2>${esc(chapterTitleOf(n,i))}</h2>${md2html(typo(cleanProse(n)))}`).join('<hr style="margin:20pt 0">');
  const win=window.open('','_blank');
  if(!win){toast('Заблокирован всплывающий окно — разрешите для этой страницы','err');return;}
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(typo(pr.title||'Книга'))}</title>
<style>
body{font-family:"Times New Roman",serif;font-size:12pt;line-height:1.8;margin:2cm 2.5cm;color:#000;background:#fff}
h1{font-size:20pt;text-align:center;margin-bottom:6pt;page-break-after:avoid}
h2{font-size:14pt;margin-top:28pt;margin-bottom:6pt;page-break-after:avoid}
p{margin:0 0 8pt;text-indent:1.5em}
ul,ol{margin:0 0 8pt 2em}li{margin:2pt 0}
hr{border:none;border-top:1px solid #bbb;margin:20pt 0}
.meta{text-align:center;color:#555;font-size:10pt;margin-bottom:24pt}
@media print{
  @page{margin:2cm 2.5cm;size:A4}
  body{margin:0}
  h2{page-break-after:avoid}
  h2+*{page-break-before:avoid}
}
</style></head><body>
<h1>${esc(typo(pr.title||'Без названия'))}</h1>
<div class="meta">
  <div>Жанр: ${esc(pr.genre||'—')} · Аудитория: ${esc(pr.audience||'—')}</div>
</div>
<hr>
${body}
<script>window.onload=function(){window.print();};<\/script>
</body></html>`);
  win.document.close();
  toast('Открыта страница печати / сохранения в PDF','ok');
}
function exportFb2(){
  remindDisclosure();
  const pr=state.project;
  const chapters=bookNodes();
  if(!chapters.length){toast('Нет прозы для FB2 — запустите конвейер','err');return;}
  const X=s=>(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const md2fb2=s=>{
    s=typo(s||'');
    return s.split(/\n\n+/).map(p=>{
      p=p.trim(); if(!p) return '';
      if(/^#{1,2}\s/.test(p)) return `<subtitle><p>${X(p.replace(/^#{1,3}\s*/,''))}</p></subtitle>`;
      if(/^### /.test(p)) return `<subtitle><p>${X(p.replace(/^### /,''))}</p></subtitle>`;
      p=p.replace(/\*\*([^*]+)\*\*/g,(m,t)=>`<strong>${X(t)}</strong>`)
         .replace(/\*([^*]+)\*/g,(m,t)=>`<emphasis>${X(t)}</emphasis>`);
      return `<p>${p.replace(/\n/g,' ')}</p>`;
    }).filter(Boolean).join('\n    ');
  };
  const sects=chapters.map((n,i)=>`  <section>\n    <title><p>${X(chapterTitleOf(n,i))}</p></title>\n    ${md2fb2(cleanProse(n))}\n  </section>`).join('\n');
  const date=new Date().toISOString().slice(0,10);
  // Жанр FB2: код из формы (project.fb2genre) → иначе fallback по сырой строке.
  const fb2genre=(pr.fb2genre&&pr.fb2genre.trim())||(pr.genre?pr.genre.trim():'')||'prose_contemporary';
  // Автор: «Имя [Отчество] Фамилия» → first-name = всё кроме последнего слова, last-name = последнее.
  const authorParts=(pr.author||'').trim().split(/\s+/).filter(Boolean);
  const firstName=authorParts.length>1?authorParts.slice(0,-1).join(' '):(authorParts[0]||'');
  const lastName=authorParts.length>1?authorParts[authorParts.length-1]:'';
  const annot=(pr.annotation||'').trim();
  const annotXml=annot?annot.split(/\n\n+/).map(p=>`<p>${X(p.replace(/\n/g,' '))}</p>`).join(''):'<p></p>';
  const xml=`<?xml version="1.0" encoding="UTF-8"?>\n<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">\n  <description>\n    <title-info>\n      <genre>${X(fb2genre)}</genre>\n      <author><first-name>${X(firstName)}</first-name><last-name>${X(lastName)}</last-name></author>\n      <book-title>${X(typo(pr.title||'Без названия'))}</book-title>\n      <annotation>${annotXml}</annotation>${pr.series?`\n      <sequence name="${X(pr.series)}"/>`:''}\n      <lang>ru</lang>\n    </title-info>\n    <document-info>\n      <author><nickname>ии-издательство</nickname></author>\n      <program-used>ИИ-Издательство</program-used>\n      <date value="${date}">${date}</date>\n      <id>${uid()}</id>\n      <version>1.0</version>\n    </document-info>\n  </description>\n  <body>\n${sects}\n  </body>\n</FictionBook>`;
  download((pr.title||'book').replace(/[\\/:*?"<>|]/g,'-')+'.fb2', xml, 'application/xml');
  toast('FB2 готов','ok');
}
/* ============ GOOGLE DRIVE BACKUP ============ */
function gdriveAuth(clientId){
  const redirectUri=location.origin+'/oauth-callback.html';
  const scope='https://www.googleapis.com/auth/drive.file';
  const url=`https://accounts.google.com/o/oauth2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent(scope)}`;
  window._gdriveAuthCallback=function(token){
    localStorage.setItem('gdrive_token',token);
    toast('Google Drive подключён ✓','ok');
  };
  const w=window.open(url,'gdrive_auth','width=520,height=620,left=200,top=100');
  if(!w) toast('Разрешите всплывающие окна для этой страницы','err');
}
window.receiveGdriveToken=function(token){
  if(window._gdriveAuthCallback) window._gdriveAuthCallback(token);
};
async function backupToDrive(){
  const token=localStorage.getItem('gdrive_token');
  if(!token){ toast('Сначала подключите Google Drive в настройках','err'); return; }
  const title=state.project.title||'проект';
  const filename=`ии-издательство-${title.replace(/[^\wЀ-ӿ]/g,'-')}-${new Date().toISOString().slice(0,10)}.json`;
  const content=JSON.stringify(state,safeReplacer,2);
  toast('Загружаю в Drive…');
  try{
    const searchRes=await fetch(`https://www.googleapis.com/drive/v3/files?q=name%3D%27${encodeURIComponent(filename)}%27%20and%20trashed%3Dfalse&fields=files(id,name)`,
      {headers:{Authorization:'Bearer '+token}});
    if(searchRes.status===401){localStorage.removeItem('gdrive_token');toast('Сессия Google Drive истекла — переподключитесь','err');return;}
    const meta={name:filename,mimeType:'application/json'};
    const blob=new Blob([content],{type:'application/json'});
    const form=new FormData();
    form.append('metadata',new Blob([JSON.stringify(meta)],{type:'application/json'}));
    form.append('file',blob);
    const upRes=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {method:'POST',headers:{Authorization:'Bearer '+token},body:form});
    if(!upRes.ok){
      const err=await upRes.text();
      if(upRes.status===401){localStorage.removeItem('gdrive_token');toast('Сессия истекла — переподключитесь','err');}
      else toast('Ошибка Drive: '+upRes.status,'err');
      return;
    }
    state.global.gdriveLastBackup=Date.now(); save();
    toast('Бэкап в Google Drive сохранён ✓','ok');
    logRow('Drive backup','ok',filename);
  }catch(err){toast('Ошибка: '+err.message,'err');}
}
function download(name,text,mime='text/plain'){ const u=URL.createObjectURL(new Blob([text],{type:mime})); const a=document.createElement('a'); a.href=u; a.download=name; a.click(); URL.revokeObjectURL(u); }
// Типографический постпроцессинг: ASCII-символы → типографические.
// Код (```...``` и `...`) не трогаем. Кавычки в чисто-латинских вставках не «ёлочим».
function _typoSeg(seg){
  return seg
    .replace(/---/g,'—').replace(/--/g,'–')
    .replace(/"([^"]+)"/g,(m,inner)=>{
      // Не превращать в «ёлочки» английские кавычки (нет кириллицы внутри)
      return /[а-яёА-ЯЁ]/.test(inner)?'«'+inner+'»':m;
    })
    .replace(/[^\S\r\n]{2,}/g,' ')           // двойные пробелы (только пробелы, не переносы строк)
    .replace(/\.{3}/g,'…')                  // три точки → многоточие
    .replace(/(\d)\s*x\s*(\d)/gi,'$1×$2'); // 2 x 3 → 2×3
}
function typo(s){
  if(!s) return '';
  // Разбиваем на сегменты: код-fence ```...```, inline-code `...`, остальное.
  // Типографируем только не-код.
  const parts=s.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts.map(p=>(p.startsWith('```')||(p.startsWith('`')&&p.endsWith('`')))?p:_typoSeg(p)).join('');
}
/* ============ СБОРКА КНИГИ (общие хелперы) ============ */
// Определяет ключ роли узла (n.role хранит ДОЛЖНОСТЬ — title, поэтому ищем шаблон).
function roleKeyOf(n){
  if(n.nodeType && SPEC_NODES[n.nodeType]) return n.nodeType;
  const byName=TEMPLATES.find(t=>t.name===n.name);
  if(byName) return byName.role;
  const byTitle=TEMPLATES.find(t=>t.title===n.role);
  if(byTitle) return byTitle.role;
  return n.role||'';
}
// Должен ли узел попасть в книгу. Учитывает явный флаг; иначе считает по роли.
function nodeInBook(n){
  if(!n||!n.output) return false;
  if(typeof n.includeInBook==='boolean') return n.includeInBook;
  return defaultIncludeInBook(roleKeyOf(n));
}
// Узлы для книги в правильном порядке (топологическом).
function bookNodes(){ return topoOrder().map(id=>node(id)).filter(nodeInBook); }
// Заголовок главы: явный chapterTitle → первый H1/H2 из вывода → «Глава N».
function chapterTitleOf(n,index){
  if(n.chapterTitle&&n.chapterTitle.trim()) return n.chapterTitle.trim();
  const m=(n.output||'').split('\n').map(l=>l.match(/^#{1,2}\s+(.+?)\s*$/)).find(Boolean);
  if(m) return m[1].trim();
  return 'Глава '+(index+1);
}
// Чистая проза: если в выводе есть блок текста — вернуть только его (без списка правок).
function cleanProse(n){
  const out=n.output||'';
  // Явные маркеры блока текста
  let m=out.match(/===\s*ТЕКСТ\s*===\s*([\s\S]*?)\s*===\s*КОНЕЦ\s*===/i);
  if(m) return m[1].trim();
  m=out.match(/^#+\s*(?:Исправленный|Итоговый|Готовый|Финальный)\s+текст[:\s]*$([\s\S]*)$/im);
  if(m) return m[1].replace(/^\*{2}[^*]+\*{2}:?\s*\n*/,'').trim();
  // Снимаем типичные редакторские преамбулы ДО текста (порядок важен):
  let s=out;
  // 1) однострочные редакторские преамбулы: строка начинается с «Вот/Ниже/Привожу/Текст готов» — убрать всю строку + пустые строки после
  s=s.replace(/^(?:вот\b|ниже\b|привожу\b|текст\s+готов)[^\n]*\n+/i,'');
  // 2) *** разделитель (встречается после преамбулы)
  s=s.replace(/^\s*\*{3,}\s*\n+/,'');
  // 3) **Заголовок:** следующей строкой
  s=s.replace(/^\*{2}[^*\n]+\*{2}:?\s*\n+/,'');
  // 4) --- правки в конце (для Корректора — оставляем в выводе, убираем из книги)
  s=s.replace(/\n+---\s*ПРАВКИ:[\s\S]*$/i,'');
  return s.trim();
}
// Front matter (титульный лист) книги.
function frontMatter(){
  const pr=state.project;
  const author=(pr.author||'').trim();
  const year=new Date().getFullYear();
  return { title:typo(pr.title||'Без названия'), author, year };
}
// Одноразовое напоминание про раскрытие ИИ (не блокирует экспорт).
let _discReminded=false;
function remindDisclosure(){
  if(_discReminded) return;
  if(!state.project.disclosure || !state.project.disclosure.trim()){
    toast('💡 Не забудьте указать использование ИИ при загрузке на площадку','warn');
    _discReminded=true;
  }
}
function exportBook(){
  remindDisclosure();
  const pr=state.project;
  const fm=frontMatter();
  const chapters=bookNodes();
  if(!chapters.length){ toast('Нет прозы для книги — запустите конвейер или включите агентов в книгу','err'); return; }
  // Front matter
  const fmBlock=`# ${fm.title}\n\n${fm.author?`*${fm.author}*\n\n`:''}${fm.year}\n\nВсе права защищены\n`;
  // Оглавление
  const toc='## Содержание\n\n'+chapters.map((n,i)=>{
    const t=chapterTitleOf(n,i);
    const anchor='ch'+(i+1);
    return `${i+1}. [${t}](#${anchor})`;
  }).join('\n');
  // Тело
  const body=chapters.map((n,i)=>{
    const t=chapterTitleOf(n,i);
    return `<a id="ch${i+1}"></a>\n\n## ${t}\n\n${typo(cleanProse(n))}`;
  }).join('\n\n---\n\n');
  // KDP-чеклист — служебный блок в самом конце под разделителем
  const md=`${fmBlock}\n---\n\n${toc}\n\n---\n\n${body}\n\n---\n\n<!-- Служебный блок (не часть книги) -->\n\n${KDP_CHECKLIST}\n`;
  download((pr.title||'book')+'.md', md);
  toast('Книга собрана — '+chapters.length+' глав','ok');
}
function exportDocx(){
  remindDisclosure();
  const pr=state.project;
  const fm=frontMatter();
  const chapters=bookNodes();
  if(!chapters.length){ toast('Нет прозы для книги — запустите конвейер','err'); return; }
  const body=chapters.map((n,i)=>`<h2>${esc(chapterTitleOf(n,i))}</h2>${md2html(typo(cleanProse(n)))}<hr>`).join('');
  const front=`<h1>${esc(fm.title)}</h1>
    ${fm.author?`<p style="text-align:center;font-style:italic">${esc(fm.author)}</p>`:''}
    <p style="text-align:center;color:#666">${fm.year}</p>
    <p style="text-align:center;color:#666">Все права защищены</p><hr>`;
  const html=`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8">
    <style>body{font-family:"Times New Roman",serif;font-size:12pt;line-height:1.6;margin:2cm}
    h1{font-size:18pt;text-align:center}h2{font-size:14pt;margin-top:18pt}
    p{margin:0 0 6pt}ul{margin:0 0 6pt 18pt}li{margin:2pt 0}
    hr{border:none;border-top:1px solid #999;margin:12pt 0}</style></head><body>
    ${front}
    ${body||'<p>(нет результатов)</p>'}
    </body></html>`;
  download((pr.title||'book')+'.doc', '﻿'+html, 'application/msword');
  toast('Word-документ готов','ok');
}

function exportEpub(){
  remindDisclosure();
  const pr=state.project;
  const chapters=bookNodes();
  if(!chapters.length){toast('Нет прозы для EPUB — запустите конвейер','err');return;}
  const title=typo(pr.title||'Без названия');
  const fm=frontMatter();
  const E=s=>(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const bookId=(pr.isbn&&pr.isbn.trim())?('urn:isbn:'+pr.isbn.trim().replace(/[^\dXx]/g,'')):('urn:uuid:'+uid()+'-'+uid());
  const now=new Date().toISOString().replace(/\.\d+Z$/,'Z');

  // Обложка (cover-image) — декодируем dataURL в бинарь для STORE+CRC32
  let coverBin=null;
  if(pr.cover&&/^data:image\//.test(pr.cover)){
    try{
      const b64=pr.cover.split(',')[1]; const bin=atob(b64);
      coverBin=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) coverBin[i]=bin.charCodeAt(i);
    }catch{ coverBin=null; }
  }
  const coverXhtml=`<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><meta charset="utf-8"/><title>Обложка</title><style>body{margin:0;padding:0}img{max-width:100%;height:auto;display:block;margin:0 auto}</style></head><body epub:type="cover"><img src="../images/cover.jpg" alt="${E(title)}"/></body></html>`;

  // Титульная страница (front matter) — первая в spine
  const titleXhtml=`<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><meta charset="utf-8"/><title>${E(fm.title)}</title><link rel="stylesheet" href="../style.css"/></head><body><div class="titlepage"><h1>${E(fm.title)}</h1>${fm.author?`<p class="author">${E(fm.author)}</p>`:''}<p class="year">${fm.year}</p><p class="rights">Все права защищены</p></div></body></html>`;

  // Главы (с человеческими заголовками)
  const chs=chapters.map((n,i)=>{
    const fn='ch'+String(i+1).padStart(3,'0')+'.xhtml';
    const cht=E(chapterTitleOf(n,i));
    const body=md2xhtml(typo(cleanProse(n)));
    return {fn,cht,xhtml:`<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><meta charset="utf-8"/><title>${cht}</title><link rel="stylesheet" href="../style.css"/></head><body><h2>${cht}</h2>\n${body}\n</body></html>`};
  });

  const coverManifest=coverBin?`<item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>\n    <item id="cover" href="chapters/cover.xhtml" media-type="application/xhtml+xml"/>\n    `:'';
  const manifestItems=coverManifest+`<item id="titlepage" href="chapters/title.xhtml" media-type="application/xhtml+xml"/>\n    `+chs.map((c,i)=>`<item id="ch${i+1}" href="chapters/${c.fn}" media-type="application/xhtml+xml"/>`).join('\n    ');
  const spineItems=(coverBin?`<itemref idref="cover"/>\n    `:'')+`<itemref idref="titlepage"/>\n    `+chs.map((_,i)=>`<itemref idref="ch${i+1}"/>`).join('\n    ');
  const navItems=chs.map(c=>`<li><a href="chapters/${c.fn}">${c.cht}</a></li>`).join('\n      ');
  const ncxPoints=chs.map((c,i)=>`<navPoint id="np${i+1}" playOrder="${i+1}"><navLabel><text>${c.cht}</text></navLabel><content src="chapters/${c.fn}"/></navPoint>`).join('\n  ');

  const css=`body{font-family:Georgia,serif;font-size:1em;line-height:1.7;margin:1.2em}
h1{font-size:1.8em;text-align:center;margin:1em 0}h2{font-size:1.3em;margin:1.2em 0 .5em}
h3{font-size:1.15em;margin:1em 0 .4em}h4{font-size:1em;font-weight:bold;margin:.8em 0 .3em}
p{margin:.3em 0 .6em;text-indent:1.4em}p:first-child,h2+p,h3+p{text-indent:0}
ul{margin:.3em 0 .6em 1.8em}li{margin:.2em 0}hr{border:none;border-top:1px solid #aaa;margin:1em 0}
.titlepage{text-align:center;margin-top:30%}.titlepage h1{font-size:2em;margin:0 0 1em}.titlepage .author{font-style:italic;font-size:1.2em;margin:.5em 0}.titlepage .year{margin:2em 0 .3em;color:#555}.titlepage .rights{color:#777;font-size:.9em}`;

  const container=`<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;

  const opf=`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${E(title)}</dc:title>
    <dc:creator>${E((pr.author||'').trim()||'Автор не указан')}</dc:creator>
    <dc:language>ru</dc:language>
    <dc:identifier id="bookid">${bookId}</dc:identifier>
    <dc:description>${E(pr.annotation||'')}</dc:description>${pr.bisac?`\n    <dc:subject>${E(pr.bisac)}</dc:subject>`:''}${pr.series?`\n    <meta property="belongs-to-collection" id="series">${E(pr.series)}</meta>`:''}
    <dc:publisher>ИИ-Издательство</dc:publisher>${coverBin?'\n    <meta name="cover" content="cover-image"/>':''}
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
  if(coverBin){ zip.add('OEBPS/images/cover.jpg',coverBin); zip.add('OEBPS/chapters/cover.xhtml',coverXhtml); }
  zip.add('OEBPS/chapters/title.xhtml',titleXhtml);
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
  else if(a==='att-choose'){ resolveAttention(id, t.dataset.val); }
  else if(a==='att-apply'){
    const inp=$('#attention-bar .att-input[data-id="'+id+'"]');
    const v=inp&&inp.value.trim();
    if(v) resolveAttention(id, v); else toast('Введите свой вариант','warn');
  }
  else if(a==='att-collapse'){ _attentionCollapsed=true; renderAttention(); }
  else if(a==='att-expand'){ _attentionCollapsed=false; renderAttention(); }
  else if(a==='settings') openSettings(); else if(a==='add-node') addNodePicker(); else if(a==='auto-layout') autoLayout(); else if(a==='templates') openTemplates(); else if(a==='group') openGroupCreator(); else if(a==='chapters') openChapters(); else if(a==='guide') openGuide(); else if(a==='entities') openEntities();
  else if(a==='text-analysis') openTextAnalysis();
  else if(a==='concept') openConcept();
  else if(a==='style-school') openStyleSchool();
  else if(a==='publish-guide') openPublishGuide();
  else if(a==='switch-view') switchView(t.dataset.view);
  else if(a==='toggle-rail'){ $('#studio')?.classList.toggle('rail-collapsed'); }
  else if(a==='rail-chapter'){
    // Режим «Книга»: выбор главы наполняет закреплённый инспектор (#book-inspector),
    // НЕ открывая выезжающий оверлей холста (#node-panel).
    _panelNodeId=id;
    switchView('reader');
    renderBookInspector();
    const anchor=document.querySelector(`.lr-chapter[data-id="${id}"]`);
    if(anchor){ document.querySelectorAll('.lr-chapter.active').forEach(e=>e.classList.remove('active')); anchor.classList.add('active'); }
  }
  else if(a==='bi-overview'){ _panelNodeId=null; renderBookInspector(); renderLeftRail(); }
  else if(a==='bi-run'){ runNode(id); }
  else if(a==='bi-rerun'){ const n=node(id); if(n){ n.cacheHash=''; n._loopPrev=''; runNode(id); } }
  else if(a==='bi-edit'){ openManualEdit(id); }
  else if(a==='bi-cfg'){ openNode(id); }
  else if(a==='bi-runfrom'){ runFromNode(id); }
  else if(a==='bi-ver'){ const n=node(id); const vs=n&&n.outputVersions; if(vs&&vs.length>1) openWordDiff('Версии: '+esc(n.name), vs[1].output, n.output, ()=>{ switchView('reader'); }); }
  else if(a==='delete-node'){
    const del=node(id); if(!del) return;
    const relinked=deleteNodesWithRelink([id]);
    save(); render(); closeDrawer();
    toast('Агент «'+del.name+'» удалён'+(relinked?' · связи перенаправлены':''));
  }
  else if(a==='toggle-collapse'){
    const n=node(id); if(n){ n.collapsed=!n.collapsed; save(); renderNodes(); }
  }
  else if(a==='open-edge'){
    const ed=state.edges.find(x=>x.id===id);
    if(!ed) return;
    const hitPath=edgesEl.querySelector(`[data-edge="${id}"]`);
    if(hitPath) hitPath.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  }
  else if(a==='edit-input') openInput(); else if(a==='open-node') openNode(id); else if(a==='run-node') runNode(id);
  else if(a==='run-from'){ closeDrawer(); runFromNode(id); }
  else if(a==='approve') approveNode(id); else if(a==='bible') openBible(); else if(a==='log') openLog(); else if(a==='export') openExport(); else if(a==='selfeval') runSelfEval();
  else if(a==='book-library') openBookLibrary();
  else if(a==='new-book'){ if(typeof newBook==='function') newBook(); }
  else if(a==='clear-style'){
    state.project.styleMix=[]; state.project.stylePassport=''; state.project.engagementPatterns=''; state.project.styleSourceName='';
    save(); render(); toast('Стиль снят — агенты пишут обычным голосом','ok');
  }
  else if(a==='restore-version'){
    const nodeId = t.dataset.node;
    const verIdx = parseInt(t.dataset.ver);
    const n = node(nodeId);
    if(n && n.outputVersions?.[verIdx]){
      n.output = n.outputVersions[verIdx].output;
      save(); render();
      toast('Версия восстановлена');
    }
  }
  else if(a==='diff-version'){
    const n=node(t.dataset.node);
    const verIdx=parseInt(t.dataset.ver);
    const v=n&&n.outputVersions?.[verIdx];
    if(v) openWordDiff(`± Версия ${n.outputVersions.length-verIdx} ↔ текущая — ${esc(n.name)}`,
      v.output||'', n.output||'', ()=>openNode(n.id));
  }
  else if(a==='baseline-textdiff'){
    const n=node(id);
    const bln=state.baseline&&state.baseline.nodes[id];
    if(n&&bln) openWordDiff(`± Изменения текста — ${esc(n.name)}`,
      bln.output||'', n.output||'', ()=>openBaselineCompare());
  }
  else if(a === 'pick-variant'){
    const n = node(t.dataset.id);
    const vi = parseInt(t.dataset.vi);
    if(n && n.variantOutputs?.[vi] !== undefined){
      n.output = n.variantOutputs[vi];
      n.status = 'done';
      save(); render(); closeDrawer();
      toast(`Вариант ${vi+1} выбран`, 'ok');
    }
  }
  else if(a === 'open-variants'){
    const n = node(t.dataset.id);
    if(n && n.variantOutputs) openVariantPicker(n);
  }
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
// Каталог жанров: код FB2 + название + типичная аудитория + тон для брифа
const GENRES = [
  {v:'detective',          l:'Детектив',              aud:'взрослые 25–55',   tone:'напряжённый, с интригой и неожиданной развязкой'},
  {v:'thriller',           l:'Триллер',               aud:'взрослые',         tone:'динамичный, держит в саспенсе'},
  {v:'fantasy',            l:'Фэнтези',               aud:'14–35',            tone:'эпичный, образный, с проработанным миром'},
  {v:'sf',                 l:'Научная фантастика',    aud:'16–45',            tone:'идейный, с технологиями и социальными вопросами'},
  {v:'love',               l:'Любовный роман',        aud:'женщины 20–45',    tone:'эмоциональный, о чувствах и отношениях'},
  {v:'prose_contemporary', l:'Современная проза',     aud:'взрослые',         tone:'реалистичный, психологичный'},
  {v:'horror',             l:'Ужасы',                 aud:'18+',              tone:'тревожный, атмосферный'},
  {v:'adventure',          l:'Приключения',           aud:'12–40',            tone:'насыщенный действием'},
  {v:'child_prose',        l:'Детская проза',         aud:'6–12',             tone:'простой, тёплый, поучительный'},
  {v:'nonfiction',         l:'Нон-фикшн',             aud:'взрослые',         tone:'ясный, структурированный, по делу'},
  {v:'sci_history',        l:'История',               aud:'взрослые',         tone:'фактологичный, повествовательный'},
  {v:'humor',              l:'Юмор',                  aud:'взрослые',         tone:'лёгкий, ироничный'},
];
const LENGTHS = [
  {v:'flash',   l:'Рассказ — до 5 000 слов',   words:'до 5 000 слов'},
  {v:'novella', l:'Повесть — 15–40 тыс. слов', words:'15–40 тыс. слов'},
  {v:'novel',   l:'Роман — 60–120 тыс. слов',  words:'60–120 тыс. слов'},
];
// roles — линейная цепочка; loops — рёбра-перепроверки {from,to} (индексы roles),
// from = проверяющий агент, to = к кому возвращаем на доработку, base = базовый порог 1–10.
const PROJECT_TPLS = {
  solo:{ label:'🤖 Соло-агент', icon:'🤖', roles:['writer'], loops:[], brief:'Один агент — задаёте промт, получаете результат' },
  story:{ label:'📖 Рассказ', icon:'📖', roles:['scout','writer','logedit','proof'], loops:[], brief:'Короткий рассказ' },
  nonfic:{ label:'📚 Нон-фикшн', icon:'📚', roles:['scout','dev','writer','factcheck','meta'], loops:[], brief:'Книга на основе экспертизы автора' },
  novel:{ label:'✍️ Роман', icon:'✍️', roles:['scout','dev','writer','logedit','line','proof','continuity','art','layout','meta','mkt'], loops:[], brief:'Полный производственный цикл' },
  chapters:{ label:'🗂 Роман по главам', icon:'🗂', roles:['scout','dev','fanout','proof'], loops:[], brief:'Роман с параллельной записью глав' },
  beatsheet:{ label:'🎬 Save The Cat', icon:'🎬', roles:['scout','beatsheet','writer','proof'], loops:[], brief:'Структура Save The Cat — 15 битов' },
  // ── Издательские циклы с перепроверкой (петли авто-оценки) ──
  qualityloop:{ label:'🔁 Редактура до качества', icon:'🔁',
    roles:['dev','writer','logedit','proof'],
    loops:[ {from:2,to:1,base:8,name:'Литред → доработка'}, {from:3,to:2,base:9,name:'Корректор → доработка'} ],
    brief:'Литред и корректор возвращают текст на доработку, пока оценка не достигнет порога' },
  house:{ label:'🏛 Издательство — полный цикл', icon:'🏛',
    roles:['scout','dev','writer','continuity','line','proof','factcheck','meta'],
    loops:[ {from:3,to:2,base:8,name:'Контроль логики → автор'}, {from:4,to:2,base:8,name:'Литред → автор'}, {from:5,to:4,base:9,name:'Корректор → литред'} ],
    brief:'Производственный цикл как в издательстве: автор → проверки непротиворечивости, литредактуры и корректуры с возвратами на доработку' },
  nonficcheck:{ label:'📋 Нон-фикшн с фактчеком', icon:'📋',
    roles:['scout','dev','writer','factcheck','proof'],
    loops:[ {from:3,to:2,base:8,name:'Фактчек → автор'} ],
    brief:'Каждый раздел проходит проверку фактов: при ошибках возвращается автору' },
};
// Строит граф из шаблона + применяет настройки (жанр/аудитория/объём/строгость).
// opts: {genreCode, audience, lengthWords, strictness(0..2), title, brief}
function buildTemplate(key, opts={}){
  const t = PROJECT_TPLS[key]; if(!t) return;
  const tpls = t.roles.map(r => TEMPLATES.find(x => x.role === r)).filter(Boolean);
  if(!tpls.length) return;
  // Узлы — раскладка с запасом по вертикали (чтобы петли были видны)
  state.nodes = tpls.map((tp,i)=>freshNode(tp, 60+(i%3)*260, 40+Math.floor(i/3)*210));
  state.edges = [];
  // Линейная цепочка
  for(let i=0;i<state.nodes.length-1;i++)
    state.edges.push({id:uid(),from:state.nodes[i].id,to:state.nodes[i+1].id,condition:'',maxRetries:0,_retryCount:0,isLoop:false,autoEval:false,evalThreshold:7,_autoScore:null});
  // Петли перепроверки: from(проверяющий) → to(на доработку), авто-оценка
  const strictDelta = (opts.strictness===2?1 : opts.strictness===0?-1 : 0); // строже/мягче порог
  (t.loops||[]).forEach(lp=>{
    const from=state.nodes[lp.from], to=state.nodes[lp.to];
    if(!from||!to) return;
    const thr=Math.max(5,Math.min(10,(lp.base||8)+strictDelta));
    state.edges.push({id:uid(),from:from.id,to:to.id,condition:'',maxRetries:opts.strictness===2?6:4,_retryCount:0,
      isLoop:true,autoEval:true,evalThreshold:thr,_autoScore:null});
  });
  // Применяем настройки проекта
  const g = GENRES.find(x=>x.v===opts.genreCode);
  if(g){ state.project.genre=g.l; state.project.fb2genre=g.v; }
  state.project.audience = opts.audience || (g?g.aud:state.project.audience);
  if(opts.title) state.project.title=opts.title;
  const lenTxt = (LENGTHS.find(x=>x.v===opts.lengthWords)||{}).words || '';
  state.project.brief = opts.brief || [t.brief, g?('жанр: '+g.l+', тон '+g.tone):'', lenTxt?('объём: '+lenTxt):''].filter(Boolean).join('. ');
  save(); render();
}
function applyTemplate(key){ buildTemplate(key, {}); } // для режима «Просто» — без диалога

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
    // #33: остаёмся в «Просто» — прогресс показываем здесь, а не кидаем на холст
    runPipeline();
  };
  const expertBtn = document.querySelector('#simp-to-expert');
  if(expertBtn) expertBtn.onclick = () => switchView('canvas');
  renderSimpleProgress();
}
// #33: прогресс создания книги внутри режима «Просто»
function renderSimpleProgress(){
  if(_currentView!=='simple') return;
  const box=document.querySelector('#simp-progress');
  if(!box) return;
  const nodes=state.nodes.filter(n=>n.nodeType!=='note');
  // Показываем блок если идёт создание или уже есть результаты
  const anyDone=nodes.some(n=>n.status==='done'||n.status==='error');
  if(!running && !anyDone){ box.style.display='none'; box.innerHTML=''; return; }
  box.style.display='';
  const ICON={done:'✅',error:'❌',running:'⏳',review:'⏳',variants:'⏳',skip:'⏭',idle:'•'};
  const doneCount=nodes.filter(n=>n.status==='done').length;
  const pct=nodes.length?Math.round(doneCount/nodes.length*100):0;
  const finished=!running && nodes.every(n=>['done','error','skip'].includes(n.status));
  const rows=nodes.map(n=>{
    const ic=ICON[n.status]||'•';
    const cls=n.status==='done'?'sp-done':n.status==='error'?'sp-err':n.status==='running'?'sp-run':'';
    return `<div class="sp-row ${cls}"><span class="sp-ic">${ic}</span><span class="sp-name">${esc(n.name)}</span></div>`;
  }).join('');
  const head=finished
    ? `<div class="sp-head">📖 Книга готова — ${doneCount} из ${nodes.length} этапов</div>`
    : running
      ? `<div class="sp-head">✨ Команда агентов создаёт книгу… ${pct}%</div>`
      : `<div class="sp-head">Готово ${doneCount} из ${nodes.length} этапов</div>`;
  let foot;
  if(running){
    foot=`<button class="btn danger sm" id="sp-stop" type="button">■ Стоп</button>
      <a href="#" class="sp-link" id="sp-show-canvas">Показать на схеме →</a>`;
  } else if(finished){
    foot=`<button class="btn ok sm" id="sp-read" type="button">📖 Читать</button>
      <button class="btn ghost sm" id="sp-docx" type="button">📄 Скачать Word</button>
      <button class="btn ghost sm" id="sp-epub" type="button">📗 Скачать EPUB</button>
      <a href="#" class="sp-link" id="sp-show-canvas">Показать на схеме →</a>`;
  } else {
    foot=`<a href="#" class="sp-link" id="sp-show-canvas">Показать на схеме →</a>`;
  }
  box.innerHTML=`${head}
    <div class="sp-bar"><div class="sp-bar-fill" style="width:${pct}%"></div></div>
    <div class="sp-list">${rows}</div>
    <div class="sp-cost">Стоимость: ${money(projectCost())}</div>
    ${finished?`<div class="sp-hint">Для KDP → EPUB, для Литрес → .docx</div>`:''}
    <div class="sp-foot">${foot}</div>`;
  box.querySelector('#sp-stop')?.addEventListener('click',()=>{ if(abortCtrl) abortCtrl.abort(); });
  box.querySelector('#sp-show-canvas')?.addEventListener('click',ev=>{ ev.preventDefault(); switchView('canvas'); });
  box.querySelector('#sp-read')?.addEventListener('click',()=>switchView('reader'));
  box.querySelector('#sp-docx')?.addEventListener('click',()=>exportDocx());
  box.querySelector('#sp-epub')?.addEventListener('click',()=>exportEpub());
}

function openTemplates(){
  openDrawer('🗂 Шаблоны проекта',`
    <p class="hint" style="margin-top:0">Выберите стартовый пакет агентов. Шаблоны с 🔁 содержат циклы перепроверки — редактор возвращает текст на доработку, пока авто-оценка не достигнет порога.</p>
    ${Object.entries(PROJECT_TPLS).map(([k,t])=>{
      const chain=t.roles.map(r=>TEMPLATES.find(x=>x.role===r)?.name).filter(Boolean).join(' → ');
      const loopBadge=(t.loops&&t.loops.length)?`<span class="tpl-loop-badge">🔁 ${t.loops.length} ${t.loops.length===1?'проверка':'проверки'}</span>`:'';
      return `<div class="tpl-card" data-tpl="${k}">
        <div class="tpl-card-head"><strong>${t.label}</strong>${loopBadge}</div>
        <div class="tpl-card-desc">${esc(t.brief||'')}</div>
        <div class="tpl-card-chain">${chain}</div>
      </div>`;
    }).join('')}`,
  b=>{ b.querySelectorAll('[data-tpl]').forEach(card=>card.onclick=()=>openTemplateSetup(card.dataset.tpl)); });
}
// Шаг 2: настройка жанра/аудитории/объёма/строгости перед созданием
function openTemplateSetup(key){
  const t=PROJECT_TPLS[key]; if(!t) return;
  const hasLoops=t.loops&&t.loops.length;
  openDrawer('⚙ Настройка: '+t.label,`
    <div class="field"><label>Название книги</label><input id="ts-title" value="${esc(state.project.title||'')}" placeholder="Можно заполнить позже"></div>
    <div class="field"><label>Жанр</label><select id="ts-genre">
      <option value="">— не выбран —</option>
      ${GENRES.map(g=>`<option value="${g.v}"${state.project.fb2genre===g.v?' selected':''}>${g.l}</option>`).join('')}
    </select></div>
    <div class="row2">
      <div class="field"><label>Аудитория</label><input id="ts-aud" value="${esc(state.project.audience||'')}" placeholder="подставится из жанра"></div>
      <div class="field"><label>Объём</label><select id="ts-len">
        ${LENGTHS.map(x=>`<option value="${x.v}">${x.l}</option>`).join('')}
      </select></div>
    </div>
    ${hasLoops?`<div class="field"><label>Строгость проверок</label>
      <select id="ts-strict">
        <option value="0">Мягкая — порог ниже, меньше повторов (дешевле)</option>
        <option value="1" selected>Обычная — как в издательстве</option>
        <option value="2">Строгая — высокий порог, больше итераций (дороже)</option>
      </select>
      <div class="hint">Циклы: ${t.loops.map(l=>esc(l.name)).join(' · ')}. Каждая итерация — доп. вызовы LLM (автор + оценка).</div></div>`:''}
    <div class="field"><label>Бриф (о чём книга) — необязательно</label>
      <textarea id="ts-brief" rows="3" placeholder="Если оставить пустым — соберём из жанра и шаблона">${esc(state.project.brief||'')}</textarea></div>
    <div class="hint" style="color:var(--warn)">⚠ Текущий холст будет заменён.</div>
    <div class="actions">
      <button class="btn ok" id="ts-create">Создать команду агентов</button>
      <button class="btn ghost" id="ts-back">← Назад</button>
    </div>`,
  b=>{
    const gsel=b.querySelector('#ts-genre'), aud=b.querySelector('#ts-aud');
    gsel.onchange=()=>{ const g=GENRES.find(x=>x.v===gsel.value); if(g && !aud.value.trim()) aud.value=g.aud; };
    b.querySelector('#ts-back').onclick=openTemplates;
    b.querySelector('#ts-create').onclick=()=>{
      buildTemplate(key,{
        title:b.querySelector('#ts-title').value.trim(),
        genreCode:gsel.value,
        audience:aud.value.trim(),
        lengthWords:b.querySelector('#ts-len').value,
        strictness:hasLoops?parseInt(b.querySelector('#ts-strict').value):1,
        brief:b.querySelector('#ts-brief').value.trim()
      });
      closeDrawer(); toast(t.label+' — команда готова'+(hasLoops?' (с циклами перепроверки)':''),'ok');
    };
  });
}
function autoLayout(){ state.nodes.forEach((n,i)=>{ n.x=60+(i%3)*250; n.y=40+Math.floor(i/3)*180; });
  state.edges=[]; for(let i=0;i<state.nodes.length-1;i++) state.edges.push({id:uid(),from:state.nodes[i].id,to:state.nodes[i+1].id,condition:'',maxRetries:0,_retryCount:0}); save(); render(); toast('Схема выстроена в цепочку'); }
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
  const userTpls=state.userTemplates||[];
  const myAgents=userTpls.length?`
    <div class="section-label">⭐ Мои агенты</div>
    <div id="my-agents" class="my-agents">
      ${userTpls.map((t,i)=>`<div class="my-agent-row">
        <button class="btn ghost sm my-agent-add" data-utpl="${i}" style="flex:1;text-align:left">${esc(t.emoji||'🤖')} ${esc(t.name||'агент')}</button>
        <button class="btn ghost xs my-agent-del" data-utpl-del="${i}" title="Удалить шаблон">×</button>
      </div>`).join('')}
    </div>`:'';
  openDrawer('＋ Добавить агента',`<div class="field"><label>Готовая роль</label><select id="add-tpl">
    ${TEMPLATES.map((t,i)=>`<option value="${i}">${t.emoji} ${t.name} — ${t.title}</option>`).join('')}
    <option value="custom">⚙️ Произвольный агент</option></select></div>
    <div class="hint">Появится на холсте. Свяжите вручную или «Авто-схема».</div>
    <div class="actions" style="margin-top:16px"><button class="btn ok" id="add-go">Добавить</button></div>
    ${myAgents}`,
    b=>{ b.querySelector('#add-go').onclick=()=>{ const v=b.querySelector('#add-tpl').value;
      const t=v==='custom'?{name:'Новый агент',title:'роль',emoji:'🤖',prompt:'Ты — агент издательства. Опиши свою роль.'}:TEMPLATES[+v];
      state.nodes.push(freshNode(t,canvas.scrollLeft+80,canvas.scrollTop+80)); save(); render(); closeDrawer(); toast('Агент добавлен'); };
      // ⭐ Мои агенты: добавление и удаление
      b.querySelectorAll('.my-agent-add').forEach(btn=>btn.onclick=()=>{
        const ut=(state.userTemplates||[])[+btn.dataset.utpl]; if(!ut) return;
        // freshNode ждёт {name,title,emoji,prompt,role(ключ)}; у шаблона role — должность (title)
        const tpl={ name:ut.name, title:ut.role||'агент', emoji:ut.emoji||'🤖', prompt:ut.prompt||'', role:'' };
        const fn=freshNode(tpl,canvas.scrollLeft+80,canvas.scrollTop+80);
        if(typeof ut.temperature==='number') fn.temperature=ut.temperature;
        state.nodes.push(fn); save(); render(); closeDrawer(); toast('Агент добавлен из шаблона','ok');
      });
      b.querySelectorAll('.my-agent-del').forEach(btn=>btn.onclick=()=>{
        state.userTemplates.splice(+btn.dataset.utplDel,1); save(); addNodePicker();
      });
    });
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

/* ============ АНАЛИЗ ТЕКСТА (локально, без LLM) ============ */
// Курируемый словарь RU-штампов / канцелярита / слов-паразитов
const TA_CLICHE=['внезапно','казалось','по-прежнему','стоит отметить','играет важную роль','следует отметить','на самом деле','тем не менее','в конце концов','так или иначе','как известно','не что иное как','имеет место','в значительной степени'];
// Глаголы атрибуции (речи)
const TA_SPEECH=['сказал','сказала','сказали','спросил','спросила','ответил','ответила','произнёс','произнес','произнесла','воскликнул','воскликнула','проговорил','проговорила','буркнул','буркнула','прошептал','прошептала','крикнул','крикнула','пробормотал','пробормотала','промолвил','добавил','добавила'];
// Формы глагола «быть/являться»
const TA_BE=['был','была','было','были','есть','быть','будет','будут','буду','будем','будешь','является','являются','являлся','являлась','являлись','суть'];

function taSentences(text){ return (text||'').split(/[.!?…]+/).map(s=>s.trim()).filter(s=>s.length>1); }
function taSyllables(text){ return ((text||'').toLowerCase().match(/[аеёиоуыэюя]/g)||[]).length; }
function taHash(str){ let h=5381; for(let i=0;i<str.length;i++){ h=((h<<5)+h)+str.charCodeAt(i); h|=0; } return h>>>0; }

function openTextAnalysis(){
  const nodes=state.nodes.filter(n=>n.output);
  const text=nodes.map(n=>n.output).join('\n\n');
  if(!text.trim()){
    openDrawer('📊 Анализ текста','<div class="hint" style="color:var(--faint);margin-top:0">Запустите конвейер — анализ строится по результатам агентов. Все метрики считаются локально, без обращения к LLM.</div>');
    return;
  }
  const tokens=tokensOf(text);
  const wordCount=tokens.length;
  const sents=taSentences(text);

  /* ── #9 Повторы / штампы / паразиты ── */
  const freq={};
  tokens.forEach(t=>{ const s=stem(t); if(s.length>2 && !STOP_RU.has(s)){ freq[s]=(freq[s]||0)+1; } });
  const top=Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,20)
    .map(([w,c])=>({w,c,per1k: wordCount? c*1000/wordCount : 0}));
  const chipsHtml=top.map(t=>`<span class="ta-chip${t.per1k>5?' ta-warn':''}" title="${t.c}× всего, ${t.per1k.toFixed(1)} на 1000 слов">${esc(t.w)} <b>${t.per1k.toFixed(1)}</b>/1k</span>`).join('');

  // Биграммы-повторы: одно знаменательное слово в окне ±3 предложений
  const sentStems=sents.map(s=>{ const set=new Set(); (tokensOf(s)).forEach(t=>{ const st=stem(t); if(st.length>3 && !STOP_RU.has(st)) set.add(st); }); return set; });
  const nearRepeats=[];
  for(let i=0;i<sents.length;i++){
    for(let j=i+1;j<=Math.min(i+3,sents.length-1);j++){
      for(const st of sentStems[i]){
        if(sentStems[j].has(st)){
          nearRepeats.push({word:st, a:sents[i], b:sents[j], dist:j-i});
        }
      }
    }
  }
  // оставим только уникальные по слову, не более 15
  const seenRep=new Set();
  const repList=nearRepeats.filter(r=>{ if(seenRep.has(r.word)) return false; seenRep.add(r.word); return true; }).slice(0,15);
  const repHtml=repList.length? repList.map(r=>`<div class="ta-bar"><b style="color:var(--warn)">«${esc(r.word)}»</b> <span style="color:var(--faint)">(через ${r.dist} предл.)</span><br><span style="color:var(--dim);font-size:11px">…${esc(r.a.slice(0,80))}… ↔ …${esc(r.b.slice(0,80))}…</span></div>`).join('')
    : '<div class="ta-bar" style="color:var(--faint)">Близких повторов знаменательных слов не найдено.</div>';

  // Штампы / канцелярит
  const lowText=text.toLowerCase().replace(/ё/g,'е');
  const cliche=TA_CLICHE.map(c=>{ const re=new RegExp(c.replace(/ё/g,'е').replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'); const m=lowText.match(re); return {c, n: m?m.length:0}; }).filter(x=>x.n>0).sort((a,b)=>b.n-a.n);
  const clicheHtml=cliche.length? cliche.map(x=>`<span class="ta-chip${x.n>3?' ta-warn':''}">${esc(x.c)} <b>${x.n}×</b></span>`).join('')
    : '<span style="color:var(--faint);font-size:12px">Штампов из словаря не обнаружено.</span>';

  /* ── #10 Читаемость (рус. Флеш, формула Оборневой) ── */
  const nSent=Math.max(1,sents.length);
  const syl=taSyllables(text);
  const avgLen=wordCount/nSent;
  const sylPerWord=wordCount? syl/wordCount : 0;
  const flesch=206.835 - 1.3*avgLen - 60.1*sylPerWord;
  let fleschLabel, fleschCls;
  if(flesch>80){ fleschLabel='легко (нач. школа)'; fleschCls='ok'; }
  else if(flesch>60){ fleschLabel='средне (подросток)'; fleschCls='ok'; }
  else if(flesch>30){ fleschLabel='сложно (вуз)'; fleschCls='warn'; }
  else { fleschLabel='очень сложно'; fleschCls='warn'; }

  /* ── #13 Дубли между главами (шинглинг 6-грамм, Jaccard) ── */
  const shingleSets=nodes.map(n=>{
    const toks=tokensOf(n.output);
    const set=new Set();
    for(let i=0;i+6<=toks.length;i++){ set.add(taHash(toks.slice(i,i+6).join(' '))); }
    return set;
  });
  const dupPairs=[];
  for(let i=0;i<nodes.length;i++){
    for(let j=i+1;j<nodes.length;j++){
      const A=shingleSets[i],B=shingleSets[j];
      if(!A.size||!B.size) continue;
      let inter=0; A.forEach(h=>{ if(B.has(h)) inter++; });
      const jac=inter/(A.size+B.size-inter);
      if(jac>0.15){
        // найдём пример дублирующегося пассажа
        const toksA=tokensOf(nodes[i].output); let sample='';
        for(let k=0;k+6<=toksA.length;k++){ if(B.has(taHash(toksA.slice(k,k+6).join(' ')))){ sample=toksA.slice(k,k+12).join(' '); break; } }
        dupPairs.push({a:nodes[i].name,b:nodes[j].name,jac,inter,sample});
      }
    }
  }
  const dupHtml=dupPairs.length? dupPairs.map(d=>`<div class="ta-bar ta-warn"><b>${esc(d.a)}</b> ↔ <b>${esc(d.b)}</b>: ${d.inter} похожих фрагментов (Jaccard ${(d.jac*100).toFixed(0)}%)<br><span style="color:var(--dim);font-size:11px">пример: «…${esc(d.sample)}…»</span></div>`).join('')
    : '<div class="ta-bar" style="color:var(--faint)">Значимых дублей между главами (>15% пересечения) не найдено.</div>';

  /* ── #14 Диалог / нарратив + глаголы речи ── */
  const paras=text.split(/\n{1,}/).map(p=>p.trim()).filter(Boolean);
  const dialogParas=paras.filter(p=>/^[—«]/.test(p)).length;
  const dialogPct=paras.length? dialogParas*100/paras.length : 0;
  const beCount=tokens.filter(t=>TA_BE.includes(t.toLowerCase())).length;
  const bePct=wordCount? beCount*100/wordCount : 0;
  // пассив: краткие причастия на -н/-нн + причастия -нн-/-енн-
  const passiveCount=(lowText.match(/[а-я]+[ео]?нн?(ый|ая|ое|ые|ого|ому|ыми|ом|а|о|ы)?\b/g)||[]).length;
  // глаголы атрибуции
  const speechFreq={};
  tokens.forEach(t=>{ const lt=t.toLowerCase(); if(TA_SPEECH.includes(lt)) speechFreq[lt]=(speechFreq[lt]||0)+1; });
  const speechTotal=Object.values(speechFreq).reduce((a,b)=>a+b,0);
  const speechSorted=Object.entries(speechFreq).sort((a,b)=>b[1]-a[1]);
  const domSpeech=speechSorted[0];
  const domPct=domSpeech&&speechTotal? domSpeech[1]*100/speechTotal : 0;
  const speechChips=speechSorted.slice(0,12).map(([w,c])=>{ const p=speechTotal? c*100/speechTotal:0; return `<span class="ta-chip${p>40?' ta-warn':''}">${esc(w)} <b>${c}×</b> (${p.toFixed(0)}%)</span>`; }).join('') || '<span style="color:var(--faint);font-size:12px">Глаголов атрибуции не найдено.</span>';
  const dialogBadge=`диалогов ${dialogPct.toFixed(0)}%`+(domSpeech?`, доминирует: ${esc(domSpeech[0])} (${domPct.toFixed(0)}%)`:'');

  /* ── #15 Ритм предложений ── */
  const lens=sents.map(s=>(tokensOf(s)).length).filter(l=>l>0);
  const blocks='▁▂▃▄▅▆▇█';
  const maxLen=Math.max(1,...lens);
  const spark=lens.map(l=>blocks[Math.min(blocks.length-1,Math.round((l/maxLen)*(blocks.length-1)))]).join('');
  // серии 3+ одинаковой длины (±1) и монстры >40
  let monotony=0;
  for(let i=0;i+2<lens.length;i++){ if(Math.abs(lens[i]-lens[i+1])<=1 && Math.abs(lens[i+1]-lens[i+2])<=1) monotony++; }
  const monsters=lens.filter(l=>l>40).length;
  const avgRhythm=lens.length? lens.reduce((a,b)=>a+b,0)/lens.length : 0;

  const html=`
    <p class="hint" style="margin-top:0">Локальный анализ ${nodes.length} глав(ы), ${wordCount.toLocaleString('ru')} слов, ${sents.length} предложений. Все метрики считаются в браузере, без обращения к LLM.</p>

    <div class="ta-section">
      <h3>🔁 #9 Повторы, штампы, паразиты</h3>
      <p class="ta-note">Топ-20 знаменательных слов (частота на 1000 слов). <span class="ta-warn-text">Красным</span> — больше 5 на 1000.</p>
      <div class="ta-chips">${chipsHtml}</div>
      <h4 class="ta-h4">Близкие повторы (одно слово в окне ±3 предложений)</h4>
      ${repHtml}
      <h4 class="ta-h4">Штампы и канцелярит</h4>
      <div class="ta-chips">${clicheHtml}</div>
    </div>

    <div class="ta-section">
      <h3>📖 #10 Читаемость (рус. Флеш, ф-ла Оборневой)</h3>
      <p class="ta-note">Индекс = 206.835 − 1.3×(слов/предл.) − 60.1×(слогов/слово). Чем выше — тем легче читать.</p>
      <div class="ta-bar">Ср. длина предложения: <b>${avgLen.toFixed(1)}</b> слов · Слогов/слово: <b>${sylPerWord.toFixed(2)}</b></div>
      <div class="ta-bar">Индекс читаемости: <b style="color:var(--${fleschCls})">${flesch.toFixed(0)}</b> — ${fleschLabel}</div>
    </div>

    <div class="ta-section">
      <h3>🧬 #13 Дубли между главами (самоплагиат)</h3>
      <p class="ta-note">Шинглинг по 6-граммам слов, пары глав с пересечением (Jaccard) выше 15%.</p>
      ${dupHtml}
    </div>

    <div class="ta-section">
      <h3>💬 #14 Диалог / нарратив + глаголы речи</h3>
      <p class="ta-note">Доля абзацев-диалогов, насыщенность «быть/являться» и пассивом, баланс глаголов атрибуции.</p>
      <div class="ta-badge">${dialogBadge}</div>
      <div class="ta-bar">Абзацев-диалогов: <b>${dialogPct.toFixed(0)}%</b> · «быть/являться»: <b>${bePct.toFixed(1)}%</b> слов · пассив (≈): <b>${passiveCount}</b></div>
      <h4 class="ta-h4">Глаголы атрибуции (всего ${speechTotal})</h4>
      <div class="ta-chips">${speechChips}</div>
    </div>

    <div class="ta-section">
      <h3>🎵 #15 Ритм предложений</h3>
      <p class="ta-note">Длины предложений (в словах) как спарклайн. Ищем монотонность (серии ±1 слово) и «монстров» (>40 слов).</p>
      <div class="ta-spark">${spark||'—'}</div>
      <div class="ta-bar">Ср. длина: <b>${avgRhythm.toFixed(1)}</b> слов · монотонных серий (3+): <b class="${monotony>0?'ta-warn-text':''}">${monotony}</b> · предложений-монстров (>40): <b class="${monsters>0?'ta-warn-text':''}">${monsters}</b></div>
    </div>
  `;
  openDrawer('📊 Анализ текста',html);
}

/* ============ 🎓 ШКОЛА СТИЛЯ ============ */
// Разбивает текст на куски ~maxLen по границам абзацев.
function chunkByParagraphs(text, maxLen){
  const paras=String(text||'').split(/\n{2,}/);
  const chunks=[]; let cur='';
  for(const p of paras){
    if(cur && (cur.length+p.length+2)>maxLen){ chunks.push(cur); cur=''; }
    // абзац-гигант сам по себе больше лимита — режем по предложениям
    if(p.length>maxLen){
      if(cur){ chunks.push(cur); cur=''; }
      let rest=p;
      while(rest.length>maxLen){
        let cut=rest.lastIndexOf('. ',maxLen); if(cut<maxLen*0.5) cut=maxLen;
        chunks.push(rest.slice(0,cut)); rest=rest.slice(cut);
      }
      if(rest.trim()) cur=rest;
    } else {
      cur=cur?cur+'\n\n'+p:p;
    }
  }
  if(cur.trim()) chunks.push(cur);
  return chunks.filter(c=>c.trim());
}
// Равномерная выборка <=max элементов из начала/середины/конца (сохраняет порядок).
function evenSample(arr, max){
  if(arr.length<=max) return arr.slice();
  const out=[]; const step=(arr.length-1)/(max-1);
  for(let i=0;i<max;i++) out.push(arr[Math.round(i*step)]);
  return out;
}
let _styleBuilding=false;
// Парсит 3 блока (ПАСПОРТ СТИЛЯ / ПАТТЕРНЫ ВОВЛЕЧЕНИЯ / СЮЖЕТНЫЕ ПРИЁМЫ) из ответа reduce.
function parseStyleBlocks(reduced){
  const txt=String(reduced||'');
  const mEng=txt.match(/ПАТТЕРНЫ\s+ВОВЛЕЧЕНИЯ/i);
  const mPlot=txt.match(/СЮЖЕТНЫЕ\s+ПРИЁМЫ/i);
  let style='', engagement='', plot='';
  // конец паспорта = начало паттернов или начало сюжета (что раньше), иначе конец текста
  const styleEnd=mEng?mEng.index:(mPlot?mPlot.index:txt.length);
  style=txt.slice(0,styleEnd).replace(/^\s*ПАСПОРТ\s+СТИЛЯ\s*/i,'').trim();
  if(mEng){
    const engStart=mEng.index+mEng[0].length;
    const engEnd=(mPlot && mPlot.index>mEng.index)?mPlot.index:txt.length;
    engagement=txt.slice(engStart,engEnd).trim();
  }
  if(mPlot){
    plot=txt.slice(mPlot.index+mPlot[0].length).trim();
  }
  return { style, engagement, plot };
}
// Извлекает 3 блока профиля стиля и СОХРАНЯЕТ запись в state.styleLibrary.
// Обратно совместимое имя buildStylePassport — алиас ниже.
async function buildStyleProfile(rawText, sourceName){
  if(_styleBuilding) return;
  const text=String(rawText||'').trim();
  if(!text){ toast('Сначала загрузите или вставьте образец текста','warn'); return; }
  if(!hasKey()){ toast('Нужен API-ключ','err'); openSettings(); return; }
  _styleBuilding=true;
  const c={ baseURL:state.global.baseURL, apiKey:pickKey(), model:state.global.model, temperature:0.2 };
  const setProg=msg=>{ const el=document.querySelector('#ss-progress'); if(el){ el.style.display=''; el.textContent=msg; } };
  const btn=document.querySelector('#ss-build'); if(btn){ btn.disabled=true; btn.textContent='⏳ Строю…'; }
  try{
    let chunks=chunkByParagraphs(text, 6000);
    const total=chunks.length;
    let truncated=false;
    if(chunks.length>8){ chunks=evenSample(chunks, 8); truncated=true; }
    const used=chunks.length;
    logRow('Школа стиля','run', truncated
      ? `Текст большой: анализирую ${used} из ${total} фрагментов (выборка начало/середина/конец)`
      : `Анализирую ${used} фрагмент(ов)`);
    if(truncated) toast(`Текст крупный — анализирую ${used} из ${total} фрагментов (равномерная выборка)`,'warn');

    const MAP_SYS='Ты литературовед. Из фрагмента извлеки ТОЛЬКО абстрактные приёмы, НЕ пересказывай сюжет и НЕ цитируй дословно. Отметь: лицо и время повествования, среднюю длину и ритм предложений, характер лексики, долю и манеру диалогов, тон, образность/тропы, как удерживается внимание. Также подметь СЮЖЕТНЫЕ ПРИЁМЫ: типичные повороты, как строится арка/акты, типы конфликтов, как подаются твисты и развязки (как приём, без конкретного сюжета).';
    const observations=[];
    for(let i=0;i<chunks.length;i++){
      setProg(`Анализирую фрагмент ${i+1} из ${chunks.length}…`);
      try{
        const obs=await callLLM(c,[
          {role:'system',content:MAP_SYS},
          {role:'user',content:chunks[i]}
        ]);
        if(obs && obs.trim()) observations.push(obs.trim());
      }catch(e){
        logRow('Школа стиля','error','Фрагмент '+(i+1)+': '+e.message);
      }
    }
    if(!observations.length){ toast('Не удалось извлечь наблюдения (проверьте ключ и модель)','err'); return; }

    setProg('Свожу наблюдения в профиль стиля…');
    const REDUCE_SYS='Сведи наблюдения в инструкцию для писателя. Без цитат и имён персонажей источника. Только переносимые приёмы. Выдай РОВНО три блока, каждый максимум ~220 слов, начинающиеся со строк-заголовков:\n\nПАСПОРТ СТИЛЯ\n<голос, ритм, лексика, POV, диалоги, тон, табу — как писать в этом стиле>\n\nПАТТЕРНЫ ВОВЛЕЧЕНИЯ\n<крючки, эмоциональная динамика, что держит внимание>\n\nСЮЖЕТНЫЕ ПРИЁМЫ\n<типичные сюжетные повороты, структура (как строится арка/акты), типы конфликтов, как подаются твисты и развязки — переносимые приёмы, БЕЗ конкретного сюжета источника>';
    const reduced=await callLLM({ ...c, temperature:0.2 },[
      {role:'system',content:REDUCE_SYS},
      {role:'user',content:observations.map((o,i)=>`Фрагмент ${i+1}:\n${o}`).join('\n\n')}
    ]);

    const { style, engagement, plot }=parseStyleBlocks(reduced);
    const name=(sourceName||'').trim()||'вставленный текст';
    const entry={ id:uid(), name, source:name, style, engagement, plot, ts:Date.now() };
    if(!Array.isArray(state.styleLibrary)) state.styleLibrary=[];
    state.styleLibrary.push(entry);
    // Удобство: сразу делаем новый стиль единственным активным в миксе.
    state.project.styleMix=[{id:entry.id, weight:100}];
    save();
    logRow('Школа стиля','done',`Профиль стиля «${name}» построен (${used} фрагм.) и добавлен в библиотеку`);
    toast('🎓 Профиль стиля «'+name+'» в библиотеке — активен в миксе','ok');
    openStyleSchool('lib'); // показать библиотеку с результатом
  }catch(e){
    logRow('Школа стиля','error',e.message);
    toast('Ошибка построения профиля: '+e.message,'err');
  }finally{
    _styleBuilding=false;
  }
}
// Обратная совместимость: старое имя.
const buildStylePassport=buildStyleProfile;
// Сплавляет выбранные взвешенные стили в ОДИН компактный профиль (3 блока) → новая запись библиотеки.
let _styleFusing=false;
async function fuseStyles(mix){
  if(_styleFusing) return;
  if(!hasKey()){ toast('Нужен API-ключ','err'); openSettings(); return; }
  const lib=state.styleLibrary||[];
  const picked=(mix||[]).map(m=>({ w:m.weight, e:lib.find(x=>x.id===m.id) })).filter(x=>x.e);
  if(picked.length<2){ toast('Выберите минимум 2 стиля для сплава','warn'); return; }
  _styleFusing=true;
  const c={ baseURL:state.global.baseURL, apiKey:pickKey(), model:state.global.model, temperature:0.3 };
  const setProg=msg=>{ const el=document.querySelector('#ss-progress-mix'); if(el){ el.style.display=''; el.textContent=msg; } };
  try{
    setProg('Сплавляю стили в один профиль…');
    const sum=picked.reduce((a,x)=>a+(x.w||0),0)||1;
    const body=picked.map(x=>{
      const pct=Math.round((x.w||0)/sum*100);
      return `СТИЛЬ «${x.e.name}» (вес ${pct}%):\nПАСПОРТ:\n${x.e.style||'—'}\nПАТТЕРНЫ:\n${x.e.engagement||'—'}\nСЮЖЕТНЫЕ ПРИЁМЫ:\n${x.e.plot||'—'}`;
    }).join('\n\n———\n\n');
    const FUSE_SYS='Тебе даны несколько профилей авторского стиля с весами. Синтезируй из них ОДИН цельный профиль так, чтобы пропорции соблюдались (доминирует стиль с наибольшим весом). Выдай РОВНО три блока, каждый ~220 слов, с заголовками-строками:\n\nПАСПОРТ СТИЛЯ\n<…>\n\nПАТТЕРНЫ ВОВЛЕЧЕНИЯ\n<…>\n\nСЮЖЕТНЫЕ ПРИЁМЫ\n<…>\n\nБез имён персонажей и цитат — только переносимые приёмы.';
    const reduced=await callLLM(c,[
      {role:'system',content:FUSE_SYS},
      {role:'user',content:body}
    ]);
    const { style, engagement, plot }=parseStyleBlocks(reduced);
    const name='Микс: '+picked.map(x=>x.e.name).join('+');
    const entry={ id:uid(), name, source:'сплав', style, engagement, plot, ts:Date.now() };
    if(!Array.isArray(state.styleLibrary)) state.styleLibrary=[];
    state.styleLibrary.push(entry);
    state.project.styleMix=[{id:entry.id, weight:100}];
    save();
    logRow('Школа стиля','done',`Сплав «${name}» добавлен в библиотеку и активирован`);
    toast('🔥 Сплав «'+name+'» готов и активен','ok');
    openStyleSchool('lib');
  }catch(e){
    logRow('Школа стиля','error',e.message);
    toast('Ошибка сплава: '+e.message,'err');
  }finally{
    _styleFusing=false;
  }
}
function openStyleSchool(activeTab){
  const pr=state.project;
  const lib=Array.isArray(state.styleLibrary)?state.styleLibrary:(state.styleLibrary=[]);
  const mix=Array.isArray(pr.styleMix)?pr.styleMix:(pr.styleMix=[]);
  const tab=activeTab||'create';
  const fmtDate=ts=>{ try{ return new Date(ts).toLocaleDateString('ru-RU'); }catch(e){ return ''; } };

  // ── вкладка «Создать» ──
  const createPane=`
    <div class="ss-intro">Загрузите образец успешного текста (ваш, классику или лицензированный). ИИ извлечёт приёмы — голос, ритм, структуру, крючки и <b>сюжетные приёмы</b> — <b>НЕ копируя текст</b>. Профиль попадёт в библиотеку.</div>
    <div class="dropzone" id="ss-drop">
      <div class="dropzone-icon">📥</div>
      <div class="dropzone-text">Перетащите файл сюда или <label class="dz-link">выберите<input type="file" id="ss-file" accept=".txt,.md,.docx" hidden></label></div>
      <div class="dropzone-hint">.txt · .md · .docx</div>
    </div>
    <div class="field"><label>…или вставьте образец текста вручную</label>
      <textarea id="ss-text" rows="9" placeholder="Вставьте фрагмент(ы) успешного текста…"></textarea></div>
    <div class="field"><label>Название стиля</label>
      <input id="ss-name" placeholder="напр. Булгаков, Хемингуэй, мой стиль…"></div>
    <div id="ss-progress" class="ss-progress" style="display:none"></div>
    <div class="actions"><button class="btn ok" id="ss-build">🔬 Извлечь стиль</button></div>`;

  // ── вкладка «Библиотека» ──
  const libCards=lib.length ? lib.slice().reverse().map(e=>`
    <div class="ss-card" data-id="${e.id}">
      <div class="ss-card-head">
        <strong>${esc(e.name||'без названия')}</strong>
        <span class="ss-card-meta">${esc(e.source||'')} · ${fmtDate(e.ts)}</span>
      </div>
      <details class="ss-det"><summary>Паспорт стиля</summary><div class="ss-det-body">${esc(e.style||'—')}</div></details>
      <details class="ss-det"><summary>Паттерны вовлечения</summary><div class="ss-det-body">${esc(e.engagement||'—')}</div></details>
      <details class="ss-det"><summary>Сюжетные приёмы</summary><div class="ss-det-body">${esc(e.plot||'—')}</div></details>
      <div class="ss-card-actions">
        <button class="btn ghost mini" data-rename="${e.id}">✎ Переименовать</button>
        <button class="btn ghost mini" data-del="${e.id}">🗑 Удалить</button>
      </div>
    </div>`).join('') : `<div class="ss-empty">Библиотека пуста. Создайте первый стиль во вкладке «Создать».</div>`;
  const libPane=`<div class="ss-lib">${libCards}</div>`;

  // ── вкладка «Микс» ──
  const mixById=Object.fromEntries(mix.map(m=>[m.id,m.weight]));
  const mixRows=lib.length ? lib.slice().reverse().map(e=>{
    const on=Object.prototype.hasOwnProperty.call(mixById,e.id);
    const w=on?mixById[e.id]:50;
    return `<div class="ss-mix-row" data-id="${e.id}">
      <label class="ss-mix-pick"><input type="checkbox" class="ss-mix-cb" ${on?'checked':''}> <span>${esc(e.name||'—')}</span></label>
      <div class="ss-mix-w">
        <input type="range" class="ss-mix-slider" min="0" max="100" value="${w}" ${on?'':'disabled'}>
        <span class="ss-mix-pct">${w}%</span>
      </div>
    </div>`;
  }).join('') : `<div class="ss-empty">Сначала добавьте стили в библиотеку.</div>`;
  const mixPane=`
    <div class="ss-intro">Выберите до <b>3</b> стилей и задайте веса. «Применить микс» подмешает сплав во всех пишущих агентов. «Сплавить» синтезирует один чистый профиль через ИИ.</div>
    <div class="ss-mix-list">${mixRows}</div>
    <div class="ss-mix-sum" id="ss-mix-sum"></div>
    <div id="ss-progress-mix" class="ss-progress" style="display:none"></div>
    <div class="actions">
      <button class="btn ok" id="ss-mix-apply">✅ Применить микс</button>
      <button class="btn ghost" id="ss-mix-fuse">🔥 Сплавить в один стиль</button>
    </div>`;

  openDrawer('🎓 Школа стиля', `
    <div class="set-tabs">
      <button class="set-tab ${tab==='create'?'active':''}" data-sstab="create" type="button">Создать</button>
      <button class="set-tab ${tab==='lib'?'active':''}" data-sstab="lib" type="button">Библиотека${lib.length?` (${lib.length})`:''}</button>
      <button class="set-tab ${tab==='mix'?'active':''}" data-sstab="mix" type="button">Микс</button>
    </div>
    <div class="set-pane" data-sspane="create" style="${tab==='create'?'':'display:none'}">${createPane}</div>
    <div class="set-pane" data-sspane="lib" style="${tab==='lib'?'':'display:none'}">${libPane}</div>
    <div class="set-pane" data-sspane="mix" style="${tab==='mix'?'':'display:none'}">${mixPane}</div>
  `, b=>{
    // переключение вкладок
    b.querySelectorAll('.set-tab').forEach(t=>t.onclick=()=>{
      b.querySelectorAll('.set-tab').forEach(x=>x.classList.toggle('active',x===t));
      b.querySelectorAll('.set-pane').forEach(p=>p.style.display=p.dataset.sspane===t.dataset.sstab?'':'none');
    });

    // ── Создать ──
    const ta=b.querySelector('#ss-text');
    const dz=b.querySelector('#ss-drop');
    const fileInput=b.querySelector('#ss-file');
    const nameInput=b.querySelector('#ss-name');
    let loadedName='';
    const handleFile=async f=>{
      if(!f) return;
      const name=(f.name||'').toLowerCase();
      try{
        if(name.endsWith('.txt')||name.endsWith('.md')){
          ta.value=await f.text(); loadedName=f.name; toast('Файл загружен: '+f.name,'ok');
        } else if(name.endsWith('.docx')){
          toast('Распаковка .docx…','');
          try{ ta.value=await docxToText(f); loadedName=f.name; toast('📄 .docx распознан: '+f.name,'ok'); }
          catch(err){ console.warn('docx parse failed',err); toast('Не удалось прочитать .docx ('+err.message+'). Сохраните как .txt.','err'); }
        } else { toast('Поддерживаются .txt, .md, .docx','warn'); }
        if(loadedName && nameInput && !nameInput.value.trim()){
          nameInput.value=loadedName.replace(/\.(txt|md|docx)$/i,'');
        }
      }catch(e){ toast('Ошибка чтения файла: '+e.message,'err'); }
    };
    fileInput.onchange=e=>handleFile(e.target.files[0]);
    ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{ e.preventDefault(); e.stopPropagation(); dz.classList.add('dragover'); }));
    ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{ e.preventDefault(); e.stopPropagation(); dz.classList.remove('dragover'); }));
    dz.addEventListener('drop',e=>{ const f=e.dataTransfer?.files?.[0]; handleFile(f); });
    b.querySelector('#ss-build').onclick=()=>{
      const txt=ta.value.trim();
      if(!txt){ toast('Сначала загрузите или вставьте образец текста','warn'); return; }
      const nm=(nameInput.value.trim()||loadedName||'вставленный текст');
      buildStyleProfile(txt, nm);
    };

    // ── Библиотека ──
    b.querySelectorAll('[data-del]').forEach(btn=>btn.onclick=()=>{
      const id=btn.dataset.del;
      state.styleLibrary=(state.styleLibrary||[]).filter(x=>x.id!==id);
      state.project.styleMix=(state.project.styleMix||[]).filter(m=>m.id!==id);
      save(); toast('Стиль удалён','ok'); openStyleSchool('lib');
    });
    b.querySelectorAll('[data-rename]').forEach(btn=>btn.onclick=()=>{
      const id=btn.dataset.rename;
      const e=(state.styleLibrary||[]).find(x=>x.id===id); if(!e) return;
      const nv=prompt('Новое название стиля:', e.name||'');
      if(nv && nv.trim()){ e.name=nv.trim(); save(); openStyleSchool('lib'); }
    });

    // ── Микс ──
    const sumEl=b.querySelector('#ss-mix-sum');
    const rows=()=>Array.from(b.querySelectorAll('.ss-mix-row'));
    const checkedRows=()=>rows().filter(r=>r.querySelector('.ss-mix-cb').checked);
    const refreshSum=()=>{
      if(!sumEl) return;
      const sel=checkedRows();
      const total=sel.reduce((a,r)=>a+parseInt(r.querySelector('.ss-mix-slider').value||0),0);
      sumEl.textContent=sel.length?`Выбрано ${sel.length}/3 · сумма весов ${total}% (нормализуется к 100%)`:'Ничего не выбрано';
    };
    rows().forEach(r=>{
      const cb=r.querySelector('.ss-mix-cb');
      const slider=r.querySelector('.ss-mix-slider');
      const pct=r.querySelector('.ss-mix-pct');
      cb.onchange=()=>{
        if(cb.checked && checkedRows().length>3){ cb.checked=false; toast('Можно выбрать максимум 3 стиля','warn'); return; }
        slider.disabled=!cb.checked;
        refreshSum();
      };
      slider.oninput=()=>{ pct.textContent=slider.value+'%'; refreshSum(); };
    });
    refreshSum();
    const collectMix=()=>{
      const sel=checkedRows();
      if(!sel.length) return [];
      const raw=sel.map(r=>({ id:r.dataset.id, weight:parseInt(r.querySelector('.ss-mix-slider').value||0) }));
      const total=raw.reduce((a,x)=>a+x.weight,0)||1;
      return raw.map(x=>({ id:x.id, weight:Math.round(x.weight/total*100) }));
    };
    const applyBtn=b.querySelector('#ss-mix-apply');
    if(applyBtn) applyBtn.onclick=()=>{
      const m=collectMix();
      if(!m.length){ toast('Выберите хотя бы один стиль','warn'); return; }
      if(m.length>3){ toast('Максимум 3 стиля','warn'); return; }
      state.project.styleMix=m; save();
      toast('🎨 Микс применён ('+m.length+' стил.) — активен в пишущих агентах','ok');
    };
    const fuseBtn=b.querySelector('#ss-mix-fuse');
    if(fuseBtn) fuseBtn.onclick=()=>{
      const m=collectMix();
      if(m.length<2){ toast('Для сплава выберите минимум 2 стиля','warn'); return; }
      fuseStyles(m);
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
    <div class="set-section" style="margin-top:16px">
      <div class="set-section-title">⌨️ Горячие клавиши</div>
      <table style="width:100%;font-size:12px;border-collapse:collapse">
        <tr><td style="padding:4px 8px;color:var(--accent);font-family:monospace">Ctrl+Enter</td><td style="color:var(--dim)">Запустить пайплайн</td></tr>
        <tr><td style="padding:4px 8px;color:var(--accent);font-family:monospace">Ctrl+Z</td><td style="color:var(--dim)">Отменить перемещение узла</td></tr>
        <tr><td style="padding:4px 8px;color:var(--accent);font-family:monospace">Ctrl+Y</td><td style="color:var(--dim)">Повторить</td></tr>
        <tr><td style="padding:4px 8px;color:var(--accent);font-family:monospace">R</td><td style="color:var(--dim)">Переключить Reader / Canvas</td></tr>
        <tr><td style="padding:4px 8px;color:var(--accent);font-family:monospace">Esc</td><td style="color:var(--dim)">Закрыть панель</td></tr>
        <tr><td style="padding:4px 8px;color:var(--accent);font-family:monospace">Delete</td><td style="color:var(--dim)">Удалить выбранный узел (через панель)</td></tr>
      </table>
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
    const canDiff=bln.output!=null;
    return `<div class="histrow" style="flex-wrap:wrap;gap:4px">
      <b style="min-width:130px">${esc(cur.name)}</b>
      <span style="color:${col};font-size:11px">${sign}${delta} симв. (${sign}${pct}%)</span>
      <span style="color:var(--faint);font-size:11px">${sign}${dw} слов · было ${bln.len}→стало ${cur.output.length}</span>
      ${canDiff?`<button class="btn ghost xs" data-action="baseline-textdiff" data-id="${id}" title="Показать изменения текста">± текст</button>`:''}
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
  if(!_VIEWS.includes(view)) view='canvas';
  _currentView=view;
  // Явное управление display — надёжнее CSS-каскада
  const canvas=$('#canvas'), reader=$('#reader'), simp=$('#simplified');
  if(canvas) canvas.style.display = view==='canvas' ? '' : 'none';
  if(reader) reader.style.display = view==='reader' ? 'block' : 'none';
  if(simp)   simp.style.display   = view==='simple'  ? ''     : 'none';
  // data-view на body — для CSS-тем/хуков снаружи
  document.body.dataset.view=view;
  // Табы
  [$('#tab-canvas'),$('#tab-reader'),$('#tab-simple')].forEach(t=>t?.classList.remove('active'));
  if(view==='reader') $('#tab-reader')?.classList.add('active');
  else if(view==='simple') $('#tab-simple')?.classList.add('active');
  else $('#tab-canvas')?.classList.add('active');
  // Сайд-эффекты экранов
  if(view==='reader'){ renderReader(); renderBookInspector(); }
  if(view==='simple') initSimplifiedMode();
  // CTB-тулбар холста
  $('#ctb')?.classList.toggle('ctb-visible', view==='canvas');
  // Сохранение в URL-хэше (кнопка «Назад» работает, ссылка сохраняет вид)
  if(view==='canvas') history.replaceState(null,'',location.pathname+location.search);
  else history.replaceState(null,'',location.pathname+location.search+'#'+view);
}

function renderReader(){
  const pr=state.project;
  const showAll=!!state.readerShowAll;
  // «Только проза» — узлы для книги; «Все агенты» — все с выводом
  const order=showAll
    ? topoOrder().map(id=>node(id)).filter(n=>n&&n.output)
    : bookNodes();
  const wordCount=order.reduce((s,n)=>s+((showAll?n.output:cleanProse(n)).match(/\S+/g)||[]).length,0);
  let html=`<div style="margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid var(--line)">
    <h1 style="font-size:24px;font-weight:800;margin:0 0 6px;color:var(--txt)">${esc(pr.title||'Без названия')}</h1>
    ${pr.genre?`<div style="color:var(--dim);font-size:13px">${esc(pr.genre)}${pr.audience?' · '+esc(pr.audience):''}</div>`:''}
    <div style="color:var(--faint);font-size:12px;margin-top:6px">
      ~${wordCount.toLocaleString('ru-RU')} слов · ${order.length} ${showAll?'разделов':'глав'} · ${money(projectCost())}
    </div>
    <div class="actions" style="margin-top:14px;align-items:center">
      <button class="btn ok sm" onclick="exportDocx()">📄 Скачать Word</button>
      <button class="btn ok sm" onclick="exportEpub()">📗 Скачать EPUB</button>
      <button class="btn ghost sm" onclick="exportBook()">📕 Скачать .md</button>
      <label class="check" style="margin-left:auto;font-size:12px"><input type="checkbox" id="reader-showall" ${showAll?'checked':''}> ${showAll?'Все агенты':'Только проза'}</label>
    </div>
  </div>`;
  if(!order.length){
    html+=`<div style="text-align:center;padding:60px 0;color:var(--faint)">
      <div style="font-size:48px;margin-bottom:14px">✍️</div>
      <div style="font-size:16px;font-weight:700;color:var(--dim);margin-bottom:8px">Книга ещё не написана</div>
      <div style="font-size:13px">Нажмите <strong style="color:var(--txt)">▶ Запустить</strong> — команда агентов создаст текст, и он появится здесь</div>
      <div style="font-size:12px;margin-top:18px;color:var(--faint)">Когда книга будет готова: для KDP → EPUB, для Литрес → .docx</div>
      <button class="btn ghost sm" style="margin-top:10px" data-action="publish-guide">Что дальше? — как опубликовать</button>
    </div>`;
  } else {
    // Оглавление со скроллом
    html+=`<div style="margin-bottom:30px"><div style="font-weight:700;font-size:13px;color:var(--dim);margin-bottom:8px">Содержание</div>
      <ol style="margin:0;padding-left:20px;font-size:13px;line-height:1.9">`+
      order.map((n,i)=>`<li><a href="#reader-ch${i}" style="color:var(--accent,#6c63ff);text-decoration:none">${esc(showAll?(n.emoji+' '+n.name):chapterTitleOf(n,i))}</a></li>`).join('')+
      `</ol></div>`;
    order.forEach((n,i)=>{
      const text=showAll?n.output:cleanProse(n);
      const words=(text.match(/\S+/g)||[]).length;
      const head=showAll
        ? `<span style="font-size:20px">${n.emoji}</span>
          <div>
            <div style="font-weight:700;font-size:14px;color:var(--txt)">${esc(n.name)}</div>
            <div style="font-size:11px;color:var(--faint)">${esc(n.role)} · ~${words.toLocaleString('ru-RU')} слов</div>
          </div>`
        : `<div>
            <div style="font-weight:700;font-size:15px;color:var(--txt)">${esc(chapterTitleOf(n,i))}</div>
            <div style="font-size:11px;color:var(--faint)">~${words.toLocaleString('ru-RU')} слов</div>
          </div>`;
      html+=`<div id="reader-ch${i}" style="margin-bottom:40px;scroll-margin-top:20px">
        <div style="display:flex;align-items:center;gap:9px;margin-bottom:12px;padding-bottom:9px;border-bottom:1px solid var(--line)">
          ${head}
        </div>
        <div class="reader-text">${md2html(typo(text))}</div>
      </div>`;
    });
  }
  $('#reader-inner').innerHTML=html;
  const tog=$('#reader-showall');
  if(tog) tog.onchange=ev=>{ state.readerShowAll=ev.target.checked; save(); renderReader(); };
}

/* ============ БАННЕР ЗАВЕРШЕНИЯ ============ */
function showCompletionBanner(){
  const done=state.nodes.filter(n=>n.output);
  if(!done.length) return;
  const words=done.reduce((s,n)=>s+(n.output.match(/\S+/g)||[]).length,0);
  const errCount=state.nodes.filter(n=>n.status==='error').length;
  const total=state.nodes.length;
  const cb=$('#completion-banner');
  const txt=cb?.querySelector('.cb-text');
  // Item 28: при частичном провале — "Готово частично" + кнопка повтора упавших
  if(errCount){
    if(txt) txt.innerHTML=`⚠ <span id="cb-stats">Готово частично: ${done.length} из ${total} · ${errCount} упало · ${money(projectCost())}</span>`;
  } else {
    if(txt) txt.innerHTML=`✅ <span id="cb-stats">${done.length} агентов · ~${words.toLocaleString('ru-RU')} слов · ${money(projectCost())}</span> <span class="cb-pub-hint">Для KDP → EPUB, для Литрес → .docx</span>`;
  }
  const retryBtn=$('#cb-retry'); if(retryBtn) retryBtn.style.display=errCount?'':'none';
  cb.style.display='flex';
}
function hideCompletionBanner(){ const b=$('#completion-banner'); if(b) b.style.display='none'; }
// #40: краткий чеклист публикации человеческим языком
function openPublishGuide(){
  openDrawer('🚀 Что дальше?',`
    <p class="hint" style="margin-top:0">Книга готова. Осталось опубликовать — вот короткие шаги.</p>
    <div class="pub-block">
      <div class="pub-h">📗 Amazon KDP (электронная книга)</div>
      <ol class="pub-list">
        <li>Скачайте файл в формате <b>EPUB</b> (кнопка «📗 EPUB» / «Скачать EPUB»).</li>
        <li>Зайдите на kdp.amazon.com → «Create» → Kindle eBook.</li>
        <li>Загрузите EPUB, добавьте обложку, название и описание.</li>
        <li>Обязательно отметьте использование ИИ при загрузке.</li>
        <li>Назначьте цену и опубликуйте.</li>
      </ol>
    </div>
    <div class="pub-block">
      <div class="pub-h">📄 Литрес / Ridero (рунет)</div>
      <ol class="pub-list">
        <li>Скачайте файл в формате <b>Word (.docx)</b> (кнопка «📄 Word»).</li>
        <li>Зарегистрируйтесь как автор на selfpub.ru (Литрес) или ridero.ru.</li>
        <li>Загрузите .docx — площадка сама сверстает книгу.</li>
        <li>Добавьте обложку, аннотацию и ключевые слова.</li>
        <li>Отправьте на модерацию и публикацию.</li>
      </ol>
    </div>
    <div class="hint" style="margin-top:6px">Совет: вычитайте текст и проверьте имена/факты перед загрузкой — площадки не любят сырой ИИ-текст.</div>
    <div class="actions" style="margin-top:14px">
      <button class="btn ok" id="pub-epub">📗 Скачать EPUB</button>
      <button class="btn ghost" id="pub-docx">📄 Скачать Word</button>
    </div>
  `,b=>{
    b.querySelector('#pub-epub').onclick=()=>exportEpub();
    b.querySelector('#pub-docx').onclick=()=>exportDocx();
  });
}
// Item 28: сброс упавших узлов в idle и повторный прогон только их (и зависимых от них волн)
function retryFailedNodes(){
  const failed=state.nodes.filter(n=>n.status==='error');
  if(!failed.length){ toast('Нет упавших агентов'); return; }
  failed.forEach(n=>{ n.status='idle'; n.error=''; n.output=''; n.cacheHash=''; n.failedWithDownstream=false; });
  // skip-узлы тоже сбрасываем — они могли быть пропущены из-за пустого контекста
  state.nodes.filter(n=>n.status==='skip').forEach(n=>{ n.status='idle'; n.cacheHash=''; });
  hideCompletionBanner();
  logRow('Пайплайн','retry',`Повтор упавших: ${failed.map(n=>n.name).join(', ')}`);
  save(); renderNodes(); renderEdges();
  runPipeline(true);
}

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
          <option value="deepseek">DeepSeek (~$0.01/кн.)</option>
          <option value="openai">OpenAI GPT-4o mini</option>
          <option value="openrouter">OpenRouter</option>
        </select>
      </div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:7px;flex-wrap:wrap">
        <button class="btn ghost sm" id="ob-test" type="button">Проверить ключ</button>
        <span id="ob-test-res" style="font-size:12px"></span>
      </div>
      <div class="onboarding-hint" id="ob-keyhelp"></div>
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

  // #34: провайдеры с адресом API, моделью и ссылкой на получение ключа
  const PROVIDERS={
    deepseek:{url:'https://api.deepseek.com',model:'deepseek-chat',name:'DeepSeek',keyUrl:'https://platform.deepseek.com/api_keys'},
    openai:{url:'https://api.openai.com/v1',model:'gpt-4o-mini',name:'OpenAI',keyUrl:'https://platform.openai.com/api-keys'},
    openrouter:{url:'https://openrouter.ai/api/v1',model:'deepseek/deepseek-chat',name:'OpenRouter',keyUrl:'https://openrouter.ai/keys'},
  };
  const sel=el.querySelector('#ob-preset');
  const help=el.querySelector('#ob-keyhelp');
  const applyProvider=()=>{
    const p=PROVIDERS[sel.value]||PROVIDERS.deepseek;
    state.global.baseURL=p.url; state.global.model=p.model;
    help.innerHTML=`Нет ключа? → <a href="${p.keyUrl}" target="_blank" rel="noopener" style="color:var(--accent,#6c63ff)">Получить на ${esc(p.name)}</a> · ~$2 хватит на десятки книг`;
  };
  applyProvider();
  sel.onchange=applyProvider;
  // Проверка ключа: тестовый запрос с одним коротким сообщением
  const testRes=el.querySelector('#ob-test-res');
  el.querySelector('#ob-test').onclick=async()=>{
    const key=el.querySelector('#ob-key').value.trim();
    if(!key){ testRes.style.color='var(--err)'; testRes.textContent='Сначала вставьте ключ'; return; }
    const p=PROVIDERS[sel.value]||PROVIDERS.deepseek;
    testRes.style.color='var(--faint)'; testRes.textContent='Проверяю…';
    try{
      await callLLM({baseURL:p.url,apiKey:key,model:p.model,temperature:0},[{role:'user',content:'ping'}]);
      testRes.style.color='var(--ok)'; testRes.textContent='✓ ключ работает';
    }catch(e){
      const raw=String(e.message||e);
      testRes.style.color='var(--err)'; testRes.textContent='✗ '+humanError(statusFromError(raw),raw);
    }
  };
  let selectedTpl='story';
  el.querySelectorAll('.onboarding-tpl').forEach(btn=>btn.onclick=()=>{
    el.querySelectorAll('.onboarding-tpl').forEach(b=>b.classList.remove('selected'));
    btn.classList.add('selected'); selectedTpl=btn.dataset.tpl;
  });
  const dismiss=()=>{ el.remove(); state.onboarded=true; save(); };
  el.querySelector('#ob-skip').onclick=dismiss;
  el.querySelector('#ob-start').onclick=()=>{
    // #34: ключ можно пропустить — запросим при первом «▶ Запустить»
    const key=el.querySelector('#ob-key').value.trim();
    if(key) state.global.apiKey=key;
    const t=PROJECT_TPLS[selectedTpl];
    if(t){
      const tpls=t.roles.map(r=>TEMPLATES.find(x=>x.role===r)).filter(Boolean);
      state.nodes=tpls.map((tp,i)=>freshNode(tp,60+(i%3)*260,40+Math.floor(i/3)*190));
      state.edges=[]; for(let i=0;i<state.nodes.length-1;i++) state.edges.push({id:uid(),from:state.nodes[i].id,to:state.nodes[i+1].id,condition:'',maxRetries:0,_retryCount:0});
      state.project.genre=t.genre; state.project.brief=t.brief;
    }
    dismiss(); render();
    toast(key?'Готово! Укажите название книги и нажмите ▶ Запустить':'Готово! Ключ спросим при первом запуске','ok');
  };
}
function showOnboardingIfNeeded(){ if(!hasKey()&&!state.onboarded) showOnboarding(); }

render();
// Кнопки баннера завершения
$('#cb-read').onclick=()=>switchView('reader');
$('#cb-docx').onclick=exportDocx;
$('#cb-epub').onclick=exportEpub;
$('#cb-dismiss').onclick=hideCompletionBanner;
{ const _cbNext=$('#cb-next'); if(_cbNext) _cbNext.onclick=openPublishGuide; }
{ const _cbRetry=$('#cb-retry'); if(_cbRetry) _cbRetry.onclick=retryFailedNodes; }
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
    case 'add-decision':  ctbSetTool('place-decision');  break;
    case 'add-fanout':    ctbSetTool('place-fanout');    break;
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

/* ── Apply zoom via CSS transform (visual-only; node coords untouched) ── */
function applyZoom(){
  const s=(_zoomLevel||100)/100;
  [nodesEl,edgesEl].forEach(el=>{ if(el){ el.style.transformOrigin='0 0'; el.style.transform=`scale(${s})`; } });
}

/* ── Fit screen (visual-only: pick scale + scroll, do NOT move nodes) ── */
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
  _zoomLevel=Math.round(Math.max(25,Math.min(300,scale*100)));
  applyZoom();
  const s=_zoomLevel/100;
  // Scroll so the bounding box top-left lands near the viewport origin
  cv.scrollTo(Math.max(0,minX*s-60), Math.max(0,minY*s-40));
  ctbSync();
  toast('⊙ Вместил всё на экран');
}

/* ── Zoom (CSS transform only — node coordinates never change) ── */
function ctbZoom(factor){
  _zoomLevel=Math.round(Math.max(25,Math.min(300,_zoomLevel*factor)));
  applyZoom();
  ctbSync();
}
function ctbZoomReset(){ _zoomLevel=100; applyZoom(); ctbSync(); }

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
    const _s=(_zoomLevel||100)/100;
    const x=(e.clientX-r.left+cv.scrollLeft)/_s-106;
    const y=(e.clientY-r.top+cv.scrollTop)/_s-60;
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
        const _s=(_zoomLevel||100)/100;
        const x=(e.clientX-r.left+cv.scrollLeft)/_s-106;
        const y=(e.clientY-r.top+cv.scrollTop)/_s-60;
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
  applyZoom();
  ctbSync();
}

initCtb();
localStorage.removeItem('izd_view'); // очищаем устаревший ключ
switchView(_currentView);

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

// Запуск таймера авто-бэкапа + индикатора
scheduleBackup();
// #50: предложить восстановление из IndexedDB, если localStorage пуст/повреждён
checkIdbRecovery();
