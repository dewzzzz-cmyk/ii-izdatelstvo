# Иллюстрации: порядок стадий, PDF, отображение в редакторе, автосохранение экспорта — дизайн

## Контекст

Продолжение работы над «Иллюстрациями» в «Литсовет» — по итогам живого теста (детская сказка с реальными ключами DeepSeek+Recraft) пользователь заметил три отдельные, но связанные проблемы с уже готовой фичей:

1. Стадия «Иллюстрации» стоит в навигации ПОСЛЕ «Редактура», хотя «Редактура» уже финализирует книгу (чтение целиком + экспорт) — иллюстрации логично готовить ДО финального прохода.
2. PDF-экспорт (кнопка `.pdf`, `литсовет/src/ui/stages.js:1525-1541`, функция `exportPdf`) не встраивает иллюстрации вообще — ни обложку, ни картинки сцен, в отличие от `.md`/`.doc`/EPUB (которые это уже делают, см. `литсовет/src/export.js`).
3. Иллюстрации, сгенерированные на стадии «Иллюстрации», нигде не видны во время работы с текстом — ни в «Написании» (`renderWrite`), ни в «Редактуре» (`renderEdit`, обе функции в `литсовет/src/ui/stages.js`) — только на отдельной вкладке-галерее.
4. (Отдельный, но связанный запрос) Экспортированные файлы сейчас просто скачиваются браузером через `<a download>` (`литсовет/src/export.js:90-93`) — пользователь хочет автосохранение в папку, с настраиваемым расположением и подпапкой по названию книги.

Все три findings по (1)-(3) подтверждены построчным чтением кода (см. отчёт агента-исследователя в этой сессии) — порядок стадий чисто косметический (`stageDone()` в `app.js` не завязан на позицию), функциональных зависимостей между стадиями Иллюстрации/Редактура нет.

## §1. Порядок стадий

`литсовет/src/ui/app.js:33-41`, массив `STAGES`:
```js
const STAGES = [
  { id:'concept',   label:'Концепция' },
  { id:'world',     label:'Мир' },
  { id:'voice',     label:'Голос' },
  { id:'structure', label:'Структура' },
  { id:'write',     label:'Написание' },
  { id:'edit',      label:'Редактура' },
  { id:'illustrations', label:'Иллюстрации' },
];
```
Меняется порядок последних двух:
```js
  { id:'write',     label:'Написание' },
  { id:'illustrations', label:'Иллюстрации' },
  { id:'edit',      label:'Редактура' },
```
`stageDone()` не трогается (не имеет кейсов для `write`/`edit`/`illustrations` — падает в `default: return false` независимо от позиции). Никакой другой код не хардкодит порядок (проверено — ни один "Дальше →" не таргетит `illustrations`).

## §2. PDF-экспорт со встроенными иллюстрациями

`exportPdf(s)` (`литсовет/src/ui/stages.js:1525-1541`) собирает HTML-строку и открывает её в новом окне с автовызовом `window.print()` — то есть реально это print-to-PDF через браузерный диалог печати, а не сгенерированный PDF-файл. Это НЕ меняется в этой фиче (переписывать генератор PDF с нуля — отдельный, намного больший проект: PDF-формат требует ручной раскладки текста и работы с бинарным форматом, в отличие от EPUB, где ZIP+XHTML отдаются браузеру/читалке для рендеринга). Печать через диалог печати уже даёт пользователю выбор папки сохранения через нативный UI браузера — часть задачи "выбрать куда сохранить" для PDF уже решена существующим механизмом.

Что добавляется — embedding изображений в HTML перед печатью, тем же паттерном, что уже используют `exportDocx`/`exportMd` (`литсовет/src/export.js`, функции `illustrationForScene`/`worldMapItem`, не экспортируются из модуля — логика инлайнится прямо в `exportPdf`, т.к. `stages.js` не импортирует приватные хелперы `export.js`):

```js
function exportPdf(s){
  const title = esc(s.project.title||'Книга');
  const nodes = s.structure||[];
  const items = s.illustrations?.items || [];
  const illustrationForScene = (sceneId)=>{ const it=items.find(i=>i.type==='scene' && i.sceneId===sceneId); return it?it.dataUrl:null; };
  const mapItem = items.find(i=>i.type==='map') || null;
  let body='';
  if(mapItem) body += `<div class="pdf-img"><img src="${mapItem.dataUrl}"></div>`;
  nodes.forEach(n=>{
    if(n.type==='chapter') body+=`<h2>${esc(n.title)}</h2>`;
    else if(n.type==='scene'&&n.text){
      const illust = illustrationForScene(n.id);
      body+=`<div class="scene">${illust?`<div class="pdf-img"><img src="${illust}"></div>`:''}<h3>${esc(n.title)}</h3><div class="prose">${n.text.split('\n\n').map(p=>`<p>${esc(p.trim())}</p>`).filter(p=>p!=='<p></p>').join('')}</div></div>`;
    }
  });
  const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title><style>
    @page{margin:2cm 2.5cm}body{font-family:Georgia,serif;font-size:12pt;line-height:1.7;color:#111;max-width:680px;margin:0 auto}
    h1{font-size:22pt;text-align:center;margin:3cm 0 1cm}h2{font-size:16pt;margin:2cm 0 .5cm;border-bottom:1px solid #ccc;padding-bottom:.3cm}
    h3{font-size:12pt;font-weight:normal;font-style:italic;color:#555;margin:.8cm 0 .2cm}.prose p{text-indent:1.5em;margin:.15em 0}
    .prose p:first-child{text-indent:0}.pdf-img{text-align:center;margin:.5cm 0}.pdf-img img{max-width:100%;max-height:22cm}
    @media print{h2{page-break-before:always}}
  </style></head><body><h1>${title}</h1>
  ${s.project.coverDataUrl?`<div class="pdf-img" style="margin:0 0 1.5cm">\n<img src="${s.project.coverDataUrl}" style="max-height:26cm"></div>`:''}
  ${s.project.author?`<p style="text-align:center;font-style:italic;margin:-.5cm 0 1.5cm">${esc(s.project.author)}</p>`:''}${body}<script>window.onload=()=>window.print()<\/script></body></html>`;
  const w=window.open('','_blank'); if(!w) return;
  w.document.write(html); w.document.close();
}
```
(Обложка идёт первой страницей, до заголовка — большая, во весь лист; карта мира — сразу после заголовка/обложки, до первой главы; иллюстрация сцены — сразу перед текстом сцены, тем же паттерном, что уже в `.md`/`.doc`.)

## §3. Иллюстрации видны в «Написании» и «Редактуре»

### 3.1 `renderEdit` (`литсовет/src/ui/stages.js:1545-1609`) — книга целиком с картинками

Это ближе всего к «предпросмотру готовой книги» — тут добавляется то же самое, что уже идёт в экспорт: обложка перед текстом, карта мира после обложки, иллюстрация сцены перед её текстом. Строка 1560 (сборка `body`):
```js
// было:
else if(n.type==='scene' && n.text) body+=`<div class="read-scene" id="read-${n.id}"><div class="read-scene-t">${esc(n.title)}</div><div class="read-prose">${esc(n.text)}</div></div>`;
```
заменяется на версию, инлайнящую иллюстрацию сцены (тот же `illustrationForScene`-паттерн, что и в PDF выше — приватная функция объявляется один раз в начале `renderEdit`, используется и для body, и переиспользуется как есть, без экспорта из модуля):
```js
else if(n.type==='scene' && n.text){
  const illust = illustrationForScene(n.id);
  body+=`<div class="read-scene" id="read-${n.id}">${illust?`<img class="read-illust" src="${illust}" alt="${esc(n.title)}">`:''}<div class="read-scene-t">${esc(n.title)}</div><div class="read-prose">${esc(n.text)}</div></div>`;
}
```
Перед циклом (до `nodes.forEach`) добавляется обложка/карта мира — перед всем текстом:
```js
let body='';
if(s.project.coverDataUrl) body += `<div class="read-cover"><img src="${s.project.coverDataUrl}" alt="Обложка"></div>`;
const mapItem = (s.illustrations?.items||[]).find(i=>i.type==='map');
if(mapItem) body += `<div class="read-cover"><img src="${mapItem.dataUrl}" alt="Карта мира"></div>`;
```
CSS-классы `.read-illust`/`.read-cover` — новые, добавляются в `литсовет/styles.css` (или существующий CSS-файл проекта, найти по факту его расположения): `max-width:100%; border-radius: var(--radius); margin-bottom: 12px;` — тот же визуальный язык, что и в галерее `ui/illustrations.js`.

### 3.2 `renderWrite` (`литсовет/src/ui/stages.js:1104-1287`) — миниатюра текущей сцены при написании

В `renderWrite`, рядом с заголовком сцены (там же, где сейчас `«Сцена» / <название> / ↶ / ↷`), если у текущей сцены уже есть сгенерированная иллюстрация — показать маленькую миниатюру (клик — открыть в полный размер, простейший вариант: `<img>` с `onclick` → открыть в новой вкладке через `window.open(dataUrl)`, без отдельного модального окна ради простоты). Если иллюстрации ещё нет — ничего не показывать (не место предлагать генерацию — это остаётся эксклюзивно за стадией «Иллюстрации», чтобы не размывать единственную точку, где тратятся деньги на картинки, см. существующий комментарий в `illustrations.js`: "Деньги тратятся ТОЛЬКО по явному клику автора").

## §4. Автосохранение экспортов в папку (общий helper для всех Blob-based форматов)

### 4.1 Область действия

Применяется к `.md`/`.doc`/`.epub`/`.json` (все используют `download()` в `литсовет/src/export.js:90-93`, отдают `Blob`). НЕ применяется к `.pdf` — тот экспортируется через диалог печати браузера (`window.print()`), который уже сам даёт пользователю нативный выбор папки сохранения; технически недоступен для программной записи в произвольную папку (печать — не `Blob`, JS не управляет её результатом).

### 4.2 Механизм: File System Access API с фолбэком

Современные Chromium-браузеры (Chrome, Edge, Opera — НЕ Firefox/Safari) поддерживают `window.showDirectoryPicker()`: пользователь один раз выбирает папку, приложение получает `FileSystemDirectoryHandle`, который можно сохранить (структурно клонируемый объект, хранимый в IndexedDB как обычное значение) и переиспользовать между сессиями (с повторным запросом разрешения через `handle.queryPermission()`/`requestPermission()`, т.к. браузер не помнит разрешение вечно без переспроса).

Существующее хранилище `литсовет/src/storage.js` уже имеет универсальный key-value `META`-стор (`getMeta(key)`/`setMeta(key, value)`) — ключ хендла папки не проектный (не относится к конкретной книге), поэтому хранится там же, под новым ключом `'exportDirHandle'`, без изменений схемы БД.

### 4.3 Новый файл `литсовет/src/exportFolder.js`

Изолирует всю File-System-Access-логику от остального `export.js` (которое остаётся platform-agnostic, просто отдаёт `Blob`):
```js
// Автосохранение экспортов в выбранную пользователем папку (File System Access
// API — только Chromium-браузеры). При отсутствии поддержки/выбранной папки/
// разрешения — вызывающий код молча падает на обычный <a download> (см.
// export.js: download()). Папка хендла — НЕ проектные данные (не книга, не
// сцена), поэтому в общем META-сторе storage.js, не в state проекта.

import { getMeta, setMeta } from './storage.js';

export function fsApiSupported(){
  return typeof window!=='undefined' && typeof window.showDirectoryPicker==='function';
}

export async function pickExportFolder(){
  if(!fsApiSupported()) throw new Error('Браузер не поддерживает выбор папки (доступно в Chrome/Edge).');
  const handle = await window.showDirectoryPicker({ mode:'readwrite' });
  await setMeta('exportDirHandle', handle);
  return handle;
}

export async function clearExportFolder(){
  await setMeta('exportDirHandle', null);
}

export async function getExportFolderName(){
  if(!fsApiSupported()) return null;
  const handle = await getMeta('exportDirHandle');
  return handle ? handle.name : null;
}

// Возвращает true, если реально записали файл в выбранную папку (подпапка —
// санитизированное название книги); false — вызывающий код должен упасть на
// обычный download().
export async function trySaveToFolder(blob, filename, bookTitle){
  if(!fsApiSupported()) return false;
  const rootHandle = await getMeta('exportDirHandle');
  if(!rootHandle) return false;
  try{
    let perm = await rootHandle.queryPermission({mode:'readwrite'});
    if(perm!=='granted') perm = await rootHandle.requestPermission({mode:'readwrite'});
    if(perm!=='granted') return false;
    const safeTitle = (bookTitle||'Книга').replace(/[\\/:*?"<>|]/g,'_').trim().slice(0,100) || 'Книга';
    const bookDir = await rootHandle.getDirectoryHandle(safeTitle, {create:true});
    const fileHandle = await bookDir.getFileHandle(filename, {create:true});
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  }catch(e){
    console.warn('Автосохранение в папку не удалось, использую обычное скачивание:', e);
    return false;
  }
}
```

### 4.4 `литсовет/src/export.js` — `download()` пробует папку первой

```js
import { trySaveToFolder } from './exportFolder.js';

async function download(blob, filename, bookTitle){
  const saved = await trySaveToFolder(blob, filename, bookTitle);
  if(saved) return;
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}
```
`download()` становится `async` — четыре вызывающих места (`exportMd`, `exportDocx`, `exportEpub`, `exportJson`) добавляют `await` перед вызовом и сами становятся `async function` (были синхронными). Каждый вызов `download(...)` дополнительно передаёт `book.title` (уже вычисляется в каждой из функций через `buildBook(state)` — четвёртым аргументом идёт `book.title`).

Кнопки-обработчики в `renderEdit` (`stages.js:1579-1583`) не меняют сигнатуру (`onclick=()=>exportMd(s)` продолжает работать с `async`-функцией — промис просто не ожидается вызывающей стороной, что нормально для fire-and-forget обработчика клика).

### 4.5 Настройки (⚙) — новая секция «Экспорт»

`литсовет/src/ui/app.js`, `openSettings()` (строки ~179-277) — новая `<div class="settings-section">Экспорт</div>` между секциями «Иллюстрации» (строка 248) и «Мои книги» (строка 267):
```js
<div class="settings-section">Экспорт</div>
${fsApiSupported() ? `
  <div class="field"><label>Папка для сохранения <span class="hint">по умолчанию — обычная папка загрузок браузера; можно выбрать отдельную папку, книги сохраняются в подпапку по названию</span></label>
    <div class="row" style="gap:8px;align-items:center">
      <span class="muted" id="exportFolderName" style="flex:1;font-size:12px">Загружаю…</span>
      <button class="btn" id="pickExportFolder" type="button">Выбрать папку…</button>
      <button class="btn" id="clearExportFolder" type="button">Сбросить</button>
    </div>
  </div>
` : `<div class="hint">Выбор папки для сохранения доступен в Chrome/Edge — здесь файлы скачиваются как обычно.</div>`}
```
(`fsApiSupported` импортируется из `exportFolder.js`.) После вставки модалки в DOM — асинхронно подставить реальное имя папки (`getExportFolderName()`) в `#exportFolderName` (по аналогии с уже существующим паттерном асинхронной загрузки `projects` в начале `openSettings()`), обработчики `#pickExportFolder`/`#clearExportFolder` вызывают `pickExportFolder()`/`clearExportFolder()` и обновляют текст (с обработкой отказа пользователя в диалоге выбора — `catch` молча не считается ошибкой, юзер мог просто закрыть диалог).

## §5. Побочная мелкая правка (найдено по ходу, не отдельная фича)

`литсовет/src/ui/app.js:255` — опция Recraft в настройках подписана «менее проверено», «точный формат имени модели неподтверждён»: это было верно ДО этой сессии — в этой же сессии модель `recraftv4_1` подтверждена реальным вызовом (см. память проекта). Строка обновляется до нейтральной подписи без пометки "неподтверждено":
```js
// было:
<option value="recraft"${s.illustrations?.provider==='recraft'?' selected':''} title="Менее проверенная интеграция — точный формат имени модели неподтверждён">Recraft V4.1 (менее проверено)</option>
// станет:
<option value="recraft"${s.illustrations?.provider==='recraft'?' selected':''}>Recraft V4.1</option>
```

## Проверка

Как и для всех предыдущих фич — нет тестового фреймворка. `node --input-type=module --check` на каждый изменённый файл + живая проверка через `mcp__Claude_Preview__*` на реально запущенном сервере: (а) визуально подтвердить новый порядок вкладок; (б) сгенерировать PDF на проекте с обложкой+иллюстрациями сцен, подтвердить картинки в открывшемся окне печати; (в) на «Редактуре» подтвердить обложку/карту/иллюстрации сцен видны инлайн; (г) на «Написании» подтвердить миниатюра текущей сцены показывается, если иллюстрация есть; (д) выбрать тестовую папку через `showDirectoryPicker` (доступно только в реальном интерактивном контексте — если недоступно программно через `preview_eval`/headless-автоматизацию, проверить хотя бы: `fsApiSupported()` возвращает true/false корректно в зависимости от браузера, `trySaveToFolder()` корректно возвращает `false` и падает на обычный download при отсутствии выбранной папки — это можно проверить без реального диалога).
