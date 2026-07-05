# Литсовет — раздел «Публикация» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Новая стадия «Публикация» — готовит материалы книги в точном виде, который ждёт РУЧНАЯ форма/загрузчик Author.Today, ЛитРес Самиздат и Проза.ру/Стихи.ру, плюс чек-лист их конкретных требований. Не автоматическая публикация — ни у одной площадки нет доступного авторам API для этого (см. спеку §1).

**Architecture:** Три всегда открытые секции (без сворачивания — как карточки «Мира», не нужен ещё один UI-паттерн): Author.Today и Проза.ру получают список глав с кнопкой копирования текста в буфер (текст вставляется в их веб-форму), ЛитРес получает кнопку скачивания настоящего FB2-файла (новый честный экспорт вместо ненадёжного HTML-as-.doc трюка).

**Tech Stack:** Zero-dependency vanilla JS (ES-модули), без сборки и без тестового раннера — проверка через реальный запущенный dev-сервер (`node литсовет/server.js`), не unit-тесты. Установленная практика проекта.

**Спека:** `docs/superpowers/specs/2026-07-06-publishing-checklist-design.md` — прочитать целиком перед началом.

---

## Task 1: `export.js` — экспортировать `buildBook` + новый честный FB2

**Files:**
- Modify: `литсовет/src/export.js`

Сейчас `buildBook(state)` (строка 51) — приватная функция файла, вызывается
только `exportMd`/`exportDocx`/`exportEpub` внутри него же. Новому
`ui/publish.js` (Task 2) тоже нужен доступ к ней для списка глав.

- [ ] **Step 1: Добавить `export` к `buildBook`**

Текущее (строка 51):
```js
function buildBook(state){
```
Заменить на:
```js
export function buildBook(state){
```
(Тело функции не меняется — только видимость.)

- [ ] **Step 2: Добавить `exportFb2` в конец файла, после `exportJson`**

```js
// ── .fb2 (для ЛитРес Самиздат) ──
// Намеренно БЕЗ метаданных автора/жанра/цены/обложки в файле — по чек-листу
// ЛитРес их заполняют в мастере публикации на сайте отдельно, встраивание
// в файл создаёт дублирование источника правды и конфликтует при
// конвертации (см. docs/superpowers/specs/2026-07-06-publishing-checklist-design.md §4).
export function exportFb2(state){
  const book = buildBook(state);
  const sections = book.chapters.map(ch=>{
    const title = ch.title ? `<title><p>${xesc(ch.title)}</p></title>` : '';
    const body = ch.scenes.map(sc=>paraXhtml(sc.text)).join('\n');
    return `<section>${title}\n${body}\n</section>`;
  }).join('\n');
  const fb2 = `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
<description>
<title-info><book-title>${xesc(book.title)}</book-title></title-info>
</description>
<body>
${sections}
</body>
</FictionBook>`;
  download(new Blob([fb2],{type:'application/xml'}), book.title+'.fb2');
}
```

`xesc`/`paraXhtml`/`download` — уже существуют в этом файле (используются
`exportEpub`/`exportDocx`), новых хелперов не нужно. `paraXhtml(text)` уже
возвращает `<p>...</p>` блоки — ровно то, что нужно FB2 внутри `<section>`.

- [ ] **Step 3: Проверить синтаксис**

Run: `node --check литсовет/src/export.js`
Expected: без вывода

- [ ] **Step 4: Живая проверка**

Через `preview_eval` в запущенном приложении:
```js
const ex = await import('/src/export.js');
const st = await import('/src/state.js');
const s = st.getState();
// buildBook теперь публична:
const book = ex.buildBook(s);
console.log(book.chapters.length);
```
`ex.buildBook` не должна быть `undefined`. Затем на реальном проекте с ≥1
написанной главой вызвать `ex.exportFb2(s)` (без клика по кнопке — она
появится только в Task 2) и убедиться, что файл скачался и открывается как
текст (валидный XML — можно проверить `new DOMParser().parseFromString(text,'application/xml').querySelector('parsererror')` должен быть `null`).

- [ ] **Step 5: Commit**

```bash
git add литсовет/src/export.js
git commit -m "feat(литсовет): экспортировать buildBook + честный FB2-экспорт для ЛитРес"
```

---

## Task 2: `ui/publish.js` — новая стадия «Публикация»

**Files:**
- Create: `литсовет/src/ui/publish.js`

Три всегда открытые секции. Author.Today/Проза.ру — список глав с кнопкой
копирования (переиспользует `buildBook`/`typo` из Task 1, паттерн
копирования — по образцу `copyNoteBtn`/`bindCopyNotes` в `ui/stages.js:1638`,
но НЕ импортируется оттуда напрямую: та функция заточена под короткие находки
Бета-ридера/Критика с их собственным текстом подсказки — для целой главы
нужен свой текст кнопки/тултипа, поэтому здесь — отдельная, но по тому же
принципу (`navigator.clipboard.writeText` + смена текста на 1200мс)
реализация, не копипаста чужого текста тултипа не по смыслу).

- [ ] **Step 1: Создать файл целиком**

```js
// Стадия «Публикация»: экспорт + чек-лист под РУЧНУЮ загрузку — авто-
// публикация через API недоступна ни для одной из трёх площадок (см. §1
// спеки docs/superpowers/specs/2026-07-06-publishing-checklist-design.md):
// у Author.Today API только для чтения, у ЛитРес — по бизнес-договору,
// у Прозы.ру API нет вообще. Секции ниже не сворачиваются — как карточки
// «Мира», не нужен ещё один UI-паттерн там, где обойдётся без него.

import { getState } from '../state.js';
import { buildBook, exportFb2, typo } from '../export.js';
import { esc } from './stages.js';

const AT_PART_LIMIT = 100000;     // Author.Today: рекомендованный максимум знаков на «часть»
const AT_NEWS_THRESHOLD = 15000;  // Author.Today: порог совокупного текста для «Новинок»
const LITRES_MIN_CHARS = 4000;    // ЛитРес Самиздат: минимальный объём книги
const LITRES_MAX_MB = 70;         // ЛитРес Самиздат: максимальный размер файла

let _chapterTexts = {}; // id вида "at-0"/"proza-2" → полный текст главы (источник для копирования, не хранить в DOM-атрибутах — может быть очень длинным)

function chapterFullText(ch){
  return ch.scenes.map(sc=>typo(sc.text).trim()).join('\n\n***\n\n');
}

function renderChapterList(book, platformId){
  return book.chapters.map((ch,i)=>{
    const text = chapterFullText(ch);
    const id = `${platformId}-${i}`;
    _chapterTexts[id] = text;
    const len = text.length;
    const over = len > AT_PART_LIMIT;
    return `<div class="apv-row" style="flex-direction:column;align-items:stretch;gap:4px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <b>${esc(ch.title||'Глава '+(i+1))}</b>
        <span class="${over?'stale-badge':'muted'}" style="font-size:11px">${len.toLocaleString('ru')} зн.${over?' — больше лимита части':''}</span>
      </div>
      <button class="btn pub-copy" data-copy-id="${id}" style="align-self:flex-start;font-size:11px;padding:2px 8px">📋 Копировать текст главы</button>
    </div>`;
  }).join('');
}

function renderChecklist(items){
  return `<ul style="margin:6px 0 12px 18px;padding:0;font-size:12px;color:var(--text-2)">
    ${items.map(i=>`<li>${i}</li>`).join('')}
  </ul>`;
}

export function renderPublish(els){
  const s = getState();
  const book = buildBook(s);
  _chapterTexts = {};

  els.left.innerHTML = `<div class="ph">Публикация</div>
    <div class="pad muted" style="font-size:12px">Ни у одной площадки нет доступного автору API для авто-публикации — здесь готовятся материалы под их ручную форму/загрузчик, сам процесс публикации не заменяется.</div>`;

  els.right.innerHTML = `<div class="ph">Книга</div>
    <div class="pad muted" style="font-size:12px">${book.chapters.length} ${book.chapters.length===1?'глава':book.chapters.length<5&&book.chapters.length>0?'главы':'глав'}</div>`;

  els.center.className = 'panel panel-center';
  els.center.innerHTML = `
    <div class="read-bar"><span class="read-title">Публикация</span></div>
    <div class="read-body">
      ${!book.chapters.length ? '<div class="empty-state">Напишите хотя бы одну главу — здесь появятся материалы для публикации.</div>' : `
      <div class="world-cat-card">
        <div class="world-cat-h"><b>Author.Today</b></div>
        ${renderChecklist([
          `Текст вставляется в веб-форму по главам — файл не нужен, копируйте главу за главой ниже.`,
          `Рекомендованный максимум — ${AT_PART_LIMIT.toLocaleString('ru')} знаков на одну «часть» (главу).`,
          `Чтобы попасть в «Новинки», нужно суммарно ≥ ${AT_NEWS_THRESHOLD.toLocaleString('ru')} новых знаков за раз.`,
        ])}
        ${renderChapterList(book, 'at')}
      </div>

      <div class="world-cat-card">
        <div class="world-cat-h"><b>Проза.ру / Стихи.ру</b></div>
        ${renderChecklist([
          `Публикация — тоже через веб-форму вставки текста, файл не требуется.`,
        ])}
        ${renderChapterList(book, 'proza')}
      </div>

      <div class="world-cat-card">
        <div class="world-cat-h"><b>ЛитРес Самиздат</b></div>
        ${renderChecklist([
          `Загружается готовый файл — FB2, DOCX или PDF, минимум ${LITRES_MIN_CHARS.toLocaleString('ru')} знаков, максимум ${LITRES_MAX_MB} МБ.`,
          `Обложка — отдельно, PNG/JPG в RGB.`,
          `Название, аннотацию, жанр и цену заполняете в мастере публикации на сайте — специально не встроены в файл, чтобы не конфликтовать при конвертации.`,
        ])}
        <button class="btn btn-primary" id="pubFb2">⬇ Скачать FB2</button>
      </div>
      `}
    </div>`;

  bindHandlers(els, s);
}

function bindHandlers(els, s){
  document.querySelectorAll('.pub-copy').forEach(b=>b.onclick=()=>{
    const text = _chapterTexts[b.dataset.copyId];
    if(!text) return;
    navigator.clipboard?.writeText(text).catch(()=>{});
    const orig = b.textContent; b.textContent = '✓ Скопировано'; b.disabled = true;
    setTimeout(()=>{ b.textContent = orig; b.disabled = false; }, 1200);
  });
  const fb2 = document.getElementById('pubFb2');
  if(fb2) fb2.onclick = ()=>{ exportFb2(s); };
}
```

- [ ] **Step 2: Проверить синтаксис**

Run: `node --check литсовет/src/ui/publish.js`
Expected: без вывода — но модуль пока никем не импортируется (Task 3), это
ожидаемо, не ошибка.

- [ ] **Step 3: Commit**

```bash
git add литсовет/src/ui/publish.js
git commit -m "feat(литсовет): ui/publish.js — стадия «Публикация» (главы+копирование, FB2)"
```

---

## Task 3: `ui/app.js` — зарегистрировать стадию `publish`

**Files:**
- Modify: `литсовет/src/ui/app.js:5,33-41,88-96`

- [ ] **Step 1: Добавить импорт**

Текущее (строка 5):
```js
import { renderConcept, renderVoice, renderStructure, renderWrite, renderEdit } from './stages.js';
```
Оставить как есть, добавить отдельной строкой сразу после (рядом с
`import { renderWorld } from './world.js';`, строка 8):
```js
import { renderPublish } from './publish.js';
```

- [ ] **Step 2: Добавить в `STAGES`**

Текущее (строки 33-41):
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
Заменить на (новая запись — последняя, публикация имеет смысл только после
готовой, вычитанной книги):
```js
const STAGES = [
  { id:'concept',   label:'Концепция' },
  { id:'world',     label:'Мир' },
  { id:'voice',     label:'Голос' },
  { id:'structure', label:'Структура' },
  { id:'write',     label:'Написание' },
  { id:'illustrations', label:'Иллюстрации' },
  { id:'edit',      label:'Редактура' },
  { id:'publish',   label:'Публикация' },
];
```
Стадия видна всегда, без скрытого тумблера (как «Иллюстрации») — `renderRail`
фильтрует только `voice` по `useVoice`, `publish` под фильтр не подпадает и
останется видна по умолчанию — ничего менять в `renderRail` не нужно.

- [ ] **Step 3: Добавить в `renderStage`**

Текущее (строки 88-95):
```js
  if(stage==='concept'){ renderConcept(els); }
  else if(stage==='world'){ renderWorld(els); }
  else if(stage==='voice'){ renderVoice(els); }
  else if(stage==='structure'){ renderStructure(els); }
  else if(stage==='write'){ renderWrite(els); }
  else if(stage==='edit'){ renderEdit(els); }
  else if(stage==='illustrations'){ renderIllustrations(els); }
  else { els.left.innerHTML=''; els.center.innerHTML=''; els.right.innerHTML=''; }
```
Заменить на:
```js
  if(stage==='concept'){ renderConcept(els); }
  else if(stage==='world'){ renderWorld(els); }
  else if(stage==='voice'){ renderVoice(els); }
  else if(stage==='structure'){ renderStructure(els); }
  else if(stage==='write'){ renderWrite(els); }
  else if(stage==='edit'){ renderEdit(els); }
  else if(stage==='illustrations'){ renderIllustrations(els); }
  else if(stage==='publish'){ renderPublish(els); }
  else { els.left.innerHTML=''; els.center.innerHTML=''; els.right.innerHTML=''; }
```

- [ ] **Step 4: Проверить синтаксис**

Run: `node --check литсовет/src/ui/app.js`
Expected: без вывода

- [ ] **Step 5: Commit**

```bash
git add литсовет/src/ui/app.js
git commit -m "feat(литсовет): регистрация стадии «Публикация» в app.js"
```

---

## Task 4: `ui/stages.js` — синхронизировать вторую карту стадий

**Files:**
- Modify: `литсовет/src/ui/stages.js:1472,1759-1769`

`STAGE_LABELS`/`stageDoneFor` — независимая от `STAGES`/`stageDone` (app.js)
карта, используемая панелью «Этапы производства» (правая панель
«Написания»/стадия «Редактура»). Уже известный, принятый архитектурный
нюанс проекта — обновляется вручную при каждом добавлении стадии, так же
как при добавлении «Иллюстраций» и «Мира» ранее.

- [ ] **Step 1: Добавить в `STAGE_LABELS`**

Текущее (строка 1472):
```js
const STAGE_LABELS = [['concept','Концепция'],['world','Мир'],['voice','Голос'],['structure','Структура'],['write','Написание'],['illustrations','Иллюстрации'],['edit','Редактура']];
```
Заменить на:
```js
const STAGE_LABELS = [['concept','Концепция'],['world','Мир'],['voice','Голос'],['structure','Структура'],['write','Написание'],['illustrations','Иллюстрации'],['edit','Редактура'],['publish','Публикация']];
```

- [ ] **Step 2: Добавить случай в `stageDoneFor`**

Текущее (строки 1759-1769):
```js
function stageDoneFor(s,id){
  switch(id){
    case 'concept': return !!(s.project.idea||s.project.title);
    case 'world': return (s.bible||[]).some(b=>b.source==='world');
    case 'voice': return (s.voice.examples||[]).length>0;
    case 'structure': return (s.structure||[]).some(n=>n.type==='scene');
    case 'write': return (s.structure||[]).filter(n=>n.type==='scene').some(n=>n.status==='done');
    case 'illustrations': return (s.illustrations?.items||[]).length>0;
    default: return false;
  }
}
```
Заменить на:
```js
function stageDoneFor(s,id){
  switch(id){
    case 'concept': return !!(s.project.idea||s.project.title);
    case 'world': return (s.bible||[]).some(b=>b.source==='world');
    case 'voice': return (s.voice.examples||[]).length>0;
    case 'structure': return (s.structure||[]).some(n=>n.type==='scene');
    case 'write': return (s.structure||[]).filter(n=>n.type==='scene').some(n=>n.status==='done');
    case 'illustrations': return (s.illustrations?.items||[]).length>0;
    // «Публикация» — всегда false: приложение не может знать, опубликовал ли
    // автор книгу на внешней площадке (это происходит вне Литсовета вручную).
    case 'publish': return false;
    default: return false;
  }
}
```

- [ ] **Step 3: Проверить синтаксис**

Run: `node --check литсовет/src/ui/stages.js`
Expected: без вывода

- [ ] **Step 4: Commit**

```bash
git add литсовет/src/ui/stages.js
git commit -m "chore(литсовет): синхронизировать панель «Этапы производства» с новой стадией «Публикация»"
```

---

## Task 5: Финальная сквозная живая проверка

**Files:** нет изменений — только проверка через `mcp__Claude_Preview__*` на
реальном запущенном сервере.

- [ ] **Step 1: Открыть «Публикация» на книге с ≥2 написанными главами**

Видны 3 секции: Author.Today, Проза.ру/Стихи.ру, ЛитРес Самиздат — каждая
со своим чек-листом.

- [ ] **Step 2: Author.Today — счётчик и копирование**

У каждой главы свой счётчик знаков. Временно подменить `navigator.clipboard.writeText`
(перехватить вызов через `preview_eval`) → нажать «📋 Копировать текст главы» →
убедиться, что переданный текст совпадает с реальным текстом сцен главы
(через `typo()`, разделённым `***`) → кнопка на 1200мс показывает
«✓ Скопировано», потом возвращается к исходному тексту.

- [ ] **Step 3: Искусственно проверить подсветку лимита**

Через `preview_eval` временно раздуть текст одной сцены (в памяти, не
сохраняя) до >100 000 знаков суммарно по главе → перерендерить → счётчик
этой главы показывает класс `stale-badge` (жёлтая подсветка) и текст
«— больше лимита части».

- [ ] **Step 4: Проза.ру — копирование**

Аналогично Step 2, для секции Проза.ру — независимая кнопка/id, тот же
текст главы.

- [ ] **Step 5: ЛитРес — FB2**

Клик «⬇ Скачать FB2» → файл скачался с именем `<Название книги>.fb2` →
прочитать скачанный текст → `new DOMParser().parseFromString(text,'application/xml').querySelector('parsererror')`
→ должно быть `null` (валидный XML) → убедиться, что в тексте нет полей
автора/жанра/цены/обложки (только `<book-title>` в `<description>`).

- [ ] **Step 6: Пустая книга**

Открыть «Публикация» на проекте без единой написанной главы → видно
`empty-state` вместо трёх секций, без ошибок в консоли.

- [ ] **Step 7: Панель «Этапы производства»**

Открыть «Написание» или «Редактура» → правая панель «Этапы производства»
показывает «Публикация» в списке (статус всегда «○», не «✓» — ожидаемо,
см. Task 4).

- [ ] **Step 8: Обзор изменений**

```bash
git log --oneline docs/superpowers/plans/2026-07-06-publishing-checklist-plan.md 2>/dev/null; git diff --stat HEAD~4..HEAD -- литсовет/
```

Убедиться, что список изменённых файлов совпадает с файловым планом спеки
(§6): `export.js`, `ui/publish.js` (новый), `ui/app.js`, `ui/stages.js` — и
больше ничего.
