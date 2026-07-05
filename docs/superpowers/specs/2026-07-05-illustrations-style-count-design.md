# Настройки стиля и количества иллюстраций — дизайн

## Цель

Второй из двух согласованных под-проектов доработки «Иллюстраций» (первый — встраивание в экспорт — уже смёржен). Сейчас автор не может: (1) задать художественный стиль картинок иначе чем через одно свободнотекстовое поле «Визуальный голос», (2) переключить цвет/чёрно-белое, (3) повлиять на то, сколько иллюстраций предложит арт-директор (жёстко «1 обложка + до 7 сцен», хардкод), (4) увидеть, какие из предложенных иллюстраций арт-директор считает более важными (только текстовое `reason`, без числовой оценки).

## §1. Данные

### 1.1 `state.js` — новые поля

В `style: {}` (`литсовет/src/state.js:47-53`), добавить:
```js
      colorMode: 'color',      // color | bw — цветные иллюстрации или чёрно-белые
      artStyleId: '',          // id пресета из artStyles.js; '' = без пресета (только «Визуальный голос»)
```

В `illustrations: {}` (`литсовет/src/state.js:67-73`), добавить:
```js
      suggestCount: 7,         // сколько кандидатов предлагать (включая обложку), 1-15
```

`migrate()` (`state.js:379-386`, уже делает `Object.assign({}, d.style, s.style)` и аналогично для `illustrations`) автоматически подставит эти дефолты старым проектам — дополнительных изменений в `migrate()` не требуется.

### 1.2 Новый файл `литсовет/src/artStyles.js`

По аналогии с `styles.js` (авторские стили прозы) — чистые данные, без обращений к LLM:
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

## §2. Промпты (`литсовет/src/illustrations.js`)

### 2.1 `illustrationSuggestMessages(state)` — динамическое количество

Строка `литсовет/src/illustrations.js:29` (сейчас: `'Предложи кандидатов на иллюстрации: 1 обложка + до 7 сильных визуальных сцен...'`) заменяется на использование `state.illustrations?.suggestCount || 7`:
```js
const count = state.illustrations?.suggestCount || 7;
```
и в теле `user`-промпта: `` `Предложи кандидатов на иллюстрации: 1 обложка + до ${count-1} сильных визуальных сцен (не каждую, только те, что реально дают яркую картинку — не диалоги и не размышления, а моменты с явным визуальным образом).` ``

JSON-схема кандидата получает новое числовое поле `importance` (1-10):
`{ "type":"cover|scene", "sceneTitle":"...", "prompt":"...", "reason":"...", "importance":"число 1-10, насколько сильна эта картинка для книги — 10 = ключевой визуальный момент, 1 = проходной" }`

### 2.2 `suggestIllustrations(state)` — динамический потолок + парсинг `importance`

`.slice(0, 8)` (`illustrations.js:47`) → `.slice(0, state.illustrations?.suggestCount || 7)`.

В возвращаемом объекте кандидата (`illustrations.js:50-57`) добавить:
```js
importance: Math.max(1, Math.min(10, Math.round(Number(c.importance)||5))),
```
(дефолт 5, если модель не вернула число — не роняем весь ответ из-за одного отсутствующего поля).

### 2.3 `generateIllustrationFor(state, candidate)` — стиль + цвет в промпт картинки

Сейчас (`illustrations.js:66-67`) добавляет только `visualVoice`. Расширить до накопления нескольких необязательных частей:
```js
const parts = [];
if(state.style?.visualVoiceOn && state.style?.visualVoice) parts.push(`Стиль: ${state.style.visualVoice}`);
const artStyle = ART_STYLES.find(s=>s.id===state.style?.artStyleId);
if(artStyle) parts.push(artStyle.promptFragment);
if(state.style?.colorMode==='bw') parts.push('black and white, monochrome, no color');
const prompt = parts.length ? `${candidate.prompt}\n\n${parts.join('. ')}` : candidate.prompt;
```
(цвет по умолчанию — никакой доп. инструкции не добавляется; явная инструкция нужна только для чёрно-белого режима, т.к. цвет — базовое допущение большинства генераторов).

## §3. UI

### 3.1 Концепция (`ui/stages.js`) — пикер стиля + переключатель цвета рядом с «Визуальный голос»

Внутри `#visualVoiceField` (тот же блок, что уже показывает textarea `#visualVoice` и загрузку обложки, `ui/stages.js` рядом со строками ~220-231), добавить:
```html
<div class="field" style="margin-top:10px">
  <label>Художественный стиль <span class="hint">(необязательно — добавляется к промпту картинки вместе с «Визуальным голосом»)</span></label>
  <select id="artStyleId">
    <option value="">— без пресета —</option>
    ${ART_STYLES.map(s=>`<option value="${s.id}"${s.id===state.style.artStyleId?' selected':''}>${esc(s.name)}</option>`).join('')}
  </select>
</div>
<div class="field row" style="gap:8px;align-items:center;margin-top:8px">
  <label>Цвет</label>
  <select id="colorMode">
    <option value="color"${state.style.colorMode!=='bw'?' selected':''}>Цветные</option>
    <option value="bw"${state.style.colorMode==='bw'?' selected':''}>Чёрно-белые</option>
  </select>
</div>
```
Оба — простые `<select>` без «свой вариант» (в отличие от жанра/эпохи): стиль иллюстраций — не то поле, где нужен произвольный текст, для этого уже есть «Визуальный голос» рядом.

### 3.2 Иллюстрации (`ui/illustrations.js`) — счётчик количества + бейдж важности

Рядом с кнопкой «🎨 Предложить иллюстрации» (`ui/illustrations.js:35-37`), добавить числовое поле (мирроринг паттерна «Глав: [3]» на стадии Структура):
```html
<label class="row" style="gap:6px;align-items:center;font-size:12px">
  Кандидатов:
  <input type="number" id="illSuggestCount" min="1" max="15" value="${s.illustrations?.suggestCount||7}" style="width:52px">
</label>
```
Обработчик — прямое присваивание в `state.illustrations.suggestCount` при изменении, без промежуточной кнопки-подтверждения (значение читается непосредственно в момент клика «Предложить», как уже происходит с `state.project.chapterCount` на Структуре).

В `renderCandidates()` (`ui/illustrations.js:47-71`) — сортировать `_candidates` по `importance` по убыванию перед рендером, и добавить бейдж рядом с `reason`:
```html
<span class="muted" style="font-size:11px">★ ${c.importance}/10</span>
```

## Проверка

Как и для прошлых фич — нет тестового фреймворка. Проверка — `node --input-type=module --check`, затем живая проверка через реально запущенный сервер: реальный вызов «Предложить иллюстрации» с изменённым `suggestCount` (проверить фактическое число вернувшихся кандидатов и наличие `importance` у каждого), проверка что смена художественного стиля/цвета в Концепции действительно долетает до промпта `generateIllustrationFor` (можно проверить без реальной платной генерации картинки — достаточно вызвать функцию сборки промпта и проверить итоговую строку).
