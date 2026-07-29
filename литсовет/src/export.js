// Экспорт книги: .md / .docx (HTML-in-DOC) / .epub (true EPUB 3) / .json.
// ZipBuilder + crc32 + md2xhtml перенесены из ИИ-Издательства.

import { exportCheckpoint } from './storage.js';
import { save } from './state.js';
import { coverHasBakedAuthor } from './illustrations.js';

// ── Лёгкая типографика (RU): кавычки-ёлочки, тире, неразрывные пробелы ──
export function typo(s){
  if(!s) return '';
  return s
    .replace(/"([^"]*)"/g, '«$1»')
    .replace(/(^|[\s(])-(\s)/g, '$1—$2')      // дефис как тире в начале реплики
    .replace(/ - /g, ' — ')
    // Число + неразрывный пробел. [^\S\r\n]+ (НЕ \s+!) — тот же принцип, что и
    // у схлопывания двойных пробелов в ИИ-Издательстве (см. CLAUDE.md): \s+
    // матчит и переносы строк, а paraXhtml() вызывает typo() ДО split(/\n{1,}/).
    // Абзац, заканчивающийся числом («...из 5\n\nЗатем...»), терял пустую
    // строку между абзацами — \b(\d+)\s+ поглощал оба \n и подставлял на их
    // место один неразрывный пробел, склеивая два абзаца сцены в один.
    .replace(/\b(\d+)[^\S\r\n]+/g, '$1 ');
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
export function buildBook(state){
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
// Раньше поддерживались только jpeg/png — загрузка своих картинок идёт через
// <input type="file" accept="image/*"> (ui/illustrations.js), так что WEBP/GIF/
// BMP — не гипотетика. Формат вне списка тихо пропадал из EPUB без единого
// предупреждения; экспорт «успешно» завершался без обложки/карты/иллюстрации.
const IMG_TYPES = {
  jpeg:{ext:'jpg', mime:'image/jpeg'}, jpg:{ext:'jpg', mime:'image/jpeg'},
  png:{ext:'png', mime:'image/png'},
  gif:{ext:'gif', mime:'image/gif'},
  webp:{ext:'webp', mime:'image/webp'},
  bmp:{ext:'bmp', mime:'image/bmp'},
  'svg+xml':{ext:'svg', mime:'image/svg+xml'}, svg:{ext:'svg', mime:'image/svg+xml'},
};
// Собирает пропущенные картинки за время одного exportEpub() — синхронный вызов,
// поэтому простой модульный массив безопасен (нет параллельных вызовов).
let _epubSkipped = [];
function decodeDataUrlImage(dataUrl){
  const m = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl||'');
  if(!m) return null;
  const info = IMG_TYPES[m[1].toLowerCase()];
  if(!info){ _epubSkipped.push(m[1]); return null; }
  try{
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    return { bytes, ext:info.ext, mime:info.mime };
  }catch(e){ console.warn('image decode failed', e); _epubSkipped.push(m[1]+' (ошибка декодирования)'); return null; }
}

// ── Картинка → блок <binary> для FB2 ──
// В схеме FB2 2.0 допустимы только image/jpeg и image/png: WEBP там нет вообще,
// а Recraft (текущий провайдер по умолчанию у автора) отдаёт именно WEBP — то
// есть «просто вставить как есть» дало бы файл, который читалки не покажут.
// Поэтому всё, что не jpeg/png, пережимаем в JPEG через canvas: качество для
// иллюстраций достаточное, а совместимость полная. JPEG не умеет прозрачность,
// поэтому под картинку кладём белый фон — иначе прозрачные места станут чёрными.
function toFb2Binary(dataUrl, id){
  return new Promise(resolve=>{
    const m = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl||'');
    if(!m) return resolve(null);
    const kind = m[1].toLowerCase();
    if(kind==='jpeg' || kind==='jpg') return resolve({ id:id+'.jpg', contentType:'image/jpeg', b64:m[2] });
    if(kind==='png')                  return resolve({ id:id+'.png', contentType:'image/png',  b64:m[2] });
    const img = new Image();
    img.onload = ()=>{
      try{
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0,0,c.width,c.height);
        ctx.drawImage(img, 0, 0);
        const jpg = c.toDataURL('image/jpeg', 0.88).split(',')[1];
        resolve({ id:id+'.jpg', contentType:'image/jpeg', b64:jpg });
      }catch{ resolve(null); }
    };
    img.onerror = ()=>resolve(null);
    img.src = dataUrl;
  });
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
  let body = state.project.coverDataUrl
    ? `<p style="text-align:center"><img src="${state.project.coverDataUrl}" style="max-width:100%"/></p>`
    : `<h1>${xesc(book.title)}</h1>`;
  if(state.project.author && !coverHasBakedAuthor(state)) body += `<p style="text-align:center;font-style:italic">${xesc(state.project.author)}</p>`;
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
  _epubSkipped = [];
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
  const coverDecoded = decodeDataUrlImage(p.coverDataUrl);
  if(coverDecoded){
    const { bytes, ext, mime } = coverDecoded;
    zip.add('OEBPS/cover.'+ext, bytes);
    zip.add('OEBPS/cover.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Обложка</title><style>body{margin:0;text-align:center}img{max-width:100%;max-height:100vh}</style></head><body><img src="cover.${ext}" alt="Обложка"/></body></html>`);
    coverItems = `<item id="cover-img" href="cover.${ext}" media-type="${mime}" properties="cover-image"/><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`;
    coverSpine = `<itemref idref="cover"/>`;
    coverMeta = `<meta name="cover" content="cover-img"/>`;
  }

  // Карта мира (опц.): отдельная страница сразу после обложки, до первой главы.
  let mapItems='', mapSpine='', mapNav='';
  const mapItem = worldMapItem(state);
  if(mapItem){
    const decoded = decodeDataUrlImage(mapItem.dataUrl);
    if(decoded){
      zip.add('OEBPS/images/map.'+decoded.ext, decoded.bytes);
      zip.add('OEBPS/map.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Карта мира</title><style>body{margin:0;text-align:center}img{max-width:100%;max-height:100vh}</style></head><body><h2>Карта мира</h2><img src="images/map.${decoded.ext}" alt="Карта мира"/></body></html>`);
      mapItems = `<item id="map-img" href="images/map.${decoded.ext}" media-type="${decoded.mime}"/><item id="map" href="map.xhtml" media-type="application/xhtml+xml"/>`;
      mapSpine = `<itemref idref="map"/>`;
      mapNav = `<li><a href="map.xhtml">Карта мира</a></li>`;
    }
  }

  const items=[], spine=[], nav=[], imageItems=[];
  book.chapters.forEach((ch,i)=>{
    const id='ch'+(i+1), file='chapters/'+id+'.xhtml';
    const title = xesc(ch.title || ('Глава '+(i+1)));
    const sceneBodies = ch.scenes.map((sc,si)=>{
      const illust = illustrationForScene(state, sc.id);
      let imgTag = '';
      if(illust){
        const decoded = decodeDataUrlImage(illust);
        if(decoded){
          const imgId = `${id}-img${si+1}`;
          const imgFile = `images/${imgId}.${decoded.ext}`;
          zip.add('OEBPS/'+imgFile, decoded.bytes);
          imageItems.push(`<item id="${imgId}" href="${imgFile}" media-type="${decoded.mime}"/>`);
          imgTag = `<p style="text-align:center"><img src="../${imgFile}" alt="Иллюстрация"/></p>`;
        }
      }
      return imgTag + paraXhtml(sc.text);
    });
    const body = (ch.title?`<h2>${title}</h2>`:'') + sceneBodies.join('\n<hr/>\n');
    zip.add('OEBPS/'+file, `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title><link rel="stylesheet" href="../style.css"/></head><body>${body}</body></html>`);
    items.push(`<item id="${id}" href="${file}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
    nav.push(`<li><a href="${file}">${title}</a></li>`);
  });

  zip.add('OEBPS/style.css','body{font-family:serif;line-height:1.6;margin:1em}p{margin:0 0 .2em;text-indent:1.2em}h2{text-align:center;margin:2em 0 1em}hr{border:none;text-align:center;margin:1em 0}hr:after{content:"* * *"}');
  zip.add('OEBPS/nav.xhtml',`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Оглавление</title></head><body><nav epub:type="toc"><h1>Оглавление</h1><ol>${mapNav}${nav.map(n=>n.replace('<li>','<li>')).join('')}</ol></nav></body></html>`);
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
<item id="css" href="style.css" media-type="text/css"/>${coverItems}${mapItems}${imageItems.join('')}${items.join('')}</manifest>
<spine>${coverSpine}${mapSpine}${spine.join('')}</spine></package>`);

  download(zip.blob(), book.title+'.epub');
  if(_epubSkipped.length) alert('EPUB сохранён, но пропущены картинки неподдерживаемого формата: '+_epubSkipped.join(', ')+'. Пересохраните их как JPEG/PNG и загрузите заново.');
}

// ── .json (полный проект, секреты вычищены) ──
export function exportJson(state){
  download(new Blob([exportCheckpoint(state)],{type:'application/json'}), (state.project.title||'litsovet')+'.json');
}

// ── .fb2 (для ЛитРес Самиздат) ──
// Намеренно БЕЗ метаданных автора/жанра/цены/обложки в файле — по чек-листу
// ЛитРес их заполняют в мастере публикации на сайте отдельно, встраивание
// в файл создаёт дублирование источника правды и конфликтует при
// конвертации (см. docs/superpowers/specs/2026-07-06-publishing-checklist-design.md §4).
// Жанр проекта (свободный русский текст из селекта Концепции) → код жанра FB2.
// В FB2 <genre> — не произвольная строка, а значение из фиксированного словаря
// схемы; читалки и каталоги (ЛитРес, FBReader, AlReader, Bookmate) раскладывают
// книгу по полкам именно по нему.
const FB2_GENRES = {
  'детектив':'detective', 'дамский детектив':'detective', 'ироничный детектив':'det_irony',
  'триллер':'thriller', 'ужасы':'horror', 'мистика':'sf_mystic',
  'фэнтези':'sf_fantasy', 'ироничное фэнтези':'sf_humor', 'ромфант':'love_sf',
  'фантастика':'sf', 'молодёжная фантастика':'sf', 'литрпг':'sf',
  'альтернативная история':'sf_history', 'исторический роман':'prose_history',
  'любовный роман':'love_contemporary', 'тёмная романтика':'love_contemporary',
  'приключения':'adv_story', 'биографическая проза':'nonf_biography',
  'сказка':'child_tale', 'юмористическая проза':'humor_prose',
  'роман':'prose_contemporary', 'повесть':'prose_contemporary', 'рассказ':'prose_contemporary',
};

// «А. Тестова» → <first-name>А.</first-name><last-name>Тестова</last-name>.
// Одно слово («Пелевин», псевдоним) — в <nickname>, иначе last-name остался бы
// пустым, а он в схеме обязателен внутри <author>.
function fb2Author(raw){
  const parts = String(raw||'').trim().split(/\s+/).filter(Boolean);
  if(!parts.length) return '<author><nickname>Автор не указан</nickname></author>';
  if(parts.length === 1) return `<author><nickname>${xesc(parts[0])}</nickname></author>`;
  const last = parts.pop();
  const first = parts.shift();
  const middle = parts.length ? `<middle-name>${xesc(parts.join(' '))}</middle-name>` : '';
  return `<author><first-name>${xesc(first)}</first-name>${middle}<last-name>${xesc(last)}</last-name></author>`;
}

export async function exportFb2(state){
  const book = buildBook(state);
  const p = state.project || {};

  // ── Картинки ──
  // Раньше FB2 был единственным форматом БЕЗ иллюстраций вообще: .md, .doc и
  // EPUB картинку встраивали, а FB2 отдавал голый текст (8 КБ против 1.6-2.1 МБ
  // на живом прогоне). Та же асимметрия, что была с потерянным именем автора.
  // Собираем всё заранее: конвертация в JPEG асинхронна (canvas), поэтому и сама
  // функция стала async.
  const binaries = [];
  const addBinary = async (dataUrl, id) => {
    const b = await toFb2Binary(dataUrl, id);
    if(b) binaries.push(b);
    return b;
  };
  const coverBin = p.coverDataUrl ? await addBinary(p.coverDataUrl, 'cover') : null;
  const mapItem = worldMapItem(state);
  const mapBin = mapItem ? await addBinary(mapItem.dataUrl, 'map') : null;

  const sections = [];
  if(mapBin) sections.push(`<section><title><p>Карта мира</p></title>\n<p><image l:href="#${mapBin.id}"/></p>\n</section>`);
  let imgN = 0;
  for(const ch of book.chapters){
    const title = ch.title ? `<title><p>${xesc(ch.title)}</p></title>` : '';
    const parts = [];
    for(const sc of ch.scenes){
      const illust = illustrationForScene(state, sc.id);
      if(illust){
        const b = await addBinary(illust, 'img'+(++imgN));
        // Картинка идёт ПЕРЕД текстом сцены — тот же порядок, что в .md/.doc/EPUB.
        if(b) parts.push(`<p><image l:href="#${b.id}"/></p>`);
      }
      parts.push(paraXhtml(sc.text));
    }
    sections.push(`<section>${title}\n${parts.join('\n')}\n</section>`);
  }
  const sectionsXml = sections.join('\n');
  const binariesXml = binaries.map(b=>`<binary id="${b.id}" content-type="${b.contentType}">${b.b64}</binary>`).join('\n');
  // <title-info> раньше содержал ТОЛЬКО <book-title> — файл открывался, но был
  // невалиден по схеме FB2 2.0, где genre, author и lang обязательны, и главное:
  // имя автора не попадало в файл вообще. Остальные три экспорта (.md, .doc,
  // EPUB через dc:creator) автора пишут — FB2 был единственным, кто его терял,
  // хотя для русскоязычных читалок это основной формат: книга вставала в
  // библиотеку как «Неизвестный автор». Порядок элементов важен — схема FB2
  // задаёт именно такую последовательность.
  const genre = FB2_GENRES[String(p.genre||'').toLowerCase().trim()] || 'prose_contemporary';
  const stamp = new Date().toISOString().slice(0,10);
  const fb2 = `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info><genre>${genre}</genre>${fb2Author(p.author)}<book-title>${xesc(book.title)}</book-title>${p.synopsis?`<annotation><p>${xesc(p.synopsis)}</p></annotation>`:''}${coverBin?`<coverpage><image l:href="#${coverBin.id}"/></coverpage>`:''}<lang>ru</lang></title-info>
<document-info>${fb2Author(p.author)}<program-used>Литсовет</program-used><date value="${stamp}">${stamp}</date><id>${xesc(state.id||'litsovet')}</id><version>1.0</version></document-info>
</description>
<body>
${sectionsXml}
</body>
${binariesXml}
</FictionBook>`;
  download(new Blob([fb2],{type:'application/xml'}), book.title+'.fb2');
}
