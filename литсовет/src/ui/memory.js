// Правая панель, вкладка «Память»: сводки (с откатом версий), состояния
// персонажей, сигналы дрейфа, факты Bible, квота хранилища.

import { getState, save } from '../state.js';
import { rollback } from '../memory.js';
import { storageEstimate } from '../storage.js';

function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

export function renderMemory(){
  const s = getState();
  const mem = s.memory||{};
  const scenes = (s.structure||[]).filter(n=>n.type==='scene');
  const sceneSums = scenes.filter(n=>(mem.scenes||{})[n.id]?.current);
  setTimeout(()=>{ bindMemory(); refreshQuota(); }, 0);

  return `
    <div class="ph">Память книги</div>
    <div class="pad" style="padding:10px 12px">
      <div id="quota" class="muted" style="margin-bottom:8px">квота…</div>

      <div class="mem-h">Сводки сцен (${sceneSums.length})</div>
      ${sceneSums.length ? sceneSums.map(n=>{
        const e = mem.scenes[n.id];
        return `<div class="mem-card">
          <div class="mem-title">${esc(n.title)}</div>
          <textarea class="mem-sum" data-level="scenes" data-id="${n.id}" rows="2">${esc(e.current)}</textarea>
          ${e.versions&&e.versions.length?`<button class="mem-rb" data-level="scenes" data-id="${n.id}">↶ откатить (${e.versions.length})</button>`:''}
        </div>`;
      }).join('') : '<div class="muted" style="margin-bottom:10px">Появятся после написания сцен.</div>'}

      ${s.characters&&s.characters.length?`
        <div class="mem-h">Персонажи (${s.characters.length})</div>
        ${s.characters.map(c=>`<div class="mem-card"><div class="mem-title">${esc(c.name)}</div><div class="muted" style="font-size:12px">${esc(c.stateNote||'—')}</div></div>`).join('')}
      `:''}

      ${driftBlock(scenes)}

      ${s.bible&&s.bible.length?`
        <div class="mem-h">Канон / Bible (${s.bible.length})</div>
        ${s.bible.slice(0,8).map(b=>`<div class="mem-card"><div class="mem-title" style="color:var(--accent)">${esc(b.keys||'факт')}</div><div class="muted" style="font-size:12px">${esc(b.text)}</div></div>`).join('')}
      `:''}
    </div>`;
}

function driftBlock(scenes){
  const flagged = scenes.filter(n=>Array.isArray(n.drift) && n.drift.length);
  if(!flagged.length) return '';
  return `<div class="mem-h" style="color:var(--warn)">⚠ Сигналы дрейфа</div>
    ${flagged.map(n=>`<div class="mem-card" style="border-color:var(--warn-border)">
      <div class="mem-title">${esc(n.title)}</div>
      ${n.drift.map(d=>`<div style="font-size:12px;color:var(--warn)">${esc(d)}</div>`).join('')}
    </div>`).join('')}`;
}

function bindMemory(){
  document.querySelectorAll('.mem-sum').forEach(t=>{
    t.addEventListener('change', ()=>{
      const s=getState(); const e=s.memory[t.dataset.level]?.[t.dataset.id];
      if(e){ if(e.current!==t.value){ e.versions.unshift({text:e.current, at:Date.now()}); if(e.versions.length>8)e.versions.length=8; } e.current=t.value; save(); }
    });
  });
  document.querySelectorAll('.mem-rb').forEach(b=>{
    b.onclick=()=>{ const s=getState(); if(rollback(s, b.dataset.level, b.dataset.id, 0)){ save(); } };
  });
}

async function refreshQuota(){
  const el = document.getElementById('quota');
  if(!el) return;
  const est = await storageEstimate();
  if(!est){ el.textContent=''; return; }
  const mb = (est.usage/1048576).toFixed(1);
  const pct = Math.round(est.ratio*100);
  el.textContent = `Хранилище: ${mb} МБ (${pct}%)`;
  if(est.ratio > 0.8){ el.style.color='var(--warn)'; el.textContent += ' — пора экспортировать чекпоинт'; }
}
