# Встраивание иллюстраций в экспорт книги — дизайн

## Цель

Сейчас сгенерированные иллюстрации сцен (и карта мира) существуют только в галерее внутри приложения — ни один из трёх форматов экспорта (.md, .doc, EPUB) их не встраивает. Единственное исключение — обложка, и то только в EPUB. Цель этой фичи: сделать так, чтобы всё, что автор сгенерировал в «Иллюстрациях» и «Мире», реально попадало в готовую книгу при экспорте, во всех трёх форматах.

Это первый из двух согласованных под-проектов доработки «Иллюстраций» (второй — настройки стиля/кол-ва — отдельным циклом позже).

## Решённые вопросы (согласовано с пользователем)

- Встраивать во все три формата: .md, .doc, EPUB.
- Обложка (`project.coverDataUrl`) теперь встраивается не только в EPUB, но и в .md/.doc — единообразно везде.
- Карта мира (если сгенерирована) — отдельной страницей в начале книги (после обложки, перед первой главой), не привязана к конкретной сцене.
- Иллюстрация сцены — визуально предшествует прозе этой сцены (открывающая картинка сцены).

## Важное уточнение по месту вставки

Сейчас НИ ОДИН из трёх форматов не рендерит заголовок отдельной сцены — только заголовок главы (`ch.title` → `<h2>`), сцены внутри главы разделены просто `***`/`<hr/>` без подписи. Поэтому «после заголовка сцены» на практике означает: иллюстрация ставится в начале текстового блока сцены (перед первым абзацем её прозы), сам блок сцены — это то же самое, что уже разделяется `***`/`<hr/>` в текущем коде. Это тот же визуальный эффект (картинка идёт перед текстом сцены), просто без промежуточного заголовка, которого в разметке сегодня и так нет.

## §1. Общие хелперы (`литсовет/src/export.js`)

### 1.1 `buildBook()` (`export.js:51-63`) — пробросить `id` сцены

Сейчас `cur.scenes.push({ title:n.title, text:n.text })` — не хватает `id`, без которого нельзя сопоставить иллюстрацию со сценой. Минимальное изменение:
```js
cur.scenes.push({ id:n.id, title:n.title, text:n.text });
```

### 1.2 Три новых хелпера рядом с `buildBook()`

```js
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
```

Сбой декодирования (не тот формат/битые данные) — не бросает ошибку, просто пропускает эту конкретную картинку (тот же толерантный паттерн, что уже используется в `suggestMissingWorldFacts` — молча возвращает пусто при сбое, не ломает остальной экспорт).

## §2. `.md` (`exportMd`, `export.js:71-81`)

Обложка и карта — через обычный Markdown-синтаксис `![alt](data:...)` (поддерживается большинством просмотрщиков без доп. инфраструктуры). Иллюстрация сцены — так же, перед текстом сцены:

```js
export function exportMd(state){
  const book = buildBook(state);
  let md = `# ${book.title}\n\n`;
  if(state.project.coverDataUrl) md += `![Обложка](${state.project.coverDataUrl})\n\n`;
  if(state.project.author) md += `*${state.project.author}*\n\n`;
  const mapItem = worldMapItem(state);
  if(mapItem) md += `## Карта мира\n\n![Карта мира](${mapItem.dataUrl})\n\n`;
  for(const ch of book.chapters){
    if(ch.title) md += `## ${ch.title}\n\n`;
    md += ch.scenes.map(sc=>{
      const illust = illustrationForScene(state, sc.id);
      const img = illust ? `![Иллюстрация](${illust})\n\n` : '';
      return img + typo(sc.text).trim();
    }).join('\n\n***\n\n') + '\n\n';
  }
  download(new Blob([md],{type:'text/markdown'}), book.title+'.md');
}
```

**Важная оговорка:** данные картинок встраиваются как base64 прямо в текст .md — файл станет заметно больше (десятки МБ при 6-8 иллюстрациях). Это неизбежное следствие выбранного подхода (единообразие во всех трёх форматах) — не баг, а компромисс, уже осознанно принятый при выборе «все три формата».

## §3. `.doc` (`exportDocx`, `export.js:84-94`)

Тот же принцип, через HTML `<img src="data:...">` (уже поддерживается открытием в Word/LibreOffice — сам экспорт целиком HTML-in-DOC):

```js
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
```

## §4. EPUB (`exportEpub`, `export.js:97-164`)

Расширяет уже существующий паттерн (обложка как настоящий zip-файл, не data-URI) на карту и иллюстрации сцен.

### 4.1 Рефакторинг обложки — использовать общий `decodeDataUrlImage()`

Заменить существующий инлайн-regex/atob (`export.js:116-130`) на вызов нового общего хелпера — то же поведение, без дублирования логики декодирования, которая теперь нужна трижды (обложка, карта, сцены).

### 4.2 Карта мира — отдельная XHTML-страница

После блока обложки, до `const items=[], spine=[], nav=[];`:
```js
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
```
`mapSpine` подставляется в спайн сразу после `coverSpine`, перед `spine.join('')` — гарантирует порядок обложка→карта→главы. `mapNav` добавляется в оглавление (`nav.xhtml`) тем же образом.

### 4.3 Иллюстрации сцен — файл на сцену + `<img>` в начале её блока

Изменить сборку тела главы (`export.js:134-143`), собирая изображения по ходу и добавляя их в общий список манифеста:
```js
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
```

**Важно про путь к CSS:** главы лежат в `OEBPS/chapters/`, а `style.css` — прямо в `OEBPS/`. Текущий код ссылается на него как `href="style.css"` — это уже (независимо от данной фичи) неверный относительный путь из подпапки `chapters/`; должно быть `../style.css`. Раз мы трогаем этот же блок кода — чиним заодно (см. §5, отдельным пунктом плана, не смешивать с картинками в одном шаге, чтобы ревьюеру было видно два разных изменения раздельно).

### 4.4 Манифест — добавить `mapItems` и `imageItems`

Строка `<manifest>` (`export.js:159-160`) получает оба новых списка:
```js
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="style.css" media-type="text/css"/>${coverItems}${mapItems}${imageItems.join('')}${items.join('')}</manifest>
<spine>${coverSpine}${mapSpine}${spine.join('')}</spine>
```

## §5. Побочный, но обнаруженный при чтении баг (вне первоначального скоупа, но в том же файле/функции)

При чтении `exportEpub()` для этой фичи обнаружено: главы EPUB уже сейчас ссылаются на `style.css` относительным путём `href="style.css"` (`export.js:139`), хотя сам файл главы лежит в `OEBPS/chapters/ch*.xhtml`, а `style.css` — в `OEBPS/style.css` — на уровень выше. Относительный путь из `chapters/` должен быть `../style.css`. Похоже, это существующий, никак не связанный с иллюстрациями баг (стили глав, возможно, никогда не применялись в реальных читалках, зависящих от строгого относительного резолвинга путей — некоторые читалки более снисходительны и всё равно резолвят от корня OEBPS, поэтому баг мог быть незаметен). План включает точечный однострочный фикс этого пути как отдельный шаг (не смешивая с добавлением картинок), раз мы и так трогаем эту функцию.

## Проверка

Как и для прошлых фич — нет тестового фреймворка. Проверка: `node --input-type=module --check`, затем живая проверка через реальный экспорт на тестовом проекте с реально сгенерированными обложкой + картой + минимум одной иллюстрацией сцены — открыть получившийся `.epub` (распаковать zip вручную и проверить структуру/манифест), `.md` и `.doc` (проверить, что data-URI строки на месте и корректной длины) через `mcp__Claude_Preview__*`.
