// Общая модалка "⊕ Правило автора" — раньше в трёх местах (approvalGate, разбор
// агента, инлайн-меню выделения) был свой prompt(): нативный диалог браузера без
// стилей, без доп. кнопок, блокирующий страницу. Один модал вместо трёх копий.
// Свой корневой контейнер (не #modalRoot) — approvalGate тоже рисует в #modalRoot,
// и переиспользование стёрло бы открытую модалку ручного режима под этой.
import { getState, save, addRule } from '../state.js';
import { generalizeToRule } from '../voice.js';

function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function ruleModalRoot(){
  let el = document.getElementById('ruleModalRoot');
  if(!el){ el = document.createElement('div'); el.id = 'ruleModalRoot'; document.body.appendChild(el); }
  return el;
}

// opts: { skipSave: true — не вызывать save() (approvalGate: идёт прогон, ре-рендер
//        оторвёт ссылки; правило и так действует в памяти сразу), onSave(text) }
export function openRuleModal(defaultText, opts={}){
  const root = ruleModalRoot();
  root.innerHTML = `<div class="modal-bg" id="ruleModalBg"><div class="modal" style="width:480px;max-width:92vw" onclick="event.stopPropagation()">
    <h2>⊕ Правило автора</h2>
    <div class="muted" style="margin-bottom:8px;font-size:12px">Сформулируйте как общий принцип — он будет применяться ко всем будущим сценам, не только к этому месту.</div>
    <textarea id="ruleModalText" rows="4" style="width:100%;box-sizing:border-box">${esc(defaultText||'')}</textarea>
    <div class="row" style="justify-content:space-between;margin-top:10px">
      <button class="btn" id="ruleModalGeneralize">✨ Обобщить</button>
      <div class="row" style="gap:8px">
        <button class="btn" id="ruleModalCancel">Отмена</button>
        <button class="btn btn-primary" id="ruleModalSave">Сохранить</button>
      </div>
    </div>
  </div></div>`;
  const close = ()=>{ root.innerHTML=''; };
  document.getElementById('ruleModalBg').onclick = close;
  document.getElementById('ruleModalCancel').onclick = close;
  const ta = document.getElementById('ruleModalText'); ta.focus(); ta.select();
  document.getElementById('ruleModalSave').onclick = ()=>{
    const t = ta.value.trim(); if(!t) return;
    const added = addRule(getState(), t);
    if(added && !opts.skipSave) save();
    close();
    if(opts.onSave) opts.onSave(t);
  };
  document.getElementById('ruleModalGeneralize').onclick = async ()=>{
    const btn = document.getElementById('ruleModalGeneralize');
    const s = getState();
    if(!s.global.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
    const orig = btn.textContent; btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
    try{
      const rewritten = await generalizeToRule(ta.value.trim(), s);
      if(rewritten) ta.value = rewritten;
    }catch(e){ alert('Не удалось: '+e.message); }
    finally{ btn.disabled=false; btn.textContent=orig; }
  };
}

// Универсальная модалка ввода одной строки — замена нативного prompt().
// opts: { title, hint, value, placeholder, okLabel, onOk(value) }.
// Отмена/клик по фону — просто закрыть, onOk не вызывается.
export function openInputModal({ title, hint='', value='', placeholder='', okLabel='OK', onOk }){
  const root = ruleModalRoot();
  root.innerHTML = `<div class="modal-bg" id="inModalBg"><div class="modal" style="width:440px;max-width:92vw" onclick="event.stopPropagation()">
    <h2>${esc(title||'')}</h2>
    ${hint?`<div class="muted" style="margin-bottom:8px;font-size:12px">${esc(hint)}</div>`:''}
    <input type="text" id="inModalText" value="${esc(value)}" placeholder="${esc(placeholder)}" style="width:100%;box-sizing:border-box">
    <div class="row" style="justify-content:flex-end;gap:8px;margin-top:10px">
      <button class="btn" id="inModalCancel">Отмена</button>
      <button class="btn btn-primary" id="inModalOk">${esc(okLabel)}</button>
    </div>
  </div></div>`;
  const close = ()=>{ root.innerHTML=''; };
  document.getElementById('inModalBg').onclick = close;
  document.getElementById('inModalCancel').onclick = close;
  const inp = document.getElementById('inModalText'); inp.focus();
  const ok = ()=>{ const v = inp.value.trim(); close(); if(onOk) onOk(v); };
  document.getElementById('inModalOk').onclick = ok;
  inp.onkeydown = e=>{ if(e.key==='Enter') ok(); else if(e.key==='Escape') close(); };
}

// Модалка "Ключи + Факт" — замена двух последовательных prompt() при
// добавлении/правке факта Библии/Мира (ui/world.js, ui/memory.js).
// onSave(keys, text) вызывается только при сохранении с непустым фактом;
// отмена/клик по фону/Escape — просто закрыть.
export function openFactModal({ keys='', text='' }={}, onSave){
  const root = ruleModalRoot();
  root.innerHTML = `<div class="modal-bg" id="factModalBg"><div class="modal" style="width:480px;max-width:92vw" onclick="event.stopPropagation()">
    <h2>Факт канона</h2>
    <div class="muted" style="margin-bottom:4px;font-size:12px">Ключи (через запятую)</div>
    <input type="text" id="factModalKeys" value="${esc(keys)}" placeholder="например: город, климат" style="width:100%;box-sizing:border-box;margin-bottom:10px">
    <div class="muted" style="margin-bottom:4px;font-size:12px">Факт</div>
    <textarea id="factModalText" rows="3" style="width:100%;box-sizing:border-box">${esc(text)}</textarea>
    <div class="row" style="justify-content:flex-end;gap:8px;margin-top:10px">
      <button class="btn" id="factModalCancel">Отмена</button>
      <button class="btn btn-primary" id="factModalOk">Сохранить</button>
    </div>
  </div></div>`;
  const close = ()=>{ root.innerHTML=''; };
  document.getElementById('factModalBg').onclick = close;
  document.getElementById('factModalCancel').onclick = close;
  const keysInp = document.getElementById('factModalKeys');
  const textInp = document.getElementById('factModalText');
  keysInp.focus();
  const ok = ()=>{
    const k = keysInp.value.trim(); const t = textInp.value.trim();
    if(!t) return;
    close();
    if(onSave) onSave(k, t);
  };
  document.getElementById('factModalOk').onclick = ok;
  keysInp.onkeydown = e=>{ if(e.key==='Escape') close(); };
  textInp.onkeydown = e=>{ if(e.key==='Escape') close(); };
}
