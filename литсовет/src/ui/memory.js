// Правая панель, вкладка «Память»: сводки (с откатом версий), состояния
// персонажей, сигналы дрейфа, факты Bible, квота хранилища.

import { getState, save } from '../state.js';
import { rollback, summarizeScene } from '../memory.js';
import { storageEstimate } from '../storage.js';
import { uncalibratedScenes, recordRating, calibrationState } from '../calibration.js';

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

      ${renderCalibration(s)}

      <div class="mem-h">Сводки сцен (${sceneSums.length})</div>
      ${sceneSums.length ? sceneSums.map(n=>{
        const e = mem.scenes[n.id];
        return `<div class="mem-card">
          <div class="mem-title">${esc(n.title)}</div>
          <textarea class="mem-sum" data-level="scenes" data-id="${n.id}" rows="2">${esc(e.current)}</textarea>
          <div class="row" style="gap:6px;margin-top:4px">
            <button class="mem-rs" data-id="${n.id}" title="Пере-суммаризировать сцену заново">↻ заново</button>
            ${e.versions&&e.versions.length?`<button class="mem-rb" data-level="scenes" data-id="${n.id}">↶ откатить (${e.versions.length})</button>`:''}
          </div>
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

function renderCalibration(s){
  const cal = s.global.calibration||{ratings:[]};
  const pending = uncalibratedScenes(s).length;
  const adj = cal.lastAdjust;
  return `<div class="mem-h">Калибровка вкуса</div>
    <div class="mem-card">
      <div class="muted" style="font-size:11px;margin-bottom:6px">Оцените прозу вслепую — порог Оценщика подстроится под ваш вкус (а не висит на «7/10»).</div>
      <div style="font-size:12px;margin-bottom:6px">Оценок: <b>${cal.ratings.length}</b>${adj?` · порог сейчас <b>${adj.threshold}</b> (вы ${adj.authorAvg} / ИИ ${adj.evalAvg})`:` · порог <b>${s.global.evaluatorThreshold??7}</b>`}</div>
      <button class="btn ${pending?'btn-primary':''}" id="calBtn" ${pending?'':'disabled'}>${pending?`Оценить сцену вслепую (${pending})`:'Нет новых сцен'}</button>
    </div>`;
}

function openBlindRating(){
  const s = getState();
  const scenes = uncalibratedScenes(s);
  if(!scenes.length) return;
  const scene = scenes[scenes.length-1]; // самая свежая
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-bg" id="calBg"><div class="modal" style="width:560px;max-width:92vw" onclick="event.stopPropagation()">
    <h2>Слепая оценка · «${esc(scene.title)}»</h2>
    <div class="muted" style="margin-bottom:8px">Прочитайте без оценки ИИ. Насколько это хорошая проза (1–10)?</div>
    <div style="max-height:300px;overflow-y:auto;font-size:13px;line-height:1.7;white-space:pre-wrap;border:1px solid var(--border);border-radius:var(--radius);padding:12px;margin-bottom:12px">${esc(scene.text)}</div>
    <div class="cal-scale" id="calScale">${[1,2,3,4,5,6,7,8,9,10].map(n=>`<button class="cal-n" data-n="${n}">${n}</button>`).join('')}</div>
  </div></div>`;
  const close=()=>root.innerHTML='';
  document.getElementById('calBg').onclick=close;
  document.querySelectorAll('.cal-n').forEach(b=>b.onclick=()=>{
    const adj = recordRating(scene.id, parseInt(b.dataset.n));
    close();
  });
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
  const cb=document.getElementById('calBtn'); if(cb) cb.onclick=openBlindRating;
  document.querySelectorAll('.mem-sum').forEach(t=>{
    t.addEventListener('change', ()=>{
      const s=getState(); const e=s.memory[t.dataset.level]?.[t.dataset.id];
      if(e){ if(e.current!==t.value){ e.versions.unshift({text:e.current, at:Date.now()}); if(e.versions.length>8)e.versions.length=8; } e.current=t.value; save(); }
    });
  });
  document.querySelectorAll('.mem-rb').forEach(b=>{
    b.onclick=()=>{ const s=getState(); if(rollback(s, b.dataset.level, b.dataset.id, 0)){ save(); } };
  });
  document.querySelectorAll('.mem-rs').forEach(b=>{
    b.onclick=async ()=>{
      const s=getState(); const scene=(s.structure||[]).find(n=>n.id===b.dataset.id);
      if(!scene||!s.global.apiKey){ if(!s.global.apiKey) alert('Задайте API-ключ (⚙).'); return; }
      b.disabled=true; b.innerHTML='<span class="spinner"></span>';
      try{ await summarizeScene(s, scene); save(); }   // putVersioned сохранит прошлую сводку
      catch(e){ b.textContent='ошибка'; b.title=e.message; }
    };
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
