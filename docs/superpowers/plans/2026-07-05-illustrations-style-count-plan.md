# Стиль/цвет и кол-во/важность иллюстраций — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Автор получает библиотеку готовых художественных стилей + переключатель цвет/ч-б для иллюстраций, настраиваемое количество кандидатов от арт-директора, и числовую оценку важности каждого кандидата (вместо только текстового обоснования).

**Архитектура:** Новый файл `artStyles.js` — чистые данные (13 пресетов), по образцу уже существующего `styles.js` (авторские стили прозы). Новые поля состояния (`style.colorMode`, `style.artStyleId`, `illustrations.suggestCount`) автоматически бэкфилятся в старые проекты через уже существующий `migrate()`. Промпт-функции в `illustrations.js` читают эти поля вместо хардкода. UI — два новых `<select>` в Концепции рядом с уже существующим «Визуальный голос», и счётчик + сортировка по важности на стадии «Иллюстрации».

**Tech Stack:** Vanilla JS (ES-модули), без сборщика и фреймворка.

**Спека:** `docs/superpowers/specs/2026-07-05-illustrations-style-count-design.md` (одобрена, все ссылки на код проверены построчно против репозитория).

**Как проверять каждый шаг:** в этом проекте нет тестового фреймворка (zero-dependency приложение). Проверка — `node --input-type=module --check < file.js` на синтаксис сразу после правки, и **живая проверка через `mcp__Claude_Preview__*`** на реально запущенном сервере (`node server.js`, порт 8788 для конфига `litsovet`).

---

### Task 1: `state.js` — новые поля по умолчанию

**Files:**
- Modify: `литсовет/src/state.js`

- [ ] **Шаг 1: Добавить поля в `style: {}`**

Найти `литсовет/src/state.js:47-53`:
```js
    style: {
      refs: [],                // стилевые ориентиры (авторы)
      density: 3, dialogue: 2, pace: 2,
      forbidden: ['клише','эмоц. ярлыки','восклицания'],
      rules: [],               // правила автора (do/don't): идут Прозаику, Оценщику, Стражу стиля
      profanity: 'moderate',   // off | mild | moderate | strict
    },
```
Заменить на:
```js
    style: {
      refs: [],                // стилевые ориентиры (авторы)
      density: 3, dialogue: 2, pace: 2,
      forbidden: ['клише','эмоц. ярлыки','восклицания'],
      rules: [],               // правила автора (do/don't): идут Прозаику, Оценщику, Стражу стиля
      profanity: 'moderate',   // off | mild | moderate | strict
      colorMode: 'color',      // color | bw — цветные иллюстрации или чёрно-белые
      artStyleId: '',          // id пресета из artStyles.js; '' = без пресета (только «Визуальный голос»)
    },
```

- [ ] **Шаг 2: Добавить поле в `illustrations: {}`**

Найти `литсовет/src/state.js:67-73`:
```js
    illustrations: {
      provider: 'gemini',      // gemini | openai — какой платный провайдер картинок
      apiKey: '',              // отдельный ключ, НЕ текстовый — тоже только в памяти
      model: '',                // пусто → дефолт провайдера (gpt-image-1 / gemini-2.5-flash-image)
      quality: 'standard',     // standard | hd
      items: [],                // {id, type, sceneId, sceneTitle, prompt, dataUrl, createdAt}
    },
```
Заменить на:
```js
    illustrations: {
      provider: 'gemini',      // gemini | openai — какой платный провайдер картинок
      apiKey: '',              // отдельный ключ, НЕ текстовый — тоже только в памяти
      model: '',                // пусто → дефолт провайдера (gpt-image-1 / gemini-2.5-flash-image)
      quality: 'standard',     // standard | hd
      items: [],                // {id, type, sceneId, sceneTitle, prompt, dataUrl, createdAt}
      suggestCount: 7,          // сколько кандидатов предлагать (включая обложку), 1-15
    },
```

`migrate()` (`литсовет/src/state.js`, содержит `s.style = Object.assign({}, d.style, s.style);` и `s.illustrations = Object.assign({}, d.illustrations, s.illustrations);`) автоматически подставит эти дефолты в уже сохранённые проекты — саму функцию `migrate()` трогать не нужно.

- [ ] **Шаг 3: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/state.js`
Expected: без вывода.

- [ ] **Шаг 4: Живая проверка**

Через `mcp__Claude_Preview__preview_eval` на запущенном сервере:
```js
const { getState } = await import('/src/state.js');
const s = getState();
({ colorMode: s.style.colorMode, artStyleId: s.style.artStyleId, suggestCount: s.illustrations.suggestCount })
```
Expected: `{colorMode:'color', artStyleId:'', suggestCount:7}` на новом/уже открытом проекте (подтверждает и дефолт, и бэкфилл через `migrate()` для уже существующих сохранённых проектов).

- [ ] **Шаг 5: Commit**

```bash
git add литсовет/src/state.js
git commit -m "feat(литсовет): state.js — поля colorMode/artStyleId/suggestCount для иллюстраций"
```

---

### Task 2: Новый файл `artStyles.js` — 13 художественных стилей

**Files:**
- Create: `литсовет/src/artStyles.js`

- [ ] **Шаг 1: Создать файл**

```js
// Готовые художественные стили для иллюстраций — чистые данные. genres[] —
// рыхлая, не эксклюзивная подсказка «подходит жанру» в UI (см. styles.js —
// та же роль для авторских стилей прозы). promptFragment — добавляется к
// промпту картинки в generateIllustrationFor() (illustrations.js), если стиль
// выбран. В отличие от авторских стилей прозы — ВЫБОР ОДИНОЧНЫЙ (у книги один
// визуальный стиль иллюстраций, не смесь нескольких).

export const ART_STYLES = [
  { id:'watercolor',   name:'Акварель',              blurb:'Мягкие цветовые растёки, видимая текстура бумаги.', genres:['роман','любовный роман','биографическая проза'], promptFragment:'watercolor illustration, soft color bleed, visible paper texture' },
  { id:'oil',          name:'Масляная живопись',     blurb:'Густые мазки, насыщенная текстура холста.', genres:['роман','исторический роман'], promptFragment:'oil painting, thick brushstrokes, rich canvas texture' },
  { id:'comic',        name:'Графический роман',     blurb:'Чёткий контур, драматичные тени, стиль комикса.', genres:['фантастика','приключения','юмористическая проза'], promptFragment:'comic book / graphic novel line art, bold ink outlines, dramatic shading' },
  { id:'lineart',      name:'Line art',              blurb:'Чистая минималистичная линия, без штриховки.', genres:['юмористическая проза','ироничный детектив'], promptFragment:'clean minimalist line art, single continuous line style, no shading' },
  { id:'sketch',       name:'Карандашный набросок',  blurb:'Штриховка, фактура блокнота для скетчей.', genres:['рассказ','биографическая проза'], promptFragment:'pencil sketch, cross-hatching, sketchbook texture' },
  { id:'flat',         name:'Плоская иллюстрация',   blurb:'Плоские формы, ограниченная палитра, вектор.', genres:['молодёжная фантастика','сказка'], promptFragment:'flat vector illustration, simple shapes, limited color palette' },
  { id:'fantasyart',   name:'Фэнтези-концепт-арт',   blurb:'Живописный, драматичное освещение, эпический масштаб.', genres:['фэнтези','ироничное фэнтези','приключения'], promptFragment:'fantasy concept art, painterly, dramatic lighting, epic scale' },
  { id:'vintage',      name:'Винтаж',                blurb:'Печатная фактура середины века, растровые точки.', genres:['исторический роман','детектив','альтернативная история'], promptFragment:'vintage book illustration, mid-century print texture, halftone dots' },
  { id:'noir',         name:'Нуар',                  blurb:'Высокий контраст, глубокие тени, драматичный свет.', genres:['детектив','триллер','тёмная романтика'], promptFragment:'film noir style, high contrast, deep shadows, dramatic chiaroscuro' },
  { id:'childrens',    name:'Детская книга',         blurb:'Округлые формы, мягкие цвета, тёплый и лёгкий тон.', genres:['сказка'], promptFragment:"children's picture book illustration, whimsical, soft rounded shapes" },
  { id:'steampunk',    name:'Стимпанк-гравюра',      blurb:'Штриховая гравюра, викторианская техническая иллюстрация.', genres:['альтернативная история','фэнтези'], promptFragment:'steampunk engraving style, cross-hatched linework, Victorian technical illustration' },
  { id:'cyberpunk',    name:'Киберпанк',             blurb:'Неоновые акценты, глянцевые футуристичные поверхности.', genres:['фантастика','триллер'], promptFragment:'cyberpunk digital art, neon accents, glossy futuristic surfaces' },
  { id:'gothic',       name:'Готика',                blurb:'Орнаментальная детализация, мрачная атмосфера.', genres:['ужасы','мистика','тёмная романтика'], promptFragment:'gothic illustration, ornate detail, moody atmosphere' },
];

export function artStyleMatchesGenre(style, genre){
  return !!genre && (style.genres||[]).includes(genre);
}
```

- [ ] **Шаг 2: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/artStyles.js`
Expected: без вывода.

- [ ] **Шаг 3: Живая проверка**

```js
const { ART_STYLES, artStyleMatchesGenre } = await import('/src/artStyles.js?v=' + Date.now());
({
  count: ART_STYLES.length, // 13
  allHavePromptFragment: ART_STYLES.every(s=>s.promptFragment && s.promptFragment.length>0),
  uniqueIds: new Set(ART_STYLES.map(s=>s.id)).size === ART_STYLES.length,
  matchWorks: artStyleMatchesGenre(ART_STYLES.find(s=>s.id==='fantasyart'), 'фэнтези'),
  noMatch: artStyleMatchesGenre(ART_STYLES.find(s=>s.id==='fantasyart'), 'детектив'),
})
```
Expected: `count:13`, `allHavePromptFragment:true`, `uniqueIds:true`, `matchWorks:true`, `noMatch:false`.

Дополнительно — сверить каждый жанр-тег с реальным `GENRES` (жанры уже существуют в проекте, ничего нового в этом плане не добавляется, но проверка защищает от опечатки):
```js
const { GENRES } = await import('/src/genres.js?v=' + Date.now());
const validGenres = new Set(GENRES.map(g=>g.v));
const allTags = new Set(ART_STYLES.flatMap(s=>s.genres));
({ invalidTags: [...allTags].filter(t=>!validGenres.has(t)) }) // должно быть []
```
Expected: `invalidTags: []`.

- [ ] **Шаг 4: Commit**

```bash
git add литсовет/src/artStyles.js
git commit -m "feat(литсовет): artStyles.js — 13 художественных стилей для иллюстраций"
```

---

### Task 3: `illustrations.js` — настраиваемое кол-во + числовая важность

**Files:**
- Modify: `литсовет/src/illustrations.js`

- [ ] **Шаг 1: Динамическое количество и поле `importance` в `illustrationSuggestMessages()`**

Найти `литсовет/src/illustrations.js:22-33` (текущая функция целиком):
```js
export function illustrationSuggestMessages(state){
  const p = state.project;
  const sys = [
    'Ты — арт-директор книги. Ты НЕ рисуешь — ты предлагаешь кандидатов на иллюстрации и текстовые промпты для генератора изображений.',
    'Промпт для картинки должен быть самодостаточным визуальным описанием (место, персонажи, свет, композиция, настроение) — генератор изображений не читал книгу и не поймёт отсылок к именам без описания их внешности.',
    'Обложка — всегда первый кандидат: она должна работать как обложка жанра (не сцена дословно, а образ, который продаёт книгу на полке).',
  ].join('\n');
  const user = [
    `Жанр: ${p.genre||'роман'}. Аудитория: ${p.audience||'широкая'}.`,
    p.synopsis||p.idea ? `Синопсис: ${p.synopsis||p.idea}` : '',
    '',
    'ОБЗОР КНИГИ ПО ГЛАВАМ И СЦЕНАМ (сводки по порядку):',
    bookOverview(state),
    '',
    'Предложи кандидатов на иллюстрации: 1 обложка + до 7 сильных визуальных сцен (не каждую, только те, что реально дают яркую картинку — не диалоги и не размышления, а моменты с явным визуальным образом).',
    'Верни JSON: { "candidates": [ { "type":"cover|scene", "sceneTitle":"точное название сцены из обзора (пусто для обложки)", "prompt":"самодостаточный визуальный промпт для генератора изображений, на английском, 1-3 предложения", "reason":"почему эта сцена/образ — по-русски, коротко" } ] }',
    'Только JSON.',
  ].filter(Boolean).join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}
```
Заменить на:
```js
export function illustrationSuggestMessages(state){
  const p = state.project;
  const count = state.illustrations?.suggestCount || 7;
  const sys = [
    'Ты — арт-директор книги. Ты НЕ рисуешь — ты предлагаешь кандидатов на иллюстрации и текстовые промпты для генератора изображений.',
    'Промпт для картинки должен быть самодостаточным визуальным описанием (место, персонажи, свет, композиция, настроение) — генератор изображений не читал книгу и не поймёт отсылок к именам без описания их внешности.',
    'Обложка — всегда первый кандидат: она должна работать как обложка жанра (не сцена дословно, а образ, который продаёт книгу на полке).',
  ].join('\n');
  const user = [
    `Жанр: ${p.genre||'роман'}. Аудитория: ${p.audience||'широкая'}.`,
    p.synopsis||p.idea ? `Синопсис: ${p.synopsis||p.idea}` : '',
    '',
    'ОБЗОР КНИГИ ПО ГЛАВАМ И СЦЕНАМ (сводки по порядку):',
    bookOverview(state),
    '',
    `Предложи кандидатов на иллюстрации: 1 обложка + до ${count-1} сильных визуальных сцен (не каждую, только те, что реально дают яркую картинку — не диалоги и не размышления, а моменты с явным визуальным образом).`,
    'Верни JSON: { "candidates": [ { "type":"cover|scene", "sceneTitle":"точное название сцены из обзора (пусто для обложки)", "prompt":"самодостаточный визуальный промпт для генератора изображений, на английском, 1-3 предложения", "reason":"почему эта сцена/образ — по-русски, коротко", "importance":"число 1-10, насколько сильна эта картинка для книги — 10 = ключевой визуальный момент, 1 = проходной" } ] }',
    'Только JSON.',
  ].filter(Boolean).join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}
```

- [ ] **Шаг 2: Динамический потолок и парсинг `importance` в `suggestIllustrations()`**

Найти `литсовет/src/illustrations.js:36-59` (текущая функция целиком):
```js
export async function suggestIllustrations(state){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ текстовой модели (⚙).');
  const scenes = doneScenesOrdered(state);
  if(!scenes.length) throw new Error('Нужна хотя бы одна законченная сцена.');
  const msgs = illustrationSuggestMessages(state);
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.6, messages:msgs, maxTokens:1500, retries:g.retries });
  const j = extractJSON(res.text);
  const arr = j && Array.isArray(j.candidates) ? j.candidates : null;
  if(!arr) throw new Error('Не удалось разобрать ответ арт-директора.');
  const sceneByTitle = new Map(scenes.map(s=>[s.title.trim().toLowerCase(), s]));
  return arr.slice(0, 8).map((c,i)=>{
    const sceneTitle = String(c.sceneTitle||'').trim();
    const matched = sceneTitle ? sceneByTitle.get(sceneTitle.toLowerCase()) : null;
    return {
      id: 'ic_'+Date.now().toString(36)+'_'+i,
      type: c.type==='cover' ? 'cover' : 'scene',
      sceneId: matched ? matched.id : null,
      sceneTitle: matched ? matched.title : sceneTitle,
      prompt: String(c.prompt||'').slice(0,600),
      reason: String(c.reason||'').slice(0,300),
    };
  });
}
```
Заменить на:
```js
export async function suggestIllustrations(state){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ текстовой модели (⚙).');
  const scenes = doneScenesOrdered(state);
  if(!scenes.length) throw new Error('Нужна хотя бы одна законченная сцена.');
  const msgs = illustrationSuggestMessages(state);
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.6, messages:msgs, maxTokens:1500, retries:g.retries });
  const j = extractJSON(res.text);
  const arr = j && Array.isArray(j.candidates) ? j.candidates : null;
  if(!arr) throw new Error('Не удалось разобрать ответ арт-директора.');
  const sceneByTitle = new Map(scenes.map(s=>[s.title.trim().toLowerCase(), s]));
  const cap = state.illustrations?.suggestCount || 7;
  return arr.slice(0, cap).map((c,i)=>{
    const sceneTitle = String(c.sceneTitle||'').trim();
    const matched = sceneTitle ? sceneByTitle.get(sceneTitle.toLowerCase()) : null;
    return {
      id: 'ic_'+Date.now().toString(36)+'_'+i,
      type: c.type==='cover' ? 'cover' : 'scene',
      sceneId: matched ? matched.id : null,
      sceneTitle: matched ? matched.title : sceneTitle,
      prompt: String(c.prompt||'').slice(0,600),
      reason: String(c.reason||'').slice(0,300),
      importance: Math.max(1, Math.min(10, Math.round(Number(c.importance)||5))),
    };
  });
}
```

(Дефолт `importance:5`, если модель не вернула число или вернула нечисловое значение — не роняем весь ответ арт-директора из-за одного отсутствующего поля, `Number(undefined)` → `NaN`, `NaN||5` → `5`.)

- [ ] **Шаг 3: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/illustrations.js`
Expected: без вывода.

- [ ] **Шаг 4: Живая проверка**

Через реально запущенный сервер, на проекте с хотя бы одной законченной сценой (нужна для `doneScenesOrdered`) и реальным API-ключом текстовой модели:
```js
const { getState, save } = await import('/src/state.js');
const s = getState();
s.illustrations.suggestCount = 4; save();
const { suggestIllustrations } = await import('/src/illustrations.js?v=' + Date.now());
const candidates = await suggestIllustrations(s);
({
  countRespected: candidates.length <= 4,
  allHaveImportance: candidates.every(c=>typeof c.importance==='number' && c.importance>=1 && c.importance<=10),
})
```
Expected: `countRespected:true`, `allHaveImportance:true`.

- [ ] **Шаг 5: Commit**

```bash
git add литсовет/src/illustrations.js
git commit -m "feat(литсовет): illustrations.js — настраиваемое кол-во кандидатов + числовая важность"
```

---

### Task 4: `illustrations.js` — художественный стиль и цвет в промпт генерации

**Files:**
- Modify: `литсовет/src/illustrations.js`

- [ ] **Шаг 1: Импортировать `ART_STYLES`**

В начало `литсовет/src/illustrations.js`, рядом с существующим импортом `generateImage` из `./imagegen.js` (строка 12), добавить:
```js
import { ART_STYLES } from './artStyles.js';
```

- [ ] **Шаг 2: Расширить `generateIllustrationFor()`**

Найти `литсовет/src/illustrations.js:63-78` (текущая функция целиком):
```js
export async function generateIllustrationFor(state, candidate){
  const ic = state.illustrations || {};
  if(!ic.apiKey) throw new Error('Не задан API-ключ для генерации картинок (⚙).');
  const voiceOn = state.style?.visualVoiceOn && state.style?.visualVoice;
  const prompt = voiceOn ? `${candidate.prompt}\n\nСтиль: ${state.style.visualVoice}` : candidate.prompt;
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
Заменить на:
```js
export async function generateIllustrationFor(state, candidate){
  const ic = state.illustrations || {};
  if(!ic.apiKey) throw new Error('Не задан API-ключ для генерации картинок (⚙).');
  const parts = [];
  if(state.style?.visualVoiceOn && state.style?.visualVoice) parts.push(`Стиль: ${state.style.visualVoice}`);
  const artStyle = ART_STYLES.find(s=>s.id===state.style?.artStyleId);
  if(artStyle) parts.push(artStyle.promptFragment);
  if(state.style?.colorMode==='bw') parts.push('black and white, monochrome, no color');
  const prompt = parts.length ? `${candidate.prompt}\n\n${parts.join('. ')}` : candidate.prompt;
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

Также обновить doc-комментарий над функцией (`литсовет/src/illustrations.js:62`, сейчас: `// visualVoice — текст стиля из Концепции (state.style.visualVoice), если тумблер включён.`) — заменить на:
```js
// Стиль картинки собирается из трёх необязательных частей (все могут сочетаться):
// visualVoice (state.style.visualVoice, если тумблер включён), пресет ART_STYLES
// (state.style.artStyleId) и чёрно-белый режим (state.style.colorMode==='bw').
// Цвет по умолчанию — без доп. инструкции (большинство генераторов рисуют
// цветное по умолчанию), явная инструкция нужна только для ч/б.
```

- [ ] **Шаг 3: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/illustrations.js`
Expected: без вывода.

- [ ] **Шаг 4: Живая проверка**

Проверка сборки промпта БЕЗ реального платного вызова генерации (просто соберите `parts`/`prompt` той же логикой в eval, читая реальный `state`, не тратя деньги на саму генерацию картинки — сама `generateIllustrationFor` неизбежно тратит деньги, если провайдер картинок настроен, поэтому здесь проверяем логику сборки промпта напрямую):
```js
const { getState, save } = await import('/src/state.js');
const s = getState();
s.style.visualVoiceOn = true; s.style.visualVoice = 'мягкий свет';
s.style.artStyleId = 'noir';
s.style.colorMode = 'bw';
save();
// Пересобираем ту же логику, что внутри generateIllustrationFor, без реального вызова provider'а:
const { ART_STYLES } = await import('/src/artStyles.js?v=' + Date.now());
const parts = [];
if(s.style.visualVoiceOn && s.style.visualVoice) parts.push(`Стиль: ${s.style.visualVoice}`);
const artStyle = ART_STYLES.find(x=>x.id===s.style.artStyleId);
if(artStyle) parts.push(artStyle.promptFragment);
if(s.style.colorMode==='bw') parts.push('black and white, monochrome, no color');
({ parts, joined: parts.join('. ') })
```
Expected: `parts` содержит все три части (визуальный голос, `film noir style, high contrast, deep shadows, dramatic chiaroscuro`, `black and white, monochrome, no color`).

Дополнительно проверить случай «цвет по умолчанию, без пресета» — `s.style.artStyleId=''; s.style.colorMode='color'; s.style.visualVoiceOn=false;` — пересчитать `parts`, ожидается пустой массив (значит `generateIllustrationFor` в этом случае отправит `candidate.prompt` без изменений).

Если в этом браузерном origin уже настроен реальный ключ провайдера картинок (проверить `s.illustrations.apiKey`) — можно ДОПОЛНИТЕЛЬНО (не обязательно) сделать один настоящий вызов `generateIllustrationFor`, чтобы убедиться что функция в сборке в целом не падает — но это тратит реальные деньги, поэтому только если уже есть ключ и это не требует отдельной настройки специально для этой проверки.

- [ ] **Шаг 5: Commit**

```bash
git add литсовет/src/illustrations.js
git commit -m "feat(литсовет): illustrations.js — художественный стиль и цвет в промпте генерации"
```

---

### Task 5: Концепция — пикер стиля + переключатель цвета

**Files:**
- Modify: `литсовет/src/ui/stages.js`

- [ ] **Шаг 1: Импортировать `ART_STYLES`**

В начало `литсовет/src/ui/stages.js`, рядом с существующим импортом `AUTHOR_STYLES, styleMatchesGenre` из `../styles.js` (строка 6), добавить новую строку:
```js
import { ART_STYLES } from '../artStyles.js';
```

- [ ] **Шаг 2: Добавить два `<select>` внутрь `#visualVoiceField`**

Найти `литсовет/src/ui/stages.js:229-231`:
```js
        <div id="visualVoiceField" style="${s.style?.visualVoiceOn?'':'display:none'}">
          <textarea id="visualVoice" rows="2" placeholder="например: акварель, тёплые приглушённые тона, мягкий рассеянный свет, в духе книжной иллюстрации начала XX века">${esc(s.style?.visualVoice||'')}</textarea>
        </div>
```
Заменить на:
```js
        <div id="visualVoiceField" style="${s.style?.visualVoiceOn?'':'display:none'}">
          <textarea id="visualVoice" rows="2" placeholder="например: акварель, тёплые приглушённые тона, мягкий рассеянный свет, в духе книжной иллюстрации начала XX века">${esc(s.style?.visualVoice||'')}</textarea>
          <div class="field" style="margin-top:10px">
            <label>Художественный стиль <span class="hint">(необязательно — добавляется к промпту картинки вместе с «Визуальным голосом»)</span></label>
            <select id="artStyleId">
              <option value="">— без пресета —</option>
              ${ART_STYLES.map(st=>`<option value="${st.id}"${st.id===(s.style?.artStyleId||'')?' selected':''}>${esc(st.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field row" style="gap:8px;align-items:center;margin-top:8px">
            <label>Цвет</label>
            <select id="colorMode">
              <option value="color"${s.style?.colorMode!=='bw'?' selected':''}>Цветные</option>
              <option value="bw"${s.style?.colorMode==='bw'?' selected':''}>Чёрно-белые</option>
            </select>
          </div>
        </div>
```

- [ ] **Шаг 3: Обработчики**

Найти `литсовет/src/ui/stages.js:370` (`bind('visualVoice', e=>{ s.style.visualVoice = e.target.value; });`), добавить сразу после:
```js
  const artStyleSel = document.getElementById('artStyleId');
  if(artStyleSel) artStyleSel.onchange = ()=>{ s.style.artStyleId = artStyleSel.value; save(); };
  const colorModeSel = document.getElementById('colorMode');
  if(colorModeSel) colorModeSel.onchange = ()=>{ s.style.colorMode = colorModeSel.value; save(); };
```

- [ ] **Шаг 4: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/ui/stages.js`
Expected: без вывода.

- [ ] **Шаг 5: Живая проверка**

На тестовом проекте, на Концепции: включить чекбокс «Визуальный голос» (`#visualVoiceOn`, если ещё не включён), убедиться через `preview_snapshot`/`document.getElementById`, что `<select id="artStyleId">` содержит 14 опций (13 стилей + «без пресета») и `<select id="colorMode">` содержит 2 опции. Выбрать стиль «Готика» и цвет «Чёрно-белые» (установить `.value` и вызвать `dispatchEvent(new Event('change'))` на обоих селектах), затем проверить:
```js
const { getState } = await import('/src/state.js');
const s = getState();
({ artStyleId: s.style.artStyleId, colorMode: s.style.colorMode })
```
Expected: `{artStyleId:'gothic', colorMode:'bw'}`.

Проверить `mcp__Claude_Preview__preview_console_logs` — без ошибок.

- [ ] **Шаг 6: Commit**

```bash
git add литсовет/src/ui/stages.js
git commit -m "feat(литсовет): Концепция — пикер художественного стиля и переключатель цвет/ч-б"
```

---

### Task 6: Иллюстрации — счётчик количества + сортировка/бейдж важности

**Files:**
- Modify: `литсовет/src/ui/illustrations.js`

- [ ] **Шаг 1: Добавить числовое поле рядом с кнопкой «Предложить иллюстрации»**

Найти `литсовет/src/ui/illustrations.js:31-38` (текущий блок `read-bar`):
```js
    <div class="read-bar">
      <span class="read-title">Иллюстрации</span>
      <span style="flex:1"></span>
      <button class="btn btn-primary" id="illSuggest" data-tip="Арт-директор (текстовый LLM, тот же что и для прозы) читает книгу и предлагает кандидатов на иллюстрации: обложку + сильные визуальные сцены. Ничего не тратит сверх обычного текстового вызова.">
        ${_busy?'<span class="spinner"></span> '+esc(_busyText):'🎨 Предложить иллюстрации'}
      </button>
    </div>
```
Заменить на:
```js
    <div class="read-bar">
      <span class="read-title">Иллюстрации</span>
      <span style="flex:1"></span>
      <label class="row" style="gap:6px;align-items:center;font-size:12px" data-tip="Сколько кандидатов предложит арт-директор (включая обложку)">
        Кандидатов:
        <input type="number" id="illSuggestCount" min="1" max="15" value="${s.illustrations?.suggestCount||7}" style="width:52px">
      </label>
      <button class="btn btn-primary" id="illSuggest" data-tip="Арт-директор (текстовый LLM, тот же что и для прозы) читает книгу и предлагает кандидатов на иллюстрации: обложку + сильные визуальные сцены. Ничего не тратит сверх обычного текстового вызова.">
        ${_busy?'<span class="spinner"></span> '+esc(_busyText):'🎨 Предложить иллюстрации'}
      </button>
    </div>
```

- [ ] **Шаг 2: Обработчик числового поля + чтение значения перед вызовом**

Найти `литсовет/src/ui/illustrations.js:87-98` (обработчик `illSuggest`):
```js
function bindHandlers(els, s){
  const sb = document.getElementById('illSuggest');
  if(sb) sb.onclick = async ()=>{
    if(!s.global.apiKey){ alert('Задайте API-ключ текстовой модели в настройках (⚙).'); return; }
    if(_busy) return;
    _busy = true; _busyText = 'Читаю книгу и продумываю кандидатов…'; renderIllustrations(els);
    try{
      _candidates = await suggestIllustrations(s);
      _selected = new Set(_candidates.map(c=>c.id));
    }catch(e){ alert('Арт-директор: '+e.message); }
    finally{ _busy = false; _busyText=''; renderIllustrations(els); }
  };
```
Заменить на:
```js
function bindHandlers(els, s){
  const countInp = document.getElementById('illSuggestCount');
  if(countInp) countInp.onchange = ()=>{
    const v = Math.max(1, Math.min(15, parseInt(countInp.value)||7));
    s.illustrations = s.illustrations || {};
    s.illustrations.suggestCount = v;
    save();
  };
  const sb = document.getElementById('illSuggest');
  if(sb) sb.onclick = async ()=>{
    if(!s.global.apiKey){ alert('Задайте API-ключ текстовой модели в настройках (⚙).'); return; }
    if(_busy) return;
    _busy = true; _busyText = 'Читаю книгу и продумываю кандидатов…'; renderIllustrations(els);
    try{
      _candidates = await suggestIllustrations(s);
      _candidates.sort((a,b)=>b.importance-a.importance);
      _selected = new Set(_candidates.map(c=>c.id));
    }catch(e){ alert('Арт-директор: '+e.message); }
    finally{ _busy = false; _busyText=''; renderIllustrations(els); }
  };
```

(`save` уже импортирован в файле из `../state.js` — строка 5, используется существующим кодом ниже.)

- [ ] **Шаг 3: Бейдж важности в карточке кандидата**

Найти `литсовет/src/ui/illustrations.js:54-63` (карточка кандидата внутри `renderCandidates`):
```js
      ${_candidates.map(c=>`<div class="apv-row" style="flex-direction:column;align-items:stretch;gap:4px">
        <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">
          <input type="checkbox" class="ill-cb" data-id="${c.id}" ${_selected.has(c.id)?'checked':''} style="margin-top:3px">
          <div style="flex:1">
            <b>${c.type==='cover'?'📕 Обложка':'🖼 «'+esc(c.sceneTitle||'')+'»'}</b>
            <div class="muted" style="font-size:12px;margin-top:2px">${esc(c.reason||'')}</div>
            <div style="font-size:12px;color:var(--text-2);margin-top:2px;font-style:italic">${esc(c.prompt)}</div>
          </div>
        </label>
      </div>`).join('')}
```
Заменить на:
```js
      ${_candidates.map(c=>`<div class="apv-row" style="flex-direction:column;align-items:stretch;gap:4px">
        <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">
          <input type="checkbox" class="ill-cb" data-id="${c.id}" ${_selected.has(c.id)?'checked':''} style="margin-top:3px">
          <div style="flex:1">
            <b>${c.type==='cover'?'📕 Обложка':'🖼 «'+esc(c.sceneTitle||'')+'»'}</b>
            <span class="muted" style="font-size:11px;margin-left:6px">★ ${c.importance||5}/10</span>
            <div class="muted" style="font-size:12px;margin-top:2px">${esc(c.reason||'')}</div>
            <div style="font-size:12px;color:var(--text-2);margin-top:2px;font-style:italic">${esc(c.prompt)}</div>
          </div>
        </label>
      </div>`).join('')}
```

- [ ] **Шаг 4: Проверить синтаксис**

Run: `node --input-type=module --check < литсовет/src/ui/illustrations.js`
Expected: без вывода.

- [ ] **Шаг 5: Живая проверка**

На тестовом проекте с хотя бы одной законченной сценой и реальным API-ключом текстовой модели: на стадии «Иллюстрации» изменить поле «Кандидатов» на `3` (`preview_fill`/`preview_eval` установить `.value` + `dispatchEvent('change')`), проверить `getState().illustrations.suggestCount === 3`. Нажать «🎨 Предложить иллюстрации» (реальный вызов), затем через `preview_snapshot`/DOM убедиться: (а) кандидатов не больше 3, (б) у каждой карточки виден бейдж `★ N/10`, (в) карточки идут в порядке убывания важности (сравнить `importance` первого и последнего кандидата в отрендеренном списке).

Проверить `mcp__Claude_Preview__preview_console_logs` — без ошибок.

- [ ] **Шаг 6: Commit**

```bash
git add литсовет/src/ui/illustrations.js
git commit -m "feat(литсовет): стадия Иллюстрации — настраиваемое кол-во кандидатов + сортировка/бейдж важности"
```

---

### Task 7: Финальная сквозная проверка

**Files:** нет изменений — только верификация.

- [ ] **Шаг 1: Полный синтаксис-проход**

```bash
for f in литсовет/src/state.js литсовет/src/artStyles.js литсовет/src/illustrations.js литсовет/src/ui/stages.js литсовет/src/ui/illustrations.js; do
  node --input-type=module --check < "$f" && echo "OK: $f" || echo "FAIL: $f"
done
```
Expected: все пять `OK`.

- [ ] **Шаг 2: Живая сквозная проверка на реальном проекте**

На свежем тестовом проекте с реальным API-ключом текстовой модели: сгенерировать реальную маленькую структуру, написать хотя бы одну сцену по-настоящему (нужен непустой текст для `doneScenesOrdered`). На Концепции — включить «Визуальный голос», выбрать художественный стиль и цвет. На «Иллюстрациях» — задать кол-во кандидатов (например 5), нажать «Предложить иллюстрации» (реальный вызов), подтвердить: количество кандидатов ≤ 5, у всех есть `importance` 1-10, список отсортирован по убыванию важности, бейджи видны в UI.

- [ ] **Шаг 3: Проверить обратную совместимость**

На проекте, у которого `state.illustrations`/`state.style` — это старые сохранённые данные БЕЗ новых полей (можно смоделировать: удалить `colorMode`/`artStyleId`/`suggestCount` из состояния через `preview_eval` и вызвать `save()`, затем перезагрузить страницу, чтобы прогнать через `migrate()` при следующей загрузке — либо явно вызвать саму функцию `migrate`, если она экспортирована, либо просто убедиться что `getState()` после `location.reload()` снова содержит дефолты). Подтвердить: `state.style.colorMode==='color'`, `state.style.artStyleId===''`, `state.illustrations.suggestCount===7` — восстановлены дефолтом, ничего не падает.

- [ ] **Шаг 4: Отчёт**

Зафиксировать результат: что подтверждено живыми проверками на реальных данных, что не удалось проверить и почему (например, если в окружении нет реального ключа текстовой модели — тогда шаги 2-3 частично заменяются на прямые проверки функций без реального вызова LLM, как уже делалось для промпт-сборки в Task 4).

---

## Порядок выполнения

Задачи **1 → 2 → 3 → 4 → 5 → 6 → 7**, полностью последовательно. Задача 1 (поля состояния) — фундамент для всех остальных. Задача 2 (`artStyles.js`) не конфликтует по файлу с 1, но задачи 4/5 читают `ART_STYLES` из неё — значит 2 должна завершиться до 4 и 5 (содержательная, не файловая зависимость — как раньше в этой же сессии было с `styles.js`/жанрами). Задачи 3 и 4 обе редактируют `illustrations.js` — строго последовательно, чтобы избежать конфликтов на одном файле. Задача 6 читает `importance`/`suggestCount`, которые задача 3 уже добавила в `suggestIllustrations()` — значит 3 должна завершиться до 6. Задача 7 — после всех остальных.
