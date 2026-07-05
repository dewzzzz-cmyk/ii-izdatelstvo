# Литсовет — вкладка «Мир»: карточки по категориям — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить единственную кнопку «Предложить мир» (все категории одним вызовом ИИ, канон только для чтения) на карточки по категориям — точечная генерация, правка/удаление/перегенерация факта, ручное добавление, подсказка на свою категорию.

**Architecture:** `src/world.js` — генерация одной категории за вызов + новая перегенерация одного факта. `src/bible.js` — общий хелпер правки/удаления факта, переиспользуемый панелью «Память» и «Миром» (устраняет дублирование `.bc-act`-обработчика). `src/ui/world.js` — полностью переписанный рендер: одна карточка на категорию из уже существующей `categoriesFor(genre)`.

**Tech Stack:** Zero-dependency vanilla JS (ES-модули), без сборки и без тестового раннера — проверка каждой задачи через реальный запущенный dev-сервер (`node литсовет/server.js`) и живые вызовы LLM (DeepSeek), а не unit-тесты. Это установленная практика проекта (см. предыдущие планы `docs/superpowers/plans/`), не отклонение от неё.

**Спека:** `docs/superpowers/specs/2026-07-05-world-tab-category-cards-design.md` — прочитать целиком перед началом, все решения по дизайну там обоснованы.

---

## Task 1: `bible.js` — общий хелпер правки/удаления факта

**Files:**
- Modify: `литсовет/src/bible.js`

Сейчас правка/удаление записи `state.bible[i]` реализована только внутри
`ui/memory.js` (строки 261-280) — локальным обработчиком, завязанным на числовой
индекс `data-bi`. Выносим только логику мутации (без `save()`/`rebuildBibleVecs()` —
это по-прежнему дело вызывающей стороны, как и для остальных функций `bible.js`),
чтобы её могли переиспользовать оба места: панель «Память» и вкладка «Мир».

- [ ] **Step 1: Добавить `editBibleFactAt`/`deleteBibleFactAt` в конец `bible.js`**

```js
// Правка/удаление одной записи канона по индексу в state.bible — общее для
// панели «Память» (ui/memory.js) и вкладки «Мир» (ui/world.js). save() и
// rebuildBibleVecs() — на стороне вызывающего UI, как и для остальных мутаций
// state в этом файле (см. saveMapItem в illustrations.js — тот же паттерн).
export function editBibleFactAt(bible, i){
  const fact = bible[i]; if(!fact) return false;
  const keys = prompt('Ключи:', fact.keys||''); if(keys===null) return false;
  const text = prompt('Факт:', fact.text||''); if(text===null) return false;
  fact.keys = keys.trim(); fact.text = text.trim();
  return true;
}

export function deleteBibleFactAt(bible, i){
  if(!bible[i]) return false;
  bible.splice(i,1);
  return true;
}
```

- [ ] **Step 2: Проверить синтаксис**

Run: `node --check литсовет/src/bible.js`
Expected: без вывода (exit code 0)

- [ ] **Step 3: Commit**

```bash
git add литсовет/src/bible.js
git commit -m "feat(литсовет): общий хелпер правки/удаления факта Библии (bible.js)"
```

---

## Task 2: `ui/memory.js` — использовать общий хелпер

**Files:**
- Modify: `литсовет/src/ui/memory.js:9,264-269`

Панель «Память» переходит на новый общий хелпер вместо локальной логики — поведение
для пользователя не меняется (те же два `prompt()`), меняется только откуда берётся
код.

- [ ] **Step 1: Добавить импорт**

В начале файла, рядом с существующим `import { rebuildBibleVecs } from '../bible.js';`
(строка 9) — заменить на:

```js
import { rebuildBibleVecs, editBibleFactAt, deleteBibleFactAt } from '../bible.js';
```

- [ ] **Step 2: Заменить тело обработчика `del`/`edit`**

Текущий код (строки 264-269):
```js
    if(b.dataset.act==='del'){ s.bible.splice(i,1); rebuildBibleVecs(s.bible); save(); return; }
    if(b.dataset.act==='edit'){
      const keys=prompt('Ключи:', fact.keys||''); if(keys===null) return;
      const text=prompt('Факт:', fact.text||''); if(text===null) return;
      fact.keys=keys.trim(); fact.text=text.trim(); rebuildBibleVecs(s.bible); save(); return;
    }
```

Заменить на:
```js
    if(b.dataset.act==='del'){ if(deleteBibleFactAt(s.bible,i)){ rebuildBibleVecs(s.bible); save(); } return; }
    if(b.dataset.act==='edit'){ if(editBibleFactAt(s.bible,i)){ rebuildBibleVecs(s.bible); save(); } return; }
```

(Строка выше `if(b.dataset.act==='expand'){` и всё, что после — не трогаем, ИИ-расширение
остаётся локальным для «Памяти», в скоуп «Мира» не входит согласно спеке §2.)

- [ ] **Step 2: Проверить синтаксис**

Run: `node --check литсовет/src/ui/memory.js`
Expected: без вывода

- [ ] **Step 3: Живая проверка**

Запустить `node литсовет/server.js` (или через `preview_start`), открыть проект с
хотя бы одним фактом в Библии → вкладка «Написание» → правая панель → «Память» →
развернуть «Канон / Bible» → нажать ✏ на факте → изменить текст в `prompt()` →
подтвердить → факт обновился на экране и остался после `location.reload()`.
Нажать 🗑 на другом факте → факт исчез из списка.

- [ ] **Step 4: Commit**

```bash
git add литсовет/src/ui/memory.js
git commit -m "refactor(литсовет): панель «Память» — переиспользует общий хелпер bible.js вместо локальной логики"
```

---

## Task 3: `world.js` — генерация по категории + перегенерация факта

**Files:**
- Modify: `литсовет/src/world.js`

Меняем `worldSuggestMessages`/`suggestWorldFacts` с «все категории одним вызовом» на
«одна категория за вызов» — промпт честно сфокусирован на одной категории, а не
размазан на 4-5 (спека §5.1). Добавляем `rerollWorldFact` — новую перегенерацию ОДНОГО
уже одобренного факта (спека §4.2). `CATEGORY_HINTS` становится экспортируемой — её
текст переиспользуется как плейсхолдер подсказки категории в UI.

- [ ] **Step 1: Экспортировать `CATEGORY_HINTS`**

Текущее (без `export`):
```js
const CATEGORY_HINTS = {
```
Заменить на:
```js
export const CATEGORY_HINTS = {
```

- [ ] **Step 2: Заменить `worldSuggestMessages`**

Текущая функция (см. `worldSuggestMessages` в `world.js`, принимает `state, hints={}`,
строит промпт на ВСЕ категории сразу через `categoriesFor(p.genre)` и три поля
`hints.ideaSeed`/`hints.limitation`/`hints.antagonistFaction`) — заменить целиком на:

```js
export function worldSuggestMessages(state, category, opts={}){
  const p = state.project;
  const hint = (opts.hint||'').trim();
  const ideaSeed = (opts.ideaSeed||'').trim();
  const sys = [
    'Ты — соавтор по мироустройству (worldbuilding). Ты предлагаешь конкретные факты мира книги — НЕ пишешь прозу и не строишь сюжет.',
    'Каждый факт — конкретное, проверяемое утверждение (не «в этом мире есть магия», а «боевая магия истощает год жизни за каждое применение») — расплывчатые факты хуже работают с системой поиска канона и не помогают стражам ловить противоречия.',
    `Сейчас нужны факты ТОЛЬКО категории «${category}»: ${CATEGORY_HINTS[category]||''}`,
    altHistoryNote(p.genre),
  ].filter(Boolean).join('\n');
  const user = [
    `Жанр: ${p.genre||'роман'}${p.subgenre?', '+p.subgenre:''}.`,
    p.era ? `Эпоха: ${p.era}.` : '',
    (p.synopsis||p.idea) ? `Синопсис: ${p.synopsis||p.idea}` : '',
    ideaSeed ? `Идея мира от автора: ${ideaSeed}` : '',
    hint ? `Подсказка автора для категории «${category}»: ${hint}` : '',
    '',
    `Предложи 3-6 фактов категории «${category}».`,
    `Верни JSON: { "facts": [ { "keys": "2-4 ключевых слова через запятую", "text": "сам факт, 1-2 предложения" } ] }`,
    'Только JSON.',
  ].filter(Boolean).join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}
```

`sys` теперь состоит из 3 строк: персона+инструкция по конкретности, сама
категория+её описание из `CATEGORY_HINTS`, и `altHistoryNote` (пустая строка
для не-альтисторических жанров — отфильтруется `filter(Boolean)`).

- [ ] **Step 3: Заменить `suggestWorldFacts`**

Текущая функция — заменить целиком на:

```js
export async function suggestWorldFacts(state, category, opts={}){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ текстовой модели (⚙).');
  const msgs = worldSuggestMessages(state, category, opts);
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.8, messages:msgs, maxTokens:800, retries:g.retries });
  const j = extractJSON(res.text);
  const arr = j && Array.isArray(j.facts) ? j.facts : null;
  if(!arr) throw new Error('Не удалось разобрать ответ агента «Мир».');
  return arr.slice(0, 6).map((f,i)=>({
    id: 'wf_'+Date.now().toString(36)+'_'+i,
    category,
    keys: String(f.keys||'').slice(0,120),
    text: String(f.text||'').trim().slice(0,500),
  })).filter(f=>f.text);
}
```

Категория теперь форсится параметром функции (а не полем ответа модели) — раз вызов
и так про одну категорию, дополнительная валидация `cats.includes(f.category)` не
нужна: она защищала от смешивания категорий в старом «все сразу» вызове.

- [ ] **Step 4: Добавить `rerollWorldFact`**

Новая функция, разместить сразу после `suggestWorldFacts`:

```js
// Перегенерация ОДНОГО уже одобренного факта — «эта формулировка не устроила»,
// не путать с ✨-расширением в ui/memory.js (то дописывает деталями, это меняет
// саму формулировку, не трогая суть). Возвращает новый текст — вызывающая
// сторона (ui/world.js) сама присваивает fact.text и вызывает rebuildBibleVecs.
export async function rerollWorldFact(state, fact){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ текстовой модели (⚙).');
  const sys = 'Ты — соавтор по мироустройству. Автору не понравилась формулировка факта мира — предложи ДРУГУЮ версию ТОЙ ЖЕ сути (тот же смысл, другие слова), не меняя факт по содержанию.';
  const user = [
    `Жанр: ${state.project.genre||'роман'}.`,
    `Факт (категория «${fact.category||''}»): ${fact.text}`,
    '',
    'Верни только новый текст факта, одно-два предложения, без пояснений и без кавычек.',
  ].join('\n');
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.9, messages:[{role:'system',content:sys},{role:'user',content:user}], maxTokens:300, retries:g.retries });
  const text = res.text.trim().replace(/^["«]+|["»]+$/g,'');
  if(!text) throw new Error('Пустой ответ.');
  return text;
}
```

- [ ] **Step 5: Проверить синтаксис**

Run: `node --check литсовет/src/world.js`
Expected: без вывода

- [ ] **Step 6: Живая проверка (реальный вызов ИИ, не мок)**

Через `preview_eval` в запущенном приложении (по образцу того, как в этой сессии уже
тестировался `runBookArchitect` напрямую через `dynamic import`):
```js
const w = await import('/src/world.js');
const st = await import('/src/state.js');
const s = st.getState();
const facts = await w.suggestWorldFacts(s, 'фракции', { hint: 'кто с кем воюет' });
```
Expected: массив из 3-6 объектов `{id, category:'фракции', keys, text}`, все `text`
непустые, все `category==='фракции'`.

- [ ] **Step 7: Commit**

```bash
git add литсовет/src/world.js
git commit -m "feat(литсовет): world.js — генерация по одной категории + перегенерация факта (rerollWorldFact)"
```

---

## Task 4: `styles.css` — стиль карточки категории

**Files:**
- Modify: `литсовет/styles.css`

Переиспользуем уже существующие `.mem-card`/`.bible-card`/`.bible-actions`/`.apv-row`
для внутренностей карточки (факты в каноне, кандидаты) — новый CSS нужен только для
самого контейнера-карточки и подсказки.

- [ ] **Step 1: Добавить правила рядом с `.mem-card`/`.bible-card` (около строки 283-290)**

```css
.world-cat-card{border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;margin-bottom:14px;background:var(--surface)}
.world-cat-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.world-cat-hint{width:100%;box-sizing:border-box;margin-bottom:8px}
.world-cat-facts{margin-top:10px}
.world-cat-cands{margin-top:10px}
.world-cat-add{font-size:12px;color:var(--text-2);cursor:pointer}
.world-cat-add:hover{color:var(--accent)}
```

- [ ] **Step 2: Commit**

```bash
git add литсовет/styles.css
git commit -m "style(литсовет): CSS для карточек категорий на вкладке «Мир»"
```

---

## Task 5: `ui/world.js` — разметка карточек (без обработчиков)

**Files:**
- Modify: `литсовет/src/ui/world.js`

Переписываем рендер: одна карточка на категорию из `categoriesFor(genre)` вместо
плоских секций «Кандидаты»/«Уже в каноне». Обработчики (Task 6) — отдельным шагом,
чтобы разметку можно было визуально проверить раньше, чем всё заработает.

- [ ] **Step 1: Заменить импорты в начале файла**

Текущее:
```js
import { getState, save } from '../state.js';
import { rebuildBibleVecs } from '../bible.js';
import { suggestWorldFacts, missingPOD, generateWorldMap } from '../world.js';
import { saveMapItem } from '../illustrations.js';
import { estimateImageCost } from '../imagegen.js';
import { esc } from './stages.js';
```
Заменить на:
```js
import { getState, save } from '../state.js';
import { rebuildBibleVecs, editBibleFactAt, deleteBibleFactAt } from '../bible.js';
import { suggestWorldFacts, missingPOD, generateWorldMap, rerollWorldFact, categoriesFor, CATEGORY_HINTS } from '../world.js';
import { saveMapItem } from '../illustrations.js';
import { estimateImageCost } from '../imagegen.js';
import { esc } from './stages.js';
```

- [ ] **Step 2: Заменить модульные переменные состояния**

Текущее:
```js
let _candidates = [];       // предложенные, ещё не одобренные факты
let _selected = new Set();  // id одобренных чекбоксом
let _collapsed = new Set(); // свёрнутые категории (по умолчанию всё развёрнуто)
let _busy = false;
let _busyText = '';
let _mapBusy = false;
```
Заменить на:
```js
let _candidates = [];        // предложенные, ещё не одобренные факты (все категории вместе, у каждого своё .category)
let _selected = new Set();   // id одобренных чекбоксом
let _hints = {};             // текст подсказки на категорию — держим тут (не в state), иначе теряется при ре-рендере во время генерации другой карточки
let _ideaSeed = '';          // общая «Идея мира» — та же причина держать вне DOM/state
let _busyCategory = null;    // категория, для которой сейчас идёт точечная генерация
let _bulkBusy = false;       // «Предложить весь мир» — идёт последовательный обход категорий
let _bulkProgress = '';      // текст прогресса булк-генерации, напр. "2 из 4"
let _mapBusy = false;
```

`_collapsed` убирается — при генерации по одной категории кандидатов физически
меньше (3-6 за раз, не 8-15 по всем категориям), сворачивание больше не нужно
(YAGNI, спека не требует).

- [ ] **Step 3: Удалить `renderCandidates` и `renderCanon`, добавить `renderCategoryCard`**

Удалить обе функции целиком (их логику заменяет `renderCategoryCard` ниже — рендерит
кандидатов и факты своей категории внутри одной карточки, а не отдельными
плоскими блоками). Добавить перед `renderMapBlock`:

```js
function factsOfCategory(worldFacts, cat){ return worldFacts.filter(f=>f.category===cat); }
function candidatesOfCategory(cat){ return _candidates.filter(c=>c.category===cat); }

function wordForm(n, one, few, many){
  const mod10=n%10, mod100=n%100;
  if(mod10===1 && mod100!==11) return one;
  if(mod10>=2 && mod10<=4 && (mod100<10||mod100>=20)) return few;
  return many;
}

function renderCategoryCard(s, worldFacts, cat, busyAny){
  const canon = factsOfCategory(worldFacts, cat);
  const cands = candidatesOfCategory(cat);
  const busy = _busyCategory===cat;
  const selCount = cands.filter(c=>_selected.has(c.id)).length;
  return `<div class="world-cat-card" data-cat="${esc(cat)}">
    <div class="world-cat-h">
      <b>${esc(cat)}</b>
      <span class="muted">${canon.length ? `${canon.length} ${wordForm(canon.length,'факт','факта','фактов')}` : 'пусто'}</span>
    </div>
    <input type="text" class="world-cat-hint" data-cat="${esc(cat)}" value="${esc(_hints[cat]||'')}" placeholder="${esc(CATEGORY_HINTS[cat]||'подсказка (необязательно)')}">
    <button class="btn world-cat-gen" data-cat="${esc(cat)}" ${busyAny?'disabled':''}>${busy?'<span class="spinner"></span> …':'✨ Предложить'}</button>

    ${canon.length ? `<div class="world-cat-facts">
      ${canon.map(f=>{
        const i = s.bible.indexOf(f);
        return `<div class="mem-card bible-card" data-bi="${i}">
          <div class="bible-actions">
            <button class="bc-act wc-act" data-act="edit" data-bi="${i}" title="Редактировать">✎</button>
            <button class="bc-act wc-act" data-act="reroll" data-bi="${i}" title="Другой вариант (ИИ)">🔄</button>
            <button class="bc-act wc-act" data-act="del" data-bi="${i}" title="Удалить">✕</button>
          </div>
          <div class="mem-title" style="color:var(--accent)">${esc(f.keys||'факт')}</div>
          <div class="muted" style="font-size:12px">${esc(f.text)}</div>
        </div>`;
      }).join('')}
    </div>` : ''}

    ${cands.length ? `<div class="world-cat-cands">
      ${cands.map(c=>`
        <div class="apv-row" style="flex-direction:column;align-items:stretch;gap:4px">
          <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">
            <input type="checkbox" class="w-cb" data-id="${c.id}" ${_selected.has(c.id)?'checked':''} style="margin-top:3px">
            <div style="flex:1">
              <input type="text" class="w-keys" data-id="${c.id}" value="${esc(c.keys)}" style="font-size:11px;color:var(--text-2);border:none;background:transparent;width:100%;padding:0;margin-bottom:2px">
              <textarea class="w-text" data-id="${c.id}" rows="2" style="width:100%;font-size:13px">${esc(c.text)}</textarea>
            </div>
          </label>
        </div>`).join('')}
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:6px">
        <button class="btn world-cat-clear" data-cat="${esc(cat)}">Отменить</button>
        <button class="btn btn-primary world-cat-approve" data-cat="${esc(cat)}" ${selCount?'':'disabled'}>Сохранить в канон (${selCount})</button>
      </div>
    </div>` : ''}

    <div class="world-cat-add" data-cat="${esc(cat)}">+ добавить вручную</div>
  </div>`;
}
```

- [ ] **Step 4: Оставить `renderMapBlock` без изменений**

Функция `renderMapBlock(s, geoCount)` копируется как есть, без правок — карта мира
не в скоупе этой задачи (спека §2, не-цели).

- [ ] **Step 5: Заменить `renderWorld`**

Текущая функция — заменить целиком на:

```js
export function renderWorld(els){
  const s = getState();
  const p = s.project;
  const worldFacts = (s.bible||[]).filter(b=>b.source==='world');
  const cats = categoriesFor(p.genre);
  const geoCount = worldFacts.filter(b=>b.category==='география').length;
  const podWarning = missingPOD(s);
  const busyAny = _bulkBusy || !!_busyCategory;

  els.left.innerHTML = `<div class="ph">Мир</div>
    <div class="pad muted" style="font-size:12px">${worldFacts.length ? `${worldFacts.length} фактов в каноне` : 'Пока нет фактов мира.'}</div>`;

  els.right.innerHTML = `<div class="ph">Идея мира (необязательно)</div><div class="pad">
    <div class="field"><textarea id="wSeed" rows="3" placeholder="в общих чертах, если есть — иначе агент оттолкнётся от жанра и синопсиса">${esc(_ideaSeed)}</textarea></div>
  </div>`;

  els.center.className = 'panel panel-center';
  els.center.innerHTML = `
    <div class="read-bar">
      <span class="read-title">Мир</span>
      <span style="flex:1"></span>
      <button class="btn btn-primary" id="wSuggestAll" ${busyAny?'disabled':''}>${_bulkBusy?'<span class="spinner"></span> '+esc(_bulkProgress):'✨ Предложить весь мир'}</button>
    </div>
    <div class="read-body" id="wBody">
      ${podWarning ? `<div class="pad" style="border:1px solid var(--err);border-radius:8px;margin:0 0 14px;background:var(--surface-2)">
        <div style="font-size:12px;color:var(--err)">⚠ Для альтернативной истории точка развилки — основа жанра. Добавьте факт категории «История» с чёткой развилкой (событие + год + следствия), прежде чем продолжать.</div>
      </div>` : ''}
      ${cats.map(cat=>renderCategoryCard(s, worldFacts, cat, busyAny)).join('')}
      ${renderMapBlock(s, geoCount)}
      <div class="row" style="margin-top:18px;justify-content:flex-end">
        <button class="btn btn-primary" id="wNext">Дальше — ${p.useVoice?'Голос':'Структура'} →</button>
      </div>
    </div>`;

  bindHandlers(els, s);
}
```

- [ ] **Step 6: Проверить синтаксис**

Run: `node --check литсовет/src/ui/world.js`
Expected: сломается — `bindHandlers` в Task 6 ещё ссылается на старые элементы
(`#wSuggest`, `.mem-h-toggle[data-cat]` и т.д.), которых больше нет в разметке. Это
ожидаемо для этого шага — синтаксической ошибки при этом быть не должно (только
логическое рассогласование, которое чинит Task 6). Если `node --check` покажет именно
SyntaxError — остановиться и найти опечатку в JSX-подобной разметке выше.

- [ ] **Step 7: Commit**

```bash
git add литсовет/src/ui/world.js литсовет/styles.css
git commit -m "feat(литсовет): ui/world.js — разметка карточек по категориям (без обработчиков, см. следующий коммит)"
```

---

## Task 6: `ui/world.js` — обработчики карточек

**Files:**
- Modify: `литсовет/src/ui/world.js`

Заменяем `bindHandlers` целиком — старая версия ссылается на элементы, которых
больше нет после Task 5.

- [ ] **Step 1: Заменить `bindHandlers`**

```js
function bindHandlers(els, s){
  // Подсказки — держим в модульных переменных (Task 5, шаг 2), не в DOM/state:
  // иначе ре-рендер при генерации ОДНОЙ категории стирал бы то, что автор
  // напечатал в поле другой ещё не отправленной карточки.
  const seedEl = document.getElementById('wSeed');
  if(seedEl) seedEl.addEventListener('input', ()=>{ _ideaSeed = seedEl.value; });
  document.querySelectorAll('.world-cat-hint').forEach(inp=>{
    inp.addEventListener('input', ()=>{ _hints[inp.dataset.cat] = inp.value; });
  });

  // Точечная генерация одной категории.
  document.querySelectorAll('.world-cat-gen').forEach(btn=>btn.onclick=async ()=>{
    if(!s.global.apiKey){ alert('Задайте API-ключ текстовой модели в настройках (⚙).'); return; }
    const cat = btn.dataset.cat;
    if(_busyCategory || _bulkBusy) return;
    _busyCategory = cat; renderWorld(els);
    try{
      const fresh = await suggestWorldFacts(s, cat, { hint:_hints[cat], ideaSeed:_ideaSeed });
      _candidates = _candidates.filter(c=>c.category!==cat).concat(fresh);
      fresh.forEach(c=>_selected.add(c.id));
    }catch(e){ alert('Мир: '+e.message); }
    finally{ _busyCategory = null; renderWorld(els); }
  });

  // «Предложить весь мир» — последовательно, категория за категорией (не
  // Promise.all — все категории пишут в общий _candidates, параллельные
  // резолвы гонялись бы за одним и тем же состоянием; спек-ревью явно
  // рекомендовало последовательный обход).
  const sa = document.getElementById('wSuggestAll');
  if(sa) sa.onclick = async ()=>{
    if(!s.global.apiKey){ alert('Задайте API-ключ текстовой модели в настройках (⚙).'); return; }
    if(_busyCategory || _bulkBusy) return;
    const cats = categoriesFor(s.project.genre);
    _bulkBusy = true;
    for(let i=0;i<cats.length;i++){
      const cat = cats[i];
      _bulkProgress = `${i+1} из ${cats.length}`;
      renderWorld(els);
      try{
        const fresh = await suggestWorldFacts(s, cat, { hint:_hints[cat], ideaSeed:_ideaSeed });
        _candidates = _candidates.filter(c=>c.category!==cat).concat(fresh);
        fresh.forEach(c=>_selected.add(c.id));
      }catch(e){ console.warn('Мир, категория '+cat+':', e.message); }
    }
    _bulkBusy = false; _bulkProgress = '';
    renderWorld(els);
  };

  // Кандидаты: чекбокс/правка текста (как раньше, только теперь рендерятся внутри карточки категории).
  document.querySelectorAll('.w-cb').forEach(cb=>cb.onchange=()=>{
    if(cb.checked) _selected.add(cb.dataset.id); else _selected.delete(cb.dataset.id);
    renderWorld(els);
  });
  document.querySelectorAll('.w-text').forEach(t=>t.addEventListener('change',()=>{
    const c = _candidates.find(x=>x.id===t.dataset.id); if(c) c.text = t.value.trim();
  }));
  document.querySelectorAll('.w-keys').forEach(t=>t.addEventListener('change',()=>{
    const c = _candidates.find(x=>x.id===t.dataset.id); if(c) c.keys = t.value.trim();
  }));

  // Отменить/сохранить в канон — теперь на уровне одной категории.
  document.querySelectorAll('.world-cat-clear').forEach(btn=>btn.onclick=()=>{
    const cat = btn.dataset.cat;
    _candidates.filter(c=>c.category===cat).forEach(c=>_selected.delete(c.id));
    _candidates = _candidates.filter(c=>c.category!==cat);
    renderWorld(els);
  });
  document.querySelectorAll('.world-cat-approve').forEach(btn=>btn.onclick=()=>{
    const cat = btn.dataset.cat;
    const approved = _candidates.filter(c=>c.category===cat && _selected.has(c.id));
    s.bible = s.bible || [];
    approved.forEach(c=>{ s.bible.push({ keys:c.keys, text:c.text, source:'world', category:c.category }); _selected.delete(c.id); });
    _candidates = _candidates.filter(c=>!approved.includes(c));
    rebuildBibleVecs(s.bible);
    if((s.structure||[]).some(n=>n.type==='chapter')) s.structureStale = true;
    save(); renderWorld(els);
  });

  // Правка/удаление/перегенерация факта уже в каноне.
  document.querySelectorAll('.wc-act[data-bi]').forEach(b=>b.onclick=async (e)=>{
    e.stopPropagation();
    const i = +b.dataset.bi; const fact = s.bible[i]; if(!fact) return;
    if(b.dataset.act==='del'){ if(deleteBibleFactAt(s.bible,i)){ rebuildBibleVecs(s.bible); save(); renderWorld(els); } return; }
    if(b.dataset.act==='edit'){ if(editBibleFactAt(s.bible,i)){ rebuildBibleVecs(s.bible); save(); renderWorld(els); } return; }
    if(b.dataset.act==='reroll'){
      if(!s.global.apiKey){ alert('Задайте API-ключ текстовой модели (⚙).'); return; }
      b.disabled = true; const orig = b.textContent; b.textContent = '…';
      try{
        const newText = await rerollWorldFact(s, fact);
        fact.text = newText;
        rebuildBibleVecs(s.bible); save(); renderWorld(els);
      }catch(err){ alert('Мир: '+err.message); b.disabled=false; b.textContent=orig; }
    }
  });

  // Добавить вручную — те же два prompt(), что и bibleAdd в ui/memory.js,
  // категория проставляется автоматически (карточка уже про конкретную категорию).
  document.querySelectorAll('.world-cat-add').forEach(el=>el.onclick=()=>{
    const cat = el.dataset.cat;
    const keys = prompt('Ключи факта (через запятую, напр.: «город, климат»):'); if(keys===null) return;
    const text = prompt('Сам факт:'); if(!text) return;
    s.bible = s.bible || [];
    s.bible.push({ keys:keys.trim(), text:text.trim(), source:'world', category:cat });
    rebuildBibleVecs(s.bible);
    if((s.structure||[]).some(n=>n.type==='chapter')) s.structureStale = true;
    save(); renderWorld(els);
  });

  const wm = document.getElementById('wMap');
  if(wm) wm.onclick = async ()=>{
    if(!s.illustrations?.apiKey){ alert('Задайте ключ для генерации картинок в настройках (⚙).'); return; }
    if(_mapBusy) return;
    _mapBusy = true; renderWorld(els);
    try{
      const dataUrl = await generateWorldMap(s);
      saveMapItem(s, dataUrl);
      save();
    }catch(e){ alert('Карта: '+e.message); }
    finally{ _mapBusy = false; renderWorld(els); }
  };

  const wn = document.getElementById('wNext');
  if(wn) wn.onclick = ()=>{ s.ui.stage = s.project.useVoice ? 'voice' : 'structure'; save(); };
}
```

(Блок `wMap`/`wNext` в конце — перенесён из старой версии без изменений, просто
теперь это единственные обработчики, не завязанные на категории.)

- [ ] **Step 2: Проверить синтаксис**

Run: `node --check литсовет/src/ui/world.js`
Expected: без вывода

- [ ] **Step 3: Commit**

```bash
git add литсовет/src/ui/world.js
git commit -m "feat(литсовет): ui/world.js — обработчики карточек категорий (генерация/правка/удаление/реролл/ручное добавление)"
```

---

## Task 7: Финальная сквозная живая проверка

**Files:** нет изменений — только проверка через `mcp__Claude_Preview__*` на реальном
запущенном сервере, по установленной в проекте практике (см. `docs/superpowers/specs/2026-07-04-litsovet-world-stage-design.md` §13).

- [ ] **Step 1: Запустить сервер и открыть «Мир» на жанре с world-фактором**

Жанр «Фэнтези» → на вкладке «Мир» видно по одной карточке на «География / История /
Фракции / Культура / Магия-технология», у каждой свой счётчик (0/«пусто» на новом
проекте) и поле подсказки с плейсхолдером, взятым из `CATEGORY_HINTS`.

- [ ] **Step 2: Точечная генерация**

Вписать в подсказку карточки «Фракции» текст «кто с кем воюет», нажать «✨
Предложить» именно там (не «Предложить весь мир») → реальный вызов ИИ → приходят
3-6 кандидатов **только** у карточки «Фракции», у остальных карточек ничего не
появилось. Пока идёт генерация — проверить, что кнопки генерации ВСЕХ остальных
карточек задизейблены (`busyAny`), а не только текущей.

- [ ] **Step 3: Подсказки не теряются при генерации другой карточки**

Вписать текст в подсказку карточки «Культура», НЕ нажимая «Предложить» — нажать
«Предложить» на карточке «История» → после того как «История» отгенерировалась и
экран перерисовался, подсказка «Культура» осталась на месте (не стёрлась ре-рендером).

- [ ] **Step 4: Одобрение и правка**

Отметить чекбоксом кандидата у «Фракции», нажать «Сохранить в канон» именно в этой
карточке → факт появился в списке «уже в каноне» этой же карточки, счётчик +1, виден
и в панели «Память» на «Написании» (`state.bible`, `source:'world'`). Навести на факт
→ появились ✎/🔄/✕ → нажать ✎ → изменить текст в `prompt()` → сохранился.

- [ ] **Step 5: Перегенерация и удаление**

Нажать 🔄 на том же факте → реальный вызов ИИ → текст заменился на другую
формулировку (не идентичную дословно). Нажать ✕ → факт удалился, счётчик карточки -1.

- [ ] **Step 6: Ручное добавление**

«+ добавить вручную» на карточке «Культура» → два `prompt()` → факт появился с
`category:'культура'`, без единого вызова ИИ (проверить по логам сети — нет запроса
к `/api/generate`).

- [ ] **Step 7: «Предложить весь мир» на пустом проекте**

Создать новый проект (жанр «Фэнтези», не заполняя мир) → нажать «✨ Предложить весь
мир» → кнопка показывает прогресс «1 из N» → «2 из N» и т.д. → по завершении во всех
карточках (кроме тех, где ИИ ничего не вернул) появились кандидаты. Проверить в
логах сети — запросы к `/api/generate` ушли **последовательно** (не одновременно N
штук).

- [ ] **Step 8: Не сломан авто-подсказчик недостающих фактов на «Структуре»**

Перейти на «Структуру», собрать скелет → карточки «Архитектор опирался на факты,
которых нет в каноне» (`suggestMissingWorldFacts`) продолжают появляться и работать
как раньше — эта задача их не трогала, но регресс исключаем прямой проверкой.

- [ ] **Step 9: Финальный обзор изменений**

```bash
git log --oneline docs/superpowers/plans/2026-07-05-world-tab-category-cards-plan.md 2>/dev/null; git diff --stat HEAD~6..HEAD -- литсовет/
```

Убедиться, что список изменённых файлов совпадает с файловым планом спеки (§6):
`world.js`, `bible.js`, `ui/memory.js`, `ui/world.js`, `styles.css` — и больше ничего.
