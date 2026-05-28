# ИИ-Издательство · Мастер-план развития

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Превратить ИИ-Издательство из инструмента для технарей в издательскую платформу для авторов — с умной Библией, стилем автора, упрощённым режимом и чистым UX.

**Architecture:** Всё состояние в `app.js` (~1380 строк, vanilla JS, no framework). Изменения — добавление функций и модификация существующих. CSS-правки — в `styles.css`. HTML-структура — в `index.html`. Сервер (`server.js`) правится только в Task 4 (добавление non-streaming режима).

**Критические оговорки для реализатора:**
- `openDrawer(title, html)` — первый аргумент title, второй html. НЕ наоборот.
- Токены считать через `tokEst(text)` — встроенная функция (не `estimateTokens`).
- `_selNode` — глобальная переменная для выбранного узла (проверить точное имя в app.js перед использованием в hotkeys).
- `state.global.autoSummarize` уже занят другой фичей — для авто-Библии использовать новое поле `state.global.autoBibleExtract`.
- `buildMessages(n)` при добавлении `await` становится async — нужно распространить `async/await` на все вызывающие функции (`runNode`, preview).
- Логика применения шаблона живёт в `openTemplates()`/onboarding — вынести в отдельную функцию `applyTemplate(key)` ПЕРЕД её использованием в Simplified mode.

**Tech Stack:** Vanilla JS (ES2020), CSS custom properties, localStorage, Node.js (server-only proxy). Никаких npm-зависимостей.

---

## Карта релизов

| Релиз | Фокус | Задачи | Приоритет |
|-------|-------|--------|-----------|
| **Р1** | UX-чистка + Авто-Библия + Стиль-ориентир | T1–T8 | 🔴 Критично |
| **Р2** | Context Distillation + Циклические рёбра + Версии вывода | T9–T14 | 🟠 Важно |
| **Р3** | Fanout-главы + PDF + Облако + Beat sheet | T15–T20 | 🟡 Желательно |
| **Р4** | i18n + Mobile + Marketplace + Character Chat | T21–T24 | 🔵 Будущее |

---

# РЕЛИЗ 1 — UX + Авто-Библия + Стиль

## Файлы (Релиз 1)

| Файл | Что меняем |
|------|-----------|
| `index.html` | Убрать 6 кнопок из `projbar`/`topbar`, добавить `#style-ref-wrap`, `#simplified-banner` |
| `styles.css` | Simplified mode CSS, style-ref badge, prompt-preview modal |
| `app.js` | 8 новых функций + правки ~15 существующих мест |

---

## Task 1: UX-чистка topbar и projbar

**Проблема:** 14 кнопок в топбаре создают cognitive overload. Новый пользователь не знает куда смотреть. Поля projbar непонятны без примеров-placeholder.

**Файлы:**
- Modify: `index.html` — projbar, topbar
- Modify: `styles.css` — `.projbar` layout

- [ ] **1.1** Открыть `index.html`, найти `<div class="projbar">`. Убрать отдельный `<select id="proj-mode">` и кнопку `<button data-action="edit-input" id="input-btn">`. Вместо них — один чекбокс:
  ```html
  <label class="proj-toggle" title="Включить если хотите улучшить готовый текст, а не писать с нуля">
    <input type="checkbox" id="proj-edit-mode"> 📄 Редактировать исходник
  </label>
  ```

- [ ] **1.2** Найти `<input id="proj-genre">` — обновить placeholder:
  ```html
  <input id="proj-genre" placeholder="Жанр: детектив, фэнтези, нон-фикшн…">
  ```

- [ ] **1.3** Найти `<input id="proj-aud">` — обновить placeholder:
  ```html
  <input id="proj-aud" placeholder="Аудитория: взрослые 25-45, подростки, бизнес…">
  ```

- [ ] **1.4** В `app.js` найти функцию `bindProj()` (или место где регистрируется `#proj-mode` как select). **УДАЛИТЬ** эту привязку, иначе `render()` будет кидать null-reference error после удаления `<select>`. Добавить обработку нового чекбокса:
  ```javascript
  // Чекбокс режима редактирования (заменяет select#proj-mode)
  const editModeCb = $('#proj-edit-mode');
  if(editModeCb){
    editModeCb.checked = state.project.mode === 'edit';
    editModeCb.onchange = () => {
      state.project.mode = editModeCb.checked ? 'edit' : 'write';
      save();
      if(editModeCb.checked) openInput(); // ← правильный вызов: openInput(), НЕ openDrawer('edit-input')
    };
  }
  ```

- [ ] **1.5** В `app.js` найти и исправить ВСЕ оставшиеся ссылки на удалённые элементы:
  - Grep `proj-mode` — убрать все `$('#proj-mode').value = ...` и `$('#proj-mode').value` в `render()` (≈ строка 278), заменить на прямое чтение/запись `state.project.mode`.
  - Grep `input-btn` — в `render()` есть строка вида `$('#input-btn').style.display = ...` (≈ строка 281). **Удалить эту строку целиком** — кнопки `#input-btn` больше нет, любое обращение к ней даст null-reference error.

- [ ] **1.6** В `styles.css` добавить стили для нового чекбокса:
  ```css
  .proj-toggle {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--txt2);
    white-space: nowrap;
    cursor: pointer;
    padding: 0 8px;
    flex-shrink: 0;
  }
  .proj-toggle input { accent-color: var(--accent); cursor: pointer; }
  ```

- [ ] **1.7** В `app.js` найти блок рендера канваса (`render()`). Убедиться что `$('#canvas-hint')` обновляется при смене режима — подсказка «Режим редактирования: вставьте исходник» когда `mode=edit`.

- [ ] **1.8** Проверить вручную: открыть приложение, переключить чекбокс — должен открыться drawer с исходником. Переключить назад — drawer не открывается.

- [ ] **1.9** Commit:
  ```
  git add index.html styles.css app.js
  git commit -m "ux: replace mode dropdown with checkbox, improve field placeholders"
  ```

---

## Task 2: Убрать кнопки из More-dropdown, переработать топбар

**Проблема:** `⤢ Схема`, `⊞ Группа`, `⭐ Оценить` — редко используются, захламляют UI.

**Файлы:**
- Modify: `index.html` — `#more-dropdown`
- Modify: `app.js` — убрать явные кнопки, оставить через контекстное меню узла

- [ ] **2.1** Открыть `index.html`. В `#more-dropdown` **удалить** строки:
  ```html
  <button class="btn ghost" data-action="auto-layout" ...>⤢ Схема</button>
  <button class="btn ghost" data-action="group"       ...>⊞ Группа</button>
  <button class="btn ghost" data-action="selfeval"    ...>⭐ Оценить</button>
  ```

- [ ] **2.2** В `app.js` найти контекстное меню узла (`openNodeContextMenu` или аналог в `openDrawer`). Добавить в меню правой кнопки мыши на узле пункт «Авто-оценить этот узел» и «Добавить в группу».
  > Если контекстного меню нет — добавить в Settings узла (drawer) кнопку «⭐ Оценить».

- [ ] **2.3** Перенести `auto-layout` в меню холста (правый клик на пустом месте холста):
  ```javascript
  // В canvas mousedown handler, добавить:
  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    showCanvasContextMenu(e.clientX, e.clientY);
  });
  function showCanvasContextMenu(x, y){
    // простое меню: [⤢ Выровнять узлы] [＋ Добавить агента]
  }
  ```

- [ ] **2.4** Проверить: кнопки убраны из dropdown, auto-layout доступен через правый клик на холсте.

- [ ] **2.5** Commit:
  ```
  git add index.html app.js
  git commit -m "ux: remove rarely used buttons from dropdown, move to context menu"
  ```

---

## Task 3: Simplified Mode («Один клик до книги»)

**Проблема:** Новые пользователи видят пустой холст и не понимают что делать. Нужен линейный режим без холста.

**Файлы:**
- Modify: `index.html` — добавить `#simplified-view`
- Modify: `styles.css` — `.simplified-*` классы
- Modify: `app.js` — `switchToSimplified()`, `switchToExpert()`

- [ ] **3.1** В `index.html` после `<div class="viewbar">` добавить новую вкладку:
  ```html
  <button class="view-tab" id="tab-simple" data-action="switch-view" data-view="simple">✨ Просто</button>
  ```

- [ ] **3.2** В `index.html` после `<div class="reader" ...>` добавить simplified view:
  ```html
  <div class="simplified" id="simplified" style="display:none">
    <div class="simplified-inner">
      <h2 class="simp-title">Расскажите о вашей книге</h2>
      <div class="simp-field">
        <label>📖 Название книги</label>
        <input id="simp-title" placeholder="Например: «Тени над городом»" />
      </div>
      <div class="simp-field">
        <label>🎭 О чём книга <span class="required">*</span></label>
        <textarea id="simp-brief" rows="4"
          placeholder="Главный герой — детектив в ретро-Питере. Расследует исчезновение художника. Конфликт — между долгом и совестью. Финал — неожиданный поворот с заказчиком."></textarea>
      </div>
      <div class="simp-row">
        <div class="simp-field">
          <label>📚 Жанр</label>
          <input id="simp-genre" placeholder="Детектив, фэнтези…" />
        </div>
        <div class="simp-field">
          <label>👥 Аудитория</label>
          <input id="simp-aud" placeholder="Взрослые 25-45" />
        </div>
      </div>
      <div class="simp-field">
        <label>🎨 Шаблон</label>
        <div class="simp-tpl-row" id="simp-tpl-row">
          <!-- заполняется JS -->
        </div>
      </div>
      <button class="btn primary lg" id="simp-run">▶ Написать книгу</button>
      <button class="btn ghost sm simp-expert" id="simp-to-expert">
        ⚙ Перейти в режим эксперта →
      </button>
    </div>
  </div>
  ```

- [ ] **3.3** В `styles.css` добавить стили:
  ```css
  .simplified {
    position: absolute;
    inset: 150px 0 0 0;
    overflow: auto;
    background: var(--bg);
    display: none;
  }
  .simplified-inner {
    max-width: 600px;
    margin: 0 auto;
    padding: 40px 24px 80px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .simp-title { font-size: 22px; font-weight: 700; color: var(--txt); margin-bottom: 4px; }
  .simp-field { display: flex; flex-direction: column; gap: 6px; }
  .simp-field label { font-size: 13px; color: var(--txt2); font-weight: 500; }
  .simp-field input, .simp-field textarea {
    background: var(--panel);
    border: 1px solid var(--line2);
    border-radius: 10px;
    padding: 10px 14px;
    color: var(--txt);
    font-size: 14px;
    font-family: inherit;
    resize: vertical;
  }
  .simp-field input:focus, .simp-field textarea:focus {
    outline: none;
    border-color: var(--accent);
  }
  .simp-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .simp-tpl-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .simp-tpl-btn {
    padding: 7px 14px;
    border-radius: 8px;
    border: 1px solid var(--line2);
    background: var(--panel);
    color: var(--txt2);
    font-size: 13px;
    cursor: pointer;
    transition: all .15s;
  }
  .simp-tpl-btn.selected, .simp-tpl-btn:hover {
    border-color: var(--accent);
    color: var(--txt);
    background: var(--panel3);
  }
  .btn.lg { padding: 14px 28px; font-size: 16px; border-radius: 12px; width: 100%; }
  .simp-expert { margin-top: -8px; align-self: center; font-size: 12px; opacity: .6; }
  .required { color: var(--danger); }
  ```

- [ ] **3.4a** **СНАЧАЛА** — вынести логику применения шаблона в отдельную функцию `applyTemplate(key)`. Найти в `app.js` где шаблоны применяются внутри `openTemplates()` или onboarding-handler. Извлечь эту логику:
  ```javascript
  function applyTemplate(key){
    const tpl = PROJECT_TPLS[key];
    if(!tpl) return;
    // Установить жанр/бриф из шаблона если не заданы пользователем
    if(tpl.genre && !state.project.genre) state.project.genre = tpl.genre;
    if(tpl.brief && !state.project.brief) state.project.brief = tpl.brief;
    // Создать узлы по шаблону (логика из openTemplates)
    const roles = tpl.roles || [];
    state.nodes = [];
    state.edges = [];
    roles.forEach((role, i) => {
      const tmpl = TEMPLATES.find(t => t.role === role);
      if(!tmpl) return;
      const n = freshNode(tmpl, 60 + (i % 3) * 250, 40 + Math.floor(i / 3) * 180);
      state.nodes.push(n);
      if(i > 0) state.edges.push({ id: uid(), from: state.nodes[i-1].id, to: n.id, condition: '' });
    });
    save();
    render();
  }
  ```
  Заменить старый inline-код в `openTemplates()` и onboarding на вызов `applyTemplate(key)`.

- [ ] **3.4b** Добавить функцию `initSimplifiedMode()`:
  ```javascript
  let _simpTpl = 'story'; // выбранный шаблон в simplified
  function initSimplifiedMode(){
    const row = $('#simp-tpl-row');
    if(!row) return;
    row.innerHTML = '';
    const tpls = [
      { key:'solo',  label:'⚡ Соло', desc:'1 агент, быстро' },
      { key:'story', label:'📖 Рассказ', desc:'3 агента' },
      { key:'novel', label:'✍️ Роман', desc:'полный цикл' },
    ];
    tpls.forEach(t => {
      const btn = document.createElement('button');
      btn.className = 'simp-tpl-btn' + (t.key === _simpTpl ? ' selected' : '');
      btn.textContent = t.label;
      btn.title = t.desc;
      btn.onclick = () => {
        _simpTpl = t.key;
        row.querySelectorAll('.simp-tpl-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      };
      row.appendChild(btn);
    });
    const st = $('#simp-title'), sb = $('#simp-brief'), sg = $('#simp-genre'), sa = $('#simp-aud');
    if(st) st.value = state.project.title || '';
    if(sb) sb.value = state.project.brief || '';
    if(sg) sg.value = state.project.genre || '';
    if(sa) sa.value = state.project.audience || '';
    const runBtn = $('#simp-run');
    if(runBtn) runBtn.onclick = () => {
      const brief = $('#simp-brief')?.value.trim();
      if(!brief){ toast('Опишите книгу — хотя бы в двух словах','warn'); return; }
      state.project.title     = $('#simp-title')?.value.trim() || state.project.title;
      state.project.brief     = brief;
      state.project.genre     = $('#simp-genre')?.value.trim() || '';
      state.project.audience  = $('#simp-aud')?.value.trim()   || '';
      save();
      applyTemplate(_simpTpl);  // ← работает т.к. определена в шаге 3.4a
      switchView('canvas');
      runPipeline();
    };
    const expertBtn = $('#simp-to-expert');
    if(expertBtn) expertBtn.onclick = () => switchView('canvas');
  }
  ```

- [ ] **3.5** В `switchView()` добавить обработку `'simple'`:
  ```javascript
  function switchView(view){
    _currentView = view;
    // canvas
    $('#canvas').style.display  = view === 'canvas' ? '' : 'none';
    // reader
    $('#reader').style.display  = view === 'reader' ? '' : 'none';
    // simplified
    const simp = $('#simplified');
    if(simp) simp.style.display = view === 'simple' ? '' : 'none';
    // Активная таб
    ['canvas','reader','simple'].forEach(v => {
      const tab = $(`#tab-${v === 'simple' ? 'simple' : v}`);
      if(tab) tab.classList.toggle('active', v === view);
    });
    if(view === 'reader') renderReader();
    if(view === 'simple') initSimplifiedMode();
    save();
  }
  ```

- [ ] **3.6** В `showOnboardingIfNeeded()` — если пользователь первый раз и нет API-ключа, открывать onboarding. После завершения onboarding — переключать на `simple` view:
  ```javascript
  // В конце showOnboarding() → при закрытии overlay:
  switchView('simple');
  ```

- [ ] **3.7** Проверить: вкладка «✨ Просто» видна. При открытии показывается форма. Кнопка «Написать книгу» без брифа показывает тост. С брифом — применяет шаблон, переключает на холст, запускает пайплайн.

- [ ] **3.8** Commit:
  ```
  git add index.html styles.css app.js
  git commit -m "feat: simplified mode - one-click book creation without canvas"
  ```

---

## Task 4: Авто-обновление Библии после агентов

**Проблема:** Агент написал главу → появились новые персонажи, места, события — но Библия не обновляется. Пользователь должен вручную выписывать всё. Это огромная потеря времени.

**Файлы:**
- Modify: `app.js` — новая функция `autoBibleUpdate()`, вызов после `runNode()`

- [ ] **4.1** Добавить функцию `autoBibleUpdate(nodeOutput, nodeRole)` после `bibleFor()`:
  ```javascript
  async function autoBibleUpdate(output, role){
    // Только для writer и logedit — там появляются реальные нарративные сущности
    if(!['writer','logedit','line'].includes(role)) return;
    if(!output || output.length < 200) return;
    if(!state.global.autoBibleExtract) return; // ← флаг autoBibleExtract (НЕ autoSummarize — тот занят другой фичей)
    // Строим запрос к модели — просим извлечь новые факты
    const msgs = [{
      role: 'system',
      content: 'Ты — архивариус. Извлеки из текста НОВЫЕ факты о персонажах, местах, временной линии и ключевых событиях. Отвечай строго в формате:\nИмя персонажа | факт о нём\nНазвание места | описание\nСобытие | дата или позиция в сюжете\n\nТолько факты, присутствующие в тексте. Не придумывай. Если новых фактов нет — ответь: ПУСТО'
    },{
      role: 'user',
      content: `Уже известно из Библии:\n${state.bible.map(b=>b.keys+'|'+b.text).join('\n') || '(пусто)'}\n\nНовый текст:\n${smartTrunc(output, 3000)}`
    }];
    try {
      const c = { baseURL: state.global.baseURL, apiKey: pickKey(), model: state.global.model, temperature: 0.1 };
      const resp = await callLLM(c, msgs);
      if(!resp || resp.trim() === 'ПУСТО') return;
      const newEntries = parseBibleLines(resp);
      if(!newEntries.length) return;
      // Добавляем только те, которых ещё нет (по keys)
      const existingKeys = new Set(state.bible.map(b => b.keys.toLowerCase()));
      const toAdd = newEntries.filter(e => !existingKeys.has(e.keys.toLowerCase()));
      if(!toAdd.length) return;
      state.bible.push(...toAdd);
      rebuildBibleVecs();
      save();
      toast(`📚 Библия: +${toAdd.length} новых записей`, 'ok');
    } catch(e){
      console.warn('autoBibleUpdate error', e);
    }
  }
  ```

- [ ] **4.2** В функции `runNode()` — найти место после успешного завершения агента (после `node.status = 'done'`). Добавить вызов:
  ```javascript
  // Авто-обновление Библии (неблокирующее)
  autoBibleUpdate(node.output, /* role */ TEMPLATES.find(t=>t.name===node.name)?.role || '');
  ```

- [ ] **4.3** В `server.js` найти обработчик `/api/generate`. Текущий код всегда передаёт `stream:true` в upstream и стримит chunks обратно. Добавить ветку для `stream:false`:
  ```javascript
  // В обработчике POST /api/generate, после парсинга body:
  const wantStream = body.stream !== false; // false → аккумулируем, true → стримим (default)
  
  // В upstream request body:
  upstreamBody.stream = wantStream;
  
  // После получения upstream response:
  if(!wantStream){
    // Накопить весь ответ и вернуть единым телом
    const chunks = [];
    for await (const chunk of upstreamRes.body) chunks.push(chunk);
    const full = Buffer.concat(chunks).toString('utf-8');
    // При stream:false upstream возвращает обычный JSON (НЕ SSE).
    // Формат: { choices: [{ message: { content: "..." } }] }
    let content = '';
    try {
      const parsed = JSON.parse(full);
      content = parsed.choices?.[0]?.message?.content || '';
    } catch(e) {
      // Fallback: нестандартный upstream вернул SSE-чанки — распарсить
      content = full.split('\n')
        .filter(l => l.startsWith('data: ') && l !== 'data: [DONE]')
        .map(l => { try { return JSON.parse(l.slice(6)).choices?.[0]?.delta?.content || ''; } catch{ return ''; } })
        .join('');
    }
    res.setHeader('Content-Type', 'text/plain');
    res.end(content);
    return;
  }
  // Иначе — старая логика стриминга
  ```

- [ ] **4.4** Добавить `callLLM()` в `app.js` — использует `stream:false` через обновлённый server.js:
  ```javascript
  async function callLLM(c, messages){
    const r = await fetch('/api/generate', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        baseURL: c.baseURL, apiKey: c.apiKey,
        model: c.model, temperature: c.temperature ?? 0.1,
        messages, stream: false
      })
    });
    if(!r.ok) throw new Error(await r.text());
    return await r.text();
  }
  ```
  > Тест вручную: `curl -X POST http://localhost:8787/api/generate -H 'Content-Type: application/json' -d '{"stream":false,"messages":[...],...}'` — должен вернуть полный текст одним ответом, не чанками.

- [ ] **4.5** В `defaultState()` добавить новое поле `autoBibleExtract: false` в `global` (НЕ использовать `autoSummarize` — он уже занят другой фичей). В Settings drawer добавить тогл:
  ```javascript
  // В defaultState():
  global: { ..., autoSummarize: false, autoBibleExtract: false, ... }
  
  // В renderSettingsDrawer():
  row('Авто-Библия', `<label class="toggle">
    <input type="checkbox" id="set-auto-bible" ${state.global.autoBibleExtract?'checked':''}/>
    <span>Извлекать персонажей и факты после каждой главы</span>
  </label>`);
  $('#set-auto-bible')?.addEventListener('change', e => {
    state.global.autoBibleExtract = e.target.checked;
    save();
  });
  ```
  В `autoBibleUpdate()` изменить проверку флага: `if(!state.global.autoBibleExtract) return;`

- [ ] **4.6** Проверить: запустить пайплайн с writer-агентом. После завершения — в Библии должны появиться новые записи (если `autoSummarize=true`).

- [ ] **4.7** Commit:
  ```
  git add app.js server.js
  git commit -m "feat: auto-bible update - extract characters/places after each writer agent"
  ```

---

## Task 5: Стиль-ориентир (авторский голос)

**Проблема:** Агент пишет своим голосом, убивая авторский стиль. Нужна возможность загрузить 300-500 слов своего текста — и агенты будут адаптировать к этому голосу.

**Файлы:**
- Modify: `index.html` — добавить поле в projbar или Settings
- Modify: `app.js` — `buildMessages()`, Settings drawer
- Modify: `styles.css` — badge «стиль задан»

- [ ] **5.1** В `defaultState()` добавить поле `styleRef` в project:
  ```javascript
  project: { title:'', genre:'', audience:'', brief:'', mode:'write',
    input:'', disclosure:'...', styleRef:'' },  // ← добавить styleRef
  ```

- [ ] **5.2** В Settings drawer добавить секцию «Стиль автора»:
  ```javascript
  // В renderSettingsDrawer() → добавить раздел:
  html += `<div class="set-section">
    <div class="set-section-title">✍️ Стиль автора</div>
    <p class="set-hint">Вставьте 300–500 слов своего текста — агенты будут писать в этом стиле</p>
    <textarea id="set-style-ref" rows="6" placeholder="Вставьте фрагмент своего текста…"
      style="width:100%;background:var(--panel);border:1px solid var(--line2);
      border-radius:8px;padding:10px;color:var(--txt);font-family:inherit;font-size:13px;resize:vertical"
    >${esc(state.project.styleRef||'')}</textarea>
    <div id="style-ref-status" style="font-size:12px;color:var(--txt2);margin-top:4px">
      ${state.project.styleRef ? '✅ Стиль-ориентир задан (' + state.project.styleRef.split(/\s+/).length + ' слов)' : ''}
    </div>
    <div style="display:flex;gap:8px;margin-top:6px">
      <button class="btn ghost sm" id="set-style-save">💾 Сохранить стиль</button>
      <button class="btn ghost sm" id="set-style-clear">🗑 Очистить</button>
    </div>
  </div>`;
  // После инжекта HTML:
  $('#set-style-save')?.addEventListener('click', () => {
    state.project.styleRef = $('#set-style-ref')?.value.trim() || '';
    save();
    toast('Стиль-ориентир сохранён', 'ok');
    updateStyleRefBadge();
  });
  $('#set-style-clear')?.addEventListener('click', () => {
    state.project.styleRef = '';
    if($('#set-style-ref')) $('#set-style-ref').value = '';
    save();
    toast('Стиль-ориентир очищен');
    updateStyleRefBadge();
  });
  ```

- [ ] **5.3** Добавить функцию `updateStyleRefBadge()` и badge в topbar:
  ```javascript
  function updateStyleRefBadge(){
    const badge = $('#style-ref-badge');
    if(badge) badge.style.display = state.project.styleRef ? '' : 'none';
  }
  ```
  В `index.html` в топбаре после `#proj-title`:
  ```html
  <span id="style-ref-badge" class="hint-pill" title="Стиль-ориентир задан — агенты пишут в вашем голосе"
    style="display:none;color:var(--ok)">✍️ стиль</span>
  ```

- [ ] **5.4** В `buildMessages()` добавить стиль в system prompt:
  ```javascript
  // В начале buildMessages(n), после const pr = state.project:
  const styleBlock = pr.styleRef
    ? `\n\nСТИЛЬ АВТОРА (имитируй этот голос — ритм, лексику, длину предложений):\n"""\n${smartTrunc(pr.styleRef, 600)}\n"""`
    : '';
  // Добавить styleBlock в system сообщение:
  // messages[0].content += styleBlock;
  ```

- [ ] **5.5** Проверить: задать стиль-ориентир → запустить writer-агента → убедиться что в лог/промпте появился блок стиля. Badge виден в топбаре.

- [ ] **5.6** Commit:
  ```
  git add index.html styles.css app.js
  git commit -m "feat: style reference - author voice preserved across all agents"
  ```

---

## Task 6: Preview промпта перед запуском

**Проблема:** Пользователь не знает, что именно уйдёт в LLM. Нельзя проверить промпт перед запуском дорогого агента.

**Файлы:**
- Modify: `app.js` — `openNodeDrawer()`, новая функция `showPromptPreview()`
- Modify: `styles.css` — `.prompt-preview-modal`

- [ ] **6.1** Добавить кнопку «👁 Предпросмотр» в drawer агента (рядом с кнопкой «Запустить»):
  ```javascript
  // В renderNodeDrawer(n) — найти кнопку run/запустить, перед ней добавить:
  html += `<button class="btn ghost sm" data-action="preview-prompt" data-id="${n.id}">
    👁 Предпросмотр промпта
  </button>`;
  ```

- [ ] **6.2** Добавить обработчик `preview-prompt` в главный `handleAction()`:
  ```javascript
  case 'preview-prompt': {
    const n = node(target.dataset.id);
    if(n) showPromptPreview(n);
    break;
  }
  ```

- [ ] **6.3** Реализовать `showPromptPreview(n)`. Обратить внимание на два нюанса: (1) `buildMessages` может стать `async` в Task 9 — здесь пока sync-версия; (2) токены считать через `tokEst(text)` (встроенная функция app.js), а НЕ `estimateTokens`; (3) `openDrawer(title, html)` — порядок аргументов: сначала title, потом html:
  ```javascript
  function showPromptPreview(n){
    const msgs = buildMessages(n); // sync — не вызывать callLLM внутри
    let html = '';
    msgs.forEach(m => {
      const roleLabel = m.role === 'system' ? '⚙ System' : m.role === 'user' ? '👤 User' : '🤖 Assistant';
      html += `<div class="pp-msg">
        <div class="pp-role">${roleLabel}</div>
        <pre class="pp-content">${esc(m.content)}</pre>
      </div>`;
    });
    const fullText = msgs.map(m => m.content).join(' ');
    const toks = tokEst(fullText); // ← tokEst, НЕ estimateTokens
    const cost = (toks / 1e6 * (PRICES[cfg(n).model]?.in || 0.15)).toFixed(4);
    html += `<div class="pp-stats">~${toks} токенов · ~$${cost}</div>`;
    // openDrawer(title, html) — первый аргумент TITLE, второй HTML
    openDrawer('Предпросмотр промпта: ' + esc(n.name), html);
  }
  ```

- [ ] **6.4** В `styles.css` добавить стили:
  ```css
  .pp-msg { margin-bottom: 16px; }
  .pp-role { font-size: 11px; font-weight: 700; text-transform: uppercase;
    color: var(--accent); letter-spacing: .05em; margin-bottom: 4px; }
  .pp-content {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 12.5px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--txt2);
    max-height: 300px;
    overflow: auto;
  }
  .pp-stats { font-size: 12px; color: var(--txt2); text-align: right;
    padding-top: 8px; border-top: 1px solid var(--line); }
  ```

- [ ] **6.5** Проверить: открыть drawer агента → нажать «Предпросмотр» → увидеть полный промпт с подстановками и оценкой токенов.

- [ ] **6.6** Commit:
  ```
  git add app.js styles.css
  git commit -m "feat: prompt preview - show full prompt with substitutions before running"
  ```

---

## Task 7: Версии вывода (Output Versions)

**Проблема:** Агент выдал плохой результат — нет возможности попробовать снова и сравнить с первым вариантом.

**Файлы:**
- Modify: `app.js` — `runNode()`, `renderNodeCard()`, новые функции

- [ ] **7.1** В `freshNode()` добавить поле `outputVersions`:
  ```javascript
  function freshNode(t,x,y){ return { ..., output:'', outputVersions:[], ... }; }
  ```

- [ ] **7.2** В `runNode()` после успешного завершения — сохранять версию:
  ```javascript
  // После node.status = 'done':
  if(node.output){
    if(!node.outputVersions) node.outputVersions = [];
    node.outputVersions.unshift({
      ts: Date.now(),
      output: node.output,
      tokensIn: node.tokensIn,
      tokensOut: node.tokensOut,
    });
    // Хранить не более 5 версий
    if(node.outputVersions.length > 5) node.outputVersions = node.outputVersions.slice(0,5);
  }
  ```

- [ ] **7.3** В drawer агента добавить секцию «Предыдущие версии» (если `outputVersions.length > 0`):
  ```javascript
  // В renderNodeDrawer(n):
  if(n.outputVersions && n.outputVersions.length > 1){
    html += `<div class="set-section">
      <div class="set-section-title">🕐 Версии вывода (${n.outputVersions.length})</div>`;
    n.outputVersions.forEach((v, i) => {
      const d = new Date(v.ts);
      const label = i === 0 ? '(текущая)' : `от ${d.toLocaleTimeString('ru')}`;
      html += `<div class="ver-row">
        <span class="ver-label">Версия ${n.outputVersions.length - i} ${label}</span>
        <span class="ver-meta">${Math.round((v.output||'').split(/\s+/).length)} сл.</span>
        ${i > 0 ? `<button class="btn ghost xs" data-action="restore-version" data-node="${n.id}" data-ver="${i}">↩ Восстановить</button>` : ''}
      </div>`;
    });
    html += `</div>`;
  }
  ```

- [ ] **7.4** Добавить обработчик `restore-version`:
  ```javascript
  case 'restore-version': {
    const n = node(target.dataset.node);
    const i = parseInt(target.dataset.ver);
    if(n && n.outputVersions?.[i]){
      n.output = n.outputVersions[i].output;
      save(); render();
      toast('Версия восстановлена');
    }
    break;
  }
  ```

- [ ] **7.5** Commit:
  ```
  git add app.js
  git commit -m "feat: output versions - keep last 5 runs per node, restore any version"
  ```

---

## Task 8: Горячие клавиши + Undo/Redo для Canvas

**Проблема:** Всё управление через мышь. Случайно сдвинул узел — нет отката.

**Файлы:**
- Modify: `app.js` — hotkeys map, undo stack

- [ ] **8.1** Добавить undo-стек в начало `app.js`:
  ```javascript
  const _undoStack = [];
  const _redoStack = [];
  const MAX_UNDO = 20;
  function pushUndo(){
    _undoStack.push(JSON.stringify({ nodes: state.nodes.map(n=>({id:n.id,x:n.x,y:n.y})) }));
    _redoStack.length = 0;
    if(_undoStack.length > MAX_UNDO) _undoStack.shift();
  }
  function undoCanvas(){
    if(!_undoStack.length) return;
    _redoStack.push(JSON.stringify({ nodes: state.nodes.map(n=>({id:n.id,x:n.x,y:n.y})) }));
    const snap = JSON.parse(_undoStack.pop());
    snap.nodes.forEach(s => { const n = node(s.id); if(n){ n.x=s.x; n.y=s.y; } });
    save(); render();
  }
  function redoCanvas(){
    if(!_redoStack.length) return;
    _undoStack.push(JSON.stringify({ nodes: state.nodes.map(n=>({id:n.id,x:n.x,y:n.y})) }));
    const snap = JSON.parse(_redoStack.pop());
    snap.nodes.forEach(s => { const n = node(s.id); if(n){ n.x=s.x; n.y=s.y; } });
    save(); render();
  }
  ```

- [ ] **8.2** В drag handler узла — вызывать `pushUndo()` при начале перетаскивания:
  ```javascript
  // В mousedown на узле, перед началом drag:
  pushUndo();
  ```

- [ ] **8.3** Добавить глобальный keydown listener с hotkeys:
  ```javascript
  document.addEventListener('keydown', e => {
    // Игнорировать если фокус в input/textarea
    if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if(ctrl && e.key === 'z'){ e.preventDefault(); undoCanvas(); return; }
    if(ctrl && e.key === 'y'){ e.preventDefault(); redoCanvas(); return; }
    if(ctrl && e.key === 'Enter'){ e.preventDefault(); runPipeline(); return; }
    if(e.key === 'Escape'){ closeDrawer(); return; }
    // R — открыть reader
    if(e.key === 'r' && !ctrl){ switchView(_currentView === 'reader' ? 'canvas' : 'reader'); return; }
    // Delete/Backspace — удалить выбранный узел
    // ⚠ Перед написанием: найти в app.js точное имя переменной выбранного узла
    // (может быть _selNode, selectedNodeId, _sel и т.д.) — grep 'selected' по app.js
    if((e.key === 'Delete' || e.key === 'Backspace') && typeof _selNode !== 'undefined' && _selNode){
      e.preventDefault();
      deleteNode(_selNode);
      _selNode = null;
      return;
    }
  });
  ```

- [ ] **8.4** Добавить отображение hotkeys в Гайде — найти `openDrawer('guide')` и добавить таблицу:
  ```
  Ctrl+Enter   — Запустить пайплайн
  Ctrl+Z       — Отменить перемещение узла
  Ctrl+Y       — Повторить
  R            — Переключить Reader / Canvas
  Escape       — Закрыть панель
  Delete       — Удалить выбранный узел
  ```

- [ ] **8.5** Commit:
  ```
  git add app.js
  git commit -m "feat: canvas undo/redo + keyboard shortcuts (Ctrl+Z, Ctrl+Enter, R, Esc)"
  ```

---

# РЕЛИЗ 2 — Distillation + Cyclic edges + Fanout

## Task 9: Context Distillation Agent

**Проблема:** При длинных романах агент получает 50k+ токенов от предыдущих — дорого и модель «теряется».

**Файлы:**
- Modify: `app.js` — `buildMessages()`, новый TEMPLATE `distill`
- Modify: `index.html` — добавить `distill` в TEMPLATES

- [ ] **9.1** Добавить `distill` в `TEMPLATES`:
  ```javascript
  { role:'distill', name:'Дистиллятор', title:'Context compressor', emoji:'🗜️',
    prompt:'Сожми предыдущий текст до 200-300 слов: главные события, ключевые факты о персонажах, открытые сюжетные линии. Формат: маркированный список. Это резюме будет передано следующим агентам.' }
  ```

- [ ] **9.2** В `buildMessages()` — если общий контекст предшественников > `maxContextChars * 0.7`, автоматически вставлять distill-шаг (не создавая узел, а вызывая `callLLM` inline):
  ```javascript
  // Если prior.length > budget * 0.7 и есть API-ключ:
  if(prior.length > budget * 0.7 && hasKey()){
    try {
      const distilled = await callLLM(cfg(n), [{
        role:'system', content:'Сожми до 250 слов. Только факты. Маркированный список.'
      },{
        role:'user', content: prior
      }]);
      prior = '📌 Резюме предыдущих агентов:\n' + distilled;
    } catch(e){ /* fallback to smartTrunc */ }
  }
  ```

- [ ] **9.3** Добавить флаг в Settings: «Авто-сжатие контекста»:
  ```javascript
  row('Авто-сжатие', `<label class="toggle">
    <input type="checkbox" id="set-auto-distill" ${state.global.autoDistill?'checked':''}/>
    <span>Сжимать длинный контекст перед передачей агентам</span>
  </label>`);
  ```

- [ ] **9.4** Commit:
  ```
  git add app.js
  git commit -m "feat: context distillation - auto-compress long context before passing to agents"
  ```

---

## Task 10: Циклические рёбра (Retry loops)

**Проблема:** Нет автоматического возврата к предыдущему агенту если качество не устраивает.

**Файлы:**
- Modify: `app.js` — `runnableNodes()`, `evalCondition()`, edge data model
- Modify: `styles.css` — cyclic edge visual

- [ ] **10.1** В data model ребра добавить поля `maxRetries` и `_retryCount`:
  ```javascript
  // При создании ребра: { id, from, to, condition:'', maxRetries:0, _retryCount:0 }
  // В defaultState() — уже будет через Object.assign
  ```

- [ ] **10.2** В drawer ребра добавить поле `maxRetries`:
  ```javascript
  // В renderEdgeDrawer(e):
  row('Макс. повторов', `<input type="number" min="0" max="5" value="${e.maxRetries||0}"
    id="edge-retries" style="width:60px">`);
  $('#edge-retries')?.addEventListener('change', ev => {
    e.maxRetries = parseInt(ev.target.value) || 0;
    save();
  });
  ```

- [ ] **10.3** В `runnableNodes()` — обработка cyclic edge (ребро, у которого `from` узел уже `done`, но condition вернула `false` и `maxRetries > 0`):
  ```javascript
  // Если edge.condition failed AND edge.maxRetries > 0 AND _retryCount < maxRetries:
  // → установить from-node в status='idle', сбросить output, инкрементировать _retryCount
  ```

- [ ] **10.4** Отрисовать cyclic edges иначе — стрелка-петля на узле:
  ```javascript
  // В renderEdges(): если edge.from === edge.to или если to-node стоит выше from-node по Y:
  // рисовать дугу с угловым отступом вместо прямой линии
  ```

- [ ] **10.5** Commit:
  ```
  git add app.js styles.css
  git commit -m "feat: cyclic edges with retry count for quality loops"
  ```

---

## Task 11: Несколько вариантов вывода (Multi-variant)

**Проблема:** Агент выдаёт один вариант. Хочется выбрать из 3-5.

- [ ] **11.1** Добавить поле `variants` в настройках узла (1-5, default 1).
- [ ] **11.2** Если `variants > 1` — запустить `variants` параллельных вызовов через `Promise.all`.
- [ ] **11.3** В drawer узла показать карточки вариантов с кнопками «Выбрать».
- [ ] **11.4** `node.output` = выбранный вариант.
- [ ] **11.5** Commit: `feat: multi-variant output - generate N alternatives and pick best`

---

## Task 12: Fanout — параллельные главы

**Проблема:** Для романа из 20 глав нужно запускать 20 writer-агентов параллельно, но нельзя создавать их динамически.

- [ ] **12.1** Добавить тип узла `fanout` — принимает JSON-список от предыдущего агента (`["Глава 1: ...", "Глава 2: ..."]`), динамически создаёт дочерние узлы.
- [ ] **12.2** Fanout-узел в интерфейсе имеет поле «Количество ответвлений» (авто/1-20).
- [ ] **12.3** После завершения всех дочерних узлов — fanout-join собирает их выводы в порядке.
- [ ] **12.4** Добавить шаблон «🗂 Роман по главам» в PROJECT_TPLS: Scout → Dev → Fanout(Writer×N) → Litred → Proof.
- [ ] **12.5** Commit: `feat: fanout pattern - one node spawns N parallel chapter writers`

---

# РЕЛИЗ 3 — PDF + Облако + Beat Sheet

## Task 13: Стильный PDF-экспорт

- [ ] **13.1** Реализовать `exportPDF()` через `window.print()` с кастомным `@media print` CSS.
- [ ] **13.2** Добавить `@media print` стили: белый фон, чёрный текст, красивые шрифты, поля, колонтитулы.
- [ ] **13.3** Кнопку «📄 PDF» добавить в completion banner и drawer экспорта.
- [ ] **13.4** Commit: `feat: PDF export via print stylesheet`

## Task 14: Экспорт в FB2

- [ ] **14.1** Реализовать `exportFb2()` — генерация валидного FB2 XML.
- [ ] **14.2** FB2 структура: `<FictionBook>` → `<description>` (title-info, publish-info) → `<body>` (sections per agent output).
- [ ] **14.3** Кнопку «📕 FB2» добавить в drawer экспорта.
- [ ] **14.4** Commit: `feat: FB2 export for Russian reading apps`

## Task 15: Облачный бэкап (Google Drive)

- [ ] **15.1** Добавить кнопку «☁ Бэкап» в Settings.
- [ ] **15.2** При клике — открыть Google OAuth через popup (scope: `drive.file`).
- [ ] **15.3** После авторизации — сохранять JSON-экспорт проекта в специальную папку `ИИ-Издательство/` на Drive.
- [ ] **15.4** Показывать дату последнего бэкапа в Settings.
- [ ] **15.5** Commit: `feat: Google Drive backup for project state`

## Task 16: Beat Sheet шаблон

- [ ] **16.1** Добавить в TEMPLATES агента `beatsheet` (роль 'dev') со специальным промптом по структуре Save The Cat.
- [ ] **16.2** Добавить шаблон пайплайна «🎬 Save The Cat» в PROJECT_TPLS.
- [ ] **16.3** Commit: `feat: beat sheet agent with Save the Cat story structure`

## Task 17: Ban list (стоп-слова)

- [ ] **17.1** В Settings добавить textarea «Запрещённые слова и штампы» (по одному на строку).
- [ ] **17.2** Список сохранять в `state.global.banList`.
- [ ] **17.3** В `buildMessages()` добавлять в system prompt: `НЕЛЬЗЯ использовать слова: ${banList.join(', ')}`.
- [ ] **17.4** Commit: `feat: ban list - forbid cliches and overused phrases globally`

---

# РЕЛИЗ 4 — i18n + Mobile

## Task 18: i18n-архитектура

- [ ] **18.1** Создать `locales/ru.js` и `locales/en.js` — вынести все строки UI.
- [ ] **18.2** Заменить все хардкоды строк в app.js на `t('key')` вызовы.
- [ ] **18.3** Добавить переключатель языка в Settings.
- [ ] **18.4** Commit: `feat: i18n architecture - ru/en locale support`

## Task 19: Mobile-responsive Reader

- [ ] **19.1** В `styles.css` добавить `@media (max-width: 768px)` — скрывать Canvas, показывать только Reader и Simplified.
- [ ] **19.2** Topbar на мобайле — только «▶ Запустить» + «📖 Книга» + «⚙».
- [ ] **19.3** Commit: `feat: mobile-responsive reader view`

## Task 20: Template Marketplace (базовый)

- [ ] **20.1** Добавить возможность экспортировать текущую схему агентов как шаблон (JSON без выводов).
- [ ] **20.2** Добавить библиотеку встроенных расширенных шаблонов (детектив, фэнтези, нон-фикшн).
- [ ] **20.3** Будущее: GitHub Gist-интеграция для публикации шаблонов сообществу.
- [ ] **20.4** Commit: `feat: template export/import for sharing pipelines`

---

# Итоговый трекер прогресса

| Задача | Фича | Статус |
|--------|------|--------|
| T1 | UX-чистка projbar | ☐ |
| T2 | Уборка кнопок topbar | ☐ |
| T3 | Simplified Mode | ☐ |
| T4 | Авто-Библия | ☐ |
| T5 | Стиль-ориентир | ☐ |
| T6 | Preview промпта | ☐ |
| T7 | Версии вывода | ☐ |
| T8 | Hotkeys + Undo/Redo | ☐ |
| T9 | Context Distillation | ☐ |
| T10 | Cyclic edges | ☐ |
| T11 | Multi-variant output | ☐ |
| T12 | Fanout (главы) | ☐ |
| T13 | PDF export | ☐ |
| T14 | FB2 export | ☐ |
| T15 | Cloud backup | ☐ |
| T16 | Beat sheet | ☐ |
| T17 | Ban list | ☐ |
| T18 | i18n | ☐ |
| T19 | Mobile | ☐ |
| T20 | Template marketplace | ☐ |

---

*Сгенерировано: 2026-05-28 · Проект: ИИ-Издательство · Версия плана: 1.0*
