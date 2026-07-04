# Встраивание иллюстраций в экспорт книги — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Обложка, карта мира и иллюстрации сцен, сгенерированные в «Иллюстрациях»/«Мире», должны реально попадать в экспортированную книгу во всех трёх форматах (.md, .doc, EPUB), а не оставаться только в галерее внутри приложения.

**Архитектура:** Три новых чистых хелпера (`illustrationForScene`, `worldMapItem`, `decodeDataUrlImage`) рядом с уже существующим `buildBook()` в `литсовет/src/export.js`. `.md`/`.doc` встраивают картинки как data-URI прямо в текст (просто, единообразно, ценой размера файла). EPUB расширяет уже работающий паттерн (обложка как настоящий zip-файл) на карту и иллюстрации сцен — каждая картинка становится отдельным файлом в архиве с записью в манифесте, а не data-URI.

**Tech Stack:** Vanilla JS (ES-модули), без сборщика и фреймворка. Никаких новых зависимостей — та же самопальная `ZipBuilder`/CRC-32, что уже используется для обложки.

**Спека:** `docs/superpowers/specs/2026-07-05-illustrations-export-design.md` (одобрена, все ссылки на код проверены построчно против репозитория, включая найденный попутный баг с `style.css`).

**Как проверять каждый шаг:** в этом проекте нет тестового фреймворка (zero-dependency приложение). Проверка — `node --input-type=module --check < литсовет/src/export.js` на синтаксис сразу после правки, и **живая проверка через `mcp__Claude_Preview__*`** на реально запущенном сервере (`node server.js`, порт 8788 для конфига `litsovet`). Финальная сквозная проверка — Task 7.

---

### Task 1: Общие хелперы + `buildBook()` пробрасывает `id` сцены

**Files:**
- Modify: `литсовет/src/export.js`

- [ ] **Шаг 1: Добавить `id` в объект сцены**

Найти `литсовет/src/export.js:59`:
```js
      cur.scenes.push({ title:n.title, text:n.text });
```
Заменить на:
```js
      cur.scenes.push({ id:n.id, title:n.title, text:n.text });
```

- [ ] **Шаг 2: Добавить три новых хелпера**

Сразу после `buildBook()` (после закрывающей `}` на `литсовет/src/export.js:63`), перед `function download(...)`:

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

- [ ] **Шаг 3: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/export.js`
Expected: без вывода.

- [ ] **Шаг 4: Живая проверка**

Через `mcp__Claude_Preview__preview_eval` на запущенном сервере (порт 8788, конфиг `litsovet`) — импортировать функции напрямую невозможно (не экспортированы, внутренние хелперы модуля), поэтому проверить косвенно: создать тестовый проект через `newProject()`, сгенерировать структуру (реальный вызов, минимум 1 глава/1 сцена — можно взять маленький `targetWords`, чтобы дёшево), затем:
```js
const { getState } = await import('/src/state.js');
const s = getState();
({ firstSceneHasId: !!(s.structure||[]).find(n=>n.type==='scene')?.id })
```
Expected: `firstSceneHasId:true` (подтверждает, что узлы сцен вообще имеют `id` — на этом опирается Шаг 1; сам `buildBook()` пока нигде не используется до Task 2/3/4, поэтому прямой вызов будет только в следующих задачах).

- [ ] **Шаг 5: Commit**

```bash
git add литсовет/src/export.js
git commit -m "feat(литсовет): export.js — хелперы для иллюстраций + id сцены в buildBook()"
```

---

### Task 2: `.md` — встроить обложку, карту и иллюстрации сцен

**Files:**
- Modify: `литсовет/src/export.js`

- [ ] **Шаг 1: Заменить `exportMd()`**

Найти `литсовет/src/export.js:71-81` (текущая функция целиком):
```js
export function exportMd(state){
  const book = buildBook(state);
  let md = `# ${book.title}\n\n`;
  if(state.project.author) md += `*${state.project.author}*\n\n`;
  for(const ch of book.chapters){
    if(ch.title) md += `## ${ch.title}\n\n`;
    // сцены внутри главы разделяются *** (как «* * *» в EPUB)
    md += ch.scenes.map(sc=>typo(sc.text).trim()).join('\n\n***\n\n') + '\n\n';
  }
  download(new Blob([md],{type:'text/markdown'}), book.title+'.md');
}
```
Заменить на:
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
    // сцены внутри главы разделяются *** (как «* * *» в EPUB)
    md += ch.scenes.map(sc=>{
      const illust = illustrationForScene(state, sc.id);
      const img = illust ? `![Иллюстрация](${illust})\n\n` : '';
      return img + typo(sc.text).trim();
    }).join('\n\n***\n\n') + '\n\n';
  }
  download(new Blob([md],{type:'text/markdown'}), book.title+'.md');
}
```

- [ ] **Шаг 2: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/export.js`
Expected: без вывода.

- [ ] **Шаг 3: Живая проверка**

На тестовом проекте (продолжение Task 1's, или свежий) — реально сгенерировать/загрузить: обложку (`state.project.coverDataUrl` — можно временно подставить любой валидный маленький `data:image/png;base64,...` через `preview_eval`, чтобы не тратить реальные деньги на генерацию картинки лишний раз, если требуется только проверить факт встраивания, а не качество картинки), написать хотя бы одну сцену (нужен `text`, иначе `buildBook()` её не включит — см. `export.js:57`), и вручную положить тестовый `state.illustrations.items` элемент `{type:'scene', sceneId:<id первой сцены>, dataUrl:'data:image/png;base64,...'}` через `preview_eval` (не обязательно тратить реальные деньги генерации через настоящий провайдер картинок — для проверки самого факта встраивания в экспорт достаточно валидного тестового dataUrl).

Вызвать `exportMd(getState())` (через `preview_eval`, перехватив `download()` — либо временно проверить итоговую строку `md` напрямую, если `exportMd` не экспортирует промежуточный текст: проще всего скопировать логику построения `md`-строки в eval-выражении, импортируя `buildBook`/хелперы... но они НЕ экспортированы (внутренние). Поэтому: временно перехватить `URL.createObjectURL` и/или прочитать Blob через `FileReader`, либо — проще — экспортировать `exportMd` уже есть (```export function exportMd```), так что можно вызвать её напрямую и перехватить сам Blob через monkey-patch `document.createElement`/`a.click`, либо просто вызвать функцию и проверить, что она не бросает ошибку, а затем отдельно верифицировать СОДЕРЖИМОЕ через:
```js
const { exportMd } = await import('/src/export.js?v=' + Date.now());
let captured = null;
const origCreateEl = document.createElement.bind(document);
document.createElement = (tag) => {
  const el = origCreateEl(tag);
  if(tag === 'a') { const origClick = el.click.bind(el); el.click = () => { captured = el.href; origClick(); }; }
  return el;
};
exportMd(getState());
document.createElement = origCreateEl; // восстановить сразу после вызова
const blobUrl = captured;
const resp = await fetch(blobUrl);
const text = await resp.text();
({ hasCoverImg: text.includes('![Обложка](data:image'), hasSceneImg: text.includes('![Иллюстрация](data:image'), length: text.length })
```
Expected: `hasCoverImg:true`, `hasSceneImg:true` (если тестовые данные обложки/иллюстрации были подставлены заранее), `length` заметно больше, чем без картинок (десятки КБ на одну маленькую тестовую картинку, подтверждает встраивание).

- [ ] **Шаг 4: Commit**

```bash
git add литсовет/src/export.js
git commit -m "feat(литсовет): .md — встроить обложку, карту мира и иллюстрации сцен"
```

---

### Task 3: `.doc` — встроить обложку, карту и иллюстрации сцен

**Files:**
- Modify: `литсовет/src/export.js`

- [ ] **Шаг 1: Заменить `exportDocx()`**

Найти `литсовет/src/export.js:84-94` (текущая функция целиком):
```js
export function exportDocx(state){
  const book = buildBook(state);
  let body = `<h1>${xesc(book.title)}</h1>`;
  if(state.project.author) body += `<p style="text-align:center;font-style:italic">${xesc(state.project.author)}</p>`;
  for(const ch of book.chapters){
    if(ch.title) body += `<h2>${xesc(ch.title)}</h2>`;
    body += ch.scenes.map(sc=>paraXhtml(sc.text)).join('<p style="text-align:center">*&#160;*&#160;*</p>');
  }
  const html = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"></head><body>${body}</body></html>`;
  download(new Blob([html],{type:'application/msword'}), book.title+'.doc');
}
```
Заменить на:
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

- [ ] **Шаг 2: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/export.js`
Expected: без вывода.

- [ ] **Шаг 3: Живая проверка**

Тем же приёмом, что в Task 2 Шаг 3 (перехват `document.createElement('a')`/`.click`), вызвать `exportDocx(getState())` на том же тестовом проекте, прочитать Blob, проверить:
```js
({ hasCoverImg: text.includes('<img src="data:image') /* появится минимум дважды: обложка + иллюстрация сцены, если обе заданы */, imgCount: (text.match(/<img src="data:image/g)||[]).length })
```
Expected: `imgCount >= 2` (обложка + минимум одна иллюстрация сцены из тестовых данных).

- [ ] **Шаг 4: Commit**

```bash
git add литсовет/src/export.js
git commit -m "feat(литсовет): .doc — встроить обложку, карту мира и иллюстрации сцен"
```

---

### Task 4: EPUB — починить относительный путь до `style.css` (попутный баг)

Обнаружен при чтении `exportEpub()` для этой фичи, не связан с иллюстрациями напрямую — но раз мы трогаем эту же функцию в следующих задачах, чиним отдельным, легко откатываемым коммитом сейчас, а не смешиваем с добавлением картинок.

**Files:**
- Modify: `литсовет/src/export.js`

- [ ] **Шаг 1: Понять баг**

Главы EPUB пишутся в `OEBPS/chapters/ch*.xhtml` (`литсовет/src/export.js:135`: `file='chapters/'+id+'.xhtml'`, `zip.add('OEBPS/'+file, ...)` на строке 138). Стили лежат в `OEBPS/style.css` (строка 145: `zip.add('OEBPS/style.css', ...)`). Шаблон главы (строка 139) ссылается на стили как `href="style.css"` — относительный путь резолвится ОТ `OEBPS/chapters/`, то есть фактически ищет несуществующий `OEBPS/chapters/style.css`, а не реальный `OEBPS/style.css`.

- [ ] **Шаг 2: Исправить путь**

Найти `литсовет/src/export.js:139`:
```js
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title><link rel="stylesheet" href="style.css"/></head><body>${body}</body></html>`);
```
Заменить `href="style.css"` на `href="../style.css"`:
```js
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title><link rel="stylesheet" href="../style.css"/></head><body>${body}</body></html>`);
```

- [ ] **Шаг 3: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/export.js`
Expected: без вывода.

- [ ] **Шаг 4: Живая проверка**

Экспортировать EPUB (тем же приёмом перехвата `<a>.click`, прочитать Blob как ArrayBuffer вместо текста), распаковать вручную через `preview_eval` (нативный `DecompressionStream`/ручной ZIP-парсер писать не нужно — проще: раз ZIP собирается STORE-методом без компрессии, можно найти байтовое смещение записи `OEBPS/chapters/ch1.xhtml` внутри архива и убедиться, что байты содержат `href="../style.css"`, а не `href="style.css"`). Проще всего: `text = await (await new Response(blob)).text()`-подобным способом искать подстроку `../style.css` в сыром содержимом Blob (ZIP STORE не сжимает текстовые записи, так что строка будет присутствовать как есть):
```js
const buf = await (await fetch(blobUrl)).arrayBuffer();
const raw = new TextDecoder('utf-8', {fatal:false}).decode(buf);
({ hasFixedPath: raw.includes('href="../style.css"'), hasOldBug: raw.includes('href="style.css"') })
```
Expected: `hasFixedPath:true`, `hasOldBug:false` (если `hasOldBug` тоже `true` — значит где-то осталась старая ссылка, например в `nav.xhtml` или `cover.xhtml`, которые НЕ используют style.css вовсе — проверить, что это не false positive от частичного совпадения подстроки `href="style.css"` внутри `href="../style.css"`; сам тест на `hasOldBug` ищет ТОЧНОЕ вхождение БЕЗ `../`, так что не пересекается).

- [ ] **Шаг 5: Commit**

```bash
git add литсовет/src/export.js
git commit -m "fix(литсовет): EPUB — неверный относительный путь до style.css в главах"
```

---

### Task 5: EPUB — рефакторинг обложки на общий хелпер + страница карты мира

**Files:**
- Modify: `литсовет/src/export.js`

- [ ] **Шаг 1: Рефакторинг блока обложки**

Найти `литсовет/src/export.js:114-131` (текущий блок целиком):
```js
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
```
Заменить на (использует новый общий `decodeDataUrlImage()` из Task 1, поведение идентично):
```js
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
```

- [ ] **Шаг 2: Добавить блок карты мира**

Сразу после блока обложки (после `}` закрывающей `if(coverDecoded)`), перед `const items=[], spine=[], nav=[];`:
```js
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
```

- [ ] **Шаг 3: Подключить `mapItems`/`mapSpine`/`mapNav` в манифест, спайн и оглавление**

Найти `литсовет/src/export.js:146-147` (nav.xhtml):
```js
  zip.add('OEBPS/nav.xhtml',`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Оглавление</title></head><body><nav epub:type="toc"><h1>Оглавление</h1><ol>${nav.map(n=>n.replace('<li>','<li>')).join('')}</ol></nav></body></html>`);
```
Заменить `${nav.map(...)}` на `${mapNav}${nav.map(n=>n.replace('<li>','<li>')).join('')}`:
```js
  zip.add('OEBPS/nav.xhtml',`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Оглавление</title></head><body><nav epub:type="toc"><h1>Оглавление</h1><ol>${mapNav}${nav.map(n=>n.replace('<li>','<li>')).join('')}</ol></nav></body></html>`);
```

Найти `литсовет/src/export.js:159-161` (манифест/спайн):
```js
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="style.css" media-type="text/css"/>${coverItems}${items.join('')}</manifest>
<spine>${coverSpine}${spine.join('')}</spine></package>`);
```
Заменить на:
```js
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="style.css" media-type="text/css"/>${coverItems}${mapItems}${items.join('')}</manifest>
<spine>${coverSpine}${mapSpine}${spine.join('')}</spine></package>`);
```
(Полный манифест/спайн получит третий список — `imageItems` от иллюстраций сцен — в Task 6; на этом шаге его ещё нет, поэтому строка временно не включает его.)

- [ ] **Шаг 4: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/export.js`
Expected: без вывода.

- [ ] **Шаг 5: Живая проверка**

На тестовом проекте с уже подставленным `state.illustrations.items` элементом `{type:'map', dataUrl:'data:image/png;base64,...'}` (через `preview_eval`, тестовый маленький dataUrl — не тратить реальные деньги на генерацию), экспортировать EPUB (перехват `<a>.click`, прочитать Blob как ArrayBuffer, декодировать как текст тем же приёмом, что в Task 4 Шаг 4 — ZIP STORE не сжимает, строки ищутся напрямую):
```js
const buf = await (await fetch(blobUrl)).arrayBuffer();
const raw = new TextDecoder('utf-8', {fatal:false}).decode(buf);
({
  hasMapPage: raw.includes('map.xhtml'),
  hasMapImageRef: raw.includes('images/map.'),
  hasMapInNav: raw.includes('Карта мира'),
  coverStillWorks: raw.includes('cover.xhtml'), // обложка не сломалась после рефакторинга
})
```
Expected: все четыре `true` (если в тестовых данных также была подставлена обложка — иначе `coverStillWorks` проверяется отдельно на проекте с обложкой).

- [ ] **Шаг 6: Commit**

```bash
git add литсовет/src/export.js
git commit -m "feat(литсовет): EPUB — карта мира отдельной страницей + рефакторинг декодирования обложки"
```

---

### Task 6: EPUB — иллюстрации сцен как файлы в архиве

**Files:**
- Modify: `литсовет/src/export.js`

- [ ] **Шаг 1: Заменить сборку глав**

Найти `литсовет/src/export.js` (после Task 4/5 правок — искать по `const items=[], spine=[], nav=[];` и последующий `book.chapters.forEach(...)`):
```js
  const items=[], spine=[], nav=[];
  book.chapters.forEach((ch,i)=>{
    const id='ch'+(i+1), file='chapters/'+id+'.xhtml';
    const title = xesc(ch.title || ('Глава '+(i+1)));
    const body = (ch.title?`<h2>${title}</h2>`:'') + ch.scenes.map(sc=>paraXhtml(sc.text)).join('\n<hr/>\n');
    zip.add('OEBPS/'+file, `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title><link rel="stylesheet" href="../style.css"/></head><body>${body}</body></html>`);
    items.push(`<item id="${id}" href="${file}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
    nav.push(`<li><a href="${file}">${title}</a></li>`);
  });
```
Заменить на:
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

- [ ] **Шаг 2: Добавить `imageItems` в манифест**

Найти (уже изменённую в Task 5) строку манифеста:
```js
<item id="css" href="style.css" media-type="text/css"/>${coverItems}${mapItems}${items.join('')}</manifest>
```
Заменить на:
```js
<item id="css" href="style.css" media-type="text/css"/>${coverItems}${mapItems}${imageItems.join('')}${items.join('')}</manifest>
```

- [ ] **Шаг 3: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/export.js`
Expected: без вывода.

- [ ] **Шаг 4: Живая проверка**

На тестовом проекте с уже подставленным `state.illustrations.items` элементом `{type:'scene', sceneId:<id первой сцены с непустым text>, dataUrl:'data:image/png;base64,...'}`, экспортировать EPUB тем же приёмом (перехват click → ArrayBuffer → текстовый поиск подстрок в несжатом ZIP):
```js
const buf = await (await fetch(blobUrl)).arrayBuffer();
const raw = new TextDecoder('utf-8', {fatal:false}).decode(buf);
({
  hasSceneImageFile: raw.includes('ch1-img1'),
  hasImgTag: raw.includes('<img src="../images/ch1-img1'),
  manifestHasImageEntry: /item id="ch1-img1" href="images\/ch1-img1\.\w+" media-type="image\/\w+"/.test(raw),
})
```
Expected: все три `true`.

- [ ] **Шаг 5: Commit**

```bash
git add литсовет/src/export.js
git commit -m "feat(литсовет): EPUB — иллюстрации сцен встраиваются как файлы в архиве"
```

---

### Task 7: Финальная сквозная проверка

**Files:** нет изменений — только верификация.

- [ ] **Шаг 1: Полный синтаксис-проход**

```bash
node --input-type=module --check < литсовет/src/export.js && echo OK
```
Expected: `OK`.

- [ ] **Шаг 2: Живая сквозная проверка на реальном (не поддельном) наборе данных**

На свежем тестовом проекте: сгенерировать реальную маленькую структуру (1-2 главы, 2-3 сцены, дешёвый `targetWords`), написать хотя бы одну сцену по-настоящему (реальный вызов Прозаика — нужен непустой `text`, без которого `buildBook()` сцену не включит), сгенерировать через «Мир» настоящую карту (если жанр это поддерживает — иначе можно пропустить и явно отметить в отчёте, что карта не проверена на реальных данных, только на подставленных в Task 5), и — если реальный ключ провайдера картинок доступен в этом браузерном origin — сгенерировать одну настоящую иллюстрацию сцены и обложку через существующий UI («Иллюстрации» → «Предложить» → «Сгенерировать выбранные»); если ключа нет, переиспользовать тестовые dataUrl-заглушки из прошлых задач (это ПОЛНОСТЬЮ равноценная проверка САМОГО ВСТРАИВАНИЯ — код экспорта не отличает «настоящую» картинку от валидного тестового dataUrl, разница есть только в художественном качестве, которое здесь не проверяется).

Экспортировать все три формата (.md, .doc, .epub) с этим набором данных. Для каждого — подтвердить встраивание обложки+карты+иллюстрации сцены тем же приёмом перехвата `<a>.click`, что в предыдущих задачах. Дополнительно для EPUB: распаковать архив вручную (ZIP STORE, без сжатия — можно either через `preview_eval` вручную распарсить local file headers по сигнатуре `PK\x03\x04`, либо проще — скачать Blob и попросить пользователя/следующий шаг открыть в любой читалке; для целей автоматической проверки в этой задаче достаточно текстового поиска ожидаемых путей/тегов в сыром содержимом архива, как в предыдущих задачах — полноценный ZIP-парсер не нужен).

- [ ] **Шаг 3: Проверить, что старое поведение не сломалось**

Экспортировать все три формата на проекте БЕЗ иллюстраций/карты/обложки (пустые `state.illustrations.items`, `state.project.coverDataUrl` не задан) — подтвердить, что экспорт по-прежнему работает (текст глав/сцен присутствует), просто без картиночных блоков (никаких `<img>`/`![...]` там, где условие `if(illust)`/`if(mapItem)`/`if(state.project.coverDataUrl)` ложно). Это подтверждает, что вся фича полностью опциональна и не ломает существующий путь для проектов без иллюстраций.

- [ ] **Шаг 4: Отчёт**

Зафиксировать результат: что подтверждено на реальных данных, что — только на тестовых dataUrl-заглушках (и почему, если реального ключа для картинок не было), и подтверждение, что старое поведение (экспорт без иллюстраций) не регрессировало.

---

## Порядок выполнения

Все 7 задач правят один и тот же файл `литсовет/src/export.js` — строго последовательно: **1 → 2 → 3 → 4 → 5 → 6 → 7**. Задача 1 — фундамент (хелперы + `id` в `buildBook()`), от неё зависят 2, 3, 5, 6. Задача 4 (баг со `style.css`) должна пройти ДО задачи 6, потому что обе трогают один и тот же `forEach`-блок сборки глав EPUB, и Задача 6 в своём коде уже содержит ИСПРАВЛЕННУЮ ссылку (`../style.css`) — если бы порядок был обратным, потребовалось бы либо развести правки по разным строкам вручную, либо задача 6 конфликтовала бы с ещё не применённым фиксом. Задача 5 (карта мира + рефакторинг обложки) должна пройти ДО задачи 6, потому что задача 6 добавляет `imageItems` в ту же строку манифеста, которую задача 5 уже расширила до `${coverItems}${mapItems}${items.join('')}` — задаче 6 нужно видеть этот промежуточный вид строки, чтобы корректно вставить `imageItems` между `mapItems` и `items.join('')`.
