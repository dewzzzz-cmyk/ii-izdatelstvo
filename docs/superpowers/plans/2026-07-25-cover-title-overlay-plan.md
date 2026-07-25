# Настоящий текст на обложке + фикс дублирующего титула — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Обложка получает настоящий, гарантированно читаемый текст названия/автора (canvas-overlay, не AI-генерация текста), а PDF/.doc-экспорт перестают печатать отдельный пустой титульный лист, когда обложка уже есть.

**Architecture:** `compositeCoverTitle()` в `illustrations.js` — по образцу уже работающего `compositeMapLabels()` — рисует название/автора на canvas поверх сгенерированной AI-картинки. `generateIllustrationFor()` для обложки теперь всегда просит AI рисовать фон БЕЗ текста и сам накладывает текст после. Оба вызывающих места в `ui/illustrations.js` обновляются под новый контракт возврата `{dataUrl, baseDataUrl}`. `exportPdf`/`exportDocx` показывают обложку без отдельного текстового титула, когда она задана.

**Tech Stack:** Ванильный JS, ES-модули, Canvas 2D API (без библиотек — как и весь проект).

## Global Constraints

- Проект без зависимостей — никаких новых npm-пакетов.
- Нет тестового фреймворка в проекте — проверка через `node --check` (синтаксис) + живую браузерную проверку через `mcp__Claude_Browser__*` инструменты, как во всех прошлых фичах этой сессии.
- `docs/` в `.gitignore` — файлы плана/спеки коммитятся через `git add -f` (уже устоявшаяся практика проекта, см. историю `docs(литсовет): спека — ...`).
- Каждый шаг с изменением кода — реальный законченный код, не описание "добавить обработку".
- Спека: `docs/superpowers/specs/2026-07-25-cover-title-overlay-design.md` — источник истины по всем деталям реализации, ссылки на неё ниже по разделам (`§1.1`, `§2.3` и т.п.).

---

### Task 1: `литсовет/src/illustrations.js` — canvas-текст обложки + новый контракт генерации

**Files:**
- Modify: `литсовет/src/illustrations.js:111-123` (`textInstruction`)
- Modify: `литсовет/src/illustrations.js:140-163` (`generateIllustrationFor`)
- Modify: `литсовет/src/illustrations.js` (после `applyMapLabels()`, до `removeCover()` — сейчас между строками 434 и 436) — новые функции `compositeCoverTitle`/`wrapCoverText`
- Modify: `литсовет/src/illustrations.js:279-288` (`restoreImageVersion`)

**Interfaces:**
- Produces: `export function compositeCoverTitle(baseDataUrl, title, author) → Promise<string>` (data URL) — используется в Task 2.
- Produces: `export async function generateIllustrationFor(state, candidate) → Promise<{dataUrl: string, baseDataUrl: string|null}>` — **меняет контракт** (раньше возвращала голую строку) — оба вызывающих места в `ui/illustrations.js` (Task 2) должны быть обновлены синхронно, иначе после этой задачи код сломается (`const dataUrl = await generateIllustrationFor(...)` начнёт присваивать объект строке).
- Consumes: ничего нового извне — использует уже существующие `generateImage` (`imagegen.js`), `ART_STYLES` (`artStyles.js`), `PORTRAIT_SIZE`/`portraitInstruction`/`effectiveTextOn` (тот же файл).

- [ ] **Шаг 1: Упростить `textInstruction()`**

Открыть `литсовет/src/illustrations.js`, найти текущую функцию (строки 111-123):
```js
export function textInstruction(ic){
  if(ic?.noText) return 'Do not include any readable text, letters, numbers or writing anywhere in the image.';
  const titleClause = (ic?.type==='cover' && ic?.title)
    ? ` The book title rendered on the cover must be EXACTLY this text, unchanged and not translated or shortened: «${ic.title}».`
    : '';
  if(ic?.ruText) return 'If the image contains any readable text or lettering (book title, map labels, signs), it must be written in Russian (Cyrillic script), not English — and rendered LARGE, bold and sparse: a few big, clear words, not small or dense text. Small/dense text reliably comes out garbled — prefer omitting a label entirely over rendering it small.' + titleClause;
  if(titleClause) return 'If the image contains any readable text or lettering, render it LARGE, bold and sparse — a few big, clear words, not small or dense text.' + titleClause;
  return '';
}
```
Заменить на (см. спеку `§1.2` — `titleClause` больше не нужен: обложка после Шага 3 никогда не доходит до этой функции с `noText:false`, AI больше не рисует текст названия ни при каких условиях):
```js
export function textInstruction(ic){
  if(ic?.noText) return 'Do not include any readable text, letters, numbers or writing anywhere in the image.';
  if(ic?.ruText) return 'If the image contains any readable text or lettering (map labels, signs), it must be written in Russian (Cyrillic script), not English — and rendered LARGE, bold and sparse: a few big, clear words, not small or dense text. Small/dense text reliably comes out garbled — prefer omitting a label entirely over rendering it small.';
  return '';
}
```

- [ ] **Шаг 2: Проверить компиляцию после Шага 1**

Run: `cd литсовет && node --check src/illustrations.js`
Expected: без вывода (успех). Файл сейчас в промежуточном состоянии (`generateIllustrationFor` ещё зовёт `textInstruction` со старыми полями `type`/`title` — это не синтаксическая ошибка, лишние поля объекта JS просто игнорируются, поэтому `node --check` пройдёт и на этом промежуточном шаге).

- [ ] **Шаг 3: Переписать `generateIllustrationFor()`**

Найти текущую функцию (строки 140-163):
```js
export async function generateIllustrationFor(state, candidate){
  const ic = state.illustrations || {};
  if(!ic.apiKey) throw new Error('Не задан API-ключ для генерации картинок (⚙).');
  const parts = [];
  if(state.style?.visualVoiceOn && state.style?.visualVoice) parts.push(`Стиль: ${state.style.visualVoice}`);
  const artStyle = ART_STYLES.find(s=>s.id===state.style?.artStyleId);
  if(artStyle) parts.push(artStyle.promptFragment);
  if(state.style?.colorMode==='bw') parts.push('black and white, monochrome, no color');
  const noText = !effectiveTextOn(candidate, ic);
  const txtInstr = textInstruction({ noText, ruText: ic.ruText, type: candidate.type, title: state.project?.title }); if(txtInstr) parts.push(txtInstr);
  const portraitInstr = portraitInstruction(ic, candidate.type); if(portraitInstr) parts.push(portraitInstr);
  const prompt = parts.length ? `${candidate.prompt}\n\n${parts.join('. ')}` : candidate.prompt;
  const size = (candidate.type==='cover' && ic.portraitCover) ? PORTRAIT_SIZE : ic.size;
  const { dataUrl } = await generateImage({
    provider: ic.provider||'gemini',
    apiKey: ic.apiKey,
    model: ic.model,
    prompt,
    size,
    quality: ic.quality,
    proxyToken: state.global?.proxyToken,
  });
  return dataUrl;
}
```
Заменить на (см. спеку `§1.2`):
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
  // для обложки управляет только тем, наложим ли МЫ текст после генерации.
  const noText = isCover ? true : !wantsText;
  const txtInstr = textInstruction({ noText, ruText: ic.ruText }); if(txtInstr) parts.push(txtInstr);
  const portraitInstr = portraitInstruction(ic, candidate.type); if(portraitInstr) parts.push(portraitInstr);
  const prompt = parts.length ? `${candidate.prompt}\n\n${parts.join('. ')}` : candidate.prompt;
  const size = (isCover && ic.portraitCover) ? PORTRAIT_SIZE : ic.size;
  const { dataUrl } = await generateImage({
    provider: ic.provider||'gemini',
    apiKey: ic.apiKey,
    model: ic.model,
    prompt,
    size,
    quality: ic.quality,
    proxyToken: state.global?.proxyToken,
  });
  if(isCover && wantsText){
    const composed = await compositeCoverTitle(dataUrl, state.project?.title, state.project?.author);
    return { dataUrl: composed, baseDataUrl: dataUrl };
  }
  return { dataUrl, baseDataUrl: null };
}
```

- [ ] **Шаг 4: Добавить `compositeCoverTitle()` и `wrapCoverText()`**

В том же файле найти конец функции `applyMapLabels` (заканчивается `return composited;\n}` перед комментарием `// Убрать обложку целиком...` и `export function removeCover`). Вставить между ними новые функции (см. спеку `§1.1`):
```js
// Настоящий текст названия на обложке (canvas), а не то, что нарисует сама
// AI-модель — та же причина и тот же приём, что и у compositeMapLabels выше:
// мелкий/плотный текст даёт нечитаемые артефакты у всех современных
// image-моделей без исключения. baseDataUrl — чистый фон без текста (см.
// generateIllustrationFor выше — AI теперь всегда просится рисовать обложку
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
// в последнюю разрешённую строку просто не попадают.
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

- [ ] **Шаг 5: Пофиксить `restoreImageVersion()` — сброс `baseDataUrl` после отката**

Найти текущую функцию (строки 279-288):
```js
export function restoreImageVersion(item, verIdx){
  const chosen = item.versions?.[verIdx]; if(!chosen) return false;
  const current = { dataUrl: item.dataUrl, prompt: item.prompt, createdAt: item.createdAt };
  item.versions.splice(verIdx, 1);
  item.dataUrl = chosen.dataUrl; item.prompt = chosen.prompt; item.createdAt = chosen.createdAt;
  item.versions.unshift(current);
  const cap = versionsCapFor(item);
  if(item.versions.length > cap) item.versions.length = cap;
  return true;
}
```
Добавить одну строку `item.baseDataUrl = null;` сразу после присваивания `item.dataUrl`/`item.prompt`/`item.createdAt` (см. спеку `§1.3` — версии не хранят `baseDataUrl`, после отката он бы указывал не на тот фон):
```js
export function restoreImageVersion(item, verIdx){
  const chosen = item.versions?.[verIdx]; if(!chosen) return false;
  const current = { dataUrl: item.dataUrl, prompt: item.prompt, createdAt: item.createdAt };
  item.versions.splice(verIdx, 1);
  item.dataUrl = chosen.dataUrl; item.prompt = chosen.prompt; item.createdAt = chosen.createdAt;
  item.baseDataUrl = null; // версии не хранят baseDataUrl — гасим «Обновить название» до следующей регенерации
  item.versions.unshift(current);
  const cap = versionsCapFor(item);
  if(item.versions.length > cap) item.versions.length = cap;
  return true;
}
```

- [ ] **Шаг 6: Синтаксис-проверка всего файла**

Run: `cd литсовет && node --check src/illustrations.js`
Expected: без вывода (успех).

- [ ] **Шаг 7: Коммит**

```bash
cd "C:\Users\user\Documents\webar-main\издательство"
git add литсовет/src/illustrations.js
git commit -m "feat(литсовет): настоящий текст названия на обложке через canvas (compositeCoverTitle)"
```

---

### Task 2: `литсовет/src/ui/illustrations.js` — новый контракт возврата + кнопка «Обновить название»

**Files:**
- Modify: `литсовет/src/ui/illustrations.js:6` (импорт)
- Modify: `литсовет/src/ui/illustrations.js:157-201` (`renderGallery`)
- Modify: `литсовет/src/ui/illustrations.js:393-429` (`illGenerate` — обработчик `#illGenerate`)
- Modify: `литсовет/src/ui/illustrations.js:480-498` (обработчик `.ill-regen-img`)
- Modify: `литсовет/src/ui/illustrations.js` (`bindHandlers`, рядом с обработчиком `.ill-regen-img`) — новый обработчик `.ill-retitle`

**Interfaces:**
- Consumes: `generateIllustrationFor(state, candidate) → Promise<{dataUrl, baseDataUrl}>` и `compositeCoverTitle(baseDataUrl, title, author) → Promise<string>` из Task 1.
- Produces: элементы `state.illustrations.items[]` теперь несут поле `baseDataUrl` (строка или `null`) — используется только внутри этого файла (кнопка «Обновить название»), другие потребители галереи (`export.js`, `ui/stages.js`, `ui/world.js`) читают только `item.dataUrl`, их не касается.

- [ ] **Шаг 1: Добавить `compositeCoverTitle` в импорт**

Найти строку 6:
```js
import { suggestIllustrations, generateIllustrationFor, chapterTitleForScene, suggestOneIllustration, saveUploadedItem, effectiveTextOn, carryVersions, pushImageVersion, restoreImageVersion } from '../illustrations.js';
```
Заменить на:
```js
import { suggestIllustrations, generateIllustrationFor, chapterTitleForScene, suggestOneIllustration, saveUploadedItem, effectiveTextOn, carryVersions, pushImageVersion, restoreImageVersion, compositeCoverTitle } from '../illustrations.js';
```

- [ ] **Шаг 2: Обновить обработчик `#illGenerate` (генерация новых картинок) под новый контракт**

Найти в `bindHandlers()` (строки ~393-429) блок цикла генерации:
```js
      try{
        const dataUrl = await generateIllustrationFor(s, c);
        // Обложка — одна на проект (как карта мира): предыдущая запись заменяется,
        // но её dataUrl переносится в versions[] новой (carryVersions) — не пропадает.
        let versions = [];
        if(c.type==='cover'){
          versions = carryVersions(s.illustrations.items.find(it=>it.type==='cover'));
          s.illustrations.items = s.illustrations.items.filter(it=>it.type!=='cover');
        }
        s.illustrations.items.push({ id:c.id, type:c.type, sceneId:c.sceneId, sceneTitle:c.sceneTitle, prompt:c.prompt, textOn:c.textOn, dataUrl, createdAt:Date.now(), versions });
        if(c.type==='cover') s.project.coverDataUrl = dataUrl;
        succeeded.add(c.id);
        _errors.delete(c.id);
        save();
      }catch(e){ _errors.set(c.id, e.message); }
```
Заменить на (единственные изменения: деструктуризация `{dataUrl, baseDataUrl}` и добавление поля `baseDataUrl` в пушимый объект):
```js
      try{
        const { dataUrl, baseDataUrl } = await generateIllustrationFor(s, c);
        // Обложка — одна на проект (как карта мира): предыдущая запись заменяется,
        // но её dataUrl переносится в versions[] новой (carryVersions) — не пропадает.
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

- [ ] **Шаг 3: Обновить обработчик `.ill-regen-img` («Другая картинка») под новый контракт**

Найти (строки ~480-498):
```js
  document.querySelectorAll('.ill-regen-img').forEach(b=>b.onclick=async ()=>{
    if(!s.illustrations?.apiKey){ alert('Задайте ключ для генерации картинок в настройках (⚙).'); return; }
    if(_busy) return;
    const id = b.dataset.id;
    const it = (s.illustrations.items||[]).find(x=>x.id===id);
    if(!it) return;
    if(!confirm('Перегенерировать картинку по текущему промпту? Это платно.')) return;
    _busy = true; _busyText='Генерирую картинку…'; renderIllustrations(els);
    try{
      const dataUrl = await generateIllustrationFor(s, it);
      pushImageVersion(it);
      it.dataUrl = dataUrl;
      if(it.type==='cover') s.project.coverDataUrl = dataUrl;
      _rerollErrors.delete(id);
      save();
      announce('Картинка перегенерирована — прошлая версия доступна в истории (🕐)');
    }catch(e){ _rerollErrors.set(id, e.message); }
    finally{ _busy=false; _busyText=''; renderIllustrations(els); }
  });
```
Заменить на:
```js
  document.querySelectorAll('.ill-regen-img').forEach(b=>b.onclick=async ()=>{
    if(!s.illustrations?.apiKey){ alert('Задайте ключ для генерации картинок в настройках (⚙).'); return; }
    if(_busy) return;
    const id = b.dataset.id;
    const it = (s.illustrations.items||[]).find(x=>x.id===id);
    if(!it) return;
    if(!confirm('Перегенерировать картинку по текущему промпту? Это платно.')) return;
    _busy = true; _busyText='Генерирую картинку…'; renderIllustrations(els);
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
    finally{ _busy=false; _busyText=''; renderIllustrations(els); }
  });
```

- [ ] **Шаг 4: Синтаксис-проверка после Шагов 1-3**

Run: `cd литсовет && node --check src/ui/illustrations.js`
Expected: без вывода (успех).

- [ ] **Шаг 5: Добавить кнопку «🔤 Название» в `renderGallery()`**

Найти блок действий в строке цикла галереи (строки ~189-195):
```js
        <td>
          <div class="row" style="gap:6px;flex-wrap:wrap">
            ${canReroll?`<button class="btn ill-reroll-prompt" data-id="${it.id}" title="Предложить другой промпт (текстовый вызов, бесплатно) — картинку это не трогает">🔄 Промпт</button>`:''}
            ${canReroll?`<button class="btn ill-regen-img" data-id="${it.id}" title="Перегенерировать картинку по текущему промпту — платно">🖼 Картинка</button>`:''}
            ${it.versions&&it.versions.length?`<button class="btn ill-history" data-id="${it.id}" title="История версий (${it.versions.length}) — можно вернуться к прошлой картинке">🕐 ${it.versions.length}</button>`:''}
            <button class="btn ill-del" data-id="${it.id}" data-label="${esc(label)}" title="Удалить">🗑</button>
          </div>
        </td>
```
Прямо перед этим блоком (внутри `.map(it=>{...})`, после строки `const rerollErr = _rerollErrors.get(it.id);`) добавить:
```js
        const canRetitle = it.type==='cover' && it.baseDataUrl;
```
И заменить сам блок действий на:
```js
        <td>
          <div class="row" style="gap:6px;flex-wrap:wrap">
            ${canReroll?`<button class="btn ill-reroll-prompt" data-id="${it.id}" title="Предложить другой промпт (текстовый вызов, бесплатно) — картинку это не трогает">🔄 Промпт</button>`:''}
            ${canReroll?`<button class="btn ill-regen-img" data-id="${it.id}" title="Перегенерировать картинку по текущему промпту — платно">🖼 Картинка</button>`:''}
            ${canRetitle?`<button class="btn ill-retitle" data-id="${it.id}" title="Перерисовать название по текущим данным книги — без новой платной генерации картинки">🔤 Название</button>`:''}
            ${it.versions&&it.versions.length?`<button class="btn ill-history" data-id="${it.id}" title="История версий (${it.versions.length}) — можно вернуться к прошлой картинке">🕐 ${it.versions.length}</button>`:''}
            <button class="btn ill-del" data-id="${it.id}" data-label="${esc(label)}" title="Удалить">🗑</button>
          </div>
        </td>
```

- [ ] **Шаг 6: Добавить обработчик `.ill-retitle` в `bindHandlers()`**

Сразу после блока обработчика `.ill-regen-img` (изменённого в Шаге 3, перед закрывающей `}` функции `bindHandlers`), добавить:
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

- [ ] **Шаг 7: Финальная синтаксис-проверка файла**

Run: `cd литсовет && node --check src/ui/illustrations.js`
Expected: без вывода (успех).

- [ ] **Шаг 8: Коммит**

```bash
cd "C:\Users\user\Documents\webar-main\издательство"
git add литсовет/src/ui/illustrations.js
git commit -m "feat(литсовет): галерея — кнопка «Обновить название» на обложке, новый контракт generateIllustrationFor"
```

---

### Task 3: Убрать дублирующий титульный лист в PDF/.doc

**Files:**
- Modify: `литсовет/src/ui/stages.js:2151-2152` (`exportPdf`)
- Modify: `литсовет/src/export.js:133-134` (`exportDocx`)

**Interfaces:**
- Consumes: `state.project.coverDataUrl` (уже существующее поле, без изменений формата).
- Produces: ничего нового — только меняет вёрстку экспорта. Не зависит от Task 1/2 и может выполняться независимо/параллельно.

- [ ] **Шаг 1: Поправить `exportPdf()` в `ui/stages.js`**

Найти (строки 2151-2153):
```js
  </style></head><body><h1>${title}</h1>
  ${s.project.coverDataUrl?`<div class="pdf-img" style="margin:0 0 1.5cm">\n<img src="${s.project.coverDataUrl}" style="max-height:26cm"></div>`:''}
  ${s.project.author?`<p style="text-align:center;font-style:italic;margin:-.5cm 0 1.5cm">${esc(s.project.author)}</p>`:''}${body}<script>window.onload=()=>window.print()<\/script></body></html>`;
```
Заменить на:
```js
  </style></head><body>
  ${s.project.coverDataUrl
    ? `<div class="pdf-img" style="margin:0 0 1.5cm"><img src="${s.project.coverDataUrl}" style="max-height:26cm"></div>`
    : `<h1>${title}</h1>`}
  ${s.project.author?`<p style="text-align:center;font-style:italic;margin:-.5cm 0 1.5cm">${esc(s.project.author)}</p>`:''}${body}<script>window.onload=()=>window.print()<\/script></body></html>`;
```

- [ ] **Шаг 2: Поправить `exportDocx()` в `export.js`**

Найти (строки 131-134):
```js
export function exportDocx(state){
  const book = buildBook(state);
  let body = `<h1>${xesc(book.title)}</h1>`;
  if(state.project.coverDataUrl) body += `<p style="text-align:center"><img src="${state.project.coverDataUrl}" style="max-width:100%"/></p>`;
```
Заменить на:
```js
export function exportDocx(state){
  const book = buildBook(state);
  let body = state.project.coverDataUrl
    ? `<p style="text-align:center"><img src="${state.project.coverDataUrl}" style="max-width:100%"/></p>`
    : `<h1>${xesc(book.title)}</h1>`;
```

- [ ] **Шаг 3: Синтаксис-проверка обоих файлов**

Run: `cd литсовет && node --check src/ui/stages.js && node --check src/export.js`
Expected: без вывода (успех).

- [ ] **Шаг 4: Коммит**

```bash
cd "C:\Users\user\Documents\webar-main\издательство"
git add литсовет/src/ui/stages.js литсовет/src/export.js
git commit -m "fix(литсовет): PDF/.doc не дублируют титул отдельным листом, когда обложка уже есть"
```

---

### Task 4: Живая сквозная проверка в браузере

**Files:** нет изменений кода — только проверка Task 1-3 вместе, реальным запущенным сервером.

**Interfaces:** N/A (проверочная задача).

- [ ] **Шаг 1: Запустить сервер**

Run: `cd литсовет && node server.js` (или через `mcp__Claude_Browser__preview_start` с `{name:"litsovet"}`, если в `.claude/launch.json` уже есть конфигурация — проверить `литсовет/.claude/launch.json`, при отсутствии создать конфигурацию `{name:"litsovet", runtimeExecutable:"node", runtimeArgs:["server.js"], port:8787}` — см. `литсовет/CLAUDE.md`/корневой `CLAUDE.md` за портом).
Expected: сервер поднялся на `http://localhost:8787` (или `$PORT`), лог без ошибок.

- [ ] **Шаг 2: Открыть приложение в Browser pane**

Через `mcp__Claude_Browser__preview_start` открыть `http://localhost:8787`, дождаться загрузки SPA.

- [ ] **Шаг 3: Живой тест `compositeCoverTitle` через `javascript_tool`**

Выполнить в консоли страницы (через `mcp__Claude_Browser__javascript_tool`, `action:"javascript_exec"`) примерно такой скрипт — собрать фейковый `baseDataUrl` (сплошной цвет через canvas), импортировать модуль с cache-busting (`?v=' + Date.now()`, см. известный урок этой сессии — без этого параметра можно получить закэшированный модуль ДО правок), вызвать функцию:
```js
const c = document.createElement('canvas'); c.width=1024; c.height=1536;
const ctx = c.getContext('2d'); ctx.fillStyle='#335577'; ctx.fillRect(0,0,1024,1536);
const base = c.toDataURL('image/png');
const mod = await import('/src/illustrations.js?v=' + Date.now());
const short = await mod.compositeCoverTitle(base, 'Тестовая книга', 'Автор Тестов');
const long = await mod.compositeCoverTitle(base, 'Очень длинное название книги которое почти наверняка не влезет в одну строку целиком', '');
({ shortOk: short.startsWith('data:image/png'), shortDiffersFromBase: short !== base, longOk: long.startsWith('data:image/png') })
```
Expected: `{ shortOk: true, shortDiffersFromBase: true, longOk: true }`, без выброшенных исключений.

- [ ] **Шаг 4: Живой тест `generateIllustrationFor()` для обложки со стабом `generateImage`**

Через `javascript_tool` — застабить `window.fetch` (как ранее в этой сессии стабился `/api/generate-image`), чтобы не тратить реальные деньги, и проверить оба режима (`wantsText` истина/ложь):
```js
const mod = await import('/src/illustrations.js?v=' + Date.now());
const origFetch = window.fetch;
let capturedPrompt = '';
window.fetch = async (url, opts) => {
  if(String(url).includes('/api/generate-image')){
    const body = JSON.parse(opts.body);
    capturedPrompt = body.prompt;
    const c = document.createElement('canvas'); c.width=32; c.height=32;
    return new Response(JSON.stringify({ dataUrl: c.getContext('2d') && c.toDataURL('image/png') }), { status:200 });
  }
  return origFetch(url, opts);
};
const state = { illustrations:{ apiKey:'fake', provider:'gemini' }, project:{ title:'Проверка', author:'Автор' }, style:{} };
const withText = await mod.generateIllustrationFor(state, { type:'cover', prompt:'a mountain landscape' });
const noTextState = { illustrations:{ apiKey:'fake', provider:'gemini', noText:true }, project:{ title:'Проверка' }, style:{} };
const withoutText = await mod.generateIllustrationFor(noTextState, { type:'cover', prompt:'a mountain landscape' });
window.fetch = origFetch;
({
  promptForcesNoAiText: capturedPrompt.includes('Do not include any readable text'),
  withTextHasBase: !!withText.baseDataUrl,
  withTextDataUrlDiffersFromBase: withText.dataUrl !== withText.baseDataUrl,
  withoutTextHasNullBase: withoutText.baseDataUrl === null,
})
```
Expected: все четыре поля `true`.

- [ ] **Шаг 5: Живой UI-тест галереи — кнопка «🔤 Название» появляется/работает**

Через реальный клик в UI (`mcp__Claude_Browser__computer`/`read_page`) или через `javascript_tool`, вызывающий уже отрендеренные обработчики: создать проект с заданным `project.title`, сгенерировать обложку (со стабом `fetch`, как в Шаге 4) через кнопку «✨ Сгенерировать выбранные» на стадии «Иллюстрации», убедиться что в галерее у обложки появилась кнопка «🔤 Название», кликнуть её, убедиться что `state.project.coverDataUrl` изменился (новый `dataUrl`) и не бросилось исключение.

- [ ] **Шаг 6: Живой тест `exportPdf`/`exportDocx` — нет дублирующего титула**

Через `javascript_tool`, застабив `window.open`, чтобы перехватить сгенерированный HTML вместо реального открытия окна печати:
```js
const mod = await import('/src/ui/stages.js?v=' + Date.now());
```
(если `exportPdf` не экспортирована — см. её текущий статус в `ui/stages.js`; при необходимости протестировать её косвенно через клик по кнопке `#exPdf` на стадии «Редактура» с `window.open` застабленным на функцию, возвращающую фейковый `{document:{write:(html)=>{ capturedHtml = html; }, close:()=>{}}}`) — с `s.project.coverDataUrl` заданным убедиться, что `capturedHtml` НЕ содержит `<h1>` до первого `<div class="pdf-img">`, а с `coverDataUrl` пустым — убедиться что `<h1>` присутствует (как раньше). Аналогично проверить `exportDocx()` (экспортирована из `export.js`, вызывается напрямую) — с обложкой результат не должен содержать `<h1>` вообще, без обложки — должен.

- [ ] **Шаг 7: Регресс — карта мира по-прежнему работает после Шага 5 Task 1**

Через `javascript_tool` вызвать `restoreImageVersion()` на фейковом элементе типа `map` с непустой историей версий, убедиться что функция по-прежнему возвращает `true` и корректно меняет местами `dataUrl`/`prompt`/`createdAt`, а новая строка `item.baseDataUrl = null` не ломает последующий вызов `applyMapLabels()` на этом же элементе (см. спеку `§Проверка` п.6 — `applyMapLabels` сам восстанавливает `baseDataUrl` из `dataUrl`, если он пуст).

- [ ] **Шаг 8: Зафиксировать результат живой проверки**

Если все шаги прошли — отметить эту задачу выполненной, переходить к Task 5. Если что-то не сошлось — исправить в соответствующем файле (Task 1/2/3), повторить проверку с этого же шага (не нужно перезапускать сервер/браузер заново, только переимпортировать модуль с новым `?v=`).

---

### Task 5: Версия, CHANGELOG, деплой

**Files:**
- Modify: `литсовет/src/state.js` (`APP_VERSION`)
- Modify: `литсовет/package.json` (`"version"`)
- Modify: `литсовет/CHANGELOG.md`

**Interfaces:** N/A (релизная задача, замыкает фичу).

- [ ] **Шаг 1: Найти текущую версию**

Run: `cd литсовет && node -e "console.log(require('fs').readFileSync('src/state.js','utf8').match(/APP_VERSION\s*=\s*'([^']+)'/)[1])"`
Expected: `1.28.0` (на момент написания плана — если к моменту исполнения уже другая, взять её и увеличить minor на 1, как везде в этом проекте).

- [ ] **Шаг 2: Бампнуть версию в `state.js` и `package.json`**

В `литсовет/src/state.js` заменить `APP_VERSION = '1.28.0'` на `APP_VERSION = '1.29.0'`.
В `литсовет/package.json` заменить `"version": "1.28.0"` на `"version": "1.29.0"`.

- [ ] **Шаг 3: Добавить запись в CHANGELOG.md**

Открыть `литсовет/CHANGELOG.md`, вставить новую секцию сразу после строки 6 (`Бампается при каждом серьёзном фиксе...`), перед `## 1.28.0 — 2026-07-25`:
```markdown
## 1.29.0 — 2026-07-25

- **Обложка получила настоящий, гарантированно читаемый текст названия
  (и автора) вместо того, что рисует сама AI-модель.** Раньше название на
  обложке рисовал сам генератор картинки текстом внутри изображения — по
  своей природе диффузионные модели дают нечитаемые артефакты на мелком/
  плотном тексте (та же проблема, что уже была решена для подписей карты
  мира через `compositeMapLabels`). Теперь обложка устроена так же: AI
  всегда рисует только фон без текста, а название/автор накладываются
  настоящим текстом через новую `compositeCoverTitle()` (canvas, нижняя
  треть обложки, подложка для контраста). Заодно чинит рассинхрон
  «обложка помнит старое название книги» окончательно — есть кнопка
  «🔤 Название» в галерее, перерисовывающая текст по актуальным данным
  книги без новой платной генерации. Проверено в браузере: генерация с
  застубленным `/api/generate-image`, короткое и длинное (с переносом
  строк) название, режим «без текста» — фон остаётся чистым.
- **PDF и .doc-экспорт перестали печатать отдельный пустой титульный лист
  перед обложкой.** Раньше `exportPdf()`/`exportDocx()` всегда выводили
  текстовый `<h1>Название</h1>` ОТДЕЛЬНО от картинки обложки — в PDF это
  давало три страницы подряд там, где должна быть одна (пустой белый лист
  с текстом → отдельный лист с обложкой → книга). `.epub` этой проблемы
  не имел изначально. Теперь при наличии обложки текстовый титул не
  выводится вообще — обложка сама открывает книгу, как в `.epub`. Без
  обложки поведение не изменилось. Проверено в браузере на состоянии с
  обложкой и без.

```

- [ ] **Шаг 4: Синтаксис-проверка изменённых файлов**

Run: `cd литсовет && node --check src/state.js`
Expected: без вывода (успех). (`package.json`/`CHANGELOG.md` не JS — синтаксис-чек не применим, достаточно визуально свериться, что JSON валиден: `node -e "require('./package.json')"`.)

- [ ] **Шаг 5: Коммит**

```bash
cd "C:\Users\user\Documents\webar-main\издательство"
git add литсовет/src/state.js литсовет/package.json литсовет/CHANGELOG.md
git commit -m "feat(1.29.0): настоящий текст на обложке (canvas) + фикс дублирующего титула в PDF/.doc"
```

- [ ] **Шаг 6: Деплой на Railway**

Run: `cd литсовет && railway up --service litsovet-v2 --detach`
Expected: деплой запущен, команда возвращает управление сразу (`--detach`).

- [ ] **Шаг 7: Дождаться и подтвердить деплой**

Опросить `GET https://litsovet-v2-production.up.railway.app/api/version` (например, через `curl` в Bash, с паузами по 10 секунд, до 6 попыток) до появления `"version":"1.29.0"` в ответе.
Expected: `{"name":"litsovet","version":"1.29.0"}` в течение ~1 минуты после деплоя.

---

## Self-Review

**Покрытие спеки:**
- §1.1 `compositeCoverTitle`/`wrapCoverText` — Task 1, Шаг 4. ✅
- §1.2 `generateIllustrationFor` + упрощённый `textInstruction` — Task 1, Шаги 1 и 3. ✅
- §1.3 `restoreImageVersion` — Task 1, Шаг 5. ✅
- §2.1/§2.2 оба вызывающих места в `ui/illustrations.js` — Task 2, Шаги 2-3. ✅
- §2.3 кнопка «🔤 Обновить название» — Task 2, Шаги 5-6. ✅
- §3.1/§3.2 `exportPdf`/`exportDocx` — Task 3. ✅
- §3.3 (`.epub`/`.md` не трогаем) — явно не создано отдельных задач под них, соответствует спеке. ✅
- Раздел «Проверка» спеки (6 пунктов) — покрыт Task 4, Шаги 3-7 один в один. ✅
- Релизный цикл (версия/CHANGELOG/деплой) — не часть спеки напрямую, но стандартная практика проекта (см. историю коммитов `feat(X.Y.Z): ...`) — добавлен как Task 5.

**Плейсхолдеры:** не найдено — весь код в шагах полный, без "TODO"/"добавить обработку".

**Согласованность типов:** `generateIllustrationFor` возвращает `{dataUrl, baseDataUrl}` — идентично используется в обоих местах Task 2 (деструктуризация `const { dataUrl, baseDataUrl } = ...`) и в описании интерфейса Task 1. `compositeCoverTitle(baseDataUrl, title, author)` — сигнатура одинакова в Task 1 (определение) и Task 2 Шаг 6 (вызов `compositeCoverTitle(it.baseDataUrl, s.project.title, s.project.author)`). `item.baseDataUrl` — единое имя поля везде (Task 1 Шаг 5, Task 2 Шаги 2/3/5).
