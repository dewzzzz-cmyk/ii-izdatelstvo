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
export function cosine(a,b){ let dot=0,na=0,nb=0; for(const k in a){ dot+=(a[k]||0)*(b[k]||0); na+=a[k]**2; } for(const k in b) nb+=b[k]**2; return na&&nb?dot/Math.sqrt(na*nb):0; }

export function rebuildBibleVecs(bible){ bible.forEach(b=>{ b._vec=tfvec(tokensOf((b.keys||'')+' '+(b.text||''))); }); }

// Семантический поиск топ-K записей релевантных запросу (бриф сцены).
// Возвращает массив записей {keys, text}.
export function bibleMatches(bible, query, k=5){
  if(!bible || !bible.length) return [];
  const low=(query||'').toLowerCase(); const sset=stemSet(low);
  const qvec=tfvec(tokensOf(query));
  const hasVecs=bible.some(b=>b._vec&&Object.keys(b._vec).length>0);
  let hits;
  if(hasVecs && Object.keys(qvec).length>=2){
    hits=bible.map(b=>({b,score:cosine(qvec,b._vec||{})}))
      .filter(x=>x.score>0.08).sort((a,c)=>c.score-a.score).slice(0,k).map(x=>x.b);
    if(!hits.length) hits=keywordFallback(bible, low, sset);
  } else {
    hits=keywordFallback(bible, low, sset);
  }
  return hits.slice(0,k);
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
export function applyFactEdit(bible, i, keys, text){
  const fact = bible[i]; if(!fact) return false;
  fact.keys = String(keys||'').trim(); fact.text = String(text||'').trim();
  return true;
}

export function deleteBibleFactAt(bible, i){
  if(!bible[i]) return false;
  bible.splice(i,1);
  return true;
}
