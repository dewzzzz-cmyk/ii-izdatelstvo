// Стадия «Иллюстрации»: арт-директор (текстовый LLM) предлагает кандидатов,
// автор сам решает, сколько и что реально заказать у платного провайдера картинок.
// Деньги тратятся ТОЛЬКО по явному клику «Сгенерировать выбранные».

import { getState, save } from '../state.js';
import { suggestIllustrations, generateIllustrationFor, chapterTitleForScene, suggestOneIllustration, saveUploadedItem } from '../illustrations.js';
import { doneScenesOrdered } from '../bookreview.js';
import { estimateImageCost } from '../imagegen.js';
import { esc } from './stages.js';
import { announce } from './a11y.js';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8МБ — щедро для JPEG/PNG, но не даёт раздуть IndexedDB одним файлом

let _candidates = [];   // предложенные арт-директором, ещё не сгенерированные
let _selected = new Set(); // id выбранных чекбоксом кандидатов
let _errors = new Map(); // id кандидата → текст последней ошибки генерации (не удалось — не теряем кандидата)
let _suggestError = ''; // ошибка арт-директора — инлайн вместо блокирующего alert()
let _manualChecked = new Set(); // 'cover' | id главы — отмеченные в ручном режиме цели
let _rerollErrors = new Map(); // id элемента галереи → ошибка «другой промпт»/«перегенерировать картинку»
let _uploadError = '';
let _busy = false;
let _busyText = '';

// Главы, для которых вообще есть что иллюстрировать (хотя бы одна написанная сцена).
function chaptersWithProse(s){
  const chapters = (s.structure||[]).filter(n=>n.type==='chapter');
  const scenes = (s.structure||[]).filter(n=>n.type==='scene');
  return chapters.filter(ch=>scenes.some(sc=>sc.chapterId===ch.id && sc.status==='done' && sc.text));
}

export function renderIllustrations(els){
  const s = getState();
  const items = s.illustrations?.items || [];

  els.left.innerHTML = `<div class="ph">Готово</div>
    ${items.length ? `<div class="pad muted" style="font-size:12px">${items.length} иллюстраци${items.length===1?'я':items.length<5?'и':'й'}${s.project.coverDataUrl?' · обложка задана':''}</div>`
      : '<div class="empty-state">Пока нет сгенерированных картинок.</div>'}`;

  const ic = s.illustrations || {};
  const mode = ic.mode==='manual' ? 'manual' : 'auto';
  els.right.innerHTML = `<div class="ph">Настройки</div><div class="pad">
    ${ic.apiKey
      ? `<div class="muted" style="font-size:12px">Провайдер: ${esc(ic.provider==='openai'?'OpenAI':ic.provider==='qwen'?'Qwen / DashScope':'Gemini (Nano Banana)')} · качество: ${esc(ic.quality==='hd'?'HD':'стандарт')}</div>`
      : `<div class="muted" style="font-size:12px">⚠ Ключ для картинок не задан — откройте ⚙ настройки.</div>`}
    <div class="muted" style="font-size:12px;margin-top:8px">Визуальный голос: ${s.style?.visualVoiceOn ? 'включён' : 'выключен'} <span class="hint">(настраивается в Концепции)</span></div>
    <div class="settings-section" style="margin-top:14px">Режим подбора</div>
    <div class="row" style="gap:6px">
      <button class="btn ${mode==='auto'?'btn-primary':''}" id="illModeAuto" style="flex:1">🎲 Авто</button>
      <button class="btn ${mode==='manual'?'btn-primary':''}" id="illModeManual" style="flex:1">☑ Ручной</button>
    </div>
    <div class="muted" style="font-size:11px;margin-top:4px">${mode==='auto'?'Арт-директор сам подбирает кандидатов на всю книгу.':'Вы сами отмечаете, что иллюстрировать — обложку и/или конкретные главы.'}</div>
    <div class="settings-section" style="margin-top:14px">Текст на картинке</div>
    <label class="row" style="gap:6px;align-items:center;font-size:12px;margin-top:4px"><input type="checkbox" id="illRuText" ${ic.ruText?'checked':''} ${ic.noText?'disabled':''}> Надписи (обложка, карта) — на русском</label>
    <label class="row" style="gap:6px;align-items:center;font-size:12px;margin-top:6px"><input type="checkbox" id="illNoText" ${ic.noText?'checked':''}> Совсем без текста на картинке</label>
    <label class="row" style="gap:6px;align-items:center;font-size:12px;margin-top:6px" data-tip="Часть провайдеров (Gemini/Recraft) не поддерживает точный размер и рисует по промпту — портретность не гарантирована на 100%, но промпт всегда просит вертикальную ориентацию."><input type="checkbox" id="illPortrait" ${ic.portraitCover?'checked':''}> Портретная обложка (под требования площадок)</label>
  </div>`;

  els.center.className = 'panel panel-center';
  const actionBar = mode==='manual' ? `
    <div class="read-bar">
      <span class="read-title">Иллюстрации</span>
      <span style="flex:1"></span>
      <button class="btn btn-primary" id="illSuggestManual" ${_manualChecked.size?'':'disabled'} data-tip="Для каждой отмеченной цели арт-директор предложит один промпт (текстовый вызов, бесплатно) — картинка генерируется отдельным шагом ниже.">
        ${_busy?'<span class="spinner"></span> '+esc(_busyText):`🎨 Предложить промпты (${_manualChecked.size})`}
      </button>
    </div>
    <div class="pad" style="display:flex;flex-direction:column;gap:4px">
      <label class="row" style="gap:6px;align-items:center;font-size:13px"><input type="checkbox" class="ill-manual-cb" data-target="cover" ${_manualChecked.has('cover')?'checked':''}> 📕 Обложка</label>
      ${chaptersWithProse(s).map(ch=>`<label class="row" style="gap:6px;align-items:center;font-size:13px"><input type="checkbox" class="ill-manual-cb" data-target="${ch.id}" data-title="${esc(ch.title)}" ${_manualChecked.has(ch.id)?'checked':''}> ${esc(ch.title)}</label>`).join('') || '<div class="muted" style="font-size:12px">Пока нет глав с написанными сценами.</div>'}
    </div>` : `
    <div class="read-bar">
      <span class="read-title">Иллюстрации</span>
      <span style="flex:1"></span>
      <label class="row" style="gap:6px;align-items:center;font-size:12px" data-tip="Сколько кандидатов предложит арт-директор (включая обложку)">
        Кандидатов:
        <input type="number" id="illSuggestCount" min="1" max="15" value="${ic.suggestCount||7}" style="width:52px">
      </label>
      <button class="btn btn-primary" id="illSuggest" data-tip="Арт-директор (текстовый LLM, тот же что и для прозы) читает книгу и предлагает кандидатов на иллюстрации: обложку + сильные визуальные сцены. Ничего не тратит сверх обычного текстового вызова.">
        ${_busy?'<span class="spinner"></span> '+esc(_busyText):'🎨 Предложить иллюстрации'}
      </button>
    </div>`;
  const uploadTargets = [
    { value:'cover', label:'📕 Обложка' },
    { value:'map', label:'🗺 Карта мира' },
    ...doneScenesOrdered(s).map(sc=>({ value:'scene:'+sc.id, label:`${chapterTitleForScene(s, sc.id)?chapterTitleForScene(s, sc.id)+' · ':''}«${sc.title}»` })),
  ];
  els.center.innerHTML = `
    ${actionBar}
    ${_suggestError?`<div class="pad" style="color:var(--err);font-size:12px">⚠ Арт-директор: ${esc(_suggestError)}</div>`:''}
    <div class="pad" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--border)">
      <span class="muted" style="font-size:12px">⬆ Своя картинка (без генерации):</span>
      <select id="illUploadTarget" style="font-size:12px">
        ${uploadTargets.map(t=>`<option value="${esc(t.value)}">${esc(t.label)}</option>`).join('')}
      </select>
      <input type="file" id="illUploadFile" accept="image/*" style="font-size:12px;max-width:220px">
    </div>
    ${_uploadError?`<div class="pad" style="color:var(--err);font-size:12px">⚠ Загрузка: ${esc(_uploadError)}</div>`:''}
    <div class="read-body" id="illBody">
      ${renderCandidates(s)}
      ${renderGallery(items, s)}
    </div>`;

  bindHandlers(els, s);
}

function renderCandidates(s){
  if(!_candidates.length) return '';
  const provider = s.illustrations?.provider||'gemini';
  const quality = s.illustrations?.quality||'standard';
  const cost = estimateImageCost(provider, quality, _selected.size);
  return `<div class="ph">Кандидаты от арт-директора</div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">
      ${_candidates.map(c=>{
        const chapter = c.type==='scene' ? chapterTitleForScene(s, c.sceneId) : null;
        const label = c.type==='cover' ? '📕 Обложка' : `🖼 ${chapter?esc(chapter)+' · ':''}«${esc(c.sceneTitle||'')}»`;
        const err = _errors.get(c.id);
        // Ниже label — только чекбокс+заголовок (короткое accessible-name чекбокса,
        // + явный aria-label на случай, если браузер всё равно взял бы текст label
        // целиком). Причина/промпт/ошибка — вне label, иначе вложенный <details>
        // конфликтовал бы с click-делегированием label на чекбокс.
        return `<div class="apv-row" style="flex-direction:column;align-items:stretch;gap:4px">
        <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">
          <input type="checkbox" class="ill-cb" data-id="${c.id}" ${_selected.has(c.id)?'checked':''} aria-label="Выбрать: ${esc(label)}" style="margin-top:3px">
          <div style="flex:1">
            <b>${label}</b>
            <span class="muted" style="font-size:11px;margin-left:6px">★ ${c.importance||5}/10</span>
          </div>
        </label>
        <div style="margin-left:24px">
          <div class="muted" style="font-size:12px">${esc(c.reason||'')}</div>
          <details style="margin-top:2px">
            <summary style="cursor:pointer;font-size:11px;color:var(--text-2)">Промпт для генератора</summary>
            <div style="font-size:12px;color:var(--text-2);margin-top:4px;font-style:italic">${esc(c.prompt)}</div>
          </details>
          ${err?`<div style="font-size:12px;color:var(--err);margin-top:4px">⚠ Не удалось сгенерировать: ${esc(err)}</div>`:''}
        </div>
      </div>`;}).join('')}
    </div>
    <div class="row" style="justify-content:flex-end;gap:8px;margin-bottom:18px">
      <button class="btn" id="illClearCand">Отменить</button>
      <button class="btn btn-primary" id="illGenerate" ${_selected.size?'':'disabled'}>
        ${_busy?'<span class="spinner"></span> '+esc(_busyText):`✨ Сгенерировать выбранные (${_selected.size}) — ~$${cost}`}
      </button>
    </div>`;
}

function renderGallery(items, s){
  if(!items.length) return '';
  return `<div class="ph">Сгенерированные</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px">
      ${items.slice().reverse().map(it=>{
        const chapter = it.type==='scene' ? chapterTitleForScene(s, it.sceneId) : null;
        const label = it.type==='cover'?'Обложка':it.type==='map'?'Карта мира':(chapter?`${chapter} · ${it.sceneTitle||'Иллюстрация'}`:(it.sceneTitle||'Иллюстрация'));
        // Своя загруженная картинка — без промпта, «другой промпт»/«перегенерировать» для неё бессмысленны.
        const canReroll = !it.uploaded && (it.type==='cover' || it.type==='scene');
        const rerollErr = _rerollErrors.get(it.id);
        return `<div class="apv-row" style="flex-direction:column;align-items:stretch;gap:6px;padding:8px">
        <img src="${it.dataUrl}" class="ill-thumb" data-id="${it.id}" style="width:100%;border-radius:var(--radius);display:block;cursor:zoom-in" alt="${esc(label)}" title="Открыть в полном размере">
        <div style="font-size:11px" class="muted">${it.type==='map'?'🗺 ':''}${it.uploaded?'⬆ ':''}${esc(label)}</div>
        ${rerollErr?`<div style="font-size:11px;color:var(--err)">⚠ ${esc(rerollErr)}</div>`:''}
        <div class="row" style="gap:6px;flex-wrap:wrap">
          ${canReroll?`<button class="btn ill-reroll-prompt" data-id="${it.id}" title="Предложить другой промпт (текстовый вызов, бесплатно) — картинку это не трогает">🔄 Другой промпт</button>`:''}
          ${canReroll?`<button class="btn ill-regen-img" data-id="${it.id}" title="Перегенерировать картинку по текущему промпту — платно">🖼 Другая картинка</button>`:''}
          <button class="btn ill-del" data-id="${it.id}" data-label="${esc(label)}">🗑 Удалить</button>
        </div>
      </div>`;}).join('')}
    </div>`;
}

// Полноразмерный просмотр + скачивание — общий для любой картинки галереи
// (сгенерированной или своей). #modalRoot — общий контейнер модалок на всё
// приложение (см. index.html), используется так же напрямую в ui/memory.js,
// ui/diagnostics.js, ui/rule-modal.js — отдельный экспорт под это не заводили.
function openImagePreview(dataUrl, label){
  const root = document.getElementById('modalRoot');
  const ext = (dataUrl.match(/^data:image\/(\w+)/)||[])[1] || 'png';
  const fname = (label||'illustration').replace(/[^a-zA-Zа-яА-Я0-9 _-]/g,'').trim().replace(/\s+/g,'_').slice(0,60) || 'illustration';
  root.innerHTML = `<div class="modal-bg" id="imgPvBg"><div class="modal" style="width:auto;max-width:94vw;padding:12px" onclick="event.stopPropagation()">
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px">
      <b style="font-size:13px">${esc(label||'')}</b>
      <div class="row" style="gap:6px">
        <a class="btn btn-primary" id="imgPvSave" href="${dataUrl}" download="${esc(fname)}.${ext}">⬇ Сохранить</a>
        <button class="btn" id="imgPvClose">✕</button>
      </div>
    </div>
    <img src="${dataUrl}" style="max-width:90vw;max-height:80vh;display:block;border-radius:var(--radius)" alt="${esc(label||'')}">
  </div></div>`;
  const close=()=>root.innerHTML='';
  document.getElementById('imgPvBg').onclick=close;
  document.getElementById('imgPvClose').onclick=close;
}

function bindHandlers(els, s){
  s.illustrations = s.illustrations || {};

  const modeA = document.getElementById('illModeAuto');
  const modeM = document.getElementById('illModeManual');
  if(modeA) modeA.onclick = ()=>{ if(s.illustrations.mode!=='auto'){ s.illustrations.mode='auto'; save(); } renderIllustrations(els); };
  if(modeM) modeM.onclick = ()=>{ if(s.illustrations.mode!=='manual'){ s.illustrations.mode='manual'; save(); } renderIllustrations(els); };

  const ruTextCb = document.getElementById('illRuText');
  if(ruTextCb) ruTextCb.onchange = ()=>{ s.illustrations.ruText = ruTextCb.checked; save(); };
  const noTextCb = document.getElementById('illNoText');
  if(noTextCb) noTextCb.onchange = ()=>{ s.illustrations.noText = noTextCb.checked; save(); renderIllustrations(els); };
  const portraitCb = document.getElementById('illPortrait');
  if(portraitCb) portraitCb.onchange = ()=>{ s.illustrations.portraitCover = portraitCb.checked; save(); };

  const uploadFile = document.getElementById('illUploadFile');
  if(uploadFile) uploadFile.onchange = ()=>{
    const file = uploadFile.files[0]; if(!file) return;
    if(!file.type.startsWith('image/')){ _uploadError = 'Это не картинка.'; uploadFile.value=''; renderIllustrations(els); return; }
    if(file.size > MAX_UPLOAD_BYTES){ _uploadError = `Файл слишком большой (${(file.size/1024/1024).toFixed(1)} МБ, максимум 8 МБ).`; uploadFile.value=''; renderIllustrations(els); return; }
    const targetVal = document.getElementById('illUploadTarget').value;
    const reader = new FileReader();
    reader.onerror = ()=>{ _uploadError = 'Не удалось прочитать файл.'; renderIllustrations(els); };
    reader.onload = ()=>{
      let type='cover', sceneId=null, sceneTitle='';
      if(targetVal==='map') type='map';
      else if(targetVal.startsWith('scene:')){
        type='scene'; sceneId = targetVal.slice(6);
        const sc = (s.structure||[]).find(n=>n.id===sceneId);
        sceneTitle = sc ? sc.title : '';
      }
      saveUploadedItem(s, reader.result, { type, sceneId, sceneTitle });
      _uploadError = '';
      save();
      announce('Картинка загружена');
      renderIllustrations(els);
    };
    reader.readAsDataURL(file);
  };

  document.querySelectorAll('.ill-manual-cb').forEach(cb=>cb.onchange=()=>{
    if(cb.checked) _manualChecked.add(cb.dataset.target); else _manualChecked.delete(cb.dataset.target);
    renderIllustrations(els);
  });

  const sm = document.getElementById('illSuggestManual');
  if(sm) sm.onclick = async ()=>{
    if(!s.global.apiKey){ alert('Задайте API-ключ текстовой модели в настройках (⚙).'); return; }
    if(_busy || !_manualChecked.size) return;
    const chapters = chaptersWithProse(s);
    const targets = [..._manualChecked].map(t=>{
      if(t==='cover') return {type:'cover'};
      const ch = chapters.find(c=>c.id===t);
      return ch ? {type:'scene', chapterId:ch.id, chapterTitle:ch.title} : null;
    }).filter(Boolean);
    _busy = true; _suggestError='';
    const fresh = [];
    for(let i=0;i<targets.length;i++){
      _busyText = `Подбираю промпт ${i+1}/${targets.length}…`; renderIllustrations(els);
      try{ fresh.push(await suggestOneIllustration(s, targets[i])); }
      catch(e){ _suggestError = e.message; }
    }
    _candidates = [..._candidates, ...fresh];
    fresh.forEach(c=>_selected.add(c.id));
    _manualChecked = new Set();
    _busy = false; _busyText='';
    announce(fresh.length ? `Предложено ${fresh.length} промптов` : 'Не удалось предложить промпты');
    renderIllustrations(els);
  };

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
    if(_candidates.length && !confirm('Заменить текущий список кандидатов? Несохранённый выбор и отметки об ошибках будут потеряны.')) return;
    _busy = true; _busyText = 'Читаю книгу и продумываю кандидатов…'; _suggestError=''; renderIllustrations(els);
    try{
      _candidates = await suggestIllustrations(s);
      _candidates.sort((a,b)=>b.importance-a.importance);
      _selected = new Set(_candidates.map(c=>c.id));
      _errors = new Map();
      announce(`Арт-директор предложил ${_candidates.length} кандидатов`);
    }catch(e){ _suggestError = e.message; announce('Арт-директор: '+e.message); }
    finally{ _busy = false; _busyText=''; renderIllustrations(els); }
  };

  document.querySelectorAll('.ill-cb').forEach(cb=>cb.onchange=()=>{
    if(cb.checked) _selected.add(cb.dataset.id); else _selected.delete(cb.dataset.id);
    renderIllustrations(els);
  });

  const cc = document.getElementById('illClearCand');
  if(cc) cc.onclick = ()=>{ _candidates=[]; _selected=new Set(); _errors=new Map(); _suggestError=''; renderIllustrations(els); };

  const gb = document.getElementById('illGenerate');
  if(gb) gb.onclick = async ()=>{
    if(!s.illustrations?.apiKey){ alert('Задайте ключ для генерации картинок в настройках (⚙).'); return; }
    if(_busy || !_selected.size) return;
    const toGen = _candidates.filter(c=>_selected.has(c.id));
    _busy = true;
    s.illustrations.items = s.illustrations.items || [];
    const succeeded = new Set();
    for(let i=0;i<toGen.length;i++){
      const c = toGen[i];
      _busyText = `Генерирую ${i+1}/${toGen.length}…`; renderIllustrations(els);
      try{
        const dataUrl = await generateIllustrationFor(s, c);
        s.illustrations.items.push({ id:c.id, type:c.type, sceneId:c.sceneId, sceneTitle:c.sceneTitle, prompt:c.prompt, dataUrl, createdAt:Date.now() });
        if(c.type==='cover') s.project.coverDataUrl = dataUrl;
        succeeded.add(c.id);
        _errors.delete(c.id);
        save();
      }catch(e){ _errors.set(c.id, e.message); }
    }
    // Убираем из списка только успешно сгенерированные — упавшие остаются
    // кандидатами (и выбранными), чтобы повторить одним кликом «Сгенерировать»,
    // а не заново вызывать арт-директора и терять уже подобранные промпты.
    _candidates = _candidates.filter(c=>!succeeded.has(c.id));
    _selected = new Set([..._selected].filter(id=>!succeeded.has(id)));
    _busy = false; _busyText='';
    const failed = toGen.length - succeeded.size;
    announce(failed ? `Сгенерировано ${succeeded.size} из ${toGen.length}, ${failed} с ошибкой` : `Сгенерировано ${succeeded.size} из ${toGen.length}`);
    save(); renderIllustrations(els);
  };

  document.querySelectorAll('.ill-del').forEach(b=>b.onclick=()=>{
    const id = b.dataset.id;
    const it0 = (s.illustrations.items||[]).find(x=>x.id===id);
    const msg = it0?.uploaded ? `Удалить «${b.dataset.label}»?` : `Удалить «${b.dataset.label}»? Картинка сгенерирована платно — заново придётся оплатить и подождать.`;
    if(!confirm(msg)) return;
    const it = (s.illustrations.items||[]).find(x=>x.id===id);
    s.illustrations.items = (s.illustrations.items||[]).filter(x=>x.id!==id);
    if(it && it.type==='cover' && s.project.coverDataUrl===it.dataUrl) s.project.coverDataUrl='';
    save(); renderIllustrations(els);
  });

  document.querySelectorAll('.ill-thumb').forEach(img=>img.onclick=()=>{
    const it = (s.illustrations.items||[]).find(x=>x.id===img.dataset.id);
    if(it) openImagePreview(it.dataUrl, img.alt);
  });

  // Реконструирует «цель» под существующий элемент галереи — для повторного
  // текстового вызова арт-директора (item сам не хранит chapterId, только sceneId).
  function targetForItem(it){
    if(it.type==='cover') return {type:'cover'};
    const scene = (s.structure||[]).find(n=>n.type==='scene' && n.id===it.sceneId);
    if(!scene) return null; // сцена удалена/переименована — предложить точечно уже не по чему
    return { type:'scene', chapterId:scene.chapterId, chapterTitle: chapterTitleForScene(s, scene.id)||'' };
  }

  document.querySelectorAll('.ill-reroll-prompt').forEach(b=>b.onclick=async ()=>{
    if(!s.global.apiKey){ alert('Задайте API-ключ текстовой модели в настройках (⚙).'); return; }
    if(_busy) return;
    const id = b.dataset.id;
    const it = (s.illustrations.items||[]).find(x=>x.id===id);
    if(!it) return;
    const target = targetForItem(it);
    if(!target){ _rerollErrors.set(id, 'Сцена этой картинки больше не найдена в структуре книги.'); renderIllustrations(els); return; }
    _busy = true; _busyText='Подбираю другой промпт…'; renderIllustrations(els);
    try{
      const fresh = await suggestOneIllustration(s, target);
      it.prompt = fresh.prompt;
      _rerollErrors.delete(id);
      save();
      announce('Промпт обновлён — картинка пока прежняя, нажмите «Другая картинка», если хотите перегенерировать.');
    }catch(e){ _rerollErrors.set(id, e.message); }
    finally{ _busy=false; _busyText=''; renderIllustrations(els); }
  });

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
      it.dataUrl = dataUrl;
      if(it.type==='cover') s.project.coverDataUrl = dataUrl;
      _rerollErrors.delete(id);
      save();
      announce('Картинка перегенерирована');
    }catch(e){ _rerollErrors.set(id, e.message); }
    finally{ _busy=false; _busyText=''; renderIllustrations(els); }
  });
}
