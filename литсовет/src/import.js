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

function stripXml(xml){
  return xml
    .replace(/<w:p\b[^>]*>/g,'\n').replace(/<\/w:p>/g,'\n')  // docx абзацы
    .replace(/<p\b[^>]*>/g,'\n').replace(/<\/p>/g,'\n')        // epub абзацы
    .replace(/<br\s*\/?>/g,'\n')
    .replace(/<[^>]+>/g,'')                                     // прочие теги
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#160;|&nbsp;/g,' ').replace(/&#?\w+;/g,'')
    .replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
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
    // собрать все xhtml/html в порядке имени
    const htmls = [...zip.keys()].filter(k=>/\.x?html?$/i.test(k) && !/nav|toc/i.test(k)).sort();
    if(!htmls.length) throw new Error('epub: не найдено глав');
    return htmls.map(k=>stripXml(new TextDecoder().decode(zip.get(k)))).join('\n\n');
  }
  throw new Error('Поддерживаются .txt, .docx, .epub');
}
