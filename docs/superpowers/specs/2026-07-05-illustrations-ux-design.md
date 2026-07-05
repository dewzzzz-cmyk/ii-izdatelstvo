# Иллюстрации: порядок стадий, PDF, отображение в редакторе — дизайн

## Контекст

Продолжение работы над «Иллюстрациями» в «Литсовет» — по итогам живого теста (детская сказка с реальными ключами DeepSeek+Recraft) пользователь заметил три отдельные, но связанные проблемы с уже готовой фичей:

1. Стадия «Иллюстрации» стоит в навигации ПОСЛЕ «Редактура», хотя «Редактура» уже финализирует книгу (чтение целиком + экспорт) — иллюстрации логично готовить ДО финального прохода.
2. PDF-экспорт (кнопка `.pdf`, `литсовет/src/ui/stages.js:1525-1541`, функция `exportPdf`) не встраивает иллюстрации вообще — ни обложку, ни картинки сцен, в отличие от `.md`/`.doc`/EPUB (которые это уже делают, см. `литсовет/src/export.js`).
3. Иллюстрации, сгенерированные на стадии «Иллюстрации», нигде не видны во время работы с текстом — ни в «Написании» (`renderWrite`), ни в «Редактуре» (`renderEdit`, обе функции в `литсовет/src/ui/stages.js`) — только на отдельной вкладке-галерее.

Все три findings подтверждены построчным чтением кода (см. отчёт агента-исследователя в этой сессии) — порядок стадий чисто косметический (`stageDone()` в `app.js` не завязан на позицию), функциональных зависимостей между стадиями Иллюстрации/Редактура нет.

**Отдельный запрос пользователя, вынесенный за рамки этой спеки:** автосохранение экспортов в папку (настраиваемое расположение + подпапка по названию книги). Ревью этой спеки (см. историю сессии) указало, что это самая новая/рискованная технически часть (File System Access API, новый файл, новое хранимое значение в IndexedDB, новый раздел настроек) — по объёму сопоставима с любой из уже сделанных сегодня отдельных под-фич (`illustrations-export`, `illustrations-style-count`), и по установленному в этом же проекте паттерну декомпозиции («сначала одно, потом отдельным циклом другое» — см. `docs/superpowers/specs/2026-07-05-illustrations-export-design.md:7`) должна получить свою отдельную спеку+план СЛЕДУЮЩИМ циклом, после того как эта (меньшая, теснее связанная) партия смёржится.

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

Мобильная раскладка: `.scene-bar` (`stages.js` около строки 1132, стили `styles.css:116`) — уже плотный flex-ряд с заголовком/бейджами/кнопками, мобильный брейкпоинт `styles.css:467` (767px). Миниатюра должна быть маленькой фиксированного размера (например `32×32px`, `border-radius`, `flex-shrink:0`) — не растягиваться и не ломать перенос строк в этом ряду ни на десктопе, ни на мобильном; если на очень узких экранах ряд и так переносится — миниатюра переносится вместе с остальными элементами, отдельного мобильного кейса не требуется.

## §4. Побочные мелкие правки (найдено по ходу, не отдельные фичи)

### 4.1 Стадия «Иллюстрации» в панели «Этапы производства»

Отдельный от `STAGES`(`app.js`)/`stageDone()` список — `STAGE_LABELS` (`литсовет/src/ui/stages.js:1482`) и `stageDoneFor()` (`stages.js:1715-1723`), используются `renderRoadmap()` для панели «Этапы производства» (правая панель «Написания» и «Редактуры»). Сейчас список не включает `illustrations` вообще:
```js
// было:
const STAGE_LABELS = [['concept','Концепция'],['voice','Голос'],['structure','Структура'],['write','Написание'],['edit','Редактура']];
```
Добавляется запись в порядке, согласованном с новым порядком `STAGES` из §1 (после `write`, перед `edit`):
```js
const STAGE_LABELS = [['concept','Концепция'],['voice','Голос'],['structure','Структура'],['write','Написание'],['illustrations','Иллюстрации'],['edit','Редактура']];
```
`stageDoneFor()` получает кейс для `illustrations` (по аналогии с остальными — простая проверка «есть ли что показать»):
```js
function stageDoneFor(s,id){
  switch(id){
    case 'concept': return !!(s.project.idea||s.project.title);
    case 'voice': return (s.voice.examples||[]).length>0;
    case 'structure': return (s.structure||[]).some(n=>n.type==='scene');
    case 'write': return (s.structure||[]).filter(n=>n.type==='scene').some(n=>n.status==='done');
    case 'illustrations': return (s.illustrations?.items||[]).length>0;
    default: return false;
  }
}
```
(`voice`/`world` в `STAGE_LABELS` условно видимы только когда включены — та же логика, что уже применяется к `STAGES` в `app.js:66-70`, здесь не меняется, т.к. `renderRoadmap` не фильтрует список по видимости стадий — это существующее поведение, вне рамок этой правки.)

### 4.2 Recraft «неподтверждено» — два места, оба стали неактуальны

`литсовет/src/ui/app.js:255` — опция Recraft в настройках подписана «менее проверено», «точный формат имени модели неподтверждён»: это было верно ДО этой сессии — в этой же сессии модель `recraftv4_1` подтверждена реальным вызовом (см. память проекта). Строка обновляется до нейтральной подписи без пометки "неподтверждено":
```js
// было:
<option value="recraft"${s.illustrations?.provider==='recraft'?' selected':''} title="Менее проверенная интеграция — точный формат имени модели неподтверждён">Recraft V4.1 (менее проверено)</option>
// станет:
<option value="recraft"${s.illustrations?.provider==='recraft'?' selected':''}>Recraft V4.1</option>
```
Такая же по смыслу устаревшая заметка есть и в `литсовет/src/imagegen.js:19-24` (комментарий над `MODEL_OPTIONS`, поясняющий выбор `recraftv4_1` с подчёркиванием как «более авторитетного» варианта из-за отсутствия ключа для проверки на момент написания). Комментарий переписывается, чтобы отражать факт: имя модели подтверждено живым вызовом в этой сессии, `recraftv4_1` — рабочий вариант, no longer a guess.

## Проверка

Как и для всех предыдущих фич — нет тестового фреймворка. `node --input-type=module --check` на каждый изменённый файл + живая проверка через `mcp__Claude_Preview__*` на реально запущенном сервере: (а) визуально подтвердить новый порядок вкладок (и в верхней навигации, и в панели «Этапы производства»); (б) сгенерировать PDF на проекте с обложкой+иллюстрациями сцен, подтвердить картинки в открывшемся окне печати; (в) на «Редактуре» подтвердить обложку/карту/иллюстрации сцен видны инлайн; (г) на «Написании» подтвердить миниатюра текущей сцены показывается, если иллюстрация есть, и не ломает раскладку `.scene-bar`; (д) подтвердить, что панель «Этапы производства» показывает «Иллюстрации» с корректным индикатором готовности (есть хотя бы одна картинка → галочка).
