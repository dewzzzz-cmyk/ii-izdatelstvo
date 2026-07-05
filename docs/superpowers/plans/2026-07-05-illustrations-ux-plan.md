# Иллюстрации: порядок стадий, PDF, отображение в редакторе — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Стадия «Иллюстрации» переезжает перед «Редактурой» в навигации; PDF-экспорт и оба текстовых редактора («Написание», «Редактура») показывают уже сгенерированные иллюстрации (обложку, карту мира, картинки сцен) вместо того, чтобы прятать их на отдельной вкладке-галерее.

**Архитектура:** Все правки — в уже существующих файлах, без новых модулей и без изменений схемы состояния (`state.illustrations.items[]` уже содержит всё нужное). Паттерн встраивания картинки — везде один и тот же (`items.find(i=>i.type==='scene' && i.sceneId===id)`), уже трижды использован в `export.js` (`.md`/`.doc`/EPUB) — здесь просто применяется ещё в трёх местах (`exportPdf`, `renderEdit`, `renderWrite`).

**Tech Stack:** Vanilla JS (ES-модули), без сборщика и фреймворка.

**Спека:** `docs/superpowers/specs/2026-07-05-illustrations-ux-design.md` (одобрена двумя раундами ревью — все ссылки на код проверены построчно против репозитория).

**Как проверять каждый шаг:** нет тестового фреймворка (zero-dependency приложение). Проверка — `node --input-type=module --check < file.js` на синтаксис сразу после правки, и **живая проверка через `mcp__Claude_Preview__*`** на реально запущенном сервере (`node server.js`, конфиг `litsovet-illustrations-ux`, порт 8794). ⚠ Эта запись — в `.claude/launch.json` **корня сессии** (`C:\Users\user\Documents\webar-main\издательство\.claude\launch.json`), НЕ в копии этого файла внутри самого worktree — `preview_start` разрешает относительные пути конфига относительно рабочей директории сессии, а не текущего worktree. Копия `.claude/launch.json` внутри worktree может быть устаревшей (не содержать эту запись, если правка в неё попала в корень сессии уже после создания worktree) — это ожидаемо и не баг, ориентироваться нужно на файл в корне сессии.

---

### Task 1: `app.js` — порядок стадий

**Files:**
- Modify: `литсовет/src/ui/app.js`

- [ ] **Шаг 1: Поменять местами `edit` и `illustrations` в `STAGES`**

Найти `литсовет/src/ui/app.js:33-41`:
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
Заменить на:
```js
const STAGES = [
  { id:'concept',   label:'Концепция' },
  { id:'world',     label:'Мир' },
  { id:'voice',     label:'Голос' },
  { id:'structure', label:'Структура' },
  { id:'write',     label:'Написание' },
  { id:'illustrations', label:'Иллюстрации' },
  { id:'edit',      label:'Редактура' },
];
```

- [ ] **Шаг 2: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/ui/app.js`
Expected: без вывода.

- [ ] **Шаг 3: Живая проверка**

На запущенном сервере — открыть любой проект, через `mcp__Claude_Preview__preview_snapshot` подтвердить порядок кнопок в верхней навигации: `Концепция → [Мир] → [Голос] → Структура → Написание → Иллюстрации → Редактура` (Мир/Голос показываются только если включены в проекте — это не меняется).

- [ ] **Шаг 4: Commit**

```bash
git add литсовет/src/ui/app.js
git commit -m "feat(литсовет): переставить «Иллюстрации» перед «Редактурой» в навигации"
```

---

### Task 2: `ui/stages.js` — иллюстрации во встроенном PDF-экспорте

**Files:**
- Modify: `литсовет/src/ui/stages.js`

- [ ] **Шаг 1: Встроить обложку/карту мира/иллюстрации сцен в `exportPdf`**

Найти `литсовет/src/ui/stages.js:1525-1541` (функция целиком):
```js
function exportPdf(s){
  const title = esc(s.project.title||'Книга');
  const nodes = s.structure||[];
  let body='';
  nodes.forEach(n=>{
    if(n.type==='chapter') body+=`<h2>${esc(n.title)}</h2>`;
    else if(n.type==='scene'&&n.text) body+=`<div class="scene"><h3>${esc(n.title)}</h3><div class="prose">${n.text.split('\n\n').map(p=>`<p>${esc(p.trim())}</p>`).filter(p=>p!=='<p></p>').join('')}</div></div>`;
  });
  const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title><style>
    @page{margin:2cm 2.5cm}body{font-family:Georgia,serif;font-size:12pt;line-height:1.7;color:#111;max-width:680px;margin:0 auto}
    h1{font-size:22pt;text-align:center;margin:3cm 0 1cm}h2{font-size:16pt;margin:2cm 0 .5cm;border-bottom:1px solid #ccc;padding-bottom:.3cm}
    h3{font-size:12pt;font-weight:normal;font-style:italic;color:#555;margin:.8cm 0 .2cm}.prose p{text-indent:1.5em;margin:.15em 0}
    .prose p:first-child{text-indent:0}@media print{h2{page-break-before:always}}
  </style></head><body><h1>${title}</h1>${s.project.author?`<p style="text-align:center;font-style:italic;margin:-.5cm 0 1.5cm">${esc(s.project.author)}</p>`:''}${body}<script>window.onload=()=>window.print()<\/script></body></html>`;
  const w=window.open('','_blank'); if(!w) return;
  w.document.write(html); w.document.close();
}
```
Заменить на:
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
(Порядок: обложка — во весь лист перед заголовком/автором; карта мира — сразу после заголовка/автора, до первой главы; иллюстрация сцены — сразу перед текстом сцены.)

- [ ] **Шаг 2: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/ui/stages.js`
Expected: без вывода.

- [ ] **Шаг 3: Живая проверка**

На проекте с обложкой + хотя бы одной иллюстрацией сцены (например, тестовый проект «Ёжик, который боялся темноты» из этой же сессии, если он ещё в IndexedDB этого браузерного origin — иначе сгенерировать новый минимальный набор через реальный вызов Recraft/иного провайдера, если ключ есть, или через прямой вызов `generateIllustrationFor` в `preview_eval`, как делалось раньше в этой сессии): на «Редактуре» (или где сейчас находится кнопка `.pdf` — после Task 1 кнопки экспорта остаются в «Редактуре») нажать `.pdf`, дождаться открытия нового окна (браузер может заблокировать `window.open` как всплывающее окно — если так, разрешить попапы для локального сервера перед проверкой). Через `preview_eval` (или прямой DOM-запрос к новому окну, если инструмент это поддерживает) подтвердить, что HTML содержит `<img src="data:image` хотя бы дважды (обложка + иллюстрация сцены). Если открыть окно программно не получится — как минимум вызвать саму функцию сборки HTML напрямую (временно экспортировав её или скопировав тело в `preview_eval` с реальным `state`) и проверить итоговую строку на наличие `<img src="${s.project.coverDataUrl}"` и `<div class="pdf-img">`.

- [ ] **Шаг 4: Commit**

```bash
git add литсовет/src/ui/stages.js
git commit -m "feat(литсовет): PDF-экспорт — встроить обложку, карту мира и иллюстрации сцен"
```

---

### Task 3: `ui/stages.js` + `styles.css` — иллюстрации видны в «Редактуре» (`renderEdit`)

**Files:**
- Modify: `литсовет/src/ui/stages.js`
- Modify: `литсовет/styles.css`

- [ ] **Шаг 1: Обложка и карта мира перед текстом книги**

⚠ Номер строки (1557) актуален только ДО применения Task 2 (Task 2 добавляет 6 строк внутрь `exportPdf`, который идёт выше `renderEdit` в файле — всё, что ниже, сдвигается на +6). Искать нужно по цитируемому коду ниже, а не по номеру строки.

Найти `литсовет/src/ui/stages.js:1557` (начало сборки `body` в `renderEdit`):
```js
  let body='';
  nodes.forEach(n=>{
    if(n.type==='chapter') body+=`<h2 class="read-ch">${esc(n.title)}</h2>`;
    else if(n.type==='scene' && n.text) body+=`<div class="read-scene" id="read-${n.id}"><div class="read-scene-t">${esc(n.title)}</div><div class="read-prose">${esc(n.text)}</div></div>`;
  });
```
Заменить на:
```js
  const illustrationForScene = (sceneId)=>{ const it=(s.illustrations?.items||[]).find(i=>i.type==='scene' && i.sceneId===sceneId); return it?it.dataUrl:null; };
  let body='';
  if(s.project.coverDataUrl) body += `<div class="read-cover"><img src="${s.project.coverDataUrl}" alt="Обложка"></div>`;
  const mapItem = (s.illustrations?.items||[]).find(i=>i.type==='map');
  if(mapItem) body += `<div class="read-cover"><img src="${mapItem.dataUrl}" alt="Карта мира"></div>`;
  nodes.forEach(n=>{
    if(n.type==='chapter') body+=`<h2 class="read-ch">${esc(n.title)}</h2>`;
    else if(n.type==='scene' && n.text){
      const illust = illustrationForScene(n.id);
      body+=`<div class="read-scene" id="read-${n.id}">${illust?`<img class="read-illust" src="${illust}" alt="${esc(n.title)}">`:''}<div class="read-scene-t">${esc(n.title)}</div><div class="read-prose">${esc(n.text)}</div></div>`;
    }
  });
```

- [ ] **Шаг 2: Добавить CSS-классы `.read-illust`/`.read-cover`**

Найти `литсовет/styles.css:61-64`:
```css
.read-ch{font-size:20px;font-weight:600;margin:28px 0 14px;text-align:center}
.read-scene{margin-bottom:18px}
.read-scene-t{font-size:11px;color:var(--text-3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px}
.read-prose{font-size:15px;line-height:1.8;white-space:pre-wrap}
```
Заменить на (добавлены две новые строки после `.read-ch`):
```css
.read-ch{font-size:20px;font-weight:600;margin:28px 0 14px;text-align:center}
.read-cover{text-align:center;margin-bottom:24px}
.read-cover img{max-width:100%;max-height:480px;border-radius:var(--radius)}
.read-illust{display:block;max-width:100%;border-radius:var(--radius);margin-bottom:12px}
.read-scene{margin-bottom:18px}
.read-scene-t{font-size:11px;color:var(--text-3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px}
.read-prose{font-size:15px;line-height:1.8;white-space:pre-wrap}
```

- [ ] **Шаг 3: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/ui/stages.js`
Expected: без вывода. (`styles.css` не JS — синтаксис не проверяется этой командой, только визуально на шаге 4.)

- [ ] **Шаг 4: Живая проверка**

На том же тестовом проекте (обложка + иллюстрации сцен) — открыть «Редактуру», через `mcp__Claude_Preview__preview_screenshot` (десктопная ширина, `preview_resize` при необходимости — см. заметку в истории сессии про мобильный вьюпорт по умолчанию в этом инструменте) подтвердить: обложка видна над текстом книги, иллюстрации сцен видны перед текстом каждой сцены. Через `preview_eval` дополнительно подтвердить программно: `document.querySelectorAll('.read-illust').length` и `document.querySelectorAll('.read-cover').length` больше 0, и что `img.complete && img.naturalWidth>0` для каждой (не битые/незагруженные картинки).

- [ ] **Шаг 5: Commit**

```bash
git add литсовет/src/ui/stages.js литсовет/styles.css
git commit -m "feat(литсовет): «Редактура» — показывать обложку, карту мира и иллюстрации сцен инлайн"
```

---

### Task 4: `ui/stages.js` + `styles.css` — миниатюра иллюстрации при написании (`renderWrite`)

**Files:**
- Modify: `литсовет/src/ui/stages.js`
- Modify: `литсовет/styles.css`

- [ ] **Шаг 1: Миниатюра рядом с заголовком сцены**

Найти `литсовет/src/ui/stages.js:1131-1136` (начало `.scene-bar` внутри `renderWrite`):
```js
    <div class="scene-bar">
      <span class="scene-tag" data-tip="${scene.sceneType==='sequel'?'Секвель: реакция героя → дилемма → решение. Меньше внешнего действия, передышка после потрясения.':'Сцена: цель героя → конфликт → поражение/осложнение. Растущее напряжение.'}">${scene.sceneType==='sequel'?'↺ Секвель':'Сцена'}</span>
      <span class="scene-title">${esc(scene.title)}</span>
      ${scene.stale?'<span class="stale-badge" title="сцена выше изменилась — проверьте, не противоречит ли">⚠ возможно устарела</span>':''}
      ${scene.handDone?'<span class="hand-badge" title="абзац переписан автором">✍ рука автора</span>':''}
```
Заменить на (добавлена одна строка после `.scene-title`):
```js
    <div class="scene-bar">
      <span class="scene-tag" data-tip="${scene.sceneType==='sequel'?'Секвель: реакция героя → дилемма → решение. Меньше внешнего действия, передышка после потрясения.':'Сцена: цель героя → конфликт → поражение/осложнение. Растущее напряжение.'}">${scene.sceneType==='sequel'?'↺ Секвель':'Сцена'}</span>
      <span class="scene-title">${esc(scene.title)}</span>
      ${(()=>{ const it=(s.illustrations?.items||[]).find(i=>i.type==='scene' && i.sceneId===scene.id); return it?`<img class="scene-thumb" src="${it.dataUrl}" alt="Иллюстрация сцены" data-tip="Иллюстрация сцены — клик открывает в полный размер" id="sceneThumb">`:''; })()}
      ${scene.stale?'<span class="stale-badge" title="сцена выше изменилась — проверьте, не противоречит ли">⚠ возможно устарела</span>':''}
      ${scene.handDone?'<span class="hand-badge" title="абзац переписан автором">✍ рука автора</span>':''}
```

- [ ] **Шаг 2: Обработчик клика — открыть в полный размер**

⚠ Номера строк 1220-1222 актуальны только ДО Шага 1 этой же задачи (Шаг 1 добавляет строку в шаблон выше, сдвигая всё, что ниже, включая этот участок, на +1). Искать по цитируемому коду, не по номеру строки.

Найти `литсовет/src/ui/stages.js:1219-1222` (комментарий + привязка `edUndo`/`edRedo`, единственное такое место в файле):
```js
  // Undo/redo ТЕКСТА в редакторе (правки рукой) — нативная история contenteditable
  const edU=document.getElementById('edUndo'), edR=document.getElementById('edRedo');
  if(edU) edU.onclick=()=>{ const ed=document.getElementById('editor'); if(ed){ ed.focus(); document.execCommand('undo'); scene.text=ed.innerText; scene._dirty=true; } };
  if(edR) edR.onclick=()=>{ const ed=document.getElementById('editor'); if(ed){ ed.focus(); document.execCommand('redo'); scene.text=ed.innerText; scene._dirty=true; } };
```
Заменить на (добавлен блок после `edR.onclick`):
```js
  // Undo/redo ТЕКСТА в редакторе (правки рукой) — нативная история contenteditable
  const edU=document.getElementById('edUndo'), edR=document.getElementById('edRedo');
  if(edU) edU.onclick=()=>{ const ed=document.getElementById('editor'); if(ed){ ed.focus(); document.execCommand('undo'); scene.text=ed.innerText; scene._dirty=true; } };
  if(edR) edR.onclick=()=>{ const ed=document.getElementById('editor'); if(ed){ ed.focus(); document.execCommand('redo'); scene.text=ed.innerText; scene._dirty=true; } };

  const sceneThumb = document.getElementById('sceneThumb');
  if(sceneThumb) sceneThumb.onclick = ()=>{ const w = window.open(); if(w) w.document.write(`<img src="${sceneThumb.src}" style="max-width:100%">`); };
```

- [ ] **Шаг 3: CSS для `.scene-thumb`**

Найти `литсовет/styles.css:116-118`:
```css
.scene-bar{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--border)}
.scene-tag{font-size:11px;background:var(--accent-bg);color:var(--accent);border-radius:10px;padding:2px 9px;font-weight:500}
.scene-title{font-size:14px;font-weight:500}
```
Заменить на (добавлена одна строка):
```css
.scene-bar{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--border)}
.scene-tag{font-size:11px;background:var(--accent-bg);color:var(--accent);border-radius:10px;padding:2px 9px;font-weight:500}
.scene-title{font-size:14px;font-weight:500}
.scene-thumb{width:32px;height:32px;object-fit:cover;border-radius:var(--radius);cursor:pointer;flex-shrink:0}
```
(`flex-shrink:0` — миниатюра не сжимается, если ряд `.scene-bar` не помещается по ширине; на узких экранах ряд переносится целиком вместе с остальными элементами, как и сейчас с кнопками/бейджами — отдельного мобильного брейкпоинта не требуется, см. спеку §3.2.)

- [ ] **Шаг 4: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/ui/stages.js`
Expected: без вывода.

- [ ] **Шаг 5: Живая проверка**

На тестовом проекте, где текущая активная сцена в «Написании» имеет сгенерированную иллюстрацию (см. `state.illustrations.items[].sceneId`) — подтвердить через `preview_eval`/`preview_snapshot`, что `#sceneThumb` есть в DOM, `naturalWidth>0` (валидная картинка), и клик по ней (`preview_click` или `.click()` через eval) открывает новое окно/вкладку (проверить `window.open` был вызван — например через временный monkey-patch `window.open` в `preview_eval` перед кликом, restore после). Дополнительно переключиться на сцену БЕЗ иллюстрации — подтвердить `#sceneThumb` отсутствует (не рендерится пустой/битый `<img>`).

- [ ] **Шаг 6: Commit**

```bash
git add литсовет/src/ui/stages.js литсовет/styles.css
git commit -m "feat(литсовет): «Написание» — миниатюра иллюстрации текущей сцены"
```

---

### Task 5: `ui/stages.js` — «Иллюстрации» в панели «Этапы производства»

**Files:**
- Modify: `литсовет/src/ui/stages.js`

- [ ] **Шаг 1: Добавить запись в `STAGE_LABELS`**

Найти `литсовет/src/ui/stages.js:1482`:
```js
const STAGE_LABELS = [['concept','Концепция'],['voice','Голос'],['structure','Структура'],['write','Написание'],['edit','Редактура']];
```
Заменить на:
```js
const STAGE_LABELS = [['concept','Концепция'],['voice','Голос'],['structure','Структура'],['write','Написание'],['illustrations','Иллюстрации'],['edit','Редактура']];
```

- [ ] **Шаг 2: Добавить кейс в `stageDoneFor()`**

Найти `литсовет/src/ui/stages.js:1715-1723` (функция целиком):
```js
function stageDoneFor(s,id){
  switch(id){
    case 'concept': return !!(s.project.idea||s.project.title);
    case 'voice': return (s.voice.examples||[]).length>0;
    case 'structure': return (s.structure||[]).some(n=>n.type==='scene');
    case 'write': return (s.structure||[]).filter(n=>n.type==='scene').some(n=>n.status==='done');
    default: return false;
  }
}
```
Заменить на:
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

- [ ] **Шаг 3: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/ui/stages.js`
Expected: без вывода.

- [ ] **Шаг 4: Живая проверка**

На «Написании» или «Редактуре» — открыть панель «Этапы производства» (правая панель), через `preview_snapshot` подтвердить: пункт «Иллюстрации» присутствует в списке между «Написание» и «Редактура», и показывает галочку (✓) на проекте, где уже есть хотя бы одна иллюстрация, либо кружок (○)/индикатор «текущий этап» иначе.

- [ ] **Шаг 5: Commit**

```bash
git add литсовет/src/ui/stages.js
git commit -m "feat(литсовет): панель «Этапы производства» — учитывать стадию «Иллюстрации»"
```

---

### Task 6: `app.js` + `imagegen.js` — обновить устаревшие пометки про Recraft

**Files:**
- Modify: `литсовет/src/ui/app.js`
- Modify: `литсовет/src/imagegen.js`

- [ ] **Шаг 1: Убрать «менее проверено» из настроек**

Найти `литсовет/src/ui/app.js:255`:
```js
            <option value="recraft"${s.illustrations?.provider==='recraft'?' selected':''} title="Менее проверенная интеграция — точный формат имени модели неподтверждён">Recraft V4.1 (менее проверено)</option>
```
Заменить на:
```js
            <option value="recraft"${s.illustrations?.provider==='recraft'?' selected':''}>Recraft V4.1</option>
```

- [ ] **Шаг 2: Обновить комментарий в `imagegen.js`**

Найти `литсовет/src/imagegen.js:19-24`:
```js
// Recraft: точный формат имени модели неподтверждён живым вызовом (в этой
// среде нет ключа Recraft) — расходится между источниками (`recraftv4_1` в
// официальном reference эндпоинтов vs. `recraft-v4.1` в примере getting-started
// с OpenAI-совместимым клиентом). Взят вариант с подчёркиванием как более
// авторитетный (полный enum моделей), но если генерация не пойдёт — это
// первое место для правки.
```
Заменить на:
```js
// Recraft: имя модели `recraftv4_1` (с подчёркиванием) подтверждено реальным
// вызовом (см. историю проекта) — рабочий вариант, не гипотеза.
```

- [ ] **Шаг 3: Проверить синтаксис**

Run:
```bash
node --input-type=module --check < литсовет/src/ui/app.js
node --input-type=module --check < литсовет/src/imagegen.js
```
Expected: без вывода на оба файла.

- [ ] **Шаг 4: Живая проверка**

Открыть настройки (⚙) на запущенном сервере, через `preview_snapshot` подтвердить, что опция провайдера картинок теперь читается «Recraft V4.1» без пометки «менее проверено» и без всплывающей подсказки об неподтверждённости.

- [ ] **Шаг 5: Commit**

```bash
git add литсовет/src/ui/app.js литсовет/src/imagegen.js
git commit -m "docs(литсовет): убрать устаревшую пометку «неподтверждено» у Recraft (модель проверена живым вызовом)"
```

---

### Task 7: Финальная сквозная проверка

**Files:** нет изменений — только верификация.

- [ ] **Шаг 1: Полный синтаксис-проход**

```bash
for f in литсовет/src/ui/app.js литсовет/src/ui/stages.js литсовет/src/imagegen.js; do
  node --input-type=module --check < "$f" && echo "OK: $f" || echo "FAIL: $f"
done
```
Expected: все три `OK`.

- [ ] **Шаг 2: Живая сквозная проверка на реальном проекте**

На проекте минимум с обложкой + 2 иллюстрациями сцен (реальные данные, не синтетические):
1. Подтвердить порядок вкладок: Написание → Иллюстрации → Редактура.
2. На «Написании» — для сцены с иллюстрацией видна миниатюра; для сцены без — не видна.
3. На «Редактуре» — обложка вверху, иллюстрации сцен инлайн перед каждой сценой.
4. Нажать `.pdf` — в открывшемся окне (или в собранном HTML, если окно недоступно программно) есть обложка и иллюстрации сцен.
5. Панель «Этапы производства» показывает «Иллюстрации» с верным индикатором готовности.
6. Настройки (⚙) — Recraft без пометки «менее проверено».

- [ ] **Шаг 3: Проверить `preview_console_logs` на всех проверенных экранах**

Expected: без ошибок ни на одном из шагов.

- [ ] **Шаг 4: Отчёт**

Зафиксировать: что подтверждено живыми проверками, что не удалось проверить и почему (например, если `window.open` для PDF заблокирован попап-блокером в тестовом окружении — тогда шаг 4 из Шага 2 частично заменяется на прямую проверку собранной HTML-строки, как описано в Task 2 Шаг 3).

---

## Порядок выполнения

Задачи **1 → 2 → 3 → 4 → 5 → 6 → 7**, последовательно. Задачи 2, 3, 4, 5 все правят `литсовет/src/ui/stages.js` — строго по порядку, чтобы избежать конфликтов на одном файле (каждая следующая задача читает актуальные номера строк ПОСЛЕ предыдущей правки — при выполнении реальным агентом смотреть на реальное текущее содержимое файла, а не слепо доверять номерам строк из этого плана, которые сдвинутся после Task 2/3/4). Задача 6 правит `app.js` (уже тронут в Task 1, но другие строки — конфликтов по содержанию нет, порядок нужен только для дисциплины «один агент одновременно на файл») и новый файл `imagegen.js` (никем больше не тронутый). Задача 7 — после всех остальных.
