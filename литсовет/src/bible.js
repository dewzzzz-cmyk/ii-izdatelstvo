// Bible TF-IDF — семантический поиск канона. Перенесено из ИИ-Издательства.
// Чистый JS, без CDN. Каждая запись: {keys, text, _vec?}.

const RU_ENDS=['иями','ями','ами','его','ого','ему','ому','ыми','ими','ах','ях','ам','ям','ом','ем','ой','ей','ою','ею','ью','ие','ые','ий','ый','ая','яя','ое','ее','ы','и','а','я','у','ю','е','о','ь','й'];
const STOP_RU=new Set('и в на с по за к о не но да из что как то все это при так же был была были если или уже там тут где когда еще от до со для же лишь ни то быть'.split(' '));

export function stem(w){
  w=(w||'').toLowerCase().replace(/ё/g,'е');
  for(const e of RU_ENDS){ if(w.length-e.length>=3 && w.endsWith(e)) return w.slice(0,-e.length); }
  return w;
}
function stemSet(text){ const s=new Set(); (text.match(/[a-zа-я0-9]+/gi)||[]).forEach(w=>s.add(stem(w))); return s; }
function keyMatches(key, low, sset){
  return key.split(/\s+/).filter(Boolean).every(p=>{
    const ps=stem(p);
    return low.includes(p)||sset.has(ps)||
      (ps.length>=4&&(low.match(/[а-яёa-z]+/gi)||[]).some(w=>stem(w).startsWith(ps)||w.toLowerCase().startsWith(ps)));
  });
}

export function tokensOf(text){ return (text||'').toLowerCase().replace(/ё/g,'е').match(/[а-яa-z0-9]+/gi)||[]; }
export function tfvec(tokens){ const f={}; tokens.forEach(t=>{ const s=stem(t); if(s.length>2&&!STOP_RU.has(s)) f[s]=(f[s]||0)+1; }); return f; }

// Топ повторяющихся корней слов по всей сцене — сигнал для Оценщика. LLM,
// читая сцену целиком, надёжно замечает повтор в соседних предложениях, но
// пропускает навязчивый мотив, размазанный по всему тексту (например, слово
// «тиканье», повторённое 6+ раз на протяжении сцены почти одной и той же
// формулировкой) — считаем это механически, а не полагаемся на то, что
// модель заметит частоту, дочитав до конца.
// Группируем по ПРЕФИКСУ слова, а не по stem() из tfvec выше: суффиксный
// стеммер заточен под именные/падежные окончания и разваливает ГЛАГОЛЬНЫЕ
// формы одного мотива на разные ключи («тиканье»→«тикань», «тикать»→
// «тикат», «тикали»→«тикал» — три ключа с частотой 1-4 вместо одного с
// частотой 6). Префикс общего корня склеивает их обратно.
const STOP_RU_EXTRA = new Set('кто без него нее себя тебя меня ему ней им них эта этот эти того тому этого этой этим весь вся всё всех всем всеми каждый каждая каждое такой такая такое такие себе сама сами само'.split(' '));
// Служебные глаголы-связки и слова-паразиты повествования («сказал», «только»,
// «словно», «мог») — в любой прозе частотны сами по себе и не сигнализируют
// об авторском стилистическом тике, в отличие от конкретной сенсорной детали
// или образа. Фильтруем по ПРЕФИКСУ (не точной форме), т.к. группировка ниже
// тоже идёт по префиксу — иначе «сказал»/«сказала»/«сказали» просочатся порознь.
const STOP_PREFIXES = new Set(['сказ','стал','нача','посм','поду','толь','слов','очен','прос','совс','пото','тепе','опят','снов','мог','можн']);
export function topRepeatedStems(text, min=5, limit=10, prefixLen=4){
  const tokens = tokensOf(text).filter(t=>t.length>=4 && !STOP_RU.has(t) && !STOP_RU_EXTRA.has(t));
  const freq = {}, examples = {};
  tokens.forEach(t=>{
    const key = t.length>prefixLen ? t.slice(0,prefixLen) : t;
    if(STOP_PREFIXES.has(key)) return;
    freq[key]=(freq[key]||0)+1;
    if(!examples[key]) examples[key]=t;
  });
  return Object.entries(freq)
    .filter(([,n])=>n>=min)
    .sort((a,b)=>b[1]-a[1])
    .slice(0, limit)
    .map(([key,count])=>({stem:key, count, example:examples[key]}));
}

// Топ дословно повторяющихся КОРОТКИХ фраз (n-грамм) — доп. сигнал для
// Оценщика. Не путать с findDuplicatePhrases() в guards.js: та калибрована
// на ДЛИННЫЕ (6+ слов) дубли В БЛИЗКОЙ БЛИЗОСТИ друг к другу — ловит
// артефакты копипаста при правке, флагует как critical. Эта функция — про
// КОРОТКИЕ (4 слова) фразы, повторившиеся хотя бы дважды где угодно в
// тексте, без окна близости: живой пример — «как треск сухой ветки» дважды
// в двух соседних абзацах ОДНОЙ сцены, «Капли падали — раз, два, три» четыре
// раза за две сцены. Оба короче 6 слов и разнесены дальше 400 символов —
// мимо findDuplicatePhrases. Это не критическая ошибка (не факт и не
// противоречие), а информационный сигнал по оси «Свежесть образа», поэтому
// порог мягче — от 2 повторов, а не от 6+ слов подряд.
export function topRepeatedPhrases(text, n=4, min=2, limit=8){
  const words = tokensOf(text).filter(w=>/[а-яё]/.test(w));
  if(words.length < n*2) return [];
  const freq = {};
  for(let i=0; i<=words.length-n; i++){
    const shingle = words.slice(i, i+n);
    // Пропускаем шинглы почти целиком из стоп-слов/местоимений — иначе шум
    // вроде «и я не могу» забивал бы список вместо реальных образов/рефренов.
    const contentWords = shingle.filter(w=>w.length>=4 && !STOP_RU.has(w) && !STOP_RU_EXTRA.has(w));
    if(contentWords.length < 2) continue;
    const key = shingle.join(' ');
    freq[key] = (freq[key]||0)+1;
  }
  return Object.entries(freq)
    .filter(([,count])=>count>=min)
    .sort((a,b)=>b[1]-a[1])
    .slice(0, limit)
    .map(([phrase,count])=>({phrase,count}));
}

// ── Баланс глаголов-тегов речи («сказал» vs спросил/ответил/крикнул/...) —
// доп. сигнал для Оценщика по оси «Ритм». Живой пример: во ВСЕХ шести
// написанных сценах книги «сказал» — 50-65% вообще всех атрибуций реплик
// (19 из 29 в одной сцене), остальное — по мелочи. Ни один существующий
// пункт рубрики этого не считает: «Ритм» штрафует повтор ИМЕНИ персонажа
// вместо местоимения, а не однообразие самого глагола-тега. Стемы без
// родовых/временных окончаний (сказа- ловит сказал/сказала/сказали/сказать).
const SPEECH_TAG_STEMS = ['сказа','спроси','ответи','повтори','пробормота','прошепта','крикну','заора','вздохну','возрази','переби','уточни','поправи','буркну'];
export function speechTagBalance(text, minTotal=4, minShare=0.5){
  const t = (text||'').toLowerCase();
  const counts = {};
  let total = 0;
  SPEECH_TAG_STEMS.forEach(stem=>{
    const n = (t.match(new RegExp(stem,'g'))||[]).length;
    if(n){ counts[stem]=n; total+=n; }
  });
  if(total < minTotal) return null;
  const [topStem, topCount] = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
  const share = topCount/total;
  if(share < minShare) return null;
  return { stem:topStem, count:topCount, total, share };
}

export function cosine(a,b){ let dot=0,na=0,nb=0; for(const k in a){ dot+=(a[k]||0)*(b[k]||0); na+=a[k]**2; } for(const k in b) nb+=b[k]**2; return na&&nb?dot/Math.sqrt(na*nb):0; }

export function rebuildBibleVecs(bible){ bible.forEach(b=>{ b._vec=tfvec(tokensOf((b.keys||'')+' '+(b.text||''))); }); }

// Смысловое сходство (не побайтовое ===) факта с уже существующим каноном —
// тот же порог, что pipeline.js использует для похожих решений «это по сути
// то же самое». Раньше это жило только внутри ui/stages.js (историческая
// разведка) — ui/world.js (одобрение кандидатов «Мир», ручное добавление
// по категории) вообще не проверял дубли перед push в state.bible, поэтому
// вынесено сюда как общая точка, доступная обоим модулям.
const FACT_SIM_THRESHOLD = 0.75;
export function factAlreadyInBible(fact, bible){
  const factVec = tfvec(tokensOf((fact.keys||'') + ' ' + (fact.text||'')));
  return (bible||[]).some(b => {
    const bVec = b._vec || tfvec(tokensOf((b.keys||'') + ' ' + (b.text||'')));
    return cosine(factVec, bVec) >= FACT_SIM_THRESHOLD;
  });
}

// Семантический поиск топ-K записей релевантных запросу (бриф сцены).
// Возвращает массив записей {keys, text}.
// Закреплённые (pinned) факты идут ВСЕГДА, независимо от релевантности —
// для фактов, которые определяют суть повторяющегося объекта/механики мира
// (напр. «очки Артёма — ИИ-гаджет, не магия»), TF-IDF top-K может не
// подобрать их для сцены, чей бриф тематически не про этот объект, а
// значит страж логики/событий и сам Прозаик их не увидят и не заметят
// противоречие с уже написанным. Закрепление — ручное решение автора,
// не эвристика.
export function bibleMatches(bible, query, k=5){
  if(!bible || !bible.length) return [];
  const pinned = bible.filter(b=>b.pinned);
  const rest = bible.filter(b=>!b.pinned);
  if(!rest.length) return pinned;
  const low=(query||'').toLowerCase(); const sset=stemSet(low);
  const qvec=tfvec(tokensOf(query));
  const hasVecs=rest.some(b=>b._vec&&Object.keys(b._vec).length>0);
  let hits;
  if(hasVecs && Object.keys(qvec).length>=2){
    hits=rest.map(b=>({b,score:cosine(qvec,b._vec||{})}))
      .filter(x=>x.score>0.08).sort((a,c)=>c.score-a.score).slice(0,k).map(x=>x.b);
    if(!hits.length) hits=keywordFallback(rest, low, sset);
  } else {
    hits=keywordFallback(rest, low, sset);
  }
  return [...pinned, ...hits.slice(0,k)];
}
function keywordFallback(bible, low, sset){
  return bible.filter(b=>{
    const keys=(b.keys||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
    return !keys.length||keys.some(k=>keyMatches(k,low,sset));
  });
}

// Формат для промпта.
export function bibleForPrompt(bible, query, k=5){
  return bibleMatches(bible, query, k).map(b=>`• ${b.keys||'канон'}: ${b.text}`).join('\n');
}

// Разбор строк вида "ключи | факт".
export function parseBibleLines(text){
  return (text||'').split('\n').map(l=>l.trim()).filter(l=>l.includes('|'))
    .map(l=>{ const i=l.indexOf('|'); return { keys:l.slice(0,i).replace(/^[-•*\d.)\s]+/,'').trim(), text:l.slice(i+1).trim() }; })
    .filter(e=>e.text);
}

// Правка/удаление одной записи канона по индексу в state.bible — общее для
// панели «Память» (ui/memory.js) и вкладки «Мир» (ui/world.js). save() и
// rebuildBibleVecs() — на стороне вызывающего UI, как и для остальных мутаций
// state в этом файле (см. saveMapItem в illustrations.js — тот же паттерн).
// Значения (keys/text) собирает вызывающий UI через openFactModal() (см.
// ui/rule-modal.js) — раньше здесь были два prompt(), но нативный prompt()
// блокирует страницу и не работает в iOS PWA.
// Те же лимиты (500/120 симв.), что suggestWorldFacts/suggestMissingWorldFacts
// применяют к своей ПЕРВОЙ партии кандидатов в world.js — applyFactEdit это
// общая точка записи для ВСЕХ последующих правок факта (ручное редактирование,
// rerollWorldFact, принятие подсказки исправления конфликта/слияния), но сама
// она клэмп не делала: факт, изначально ограниченный до 500 символов, мог
// потом получить многоабзацный ответ модели без всякого лимита при реролле
// или принятии авто-исправления — раздувая бюджет промптов, которые
// рассчитаны на короткие факты канона (OTHER_CANON_BUDGET, FACTS_BUDGET).
export function applyFactEdit(bible, i, keys, text){
  const fact = bible[i]; if(!fact) return false;
  fact.keys = String(keys||'').trim().slice(0,120);
  fact.text = String(text||'').trim().slice(0,500);
  return true;
}

export function deleteBibleFactAt(bible, i){
  if(!bible[i]) return false;
  bible.splice(i,1);
  return true;
}

// Закрепить/открепить факт — см. bibleMatches() выше про то, зачем это нужно.
export function toggleFactPinned(bible, i){
  const fact = bible[i]; if(!fact) return false;
  fact.pinned = !fact.pinned;
  return true;
}
