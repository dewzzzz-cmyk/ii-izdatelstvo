// Экспорт книги: .md / .docx (HTML-in-DOC) / .epub (true EPUB 3) / .json.
// ZipBuilder + crc32 + md2xhtml перенесены из ИИ-Издательства.

import { exportCheckpoint } from './storage.js';
import { save } from './state.js';

// ── Лёгкая типографика (RU): кавычки-ёлочки, тире, неразрывные пробелы ──
export function typo(s){
  if(!s) return '';
  return s
    .replace(/"([^"]*)"/g, '«$1»')
    .replace(/(^|[\s(])-(\s)/g, '$1—$2')      // дефис как тире в начале реплики
    .replace(/ - /g, ' — ')
    .replace(/\b(\d+)\s+/g, '$1 ');       // число + неразрывный пробел
}

// ── CRC-32 + ZIP (STORE) для EPUB ──
const CRC32_TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c;}return t;})();
function crc32(bytes){let c=0xFFFFFFFF>>>0;for(let i=0;i<bytes.length;i++)c=CRC32_TABLE[(c^bytes[i])&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}
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

const xesc = s => String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function paraXhtml(text){
  return typo(text).split(/\n{1,}/).filter(p=>p.trim()).map(p=>`<p>${xesc(p.trim())}</p>`).join('\n');
}

// ── Собрать главы→сцены в структуру для экспорта ──
function buildBook(state){
  const nodes = state.structure||[];
  const chapters = [];
  let cur = null;
  for(const n of nodes){
    if(n.type==='chapter'){ cur={ title:n.title, scenes:[] }; chapters.push(cur); }
    else if(n.type==='scene' && n.text){
      if(!cur){ cur={ title:'', scenes:[] }; chapters.push(cur); }
      cur.scenes.push({ id:n.id, title:n.title, text:n.text });
    }
  }
  return { title: state.project.title||'Без названия', chapters: chapters.filter(c=>c.scenes.length) };
}

// Иллюстрация сцены (если сгенерирована и совпадает по sceneId) — dataUrl или null.
function illustrationForScene(state, sceneId){
  const items = state.illustrations?.items || [];
  const it = items.find(i=>i.type==='scene' && i.sceneId===sceneId);
  return it ? it.dataUrl : null;
}
// Карта мира (стадия «Мир», максимум одна на проект — см. saveMapItem в illustrations.js).
function worldMapItem(state){
  const items = state.illustrations?.items || [];
  return items.find(i=>i.type==='map') || null;
}
// Декодировать data:image/(jpeg|png);base64,... → {bytes, ext, mime} или null (не бросает).
function decodeDataUrlImage(dataUrl){
  const m = /^data:image\/(jpeg|png);base64,(.+)$/.exec(dataUrl||'');
  if(!m) return null;
  try{
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    const ext = m[1]==='png' ? 'png' : 'jpg';
    const mime = m[1]==='png' ? 'image/png' : 'image/jpeg';
    return { bytes, ext, mime };
  }catch(e){ console.warn('image decode failed', e); return null; }
}

function download(blob, filename){
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}

// ── .md ──
export function exportMd(state){
  const book = buildBook(state);
  let md = `# ${book.title}\n\n`;
  if(state.project.coverDataUrl) md += `![Обложка](${state.project.coverDataUrl})\n\n`;
  if(state.project.author) md += `*${state.project.author}*\n\n`;
  const mapItem = worldMapItem(state);
  if(mapItem) md += `## Карта мира\n\n![Карта мира](${mapItem.dataUrl})\n\n`;
  for(const ch of book.chapters){
    if(ch.title) md += `## ${ch.title}\n\n`;
    // сцены внутри главы разделяются *** (как «* * *» в EPUB)
    md += ch.scenes.map(sc=>{
      const illust = illustrationForScene(state, sc.id);
      const img = illust ? `![Иллюстрация](${illust})\n\n` : '';
      return img + typo(sc.text).trim();
    }).join('\n\n***\n\n') + '\n\n';
  }
  download(new Blob([md],{type:'text/markdown'}), book.title+'.md');
}

// ── .docx (HTML-in-DOC) ──
export function exportDocx(state){
  const book = buildBook(state);
  let body = `<h1>${xesc(book.title)}</h1>`;
  if(state.project.coverDataUrl) body += `<p style="text-align:center"><img src="${state.project.coverDataUrl}" style="max-width:100%"/></p>`;
  if(state.project.author) body += `<p style="text-align:center;font-style:italic">${xesc(state.project.author)}</p>`;
  const mapItem = worldMapItem(state);
  if(mapItem) body += `<h2>Карта мира</h2><p style="text-align:center"><img src="${mapItem.dataUrl}" style="max-width:100%"/></p>`;
  for(const ch of book.chapters){
    if(ch.title) body += `<h2>${xesc(ch.title)}</h2>`;
    body += ch.scenes.map(sc=>{
      const illust = illustrationForScene(state, sc.id);
      const img = illust ? `<p style="text-align:center"><img src="${illust}" style="max-width:100%"/></p>` : '';
      return img + paraXhtml(sc.text);
    }).join('<p style="text-align:center">*&#160;*&#160;*</p>');
  }
  const html = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"></head><body>${body}</body></html>`;
  download(new Blob([html],{type:'application/msword'}), book.title+'.doc');
}

// ── .epub (EPUB 3) ──
export function exportEpub(state){
  const book = buildBook(state);
  const p = state.project || {};
  // Постоянный уникальный идентификатор книги: читалки и магазины различают
  // книги по dc:identifier — он должен быть уникален и стабилен между экспортами.
  if(!p.bookUuid){
    p.bookUuid = (typeof crypto!=='undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'ls-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
    try{ save(); }catch{}
  }
  const zip = new ZipBuilder();
  zip.add('mimetype','application/epub+zip');
  zip.add('META-INF/container.xml',`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);

  // Обложка (опц.): dataURL jpeg/png из настроек проекта → файл + первая страница
  let coverItems='', coverSpine='', coverMeta='';
  const coverM = /^data:image\/(jpeg|png);base64,(.+)$/.exec(p.coverDataUrl||'');
  if(coverM){
    const ext = coverM[1]==='png' ? 'png' : 'jpg';
    const mime = coverM[1]==='png' ? 'image/png' : 'image/jpeg';
    try{
      const bin = atob(coverM[2]);
      const bytes = new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
      zip.add('OEBPS/cover.'+ext, bytes);
      zip.add('OEBPS/cover.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Обложка</title><style>body{margin:0;text-align:center}img{max-width:100%;max-height:100vh}</style></head><body><img src="cover.${ext}" alt="Обложка"/></body></html>`);
      coverItems = `<item id="cover-img" href="cover.${ext}" media-type="${mime}" properties="cover-image"/><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`;
      coverSpine = `<itemref idref="cover"/>`;
      coverMeta = `<meta name="cover" content="cover-img"/>`;
    }catch(e){ console.warn('cover decode failed', e); }
  }

  const items=[], spine=[], nav=[];
  book.chapters.forEach((ch,i)=>{
    const id='ch'+(i+1), file='chapters/'+id+'.xhtml';
    const title = xesc(ch.title || ('Глава '+(i+1)));
    const body = (ch.title?`<h2>${title}</h2>`:'') + ch.scenes.map(sc=>paraXhtml(sc.text)).join('\n<hr/>\n');
    zip.add('OEBPS/'+file, `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title><link rel="stylesheet" href="style.css"/></head><body>${body}</body></html>`);
    items.push(`<item id="${id}" href="${file}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
    nav.push(`<li><a href="${file}">${title}</a></li>`);
  });

  zip.add('OEBPS/style.css','body{font-family:serif;line-height:1.6;margin:1em}p{margin:0 0 .2em;text-indent:1.2em}h2{text-align:center;margin:2em 0 1em}hr{border:none;text-align:center;margin:1em 0}hr:after{content:"* * *"}');
  zip.add('OEBPS/nav.xhtml',`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Оглавление</title></head><body><nav epub:type="toc"><h1>Оглавление</h1><ol>${nav.map(n=>n.replace('<li>','<li>')).join('')}</ol></nav></body></html>`);
  const now = new Date();
  zip.add('OEBPS/content.opf',`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bid">urn:uuid:${xesc(p.bookUuid)}</dc:identifier>
<dc:title>${xesc(book.title)}</dc:title><dc:language>ru</dc:language>
${p.author?`<dc:creator>${xesc(p.author)}</dc:creator>`:''}
${p.synopsis?`<dc:description>${xesc(p.synopsis)}</dc:description>`:''}
<dc:date>${now.toISOString().slice(0,10)}</dc:date>
<meta property="dcterms:modified">${now.toISOString().slice(0,19)}Z</meta>
${coverMeta}</metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="style.css" media-type="text/css"/>${coverItems}${items.join('')}</manifest>
<spine>${coverSpine}${spine.join('')}</spine></package>`);

  download(zip.blob(), book.title+'.epub');
}

// ── .json (полный проект, секреты вычищены) ──
export function exportJson(state){
  download(new Blob([exportCheckpoint(state)],{type:'application/json'}), (state.project.title||'litsovet')+'.json');
}
