# Стадия «Мир» + настройки Книжного архитектора — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить проактивную стадию «Мир» (worldbuilding до Структуры) в пайплайн «Литсовет», плюс новый жанр «Альтернативная история» и авторские настройки Книжного архитектора (объём сцены, число глав, темп, креативность).

**Архитектура:** Стадия «Мир» — новый агент-суггестер (`world.js`, без своего API-ключа) + UI ревью (`ui/world.js`), пишет одобренные факты в уже существующую Библию (`state.bible[]`, поле `source:'world'`) — никакой новой структуры данных. Книжный архитектор читает эти факты через уже существующий `bibleForPrompt()`. Канал остаётся открытым в обе стороны: Архитектор может предложить недостающий факт после построения скелета (переиспользует существующий паттерн «Историческая разведка»), а автор может дополнить мир после того как скелет уже есть (баннер устаревания, не блокировка).

**Tech Stack:** Vanilla JS (ES-модули), без сборщика и фреймворка. Существующий стек проекта: `callLLM`/`extractJSON` (`llm.js`), TF-IDF Библия (`bible.js`), `state.js`/IndexedDB (`storage.js`).

**Спека:** `docs/superpowers/specs/2026-07-04-litsovet-world-stage-design.md` (3 итерации ревью, одобрена).

**Как проверять каждый шаг:** в этом проекте нет тестового фреймворка (zero-dependency приложение). Проверка — `node --input-type=module --check < file.js` на синтаксис сразу после правки, и **живая проверка через `mcp__Claude_Preview__*`** на реально запущенном сервере (см. `CLAUDE.md`: `node server.js`, порт 8787/8788). Финальная сквозная проверка — Task 16.

---

### Task 1: Новый жанр «Альтернативная история»

**Files:**
- Modify: `литсовет/src/genres.js`

- [ ] **Шаг 1: Добавить жанр в `GENRES`**

В массив `GENRES` (после записи `'литрпг'`, строка 25, перед `'другой'`):

```js
  { v:'альтернативная история',label:'Альтернативная история',    words: 95000 },
```

- [ ] **Шаг 2: Ветка в `genreBeatsNote`**

Добавить в начало функции (перед веткой `ромфант`, т.к. порядок специфичных веток важен — но «альтернативн» не пересекается по подстроке ни с чем существующим, порядок относительно других веток не критичен, важно только не потерять её):

```js
export function genreBeatsNote(genre){
  const g = (genre||'').toLowerCase();
  if(g.includes('альтернативн')){
    return 'ЖАНРОВЫЕ БИТЫ (альтернативная история) — точка развилки (POD) должна быть узнаваема с первых глав через то, как выглядит альтернативная «норма» (не через лекцию-экспозицию: показывай следствия развилки в быту, технологиях, политике, а не объясняй впрямую). Причинно-следственная цепочка от развилки к текущему состоянию мира должна быть прослеживаема на всём протяжении книги. Кульминация часто завязана на угрозу «исправления» истории (кто-то хочет вернуть «правильный» ход событий) или на цену, которую развилка потребовала от героя/мира.';
  }
  if(g.includes('ромфант')){
```

- [ ] **Шаг 3: Ветка в `genreJudgeNote`**

Добавить в начало функции (тот же принцип):

```js
export function genreJudgeNote(genre){
  const g = (genre||'').toLowerCase();
  if(g.includes('альтернативн')){
    return 'ЖАНРОВАЯ ПОПРАВКА (альтернативная история): кажущиеся анахронизмы — не ошибка, если они прямое следствие заявленной в каноне точки развилки (например, сдвинутая на 50 лет раньше промышленная революция объясняет продвинутую технику в 1850-м). Не флагуй это как логическую дыру. Противоречия САМОЙ заявленной причинно-следственной цепочке (не то же самое, что «непривычно для реальной истории») — обычная проверка континуити, флагуй как всегда.';
  }
  if(g.includes('литрпг') || g.includes('игровая фантастика')){
```

- [ ] **Шаг 4: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/genres.js`
Expected: без вывода (успех).

- [ ] **Шаг 5: Живая проверка**

Через `mcp__Claude_Preview__preview_eval` на запущенном сервере:
```js
const { genreBeatsNote, genreJudgeNote, GENRES } = await import('/src/genres.js');
({
  hasGenre: GENRES.some(g=>g.v==='альтернативная история'),
  beats: genreBeatsNote('альтернативная история').slice(0,30),
  judge: genreJudgeNote('альтернативная история').slice(0,30),
  noCollisionWithHistorical: genreBeatsNote('исторический роман').includes('развилк'), // должно быть false
})
```
Expected: `hasGenre:true`, `beats`/`judge` непустые, `noCollisionWithHistorical:false`.

- [ ] **Шаг 6: Commit**

```bash
git add литсовет/src/genres.js
git commit -m "feat(литсовет): жанр «Альтернативная история» с поддержкой точки развилки"
```

---

### Task 2: Вынести `ag()` в state.js (устранить дублирование перед новым потребителем)

`architect-book.js` (Task 12) тоже будет читать `state.agents[]` по роли. Сейчас хелпер `ag()` — приватная функция внутри `pipeline.js`. Не дублируем его в третий раз — переносим в `state.js`, где уже живут родственные хелперы (`findOrCreateCharacter`, `addCustomAgent`), и оба модуля импортируют его оттуда.

**Files:**
- Modify: `литсовет/src/state.js`
- Modify: `литсовет/src/pipeline.js:62`

- [ ] **Шаг 1: Добавить экспорт в `state.js`**

Добавить рядом с `removeAgent` (после строки 262):

```js
// Найти агента по роли (или id как fallback) — используется пайплайном сцены
// и Книжным архитектором для чтения temp/maxTokens конкретной роли.
export function ag(state, role){
  return (state.agents||[]).find(a=>a.role===role || a.id===role) || {};
}
```

- [ ] **Шаг 2: Убрать локальное определение в `pipeline.js`, импортировать**

Найти `литсовет/src/pipeline.js:62`:
```js
function ag(state, role){ return (state.agents||[]).find(a=>a.role===role || a.id===role) || {}; }
```
Удалить эту строку. В блоке импортов из `./state.js` в начале файла добавить `ag` к списку импортируемых имён (посмотреть текущий импорт из `state.js` в `pipeline.js` и дописать `ag` в фигурные скобки).

- [ ] **Шаг 3: Проверить синтаксис обоих файлов**

Run: `node --input-type=module --check < литсовет/src/state.js && node --input-type=module --check < литсовет/src/pipeline.js`
Expected: без вывода.

- [ ] **Шаг 4: Живая проверка — пайплайн сцены не сломан**

Открыть проект с уже написанной сценой, нажать «Написать заново» на одной сцене (или эквивалент из `renderWrite`) через `mcp__Claude_Preview__*`, убедиться что пайплайн отрабатывает как раньше (Прозаик → Оценщик → Стражи), нет ошибки `ag is not defined` в консоли (`preview_console_logs`).

- [ ] **Шаг 5: Commit**

```bash
git add литсовет/src/state.js литсовет/src/pipeline.js
git commit -m "refactor(литсовет): вынести ag() в state.js — устранить дублирование перед новым потребителем"
```

---

### Task 3: `state.js` — новые поля проекта, агент «Книжный архитектор», structureStale

**Files:**
- Modify: `литсовет/src/state.js`

- [ ] **Шаг 1: Новые поля `project` в `defaultState()`**

В блоке `project:` (строка ~26-42), сразу после `useVoice: false,`:

```js
      useVoice: false,          // показывать вкладку «Голос» и учитывать образец
      useWorld: false,          // показывать вкладку «Мир» (проактивный worldbuilding)
      sceneWords: 0,            // 0 = авто (totalWords/60, зажато 700-2000); явное значение — диапазон 300-4000
      chapterCount: 0,          // 0 = «авто» — предзаполняет #chCount на Структуре
      pacing: 'balanced',       // action | balanced | reflective — доля сцена/секвель у Архитектора
      seriesSummary: '',        // краткое содержание предыдущих книг серии (для книги 2+)
```

(переставлять `seriesSummary` не нужно — просто вставить 4 новые строки перед ней, сохранив остальной порядок).

- [ ] **Шаг 2: Новое поле верхнего уровня `structureStale`**

В объекте, возвращаемом `defaultState()`, добавить рядом с `structure: []`,:

```js
    structure: [],             // плоский массив узлов {type:'chapter'|'scene', ...}
    structureStale: false,     // true — в канон добавлены world-факты после того как скелет уже построен
```

- [ ] **Шаг 3: Новая запись агента в `defaultAgents()`**

Добавить в конец массива, возвращаемого `defaultAgents()` (после записи `dialogue`, перед закрывающей `];`):

```js
    { id:'bookArchitect', name:'Книжный архитектор', icon:'🏛️', temp:0.6, enabled:true, role:'bookArchitect',
      desc:'Строит скелет книги (главы→сцены) на стадии Структуры. Один запуск на книгу, не часть цикла сцены — maxTokens считается автоматически по объёму книги, не настраивается.' },
```

Не путать с существующей записью `role:'architect'` (`«Архитектор сцены»`, строка 86) — это другая, оперативная роль на уровне одной сцены (`ondemand.js`), не трогаем её.

- [ ] **Шаг 4: Проверить, что `migrate()` подхватит новые поля без ручной миграции**

Прочитать `migrate()` (строка ~362): `s.project = Object.assign({}, d.project, s.project)` уже покроет `useWorld`/`sceneWords`/`chapterCount`/`pacing` для существующих проектов (то же самое, чем уже покрывался `useVoice`). Агенты мигрируют через блок `newBuiltins` (строка ~386) — новый `bookArchitect` из `d.agents`, которого нет в сохранённых `s.agents` (`storedIds`), автоматически попадёт в `newBuiltins` и добавится в конец списка. `structureStale` — верхнеуровневое поле state, не `project`; добавить его в `migrate()` явно, т.к. `Object.assign` на `project` его не коснётся:

Добавить в `migrate()` после `s.diagnostics = s.diagnostics || { runs: [] };`:
```js
  s.structureStale = s.structureStale || false;
```

- [ ] **Шаг 5: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/state.js`
Expected: без вывода.

- [ ] **Шаг 6: Живая проверка**

Через `preview_eval` на сервере с уже существующим (созданным до этой правки) проектом — открыть/переключиться на него, затем:
```js
const { getState } = await import('/src/state.js');
const s = getState();
({
  useWorld: s.project.useWorld, sceneWords: s.project.sceneWords, chapterCount: s.project.chapterCount, pacing: s.project.pacing,
  hasBookArchitect: s.agents.some(a=>a.id==='bookArchitect'),
  structureStale: s.structureStale,
})
```
Expected: `useWorld:false`, `sceneWords:0`, `chapterCount:0`, `pacing:'balanced'`, `hasBookArchitect:true`, `structureStale:false` — без единой ручной правки данных, т.е. миграция сработала на СУЩЕСТВУЮЩЕМ (не новом) проекте.

- [ ] **Шаг 7: Commit**

```bash
git add литсовет/src/state.js
git commit -m "feat(литсовет): поля useWorld/sceneWords/chapterCount/pacing + агент Книжный архитектор"
```

---

### Task 4: `world.js` — категории и агент-суггестер фактов мира

**Files:**
- Create: `литсовет/src/world.js`

- [ ] **Шаг 1: Написать файл**

```js
// Агент «Мир» — проактивный worldbuilding до Структуры (в отличие от
// «архивариуса», который вытаскивает факты РЕАКТИВНО из уже написанного
// текста, см. summarizer.js/series.js). Одобренные факты пишутся в обычную
// Библию (state.bible[]) с source:'world' — переиспользует существующую
// TF-IDF-систему канона, отдельного хранилища нет (спека §4).

import { callLLM, extractJSON } from './llm.js';
import { generateImage } from './imagegen.js';

// Жанры с придуманным сеттингом — авто-включают project.useWorld (см.
// ui/stages.js renderConcept) и добавляют категорию магии/технологии/системы.
// «альтернативн» — намеренно короче полного слова, матчит и «альтернативная
// история», и падежные формы; не пересекается по подстроке с «исторический
// роман» (проверено в Task 1).
export const WORLD_GENRES = ['фэнтези', 'фантастика', 'ромфант', 'литрпг', 'мистика', 'ужасы', 'альтернативн'];

export function genreWantsWorld(genre){
  const g = (genre||'').toLowerCase();
  return WORLD_GENRES.some(w=>g.includes(w));
}

const BASE_CATEGORIES = ['география', 'история', 'фракции', 'культура'];

// Genre-aware набор категорий (спека §5.2) — детерминированный список на
// стороне кода, не свободная генерация набора самим агентом.
export function categoriesFor(genre){
  const g = (genre||'').toLowerCase();
  const cats = [...BASE_CATEGORIES];
  if(g.includes('литрпг')){
    cats.splice(1, 0, 'система');
  } else if(genreWantsWorld(g)){
    cats.splice(1, 0, 'магия/технология');
  }
  return cats;
}

const CATEGORY_HINTS = {
  'география': 'места действия, расстояния, климат, что где находится',
  'история': 'ключевые прошлые события, формирующие настоящее',
  'магия/технология': 'как это работает — и ЯВНО, что оно НЕ может делать / чего стоит (ограничения не менее важны, чем возможности: без них автор потом придумывает deus ex machina, а стражи не могут это поймать, т.к. в каноне нет отрицательных фактов)',
  'система': 'правила прогрессии — уровни, статы, классы, есть ли пермасмерть',
  'фракции': 'силы в конфликте, их цели',
  'культура': 'повседневность, соц. нормы, статус/обращение, религия/мировоззрение — не только быт (еда/одежда)',
};

// Альт-история требует явной точки развилки в категории «история» — не
// хардблок (см. missingPOD ниже), но агент должен явно про это знать.
function altHistoryNote(genre){
  const g = (genre||'').toLowerCase();
  if(!g.includes('альтернативн')) return '';
  return 'ЭТОТ ЖАНР ТРЕБУЕТ явной точки развилки в категории «история»: конкретное историческое событие + год + что пошло иначе + 2-3 конкретных следствия (технологические/политические/культурные), логически из неё вытекающих. Без точки развилки жанр не работает — обязательно включи такой факт.';
}

export function worldSuggestMessages(state, hints={}){
  const p = state.project;
  const cats = categoriesFor(p.genre);
  const sys = [
    'Ты — соавтор по мироустройству (worldbuilding). Ты предлагаешь конкретные факты мира книги — НЕ пишешь прозу и не строишь сюжет.',
    'Каждый факт — конкретное, проверяемое утверждение (не «в этом мире есть магия», а «боевая магия истощает год жизни за каждое применение») — расплывчатые факты хуже работают с системой поиска канона и не помогают стражам ловить противоречия.',
    `Категории и что в них важно:\n${cats.map(c=>`— ${c}: ${CATEGORY_HINTS[c]||''}`).join('\n')}`,
    altHistoryNote(p.genre),
  ].filter(Boolean).join('\n');
  const user = [
    `Жанр: ${p.genre||'роман'}${p.subgenre?', '+p.subgenre:''}.`,
    p.era ? `Эпоха: ${p.era}.` : '',
    (p.synopsis||p.idea) ? `Синопсис: ${p.synopsis||p.idea}` : '',
    hints.ideaSeed ? `Идея мира от автора: ${hints.ideaSeed}` : '',
    hints.limitation ? `Что герой не может получить/сделать без магии/технологии: ${hints.limitation}` : '',
    hints.antagonistFaction ? `Фракция/сила, антагонистичная герою: ${hints.antagonistFaction}` : '',
    '',
    `Предложи 8-15 фактов мира, распределённых по категориям: ${cats.join(', ')}.`,
    'Верни JSON: { "facts": [ { "category": "одна из категорий выше", "keys": "2-4 ключевых слова через запятую", "text": "сам факт, 1-2 предложения" } ] }',
    'Только JSON.',
  ].filter(Boolean).join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

export async function suggestWorldFacts(state, hints={}){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ текстовой модели (⚙).');
  const msgs = worldSuggestMessages(state, hints);
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.8, messages:msgs, maxTokens:1800, retries:g.retries });
  const j = extractJSON(res.text);
  const arr = j && Array.isArray(j.facts) ? j.facts : null;
  if(!arr) throw new Error('Не удалось разобрать ответ агента «Мир».');
  const cats = categoriesFor(state.project.genre);
  return arr.slice(0, 20).map((f,i)=>({
    id: 'wf_'+Date.now().toString(36)+'_'+i,
    category: cats.includes(f.category) ? f.category : cats[0],
    keys: String(f.keys||'').slice(0,120),
    text: String(f.text||'').trim().slice(0,500),
  })).filter(f=>f.text);
}

// Мягкая проверка (не блокирует, спека §10) — для альт-истории нужен хотя бы
// один факт категории «история» в каноне. Не валидируем содержание.
export function missingPOD(state){
  const g = (state.project?.genre||'').toLowerCase();
  if(!g.includes('альтернативн')) return false;
  return !(state.bible||[]).some(b=>b.source==='world' && b.category==='история');
}
```

- [ ] **Шаг 2: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/world.js`
Expected: без вывода.

- [ ] **Шаг 3: Живая проверка (реальный вызов LLM — нужен настоящий API-ключ в настройках)**

Через `preview_eval`:
```js
const worldMod = await import('/src/world.js');
const { getState } = await import('/src/state.js');
const s = getState();
s.project.genre = 'фэнтези';
const facts = await worldMod.suggestWorldFacts(s, {});
({ count: facts.length, categories: [...new Set(facts.map(f=>f.category))], sample: facts[0] })
```
Expected: `count` 8-20, `categories` содержит `магия/технология` (т.к. жанр фэнтези), `sample` — объект `{id, category, keys, text}` с непустым `text`.

- [ ] **Шаг 4: Commit**

```bash
git add литсовет/src/world.js
git commit -m "feat(литсовет): агент «Мир» — genre-aware категории и генерация фактов"
```

---

### Task 5: `world.js` — карта мира (отдельный путь, не через suggestIllustrations)

**Files:**
- Modify: `литсовет/src/world.js`

- [ ] **Шаг 1: Дописать в конец файла**

```js
// ── Карта мира — НЕ через suggestIllustrations()/illustrationSuggestMessages()
// (те требуют doneScenesOrdered(state), а на стадии «Мир» сцен ещё нет, спека §9).
// Переиспользуется только низкоуровневый generateImage() из imagegen.js.
export function mapPromptFor(state){
  const geoFacts = (state.bible||[]).filter(b=>b.source==='world' && b.category==='география');
  if(!geoFacts.length) throw new Error('Нужно хотя бы несколько фактов категории «География» в каноне.');
  const p = state.project;
  const facts = geoFacts.map(f=>f.text).join(' ');
  const style = `${p.genre||'роман'}${p.era?', '+p.era:''}`;
  return `Fantasy-style map, top-down bird's-eye view, labeled key locations, cartography illustration style, aged paper texture, no text artifacts. Setting: ${style}. Geography: ${facts}`.slice(0, 900);
}

export async function generateWorldMap(state){
  const ic = state.illustrations || {};
  if(!ic.apiKey) throw new Error('Не задан API-ключ для генерации картинок (⚙).');
  const prompt = mapPromptFor(state);
  const { dataUrl } = await generateImage({
    provider: ic.provider||'gemini',
    apiKey: ic.apiKey,
    model: ic.model,
    prompt,
    size: ic.size,
    quality: ic.quality,
    proxyToken: state.global?.proxyToken,
  });
  return dataUrl;
}
```

- [ ] **Шаг 2: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/world.js`
Expected: без вывода.

- [ ] **Шаг 3: Живая проверка (без реального ключа — только промпт-билдер)**

```js
const worldMod = await import('/src/world.js');
const { getState } = await import('/src/state.js');
const s = getState();
s.bible = s.bible || [];
s.bible.push({ keys:'город', text:'Столица стоит на слиянии трёх рек, окружена горами с севера.', source:'world', category:'география' });
s.project.genre = 'фэнтези';
worldMod.mapPromptFor(s) // должно вернуть непустую строку с текстом факта внутри
```
Expected: строка содержит `"слиянии трёх рек"`. Отдельно, реальный вызов `generateWorldMap` (с настоящим image-ключом) — проверяется в составе Task 8 (UI уже собран) и финального Task 16.

- [ ] **Шаг 4: Commit**

```bash
git add литсовет/src/world.js
git commit -m "feat(литсовет): промпт и генерация карты мира — отдельно от suggestIllustrations"
```

---

### Task 6: `world.js` — Архитектор предлагает недостающие факты канона

Реализует «открытый канал» из спеки §7: после построения скелета — необязательный follow-up вызов (по образцу того, как `runStructureEval` уже следует за `runBookArchitect`), который сверяет скелет с каноном и предлагает то, чего не хватает. Не блокирует применение скелета, ошибка проглатывается молча (скелет уже применён к этому моменту).

**Files:**
- Modify: `литсовет/src/world.js`

- [ ] **Шаг 1: Дописать в конец файла**

```js
// ── Архитектор сверяет скелет с каноном (спека §7 — канал остаётся открытым,
// не одноразовый гейт). Не критично для успеха генерации скелета — при сбое
// возвращает [], а не бросает ошибку.
export function missingFactsMessages(state, skeleton){
  const p = state.project;
  const worldFacts = (state.bible||[]).filter(b=>b.source==='world');
  const canonText = worldFacts.length ? worldFacts.map(f=>`— ${f.text}`).join('\n') : '(канон пуст)';
  const skeletonText = skeleton.chapters.map((ch,ci)=>
    (ch.scenes||[]).map((sc,si)=>`${ci+1}.${si+1}. ${sc.brief||sc.title}`).join('\n')
  ).join('\n');
  const sys = 'Ты — книжный архитектор. Ты только что спроектировал скелет книги. Сверь его с уже зафиксированным каноном мира и найди факты, на которые скелет ОПИРАЕТСЯ (упоминает как данность), но которых в каноне ещё нет. НЕ придумывай новые сюжетные повороты — только формализуй то, что уже подразумевает скелет.';
  const user = [
    `Жанр: ${p.genre||'роман'}.`,
    `КАНОН МИРА:\n${canonText}`,
    '',
    `СКЕЛЕТ КНИГИ:\n${skeletonText}`,
    '',
    'До 5 фактов, которых не хватает канону (если скелету ничего не нужно — верни пустой массив facts). Верни JSON: { "facts": [ { "category": "география|история|фракции|культура|магия/технология|система", "keys": "ключевые слова", "text": "факт" } ] }',
    'Только JSON.',
  ].join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

export async function suggestMissingWorldFacts(state, skeleton){
  const g = state.global;
  if(!g.apiKey) return [];
  try{
    const msgs = missingFactsMessages(state, skeleton);
    const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.4, messages:msgs, maxTokens:800, retries:g.retries });
    const j = extractJSON(res.text);
    const arr = j && Array.isArray(j.facts) ? j.facts : [];
    return arr.slice(0,5).map((f,i)=>({
      id: 'wf_missing_'+Date.now().toString(36)+'_'+i,
      category: String(f.category||'история'),
      keys: String(f.keys||'').slice(0,120),
      text: String(f.text||'').trim().slice(0,500),
    })).filter(f=>f.text);
  }catch{ return []; }
}
```

- [ ] **Шаг 2: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/world.js`
Expected: без вывода.

- [ ] **Шаг 3: Commit**

```bash
git add литсовет/src/world.js
git commit -m "feat(литсовет): Архитектор предлагает недостающие факты канона после скелета"
```

(Живая проверка этой функции — в составе Task 13, где она реально вызывается из UI.)

---

### Task 7: `illustrations.js` — точка сохранения карты (без `suggestIllustrations`)

**Files:**
- Modify: `литсовет/src/illustrations.js`

- [ ] **Шаг 1: Добавить экспортируемую функцию сохранения карты**

Дописать в конец файла:

```js
// Сохранить сгенерированную карту мира в общую галерею (единый источник
// правды — state.illustrations.items, спека §9). Вызывается из world.js
// напрямую, минуя suggestIllustrations()/doneScenesOrdered (на стадии «Мир»
// сцен ещё нет). Одна карта на проект — повторная генерация заменяет старую,
// не копит версии (в отличие от сцен/обложки).
export function saveMapItem(state, dataUrl){
  state.illustrations = state.illustrations || {};
  state.illustrations.items = (state.illustrations.items||[]).filter(it=>it.type!=='map');
  const item = { id:'map_'+Date.now().toString(36), type:'map', sceneId:null, sceneTitle:'', prompt:'', dataUrl, createdAt:Date.now() };
  state.illustrations.items.push(item);
  return item;
}
```

- [ ] **Шаг 2: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/illustrations.js`
Expected: без вывода.

- [ ] **Шаг 3: Commit**

```bash
git add литсовет/src/illustrations.js
git commit -m "feat(литсовет): точка сохранения карты мира в общую галерею иллюстраций"
```

---

### Task 8: `ui/world.js` — рендер стадии «Мир»

**Files:**
- Create: `литсовет/src/ui/world.js`

- [ ] **Шаг 1: Написать файл**

```js
// Стадия «Мир»: проактивный worldbuilding до Структуры. Кандидаты предлагает
// текстовый LLM (тот же, что и для прозы — не тратит отдельных денег), автор
// одобряет, факты уходят в общую Библию. Карта — отдельная кнопка, платный
// image-API, только по явному клику (спека §5, §6, §9).

import { getState, save } from '../state.js';
import { rebuildBibleVecs } from '../bible.js';
import { suggestWorldFacts, missingPOD, generateWorldMap } from '../world.js';
import { saveMapItem } from '../illustrations.js';
import { estimateImageCost } from '../imagegen.js';
import { esc } from './stages.js';

let _candidates = [];       // предложенные, ещё не одобренные факты
let _selected = new Set();  // id одобренных чекбоксом
let _collapsed = new Set(); // свёрнутые категории (по умолчанию всё развёрнуто)
let _busy = false;
let _busyText = '';
let _mapBusy = false;

function groupByCategory(items){
  const out = {};
  items.forEach(c=>{ (out[c.category] = out[c.category]||[]).push(c); });
  return out;
}

function renderCandidates(){
  if(!_candidates.length) return '';
  const byCat = groupByCategory(_candidates);
  return `<div class="ph">Кандидаты</div>
    ${Object.entries(byCat).map(([cat, items])=>`
      <div class="mem-h mem-h-toggle" data-cat="${esc(cat)}" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:6px">
        <span>${_collapsed.has(cat)?'▸':'▾'} ${esc(cat)} (${items.length})</span>
      </div>
      ${_collapsed.has(cat) ? '' : items.map(c=>`
        <div class="apv-row" style="flex-direction:column;align-items:stretch;gap:4px">
          <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">
            <input type="checkbox" class="w-cb" data-id="${c.id}" ${_selected.has(c.id)?'checked':''} style="margin-top:3px">
            <div style="flex:1">
              <input type="text" class="w-keys" data-id="${c.id}" value="${esc(c.keys)}" style="font-size:11px;color:var(--text-2);border:none;background:transparent;width:100%;padding:0;margin-bottom:2px">
              <textarea class="w-text" data-id="${c.id}" rows="2" style="width:100%;font-size:13px">${esc(c.text)}</textarea>
            </div>
          </label>
        </div>`).join('')}
    `).join('')}
    <div class="row" style="justify-content:flex-end;gap:8px;margin:10px 0 18px">
      <button class="btn" id="wClear">Отменить</button>
      <button class="btn btn-primary" id="wApprove" ${_selected.size?'':'disabled'}>Сохранить в канон (${_selected.size})</button>
    </div>`;
}

function renderCanon(worldFacts){
  if(!worldFacts.length) return '';
  return `<div class="ph">Уже в каноне</div>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:18px">
      ${worldFacts.map(f=>`<div class="mem-card">
        <div class="mem-title" style="color:var(--accent)">${esc(f.keys||f.category||'факт')}</div>
        <div class="muted" style="font-size:12px">${esc(f.text)}</div>
      </div>`).join('')}
    </div>`;
}

function renderMapBlock(s, geoCount){
  const items = s.illustrations?.items||[];
  const map = items.find(it=>it.type==='map');
  const canGenerate = geoCount >= 2;
  const cost = estimateImageCost(s.illustrations?.provider||'gemini', s.illustrations?.quality||'standard', 1);
  return `<div class="ph">Карта мира (референс)</div>
    <div class="pad">
      ${map ? `<img src="${map.dataUrl}" style="max-width:280px;border-radius:var(--radius);display:block;margin-bottom:8px">
        <div class="muted" style="font-size:11px;margin-bottom:8px">Также доступно в разделе «Иллюстрации» →</div>` : ''}
      ${canGenerate
        ? `<button class="btn" id="wMap">${_mapBusy?'<span class="spinner"></span> …':(map?'🔄 Перегенерировать':'🗺 Сгенерировать карту')} — ~$${cost}</button>`
        : `<div class="muted" style="font-size:12px">Нужно хотя бы 2-3 факта категории «География», чтобы предложить карту.</div>`}
    </div>`;
}

export function renderWorld(els){
  const s = getState();
  const p = s.project;
  const worldFacts = (s.bible||[]).filter(b=>b.source==='world');
  const geoCount = worldFacts.filter(b=>b.category==='география').length;
  const podWarning = missingPOD(s);

  els.left.innerHTML = `<div class="ph">Мир</div>
    <div class="pad muted" style="font-size:12px">${worldFacts.length ? `${worldFacts.length} фактов в каноне` : 'Пока нет фактов мира.'}</div>`;

  els.right.innerHTML = `<div class="ph">Подсказки (необязательно)</div><div class="pad">
    <div class="field"><label>Идея мира</label>
      <textarea id="wSeed" rows="2" placeholder="в общих чертах, если есть — иначе агент оттолкнётся от жанра и синопсиса"></textarea></div>
    <div class="field"><label>Что герой не может получить/сделать без магии/технологии?</label>
      <input type="text" id="wLimit" placeholder="это и есть её главное ограничение"></div>
    <div class="field"><label>Какая фракция/сила антагонистична герою?</label>
      <input type="text" id="wAntag" placeholder="и почему"></div>
  </div>`;

  els.center.className = 'panel panel-center';
  els.center.innerHTML = `
    <div class="read-bar">
      <span class="read-title">Мир</span>
      <span style="flex:1"></span>
      <button class="btn btn-primary" id="wSuggest">${_busy?'<span class="spinner"></span> '+esc(_busyText):'✨ Предложить мир'}</button>
    </div>
    <div class="read-body" id="wBody">
      ${podWarning ? `<div class="pad" style="border:1px solid var(--err);border-radius:8px;margin:0 0 14px;background:var(--surface-2)">
        <div style="font-size:12px;color:var(--err)">⚠ Для альтернативной истории точка развилки — основа жанра. Добавьте факт категории «История» с чёткой развилкой (событие + год + следствия), прежде чем продолжать.</div>
      </div>` : ''}
      ${renderCandidates()}
      ${renderCanon(worldFacts)}
      ${renderMapBlock(s, geoCount)}
      <div class="row" style="margin-top:18px;justify-content:flex-end">
        <button class="btn btn-primary" id="wNext">Дальше — ${p.useVoice?'Голос':'Структура'} →</button>
      </div>
    </div>`;

  bindHandlers(els, s);
}

function bindHandlers(els, s){
  const sb = document.getElementById('wSuggest');
  if(sb) sb.onclick = async ()=>{
    if(!s.global.apiKey){ alert('Задайте API-ключ текстовой модели в настройках (⚙).'); return; }
    if(_busy) return;
    const hints = {
      ideaSeed: document.getElementById('wSeed')?.value.trim(),
      limitation: document.getElementById('wLimit')?.value.trim(),
      antagonistFaction: document.getElementById('wAntag')?.value.trim(),
    };
    _busy = true; _busyText = 'Продумываю мир…'; renderWorld(els);
    try{
      _candidates = await suggestWorldFacts(s, hints);
      _selected = new Set(_candidates.map(c=>c.id));
    }catch(e){ alert('Мир: '+e.message); }
    finally{ _busy = false; _busyText=''; renderWorld(els); }
  };

  document.querySelectorAll('.mem-h-toggle[data-cat]').forEach(h=>h.onclick=()=>{
    const cat = h.dataset.cat;
    if(_collapsed.has(cat)) _collapsed.delete(cat); else _collapsed.add(cat);
    renderWorld(els);
  });

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

  const wc = document.getElementById('wClear');
  if(wc) wc.onclick = ()=>{ _candidates=[]; _selected=new Set(); renderWorld(els); };

  const wa = document.getElementById('wApprove');
  if(wa) wa.onclick = ()=>{
    const approved = _candidates.filter(c=>_selected.has(c.id));
    s.bible = s.bible || [];
    approved.forEach(c=>{ s.bible.push({ keys:c.keys, text:c.text, source:'world', category:c.category }); });
    rebuildBibleVecs(s.bible);
    _candidates = _candidates.filter(c=>!_selected.has(c.id));
    _selected = new Set();
    if((s.structure||[]).some(n=>n.type==='chapter')) s.structureStale = true;
    save(); renderWorld(els);
  };

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

- [ ] **Шаг 2: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/ui/world.js`
Expected: без вывода (может показать предупреждение об отсутствующем `stages.js` при статической проверке импорта — это нормально, `node --check` не резолвит импорты, только парсит синтаксис).

- [ ] **Шаг 3: Commit**

```bash
git add литсовет/src/ui/world.js
git commit -m "feat(литсовет): UI стадии «Мир» — категории, ревью, карта"
```

(Живая проверка полного UI — после Task 9, когда стадия зарегистрирована в рейле.)

---

### Task 9: Регистрация стадии `world` в `ui/app.js`

**Files:**
- Modify: `литсовет/src/ui/app.js`

- [ ] **Шаг 1: Импорт**

Строка 7, рядом с `import { renderIllustrations } from './illustrations.js';`, добавить:
```js
import { renderWorld } from './world.js';
```

- [ ] **Шаг 2: `STAGES` — новая запись между `concept` и `voice`**

Строка 31-38, порядок отражает реальный поток («Мир» до «Голоса» — так решает цепочка кнопок «Дальше» из Концепции, см. Task 10):
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

- [ ] **Шаг 3: `stageDone()` — новая ветка**

Строка 50-57, добавить `case`:
```js
function stageDone(state, stageId){
  switch(stageId){
    case 'concept': return !!state.project.idea || !!state.project.title;
    case 'world':   return (state.bible||[]).some(b=>b.source==='world');
    case 'voice':   return (state.voice.examples||[]).length>0;
    case 'structure': return (state.structure||[]).some(n=>n.type==='scene');
    default: return false;
  }
}
```

- [ ] **Шаг 4: `renderRail()` — видимость по `useVoice` И `useWorld`**

Строка 62, заменить:
```js
  const visibleStages = s.project?.useVoice ? STAGES : STAGES.filter(st=>st.id!=='voice');
```
на:
```js
  const visibleStages = STAGES.filter(st=>{
    if(st.id==='voice') return !!s.project?.useVoice;
    if(st.id==='world') return !!s.project?.useWorld;
    return true;
  });
```

- [ ] **Шаг 5: `renderStage()` — диспетч**

Строка 74-88, добавить ветку (после `concept`, перед `voice` — порядок веток if/else не влияет на поведение, но держим согласованным с STAGES):
```js
  if(stage==='concept'){ renderConcept(els); }
  else if(stage==='world'){ renderWorld(els); }
  else if(stage==='voice'){ renderVoice(els); }
```

- [ ] **Шаг 6: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/ui/app.js`
Expected: без вывода.

- [ ] **Шаг 7: Живая проверка**

Через `mcp__Claude_Preview__*`: запустить сервер, открыть приложение, `preview_eval`:
```js
const { getState, save } = await import('/src/state.js');
const s = getState(); s.project.useWorld = true; save();
```
Затем `preview_eval('window.location.reload()')`, `preview_snapshot` — в рейле должна появиться кнопка «Мир» между «Концепция» и «Голос» (или сразу после «Концепция», если «Голос» выключен). Кликнуть по ней (`preview_click`) — должна отрисоваться стадия из Task 8 без ошибок в консоли (`preview_console_logs`).

- [ ] **Шаг 8: Commit**

```bash
git add литсовет/src/ui/app.js
git commit -m "feat(литсовет): регистрация стадии «Мир» в рейле и диспетчере"
```

---

### Task 10: `ui/stages.js renderConcept` — тумблер `useWorld`, авто-жанр, цепочка «Дальше»

**Files:**
- Modify: `литсовет/src/ui/stages.js`

- [ ] **Шаг 1: Импорт**

В начале файла (рядом с импортом `GENRES` из `../genres.js` — найти существующую строку импорта genres) добавить:
```js
import { genreWantsWorld } from '../world.js';
```

- [ ] **Шаг 2: Вычислить начальное состояние подсказки**

В `renderConcept(els)` (строка 116-122), рядом с `_canTitles`, добавить:
```js
  const _worldAutoLabel = (p.useWorld && genreWantsWorld(p.genre));
```

- [ ] **Шаг 3: Чекбокс «Мир» в «Дополнительных настройках»**

Строка 190-194 (сразу после блока `useVoice`), добавить:
```js
        <label class="field row" style="gap:8px;cursor:pointer;align-items:center">
          <input type="checkbox" id="useWorld" ${p.useWorld?'checked':''}
            style="width:16px;height:16px;flex-shrink:0">
          <span><b>Мир</b> — включить стадию «Мир» <span class="hint">зафиксировать факты сеттинга до Структуры: география, история, магия/технология, фракции, культура</span></span>
        </label>
        <div id="useWorldAutoLabel" class="hint" style="margin:-6px 0 10px 24px;${_worldAutoLabel?'':'display:none'}">Включено автоматически для жанра «${esc(GENRES.find(g=>g.v===p.genre)?.label||p.genre)}» — можно выключить</div>
```

- [ ] **Шаг 4: Обновить кнопку «Дальше» — учитывает `useWorld`**

Строка 214, заменить:
```js
        <button class="btn btn-primary" id="toNext">Дальше — ${p.useVoice?'Голос':'Структура'} →</button>
```
на:
```js
        <button class="btn btn-primary" id="toNext">Дальше — ${p.useWorld?'Мир':p.useVoice?'Голос':'Структура'} →</button>
```

- [ ] **Шаг 5: Genre onchange — авто-проставление `useWorld`**

В обработчике `genreSel.onchange` (строка 265-277), внутри ветки `else` (после блока `if(gd && gd.words){...}`), добавить:
```js
      } else {
        genreCustom.style.display='none';
        p.genre = v;
        if(gd && gd.words){ p.targetWords=gd.words; const tw=document.getElementById('tw'); if(tw) tw.value=gd.words; const h=document.getElementById('twHint'); if(h) h.textContent=sceneCountHint(gd.words); }
        p.useWorld = genreWantsWorld(v);
        const uw = document.getElementById('useWorld'); if(uw) uw.checked = p.useWorld;
        const lbl = document.getElementById('useWorldAutoLabel');
        if(lbl){ lbl.style.display = p.useWorld?'':'none'; lbl.textContent = `Включено автоматически для жанра «${gd?gd.label:v}» — можно выключить`; }
        const btn = document.getElementById('toNext'); if(btn) btn.textContent = 'Дальше — '+(p.useWorld?'Мир':p.useVoice?'Голос':'Структура')+' →';
      }
```

- [ ] **Шаг 6: Обработчик самого чекбокса**

После обработчика `useVoice.onchange` (строка 300-305), добавить:
```js
  document.getElementById('useWorld').onchange = (ev)=>{
    p.useWorld = ev.target.checked;
    const btn = document.getElementById('toNext'); if(btn) btn.textContent = 'Дальше — '+(p.useWorld?'Мир':p.useVoice?'Голос':'Структура')+' →';
    const lbl = document.getElementById('useWorldAutoLabel'); if(lbl) lbl.style.display = 'none'; // ручное решение — авто-подсказка больше не актуальна
    save();
  };
```

- [ ] **Шаг 7: Обновить `toNext.onclick` — учитывает `useWorld`**

Строка 313, заменить:
```js
  document.getElementById('toNext').onclick = ()=>{ save(); s.ui.stage = p.useVoice?'voice':'structure'; save(); };
```
на:
```js
  document.getElementById('toNext').onclick = ()=>{ save(); s.ui.stage = p.useWorld?'world':(p.useVoice?'voice':'structure'); save(); };
```

- [ ] **Шаг 8: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/ui/stages.js`
Expected: без вывода.

- [ ] **Шаг 9: Живая проверка**

Через `mcp__Claude_Preview__*`: на стадии Концепция выбрать жанр «Фэнтези» в select — проверить (`preview_inspect`/`preview_eval`), что чекбокс «Мир» в доп. настройках стал отмечен, подпись «Включено автоматически…» видна, кнопка «Дальше» показывает «Дальше — Мир →». Кликнуть «Дальше» — должна открыться стадия «Мир». Затем вручную снять чекбокс — подпись должна скрыться, кнопка обновиться на «Структура» (если Голос выключен).

- [ ] **Шаг 10: Commit**

```bash
git add литсовет/src/ui/stages.js
git commit -m "feat(литсовет): тумблер «Мир» в Концепции — авто по жанру + ручное управление"
```

---

### Task 11: `ui/stages.js renderConcept` — поля `sceneWords`/`chapterCount`/`pacing`

**Files:**
- Modify: `литсовет/src/ui/stages.js`

- [ ] **Шаг 1: Добавить поля рядом с «Целевой объём (слов)»**

Строка 186-189, после блока `#tw`/`#twHint`, добавить:
```js
        <div class="field"><label>Объём сцены (слов) <span class="hint">пусто/0 = авто (≈{targetWords}/60 слов, зажато 700–2000)</span></label>
          <input type="text" id="sceneWords" value="${p.sceneWords||''}" placeholder="авто"></div>
        <div class="field"><label>Число глав <span class="hint">пусто/0 = «авто» (пресказывается стадии Структура, там можно переопределить точечно)</span></label>
          <input type="text" id="chapterCount" value="${p.chapterCount||''}" placeholder="авто"></div>
        <div class="field"><label>Темп/ритм <span class="hint">доля сцена/секвель у Архитектора при построении структуры</span></label>
          <select id="pacing">
            <option value="action"${p.pacing==='action'?' selected':''}>Динамичный</option>
            <option value="balanced"${(!p.pacing||p.pacing==='balanced')?' selected':''}>Сбалансированный</option>
            <option value="reflective"${p.pacing==='reflective'?' selected':''}>Медитативный</option>
          </select></div>
```

- [ ] **Шаг 2: Привязка событий**

Рядом с `bind('tw', ...)` (строка 257-260), добавить:
```js
  bind('sceneWords', e=>{ p.sceneWords=parseInt(e.target.value)||0; });
  bind('chapterCount', e=>{ p.chapterCount=parseInt(e.target.value)||0; });
  const pacingSel = document.getElementById('pacing');
  if(pacingSel) pacingSel.onchange = ()=>{ p.pacing = pacingSel.value; };
```

(`bind()` уже определён выше в файле как `addEventListener('input', fn)` — подходит для текстовых полей; для select используем `onchange`, как везде в этом файле, напр. `genreSel.onchange`.)

- [ ] **Шаг 3: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/ui/stages.js`
Expected: без вывода.

- [ ] **Шаг 4: Живая проверка**

Через `mcp__Claude_Preview__*`: открыть «Дополнительные настройки» в Концепции, задать «Объём сцены» = 1500, «Число глав» = 12, «Темп» = Динамичный. `preview_eval`:
```js
(await import('/src/state.js')).getState().project // sceneWords:1500, chapterCount:12, pacing:'action'
```
Expected: значения сохранены в `state.project`.

- [ ] **Шаг 5: Commit**

```bash
git add литсовет/src/ui/stages.js
git commit -m "feat(литсовет): поля объёма сцены/числа глав/темпа в Концепции"
```

---

### Task 12: `architect-book.js` — интеграция world-фактов, sceneWords, pacing, temperature

**Files:**
- Modify: `литсовет/src/architect-book.js`

- [ ] **Шаг 1: Импорты**

Строка 6-7, добавить к существующим импортам:
```js
import { callLLM, extractJSON } from './llm.js';
import { genreBeatsNote } from './genres.js';
import { bibleForPrompt } from './bible.js';
import { ag } from './state.js';
```

- [ ] **Шаг 2: `wPerScene` — читать `project.sceneWords`**

Строка 13-16, заменить:
```js
export function bookArchitectMessages(state, opts={}){
  const p = state.project;
  const totalWords = p.targetWords || 80000;
  // Целевой объём сцены: 1200 слов для романа — реалистичная сцена.
  // Более крупная сцена → меньше вызовов LLM, лучше связность.
  const wPerScene = Math.max(700, Math.min(2000, Math.round(totalWords / 60)));
```
на:
```js
export function bookArchitectMessages(state, opts={}){
  const p = state.project;
  const totalWords = p.targetWords || 80000;
  // Целевой объём сцены: авто (totalWords/60, зажато 700-2000) ИЛИ явный
  // авторский оверрайд (project.sceneWords) — тогда диапазон шире (300-4000):
  // осознанный выбор автора не зажимаем той же вилкой, что защищает только
  // автоформулу от вырожденных случаев общего объёма (спека §12.1).
  const wPerScene = p.sceneWords>0
    ? Math.max(300, Math.min(4000, p.sceneWords))
    : Math.max(700, Math.min(2000, Math.round(totalWords / 60)));
```

- [ ] **Шаг 3: `pacing` — подменить фразу про долю сцена/секвель**

Строка 23-32, последняя строка массива `sys` сейчас:
```js
    'После сильной сцены-потрясения почти всегда нужен короткий sequel — но НЕ жёстко через одну: используй по ощущению ритма, обычно 20-35% сцен книги — sequel.',
  ].join('\n');
```
Заменить на:
```js
    PACING_NOTES[p.pacing] || PACING_NOTES.balanced,
  ].join('\n');
```

Добавить константу перед функцией `bookArchitectMessages` (после `const ARCS = [...]`, строка 9):
```js
const PACING_NOTES = {
  action: 'После сильной сцены-потрясения ЧАСТО (не обязательно) нужен короткий sequel — обычно 10-20% сцен книги — sequel, акцент на действии, реже передышки.',
  balanced: 'После сильной сцены-потрясения почти всегда нужен короткий sequel — но НЕ жёстко через одну: используй по ощущению ритма, обычно 20-35% сцен книги — sequel.',
  reflective: 'После сильной сцены-потрясения нужен sequel почти всегда — обычно 35-50% сцен книги — sequel, акцент на внутренней рефлексии, больше пауз между потрясениями.',
};
```

- [ ] **Шаг 4: World-факты — top-15 через `bibleForPrompt`, сразу после `genreBeatsNote`**

Строка 54 (`genreBeatsNote(p.genre),` внутри массива `user`), добавить сразу после нею:
```js
    genreBeatsNote(p.genre),
    (() => {
      const worldBlock = bibleForPrompt((state.bible||[]).filter(b=>b.source==='world'), p.synopsis||p.idea||'', 15);
      return worldBlock ? `\nМИР КНИГИ (уже зафиксированные факты — не противоречь им):\n${worldBlock}` : '';
    })(),
```

- [ ] **Шаг 5: Temperature — из `ag(state, 'bookArchitect')`**

В `runBookArchitect()` (строка 110-121), заменить:
```js
export async function runBookArchitect(state, opts={}){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ.');
  const msgs = bookArchitectMessages(state, opts);
```
на (добавить чтение агента, не менять остальное):
```js
export async function runBookArchitect(state, opts={}){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ.');
  const architectAgent = ag(state, 'bookArchitect');
  const msgs = bookArchitectMessages(state, opts);
```
И строку с вызовом `callLLM` (внутри цикла `for(let attempt...)`, строка 121):
```js
    const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.6, messages:msgs, maxTokens:archMaxTokens });
```
заменить на:
```js
    const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:architectAgent.temp??0.6, messages:msgs, maxTokens:archMaxTokens });
```

- [ ] **Шаг 6: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/architect-book.js`
Expected: без вывода.

- [ ] **Шаг 7: Живая проверка**

Через `preview_eval` (с реальным ключом, на проекте с несколькими world-фактами в Библии и `project.pacing='action'`, `project.sceneWords=1500`):
```js
const { bookArchitectMessages } = await import('/src/architect-book.js');
const { getState } = await import('/src/state.js');
const s = getState();
const msgs = bookArchitectMessages(s, {});
({
  hasWorldBlock: msgs[1].content.includes('МИР КНИГИ'),
  hasPacingNote: msgs[0].content.includes('10-20%'), // если pacing==='action'
  sceneWordsUsed: msgs[0].content.includes('1500'),
})
```
Expected: все три `true` при соответствующих полях `project`. Затем реально сгенерировать скелет (`runBookArchitect`) — проверить, что `targetWords` сцен близки к 1500, и что вызов ушёл с температурой из `state.agents.find(a=>a.id==='bookArchitect').temp`, а не хардкодом 0.6 (изменить temp на 0.9 через `ag()`/панель «Агенты» из Task 14 и убедиться, что скелет заметно более неожиданный/смелый — качественная, не строгая проверка).

- [ ] **Шаг 8: Commit**

```bash
git add литсовет/src/architect-book.js
git commit -m "feat(литсовет): Архитектор читает world-факты, sceneWords, pacing, temperature из настроек"
```

---

### Task 13: `ui/stages.js renderStructure` — предзаполнение глав, недостающие факты, баннер устаревания

**Files:**
- Modify: `литсовет/src/ui/stages.js`

- [ ] **Шаг 1: Импорт**

Добавить к импортам:
```js
import { suggestMissingWorldFacts } from '../world.js';
```

- [ ] **Шаг 2: Предзаполнить `#chCount` из `project.chapterCount`**

Строка 660-661, заменить:
```js
          <input type="text" id="chCount" value="" placeholder="авто" style="width:70px">
```
на:
```js
          <input type="text" id="chCount" value="${s.project.chapterCount||''}" placeholder="авто" style="width:70px">
```

- [ ] **Шаг 3: Баннер устаревания структуры (`structureStale`)**

После блока `${s.structureEval ? renderStructureEval(s.structureEval) : ''}` (строка 676), добавить:
```js
      ${s.structureStale ? `<div style="margin-top:14px;border:1px solid var(--err);border-radius:8px;padding:12px 14px;background:var(--surface-2)">
        <div style="font-size:12px;color:var(--err)">⚠ Добавлены факты мира после построения структуры — возможно, стоит перестроить.</div>
        <button class="btn" id="dismissStale" style="font-size:11px;margin-top:8px;padding:2px 9px">Скрыть</button>
      </div>` : ''}
      <div id="missingFactsBlock"></div>
```

- [ ] **Шаг 4: Сбрасывать `structureStale` при (пере)генерации скелета + вызывать `suggestMissingWorldFacts`**

В обработчике `genSkeleton.onclick` (строка 681-716), после `s.structureEval = null; // сбрасываем старую оценку`, добавить `s.structureStale = false;`:
```js
      const skeleton = await runBookArchitect(s, chCount?{chapters:chCount}:{});
      applySkeleton(s, skeleton, uid);
      s.structureEval = null; // сбрасываем старую оценку
      s.structureStale = false;
      save();
```
И после блока, где присваивается `s.structureEval = evalResult; save();` (конец текущего try-блока), добавить вызов недостающих фактов (не блокирует — на любую ошибку внутри `suggestMissingWorldFacts` уже возвращается `[]`):
```js
      const evalResult = await runStructureEval(s, skeleton);
      s.structureEval = evalResult;
      save();
      const missing = await suggestMissingWorldFacts(s, skeleton);
      if(missing.length) renderMissingFactCards(missing, s);
```

- [ ] **Шаг 5: Функция карточек недостающих фактов (по образцу `renderFactCards`)**

Добавить рядом с существующей `renderFactCards` (после строки 573):
```js
// Факты, которых, по мнению Архитектора, не хватает канону после построения
// скелета (спека §7 — канал открыт, не одноразовый гейт). Тот же визуальный
// паттерн, что у renderFactCards («Историческая разведка»), но пишет
// source:'world' + category, не смешивается с исторической разведкой.
function renderMissingFactCards(facts, s){
  const el = document.getElementById('missingFactsBlock');
  if(!el) return;
  el.innerHTML = `<div style="margin-top:16px">
    <div class="muted" style="font-size:12px;margin-bottom:8px">Архитектор опирался на факты, которых нет в каноне:</div>
    ${facts.map((f,i)=>`
      <div class="card" style="margin-bottom:8px;padding:10px 12px">
        <div style="font-size:11px;color:var(--accent);font-weight:500;margin-bottom:4px">${esc(f.category)} · ${esc(f.keys)}</div>
        <div style="font-size:12px;line-height:1.5;margin-bottom:7px">${esc(f.text)}</div>
        <button class="btn missing-fact-add" data-i="${i}" style="font-size:11px;padding:3px 9px">${s.bible.some(b=>b.text===f.text)?'✓ В каноне':'+ В канон'}</button>
      </div>`).join('')}
  </div>`;
  el.querySelectorAll('.missing-fact-add').forEach(btn=>{
    btn.onclick=()=>{
      const f = facts[+btn.dataset.i]; if(!f) return;
      if(!s.bible.some(b=>b.text===f.text)){
        s.bible.push({ keys:f.keys, text:f.text, source:'world', category:f.category });
        rebuildBibleVecs(s.bible);
        save();
      }
      btn.textContent='✓ В каноне'; btn.disabled=true;
    };
  });
}
```

- [ ] **Шаг 6: Обработчик кнопки «Скрыть» баннера устаревания**

В `renderStructure()`, рядом с другими обработчиками (после блока `revertSkeleton`), добавить:
```js
  const dismissStale = document.getElementById('dismissStale');
  if(dismissStale) dismissStale.onclick = ()=>{ s.structureStale=false; save(); };
```

- [ ] **Шаг 7: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/ui/stages.js`
Expected: без вывода.

- [ ] **Шаг 8: Живая проверка**

Через `mcp__Claude_Preview__*`, на проекте с уже построенным скелетом: перейти в «Мир», одобрить новый факт → перейти в «Структуру» → баннер устаревания виден. Нажать «Перегенерировать» скелет (с подтверждением) → баннер пропадает (`structureStale` сброшен), а через несколько секунд после `runStructureEval` должен появиться (если Архитектор действительно нашёл пробел) блок «Архитектор опирался на факты, которых нет в каноне» — не гарантированно на каждом прогоне (зависит от реального ответа LLM), но код-путь должен отработать без ошибок в консоли даже если `missing.length===0` (блок просто не рендерится).

- [ ] **Шаг 9: Commit**

```bash
git add литсовет/src/ui/stages.js
git commit -m "feat(литсовет): предзаполнение числа глав, баннер устаревания структуры, предложения недостающих фактов"
```

---

### Task 14: `ui/diagnostics.js` — исключить `maxTokens` и кнопку «▶ запустить» для `bookArchitect`

Без этой правки: (1) панель «Агенты» покажет для Книжного архитектора слайдер «Макс. токенов» с диапазоном 200-4000, хотя реальный расчёт динамический (4000-16000) и намеренно не читается из `agents[]` — слайдер был бы декорацией, вводящей в заблуждение; (2) кнопка «▶» запустит `runAgentOnDemand()` на ТЕКУЩЕЙ СЦЕНЕ, а в `ondemand.js` нет ветки для роли `bookArchitect` — по факту это упадёт в ветку `customGuardMessages` с `undefined` промптом (реальная находка при трассировке кода, не описанная в спеке явно, но прямое следствие того, что Книжный архитектор — не по-сценовый агент).

**Files:**
- Modify: `литсовет/src/ui/diagnostics.js`

- [ ] **Шаг 1: Исключить `maxTokens` из `paramSpecs()`**

Строка 23-27, заменить:
```js
function paramSpecs(a){
  const specs = [
    { key:'temp', label:'Температура', hint:'выше — креативнее, ниже — стабильнее', min:0, max:1, step:0.05, target:'agent', def:0.5, fmt:v=>v.toFixed(2) },
    { key:'maxTokens', label:'Макс. токенов', hint:'потолок длины ответа — Прозаику нужно ≥2400 для 700-слов. сцены', min:200, max:4000, step:100, target:'agent', def:700, fmt:v=>Math.round(v) },
  ];
```
на:
```js
function paramSpecs(a){
  const specs = [
    { key:'temp', label:'Температура', hint:'выше — креативнее, ниже — стабильнее', min:0, max:1, step:0.05, target:'agent', def:0.5, fmt:v=>v.toFixed(2) },
  ];
  // Книжный архитектор: потолок токенов считается динамически по объёму книги
  // (4000-16000, architect-book.js) — ручной слайдер 200-4000 сломал бы
  // генерацию длинных книг, поэтому не показываем его для этой роли.
  if(a.role!=='bookArchitect'){
    specs.push({ key:'maxTokens', label:'Макс. токенов', hint:'потолок длины ответа — Прозаику нужно ≥2400 для 700-слов. сцены', min:200, max:4000, step:100, target:'agent', def:700, fmt:v=>Math.round(v) });
  }
```

- [ ] **Шаг 2: Исключить кнопку «▶» для `bookArchitect`**

Строка 416, заменить:
```js
        ${a.role!=='prose'?`<button class="ag-run" data-runid="${a.id}" data-tip="Запустить «${esc(a.name)}» вручную на текущей сцене и получить разбор: замечания и предложения правок. Текст не меняется (кроме применения правки Линейного редактора).">▶</button>`:''}
```
на:
```js
        ${(a.role!=='prose' && a.role!=='bookArchitect')?`<button class="ag-run" data-runid="${a.id}" data-tip="Запустить «${esc(a.name)}» вручную на текущей сцене и получить разбор: замечания и предложения правок. Текст не меняется (кроме применения правки Линейного редактора).">▶</button>`:''}
```

- [ ] **Шаг 3: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/ui/diagnostics.js`
Expected: без вывода.

- [ ] **Шаг 4: Живая проверка**

Через `mcp__Claude_Preview__*`: открыть панель «Агенты» (вкладка «Все» — карточка Книжного архитектора видна только там, см. спеку §12.2), раскрыть карточку «Книжный архитектор» — должен быть только один слайдер «Температура», без «Макс. токенов», и без кнопки «▶» в заголовке карточки.

- [ ] **Шаг 5: Commit**

```bash
git add литсовет/src/ui/diagnostics.js
git commit -m "fix(литсовет): убрать неприменимые Макс.токенов и ручной запуск для Книжного архитектора"
```

---

### Task 15: `ui/illustrations.js` — отображение `type:'map'` в общей галерее

**Files:**
- Modify: `литсовет/src/ui/illustrations.js`

- [ ] **Шаг 1: Отличить подпись карты от сцены/обложки в `renderGallery`**

Найти функцию `renderGallery(items)` (строка 73-83), строку:
```js
        <div style="font-size:11px" class="muted">${it.type==='cover'?'Обложка':esc(it.sceneTitle||'')}</div>
```
заменить на:
```js
        <div style="font-size:11px" class="muted">${it.type==='cover'?'Обложка':it.type==='map'?'🗺 Карта мира':esc(it.sceneTitle||'')}</div>
```

- [ ] **Шаг 2: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/ui/illustrations.js`
Expected: без вывода.

- [ ] **Шаг 3: Живая проверка**

После генерации карты на стадии «Мир» (Task 8) — открыть стадию «Иллюстрации», убедиться что карта видна в общей галерее с подписью «🗺 Карта мира».

- [ ] **Шаг 4: Commit**

```bash
git add литсовет/src/ui/illustrations.js
git commit -m "feat(литсовет): подпись карты мира в общей галерее иллюстраций"
```

---

### Task 16: Финальная сквозная live-проверка (спека §13, все 10 пунктов)

Не бите-сайз шаг, а контрольный прогон всего построенного функционала на реально запущенном сервере (`node server.js`) через `mcp__Claude_Preview__*`, с настоящим текстовым и image-ключом. Использовать проект с уже написанными сценами для пунктов про Архитектора/структуру, и создать/переиспользовать проект жанра «Фэнтези» и отдельно «Альтернативная история» для жанровых пунктов.

- [ ] **1.** Жанр «Фэнтези» в Концепции → стадия «Мир» в рейле + видна инлайн-подсказка.
- [ ] **2.** «Предложить мир» без затравки → приходят категоризированные факты (реальный вызов LLM).
- [ ] **3.** Одобрить часть фактов → видны в `state.bible[]` с `source:'world'` и в панели «Память».
- [ ] **4.** Сгенерировать скелет в «Структуре» → `bookArchitectMessages()` реально содержит блок «МИР КНИГИ» с этими фактами.
- [ ] **5.** Добавить новый world-факт после того как структура уже построена → баннер устаревания появляется на «Структуре».
- [ ] **6.** Сгенерировать карту на стадии «Мир» (реальный вызов image-API) → видна и там, и в общей галерее «Иллюстраций».
- [ ] **7.** Жанр «Альтернативная история»: пропустить точку развилки → предупреждение видно, не блокирует; заполнить POD → факт сохраняется.
- [ ] **8.** Задать `sceneWords`/`chapterCount`/`pacing` в Концепции → сгенерировать скелет → реальные `targetWords` сцен и нужная формулировка темпа в промпте.
- [ ] **9.** Панель «Агенты» → карточка «Книжный архитектор»: один слайдер «Температура», без «Макс. токенов», без кнопки «▶».
- [ ] **10.** Изменить температуру Архитектора → сгенерировать скелет → подтвердить (через diagnostics/трейс), что вызов ушёл с этим значением, не хардкодом 0.6.

- [ ] **Доп. проверка (найдено при написании плана, не в исходной спеке):** на «Структуре» после генерации скелета с реальными world-фактами дождаться (или не дождаться — это необязательный follow-up) блока «Архитектор опирался на факты, которых нет в каноне» — если появился, кликнуть «+ В канон», убедиться что факт реально попал в `state.bible[]` с `source:'world'`.

Если что-то из 10+1 пунктов не проходит — вернуться к соответствующему Task, исправить, закоммитить фикс отдельным коммитом (не переписывать историю).

---

## Порядок и зависимости задач

Task 1 → независим, можно первым.
Task 2 → независим, готовит инфраструктуру для Task 12.
Task 3 → зависит от Task 2 (использует `ag` только опосредованно — сам Task 3 не вызывает `ag`, но по смыслу идёт после, т.к. добавляет агента, которого `ag` будет искать).
Task 4-6 → зависят от Task 3 (используют `state.bible`/`source`/`category`, но не жёстко — можно писать параллельно с Task 3, проверка только в самом конце потребует реальных полей).
Task 7 → независим.
Task 8 → зависит от Task 4-7 (импортирует `world.js` и `illustrations.js`).
Task 9 → зависит от Task 8 (импортирует `renderWorld`).
Task 10-11 → зависят от Task 3 (поля `project.*`) и Task 9 (переход на стадию `world`).
Task 12 → зависит от Task 2 (`ag`), Task 3 (агент/поля), Task 4 (world-факты в Библии).
Task 13 → зависит от Task 6 (`suggestMissingWorldFacts`), Task 3 (`structureStale`).
Task 14 → зависит от Task 3 (роль `bookArchitect` должна существовать).
Task 15 → зависит от Task 7 (`type:'map'`).
Task 16 → в самом конце, после всего.

Рекомендуемый порядок выполнения: **1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16** (уже топологически корректен как список выше).
