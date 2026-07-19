// Импорт готовых книг для режима серии (спека 5.2).
// .txt — тривиально; .docx/.epub — ZIP с XML/XHTML внутри.
// Минимальный async-распаковщик ZIP (STORE + DEFLATE через DecompressionStream).

// ── Чтение ZIP ──
async function inflateRaw(bytes){
  // DEFLATE без zlib-обёртки
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Response(bytes).body.pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

// Возвращает Map<name, Uint8Array>. Парсит central directory.
async function unzip(uint8){
  const dv = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
  // найти End of Central Directory (сигнатура 0x06054b50) с конца
  let eocd = -1;
  for(let i=uint8.length-22; i>=0; i--){ if(dv.getUint32(i,true)===0x06054b50){ eocd=i; break; } }
  if(eocd<0) throw new Error('не ZIP-архив');
  const count = dv.getUint16(eocd+10, true);
  let cd = dv.getUint32(eocd+16, true);
  const out = new Map();
  for(let n=0; n<count; n++){
    if(dv.getUint32(cd,true)!==0x02014b50) break;
    const method = dv.getUint16(cd+10, true);
    const compSize = dv.getUint32(cd+20, true);
    const nameLen = dv.getUint16(cd+28, true);
    const extraLen = dv.getUint16(cd+30, true);
    const commentLen = dv.getUint16(cd+32, true);
    const lho = dv.getUint32(cd+42, true);
    const name = new TextDecoder().decode(uint8.slice(cd+46, cd+46+nameLen));
    // локальный заголовок: вычислить смещение данных
    const lNameLen = dv.getUint16(lho+26, true);
    const lExtraLen = dv.getUint16(lho+28, true);
    const dataStart = lho+30+lNameLen+lExtraLen;
    const comp = uint8.slice(dataStart, dataStart+compSize);
    let data;
    if(method===0) data = comp;
    else if(method===8) data = await inflateRaw(comp);
    else { cd += 46+nameLen+extraLen+commentLen; continue; }
    out.set(name, data);
    cd += 46+nameLen+extraLen+commentLen;
  }
  return out;
}

// Именованные HTML-сущности, которые реально встречаются в тексте прозы
// (Word/EPUB регулярно кодируют так тире, многоточие и, критично для русского
// текста, кавычки-«ёлочки»). Раньше всё, что не входило в жёсткий список
// amp/lt/gt/quot/nbsp, просто ВЫРЕЗАЛОСЬ (.replace(/&#?\w+;/g,'')) — диалоги
// молча теряли кавычки, а тире иногда склеивало два слова без пробела.
const XML_ENTITIES = {
  amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ',
  mdash:'—', ndash:'–', hellip:'…', laquo:'«', raquo:'»',
  lsquo:'‘', rsquo:'’', ldquo:'“', rdquo:'”',
  sect:'§', copy:'©', reg:'®', trade:'™', deg:'°',
};
function decodeXmlEntity(name){
  if(/^#x[0-9a-f]+$/i.test(name)) return String.fromCodePoint(parseInt(name.slice(2),16));
  if(/^#\d+$/.test(name)) return String.fromCodePoint(parseInt(name.slice(1),10));
  return XML_ENTITIES[name.toLowerCase()] ?? '';
}
function stripXml(xml){
  return xml
    .replace(/<w:p\b[^>]*>/g,'\n').replace(/<\/w:p>/g,'\n')  // docx абзацы
    .replace(/<p\b[^>]*>/g,'\n').replace(/<\/p>/g,'\n')        // epub абзацы
    .replace(/<br\s*\/?>/g,'\n')
    .replace(/<[^>]+>/g,'')                                     // прочие теги
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (_, ent) => decodeXmlEntity(ent))
    .replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}

// Натуральная сортировка (chapter2 < chapter10), в отличие от лексикографической
// (.sort() дал бы chapter1, chapter10, chapter11, chapter2, …) — запасной
// вариант для epubSpineOrder(), если реальный спайн из content.opf недоступен.
function naturalCompare(a, b){
  const ax = a.match(/(\d+)|(\D+)/g) || [];
  const bx = b.match(/(\d+)|(\D+)/g) || [];
  const len = Math.max(ax.length, bx.length);
  for(let i=0; i<len; i++){
    const av = ax[i] ?? '', bv = bx[i] ?? '';
    if(/^\d+$/.test(av) && /^\d+$/.test(bv)){ const d = parseInt(av,10)-parseInt(bv,10); if(d) return d; }
    else { const d = av.localeCompare(bv); if(d) return d; }
  }
  return 0;
}

function parseXmlAttrs(tag){
  const attrs = {};
  const re = /([\w:-]+)\s*=\s*"([^"]*)"/g;
  let m; while((m = re.exec(tag))) attrs[m[1]] = m[2];
  return attrs;
}

// Реальный порядок чтения EPUB — из <spine> в content.opf (как делает любая
// читалка), а не из имён файлов. Возвращает null, если OPF не нашёлся/не
// распарсился — вызывающий код в этом случае откатывается на naturalCompare.
async function epubSpineOrder(zip){
  try{
    const containerBytes = zip.get('META-INF/container.xml');
    if(!containerBytes) return null;
    const containerXml = new TextDecoder().decode(containerBytes);
    const rootTag = containerXml.match(/<rootfile\b[^>]*>/i);
    const opfPath = rootTag && parseXmlAttrs(rootTag[0])['full-path'];
    if(!opfPath) return null;
    const opfBytes = zip.get(opfPath);
    if(!opfBytes) return null;
    const opfXml = new TextDecoder().decode(opfBytes);
    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')+1) : '';
    const manifest = {};
    const itemRe = /<item\b[^>]*\/?>/g;
    let im; while((im = itemRe.exec(opfXml))){
      const a = parseXmlAttrs(im[0]);
      if(a.id && a.href) manifest[a.id] = opfDir + decodeURIComponent(a.href);
    }
    const spineMatch = opfXml.match(/<spine\b[^>]*>([\s\S]*?)<\/spine>/i);
    if(!spineMatch) return null;
    const spineIds = [];
    const itemrefRe = /<itemref\b[^>]*\/?>/g;
    let sm; while((sm = itemrefRe.exec(spineMatch[1]))){
      const a = parseXmlAttrs(sm[0]);
      if(a.idref) spineIds.push(a.idref);
    }
    const order = spineIds.map(id=>manifest[id]).filter(Boolean);
    return order.length ? order : null;
  }catch{ return null; }
}

// ── Парсеры форматов → чистый текст ──
export async function parseFile(file){
  const name = (file.name||'').toLowerCase();
  if(name.endsWith('.txt')){
    return await file.text();
  }
  if(name.endsWith('.docx')){
    const zip = await unzip(new Uint8Array(await file.arrayBuffer()));
    const doc = zip.get('word/document.xml');
    if(!doc) throw new Error('docx: нет word/document.xml');
    return stripXml(new TextDecoder().decode(doc));
  }
  if(name.endsWith('.epub')){
    const zip = await unzip(new Uint8Array(await file.arrayBuffer()));
    // Порядок глав — из спайна content.opf; если он не резолвится (нестандартный
    // пакет, пути не совпали) — натуральная сортировка имён вместо лексикографической
    // (та давала chapter1, chapter10, chapter11, chapter2, … для книг от 10 глав).
    let htmls = await epubSpineOrder(zip);
    if(!htmls || !htmls.length || !htmls.every(k=>zip.has(k))){
      htmls = [...zip.keys()].filter(k=>/\.x?html?$/i.test(k) && !/nav|toc/i.test(k)).sort(naturalCompare);
    }
    if(!htmls.length) throw new Error('epub: не найдено глав');
    return htmls.map(k=>stripXml(new TextDecoder().decode(zip.get(k)))).join('\n\n');
  }
  throw new Error('Поддерживаются .txt, .docx, .epub');
}
