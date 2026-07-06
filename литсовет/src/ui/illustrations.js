// Стадия «Иллюстрации»: арт-директор (текстовый LLM) предлагает кандидатов,
// автор сам решает, сколько и что реально заказать у платного провайдера картинок.
// Деньги тратятся ТОЛЬКО по явному клику «Сгенерировать выбранные».

import { getState, save } from '../state.js';
import { suggestIllustrations, generateIllustrationFor, chapterTitleForScene } from '../illustrations.js';
import { estimateImageCost } from '../imagegen.js';
import { esc } from './stages.js';
import { announce } from './a11y.js';

let _candidates = [];   // предложенные арт-директором, ещё не сгенерированные
let _selected = new Set(); // id выбранных чекбоксом кандидатов
let _errors = new Map(); // id кандидата → текст последней ошибки генерации (не удалось — не теряем кандидата)
let _suggestError = ''; // ошибка арт-директора — инлайн вместо блокирующего alert()
let _busy = false;
let _busyText = '';

export function renderIllustrations(els){
  const s = getState();
  const items = s.illustrations?.items || [];

  els.left.innerHTML = `<div class="ph">Готово</div>
    ${items.length ? `<div class="pad muted" style="font-size:12px">${items.length} иллюстраци${items.length===1?'я':items.length<5?'и':'й'}${s.project.coverDataUrl?' · обложка задана':''}</div>`
      : '<div class="empty-state">Пока нет сгенерированных картинок.</div>'}`;

  els.right.innerHTML = `<div class="ph">Настройки</div><div class="pad">
    ${s.illustrations?.apiKey
      ? `<div class="muted" style="font-size:12px">Провайдер: ${esc(s.illustrations.provider==='openai'?'OpenAI':s.illustrations.provider==='qwen'?'Qwen / DashScope':'Gemini (Nano Banana)')} · качество: ${esc(s.illustrations.quality==='hd'?'HD':'стандарт')}</div>`
      : `<div class="muted" style="font-size:12px">⚠ Ключ для картинок не задан — откройте ⚙ настройки.</div>`}
    <div class="muted" style="font-size:12px;margin-top:8px">Визуальный голос: ${s.style?.visualVoiceOn ? 'включён' : 'выключен'} <span class="hint">(настраивается в Концепции)</span></div>
  </div>`;

  els.center.className = 'panel panel-center';
  els.center.innerHTML = `
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
    ${_suggestError?`<div class="pad" style="color:var(--err);font-size:12px">⚠ Арт-директор: ${esc(_suggestError)}</div>`:''}
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
        return `<div class="apv-row" style="flex-direction:column;align-items:stretch;gap:6px;padding:8px">
        <img src="${it.dataUrl}" style="width:100%;border-radius:var(--radius);display:block" alt="${esc(label)}">
        <div style="font-size:11px" class="muted">${it.type==='map'?'🗺 '+esc(label):esc(label)}</div>
        <button class="btn ill-del" data-id="${it.id}" data-label="${esc(label)}" style="align-self:flex-start">🗑 Удалить</button>
      </div>`;}).join('')}
    </div>`;
}

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
    if(!confirm(`Удалить «${b.dataset.label}»? Картинка сгенерирована платно — заново придётся оплатить и подождать.`)) return;
    const it = (s.illustrations.items||[]).find(x=>x.id===id);
    s.illustrations.items = (s.illustrations.items||[]).filter(x=>x.id!==id);
    if(it && it.type==='cover' && s.project.coverDataUrl===it.dataUrl) s.project.coverDataUrl='';
    save(); renderIllustrations(els);
  });
}
