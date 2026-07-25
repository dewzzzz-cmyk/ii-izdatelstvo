# Настоящий текст на обложке + фикс дублирующего титульного листа — дизайн

## Цель

Автор открыл готовую книгу в PDF и увидел три страницы подряд там, где должна быть одна: (1) пустой белый лист с текстовым `<h1>Название</h1>`, (2) отдельный лист с картинкой обложки, (3) дальше книга. Причина — `exportPdf()` (`литсовет/src/ui/stages.js`) всегда печатает текстовый титул отдельно от обложки, даже когда обложка уже есть; `.doc` (`литсовет/src/export.js` `exportDocx()`) устроен так же. `.epub` уже правильный — там сразу картинка обложки, без дублирующего текстового листа (см. `OEBPS/cover.xhtml` в `exportEpub()`).

Вторая причина того же явления: название на самой обложке рисует AI-генератор картинки. По коду (`textInstruction()` в `illustrations.js`) это признанно ненадёжно — мелкий/плотный текст даёт нечитаемые артефакты у всех современных image-моделей без исключения. Для карты мира эта же проблема уже решена — `compositeMapLabels()` рисует подписи НАСТОЯЩИМ текстом через canvas поверх сгенерированной картинки, не полагаясь на текст AI. Для обложки такого механизма нет.

Расстановка иллюстраций по сценам (картинка над текстом сцены) автором отдельно не оспаривается — это тот же вопрос качества подачи, не отдельная логика места; менять её не нужно.

## §1. `литсовет/src/illustrations.js`

### 1.1 Новая функция `compositeCoverTitle(baseDataUrl, title, author)`

По образцу `compositeMapLabels` (`illustrations.js:384-419`): рисует название и (опционально) автора настоящим текстом на canvas поверх уже сгенерированной картинки. Плашка — в нижней трети обложки (классическая книжная раскладка), с полупрозрачной тёмной подложкой для контраста поверх любого фона — та же техника, что уже используется для подписей карты (`rgba(10,8,6,0.55)` вместо `rgba(24,16,8,0.6)` у карты — крупнее плашка, поэтому чуть темнее для контраста с большим текстом).

```js
// Настоящий текст названия на обложке (canvas), а не то, что нарисует сама
// AI-модель — та же причина и тот же приём, что и у compositeMapLabels выше:
// мелкий/плотный текст даёт нечитаемые артефакты у всех современных
// image-моделей без исключения. baseDataUrl — чистый фон без текста (см.
// generateIllustrationFor ниже — AI теперь всегда просится рисовать обложку
// БЕЗ текста, реальное название/автор накладываются здесь).
export function compositeCoverTitle(baseDataUrl, title, author){
  const t = String(title||'').trim();
  if(!t) return Promise.resolve(baseDataUrl); // нечего накладывать (черновой проект без названия)
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.onload = ()=>{
      try{
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const a = String(author||'').trim();
        const titleSize = Math.max(28, Math.round(canvas.width * 0.075));
        const authorSize = Math.max(16, Math.round(canvas.width * 0.032));
        const maxTextWidth = canvas.width - canvas.width*0.16;
        const titleFont = `700 ${titleSize}px Georgia, 'Times New Roman', serif`;
        const titleLines = wrapCoverText(ctx, t, titleFont, maxTextWidth, 3);
        const lineH = titleSize * 1.15;
        const blockH = titleLines.length*lineH + (a ? authorSize*1.8 : 0);
        const blockY = canvas.height*0.78 - blockH/2; // центр текстового блока — на 78% высоты картинки
        const plateH = blockH + titleSize*0.9;
        ctx.fillStyle = 'rgba(10,8,6,0.55)';
        ctx.fillRect(0, blockY - titleSize*0.5, canvas.width, plateH);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f7edd8';
        ctx.font = titleFont;
        titleLines.forEach((line,i)=> ctx.fillText(line, canvas.width/2, blockY + lineH*(i+0.8)));
        if(a){
          ctx.font = `italic ${authorSize}px Georgia, 'Times New Roman', serif`;
          ctx.fillText(a, canvas.width/2, blockY + titleLines.length*lineH + authorSize*1.3);
        }
        resolve(canvas.toDataURL('image/png'));
      }catch(e){ reject(e); }
    };
    img.onerror = ()=>reject(new Error('Не удалось загрузить обложку для наложения названия.'));
    img.src = baseDataUrl;
  });
}

// Перенос длинного названия на несколько строк по словам — canvas не делает
// этого сам. maxLines защищает от бесконечно длинного названия — лишние слова
// в последнюю разрешённую строку просто не попадают (не обрезаем «…» на
// полуслове — редкий крайний случай, не стоит усложнять ради него).
function wrapCoverText(ctx, text, font, maxWidth, maxLines){
  ctx.font = font;
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for(const w of words){
    const test = cur ? cur+' '+w : w;
    if(ctx.measureText(test).width > maxWidth && cur){
      lines.push(cur);
      if(lines.length === maxLines) return lines;
      cur = w;
    } else cur = test;
  }
  if(cur) lines.push(cur);
  return lines.slice(0, maxLines);
}
```

### 1.2 `generateIllustrationFor(state, candidate)` — обложка больше не просит AI рисовать текст

Сейчас (`illustrations.js:140-163`) `noText` для любого типа кандидата вычисляется из `effectiveTextOn()`, и AI получает инструкцию про текст названия (`titleClause` внутри `textInstruction`). Меняется на:

```js
export async function generateIllustrationFor(state, candidate){
  const ic = state.illustrations || {};
  if(!ic.apiKey) throw new Error('Не задан API-ключ для генерации картинок (⚙).');
  const parts = [];
  if(state.style?.visualVoiceOn && state.style?.visualVoice) parts.push(`Стиль: ${state.style.visualVoice}`);
  const artStyle = ART_STYLES.find(s=>s.id===state.style?.artStyleId);
  if(artStyle) parts.push(artStyle.promptFragment);
  if(state.style?.colorMode==='bw') parts.push('black and white, monochrome, no color');
  const isCover = candidate.type==='cover';
  const wantsText = effectiveTextOn(candidate, ic);
  // Обложка: реальный текст названия теперь ВСЕГДА накладывается нами через
  // compositeCoverTitle, а не рисуется AI — поэтому AI для обложки всегда
  // просится обойтись без текста вообще, независимо от wantsText. wantsText
  // для обложки управляет только тем, наложим ли МЫ текст после генерации
  // (тот же смысл тумблера «текст на картинке», что и раньше — просто другой
  // исполнитель самого текста).
  const noText = isCover ? true : !wantsText;
  const txtInstr = textInstruction({ noText, ruText: ic.ruText }); if(txtInstr) parts.push(txtInstr);
  const portraitInstr = portraitInstruction(ic, candidate.type); if(portraitInstr) parts.push(portraitInstr);
  const prompt = parts.length ? `${candidate.prompt}\n\n${parts.join('. ')}` : candidate.prompt;
  const size = (isCover && ic.portraitCover) ? PORTRAIT_SIZE : ic.size;
  const { dataUrl } = await generateImage({
    provider: ic.provider||'gemini', apiKey: ic.apiKey, model: ic.model,
    prompt, size, quality: ic.quality, proxyToken: state.global?.proxyToken,
  });
  if(isCover && wantsText){
    const composed = await compositeCoverTitle(dataUrl, state.project?.title, state.project?.author);
    return { dataUrl: composed, baseDataUrl: dataUrl };
  }
  return { dataUrl, baseDataUrl: null };
}
```

**Важно — меняется контракт возврата функции:** раньше `generateIllustrationFor` возвращала строку (`dataUrl`), теперь — объект `{dataUrl, baseDataUrl}`. Оба вызывающих места в `ui/illustrations.js` (§2.1, §2.2) обновляются под новую форму. `baseDataUrl` — чистый фон без текста, нужен только для «🔤 Обновить название» (§2.3); для не-обложек и для обложки без текста — всегда `null`.

`textInstruction()` (`illustrations.js:111-123`) заодно упрощается — убирается вся ветка `titleClause` (`ic?.type==='cover' && ic?.title`) вместе с параметрами `type`/`title`, которые ей были нужны: обложка теперь всегда идёт по самой первой ветке (`if(ic?.noText) return 'Do not include any text...'`), эта ветка для неё никогда не достижима. Это был обходной путь под старый баг «обложка получала выдуманное название вместо реального» (commit `4ea7a31`) — теперь он не нужен вообще, раз AI не рисует текст названия никогда.

```js
export function textInstruction(ic){
  if(ic?.noText) return 'Do not include any readable text, letters, numbers or writing anywhere in the image.';
  if(ic?.ruText) return 'If the image contains any readable text or lettering (map labels, signs), it must be written in Russian (Cyrillic script), not English — and rendered LARGE, bold and sparse: a few big, clear words, not small or dense text. Small/dense text reliably comes out garbled — prefer omitting a label entirely over rendering it small.';
  return '';
}
```

### 1.3 `restoreImageVersion(item, verIdx)` — сброс `baseDataUrl` при откате

Версии (`item.versions[]`) хранят только `{dataUrl, prompt, createdAt}` — без `baseDataUrl`. После отката к прошлой версии текущий `item.baseDataUrl` относится уже не к тому `dataUrl`, что стал текущим — «Обновить название» наложил бы текст на **новый** (не откаченный) фон поверх откаченной картинки, дав молча неверный результат. Проще и безопаснее — гасить кнопку до следующей настоящей регенерации:

```js
export function restoreImageVersion(item, verIdx){
  const chosen = item.versions?.[verIdx]; if(!chosen) return false;
  const current = { dataUrl: item.dataUrl, prompt: item.prompt, createdAt: item.createdAt };
  item.versions.splice(verIdx, 1);
  item.dataUrl = chosen.dataUrl; item.prompt = chosen.prompt; item.createdAt = chosen.createdAt;
  item.baseDataUrl = null; // см. комментарий выше — версии не хранят baseDataUrl
  item.versions.unshift(current);
  const cap = versionsCapFor(item);
  if(item.versions.length > cap) item.versions.length = cap;
  return true;
}
```
(добавлена ровно одна строка `item.baseDataUrl = null;` — остальное без изменений).

## §2. `литсовет/src/ui/illustrations.js`

### 2.1 `illGenerate` (сейчас `illustrations.js:393-429`) — новый контракт возврата

```js
try{
  const { dataUrl, baseDataUrl } = await generateIllustrationFor(s, c);
  let versions = [];
  if(c.type==='cover'){
    versions = carryVersions(s.illustrations.items.find(it=>it.type==='cover'));
    s.illustrations.items = s.illustrations.items.filter(it=>it.type!=='cover');
  }
  s.illustrations.items.push({ id:c.id, type:c.type, sceneId:c.sceneId, sceneTitle:c.sceneTitle, prompt:c.prompt, textOn:c.textOn, dataUrl, baseDataUrl, createdAt:Date.now(), versions });
  if(c.type==='cover') s.project.coverDataUrl = dataUrl;
  succeeded.add(c.id);
  _errors.delete(c.id);
  save();
}catch(e){ _errors.set(c.id, e.message); }
```
(единственное изменение — деструктуризация `{ dataUrl, baseDataUrl }` вместо `const dataUrl = await ...`, и добавление поля `baseDataUrl` в пушимый объект).

### 2.2 `.ill-regen-img` (сейчас `illustrations.js:480-498`) — тот же новый контракт

```js
try{
  const { dataUrl, baseDataUrl } = await generateIllustrationFor(s, it);
  pushImageVersion(it);
  it.dataUrl = dataUrl;
  it.baseDataUrl = baseDataUrl;
  if(it.type==='cover') s.project.coverDataUrl = dataUrl;
  _rerollErrors.delete(id);
  save();
  announce('Картинка перегенерирована — прошлая версия доступна в истории (🕐)');
}catch(e){ _rerollErrors.set(id, e.message); }
```

### 2.3 Новая кнопка «🔤 Обновить название» в галерее (`renderGallery`, `illustrations.js:157-201`)

Показывается только для обложки с непустым `baseDataUrl` (то есть текст уже накладывался — есть с чем пересобрать без новой платной генерации):

```js
const canRetitle = it.type==='cover' && it.baseDataUrl;
```
в блоке действий (`illustrations.js:190-195`), рядом с `ill-reroll-prompt`/`ill-regen-img`:
```html
${canRetitle?`<button class="btn ill-retitle" data-id="${it.id}" title="Перерисовать название по текущим данным книги — без новой платной генерации картинки">🔤 Название</button>`:''}
```

Обработчик — рядом с `.ill-regen-img` в `bindHandlers()`:
```js
document.querySelectorAll('.ill-retitle').forEach(b=>b.onclick=async ()=>{
  const id = b.dataset.id;
  const it = (s.illustrations.items||[]).find(x=>x.id===id);
  if(!it || !it.baseDataUrl) return;
  try{
    const composed = await compositeCoverTitle(it.baseDataUrl, s.project.title, s.project.author);
    pushImageVersion(it);
    it.dataUrl = composed;
    s.project.coverDataUrl = composed;
    save();
    announce('Название на обложке обновлено');
    renderIllustrations(els);
  }catch(e){ _rerollErrors.set(id, e.message); renderIllustrations(els); }
});
```
(нужен импорт `compositeCoverTitle` в существующей строке `import {...} from '../illustrations.js'`, `illustrations.js:6` в ui-файле).

Полезно на практике: автор меняет название книги в «Концепции» уже после того, как обложка сгенерирована — раньше это давало рассинхрон (обложка помнит старое название), теперь один клик пересобирает картинку бесплатно.

## §3. Экспорт — убрать дублирующий текстовый титул, когда обложка есть

### 3.1 `exportPdf` (`литсовет/src/ui/stages.js:2151-2152`)

Было:
```js
</style></head><body><h1>${title}</h1>
${s.project.coverDataUrl?`<div class="pdf-img" style="margin:0 0 1.5cm">\n<img src="${s.project.coverDataUrl}" style="max-height:26cm"></div>`:''}
```
Станет:
```js
</style></head><body>
${s.project.coverDataUrl
  ? `<div class="pdf-img" style="margin:0 0 1.5cm"><img src="${s.project.coverDataUrl}" style="max-height:26cm"></div>`
  : `<h1>${title}</h1>`}
```
Без обложки — поведение не меняется (текстовый титульный лист остаётся единственным fallback). Строка с автором (`s.project.author?...`) остаётся отдельной строкой в обоих случаях — это подпись, а не целая страница, дублирования того же масштаба не создаёт.

### 3.2 `exportDocx` (`литсовет/src/export.js:133-134`)

Было:
```js
let body = `<h1>${xesc(book.title)}</h1>`;
if(state.project.coverDataUrl) body += `<p style="text-align:center"><img src="${state.project.coverDataUrl}" style="max-width:100%"/></p>`;
```
Станет:
```js
let body = state.project.coverDataUrl
  ? `<p style="text-align:center"><img src="${state.project.coverDataUrl}" style="max-width:100%"/></p>`
  : `<h1>${xesc(book.title)}</h1>`;
```

### 3.3 Не трогаем

`.epub` (`exportEpub`) — уже правильный, отдельная страница `cover.xhtml` только с картинкой. `.md` (`exportMd`) — нет понятия «страница», заголовок `# Title` перед картинкой остаётся как есть (структурный маркер markdown-файла, не два отдельных «листа»). Расстановка иллюстраций по сценам — без изменений.

## Проверка

Как и для прошлых фич — нет тестового фреймворка. Проверка:
1. `node --check` на `illustrations.js`, `ui/illustrations.js`, `ui/stages.js`, `export.js`.
2. Живой браузерный тест `compositeCoverTitle`: собрать фейковый `baseDataUrl` (сплошной цвет через canvas), вызвать с тестовым названием/автором, убедиться что промис резолвится валидным `data:image/png` и не бросает исключение; отдельно проверить короткое/длинное (>3 строк) название на перенос строк.
3. Живой тест `generateIllustrationFor` с застабленным `generateImage` (как раньше в сессии стабился `fetch`) — проверить, что для обложки `noText` в промпте всегда `true`, а результат содержит `{dataUrl, baseDataUrl}` с непустым `baseDataUrl`, когда `wantsText` истинный, и `baseDataUrl:null`, когда автор явно попросил обложку без текста.
4. Проверить оба вызывающих места в `ui/illustrations.js` (генерация новой обложки + «Другая картинка») — элемент галереи получает поле `baseDataUrl`, кнопка «🔤 Название» появляется только когда оно есть.
5. Собрать фейковый `state` с `project.coverDataUrl` заданным/незаданным, вызвать `exportPdf`/`exportDocx` (перехватив `window.open`/`download`), убедиться что при заданной обложке `<h1>` не выводится, а при отсутствии — выводится как раньше.
6. Регресс: убедиться, что `restoreImageVersion` для карты мира (не только обложки) по-прежнему работает — новая строка `item.baseDataUrl = null` не должна ломать существующую логику `applyMapLabels`/`baseDataUrl` карты (там `baseDataUrl` перезаписывается отдельно при следующем наложении подписи, `null` как временное значение безопасен, см. `illustrations.js:429`: `if(!item.baseDataUrl) item.baseDataUrl = item.dataUrl;`).
