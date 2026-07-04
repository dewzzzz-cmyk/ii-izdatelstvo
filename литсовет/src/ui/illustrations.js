// Стадия «Иллюстрации»: арт-директор (текстовый LLM) предлагает кандидатов,
// автор сам решает, сколько и что реально заказать у платного провайдера картинок.
// Деньги тратятся ТОЛЬКО по явному клику «Сгенерировать выбранные».

import { getState, save } from '../state.js';
import { suggestIllustrations, generateIllustrationFor } from '../illustrations.js';
import { estimateImageCost } from '../imagegen.js';
import { esc } from './stages.js';

let _candidates = [];   // предложенные арт-директором, ещё не сгенерированные
let _selected = new Set(); // id выбранных чекбоксом кандидатов
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
      <button class="btn btn-primary" id="illSuggest" data-tip="Арт-директор (текстовый LLM, тот же что и для прозы) читает книгу и предлагает кандидатов на иллюстрации: обложку + сильные визуальные сцены. Ничего не тратит сверх обычного текстового вызова.">
        ${_busy?'<span class="spinner"></span> '+esc(_busyText):'🎨 Предложить иллюстрации'}
      </button>
    </div>
    <div class="read-body" id="illBody">
      ${renderCandidates(s)}
      ${renderGallery(items)}
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
    </div>
    <div class="row" style="justify-content:flex-end;gap:8px;margin-bottom:18px">
      <button class="btn" id="illClearCand">Отменить</button>
      <button class="btn btn-primary" id="illGenerate" ${_selected.size?'':'disabled'}>
        ${_busy?'<span class="spinner"></span> '+esc(_busyText):`✨ Сгенерировать выбранные (${_selected.size}) — ~$${cost}`}
      </button>
    </div>`;
}

function renderGallery(items){
  if(!items.length) return '';
  return `<div class="ph">Сгенерированные</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px">
      ${items.slice().reverse().map(it=>`<div class="apv-row" style="flex-direction:column;align-items:stretch;gap:6px;padding:8px">
        <img src="${it.dataUrl}" style="width:100%;border-radius:var(--radius);display:block" alt="${esc(it.sceneTitle||it.type)}">
        <div style="font-size:11px" class="muted">${it.type==='cover'?'Обложка':it.type==='map'?'🗺 Карта мира':esc(it.sceneTitle||'')}</div>
        <button class="btn ill-del" data-id="${it.id}" style="font-size:11px;padding:3px 8px;align-self:flex-start">🗑 Удалить</button>
      </div>`).join('')}
    </div>`;
}

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

  document.querySelectorAll('.ill-cb').forEach(cb=>cb.onchange=()=>{
    if(cb.checked) _selected.add(cb.dataset.id); else _selected.delete(cb.dataset.id);
    renderIllustrations(els);
  });

  const cc = document.getElementById('illClearCand');
  if(cc) cc.onclick = ()=>{ _candidates=[]; _selected=new Set(); renderIllustrations(els); };

  const gb = document.getElementById('illGenerate');
  if(gb) gb.onclick = async ()=>{
    if(!s.illustrations?.apiKey){ alert('Задайте ключ для генерации картинок в настройках (⚙).'); return; }
    if(_busy || !_selected.size) return;
    const toGen = _candidates.filter(c=>_selected.has(c.id));
    _busy = true;
    s.illustrations.items = s.illustrations.items || [];
    for(let i=0;i<toGen.length;i++){
      const c = toGen[i];
      _busyText = `Генерирую ${i+1}/${toGen.length}…`; renderIllustrations(els);
      try{
        const dataUrl = await generateIllustrationFor(s, c);
        s.illustrations.items.push({ id:c.id, type:c.type, sceneId:c.sceneId, sceneTitle:c.sceneTitle, prompt:c.prompt, dataUrl, createdAt:Date.now() });
        if(c.type==='cover') s.project.coverDataUrl = dataUrl;
        save();
      }catch(e){ alert(`Не удалось сгенерировать «${c.sceneTitle||'обложку'}»: ${e.message}`); }
    }
    _candidates = _candidates.filter(c=>!_selected.has(c.id));
    _selected = new Set();
    _busy = false; _busyText='';
    save(); renderIllustrations(els);
  };

  document.querySelectorAll('.ill-del').forEach(b=>b.onclick=()=>{
    const id = b.dataset.id;
    const it = (s.illustrations.items||[]).find(x=>x.id===id);
    s.illustrations.items = (s.illustrations.items||[]).filter(x=>x.id!==id);
    if(it && it.type==='cover' && s.project.coverDataUrl===it.dataUrl) s.project.coverDataUrl='';
    save(); renderIllustrations(els);
  });
}
