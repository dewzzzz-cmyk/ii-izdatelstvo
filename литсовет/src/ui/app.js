// Точка входа UI: инициализация, рейл, изменяемые границы, настройки,
// диспетчеризация стадий.

import { init, getState, subscribe, save, newProject } from '../state.js';
import { renderConcept, renderVoice, renderStructure, renderWrite, renderEdit } from './stages.js';
import { renderDiagnostics } from './diagnostics.js';
import { exportCheckpoint } from '../storage.js';

function escAttr(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

const STAGES = [
  { id:'concept',   label:'Концепция' },
  { id:'voice',     label:'Голос' },
  { id:'structure', label:'Структура' },
  { id:'write',     label:'Написание' },
  { id:'edit',      label:'Редактура' },
];

const els = {
  stages: document.getElementById('stages'),
  left: document.getElementById('panelLeft'),
  center: document.getElementById('panelCenter'),
  right: document.getElementById('panelRight'),
  projMeta: document.getElementById('projMeta'),
  body: document.getElementById('body'),
  modalRoot: document.getElementById('modalRoot'),
};

function stageDone(state, stageId){
  switch(stageId){
    case 'concept': return !!state.project.idea || !!state.project.title;
    case 'voice':   return (state.voice.examples||[]).length>0;
    case 'structure': return (state.structure||[]).some(n=>n.type==='scene');
    default: return false;
  }
}

function renderRail(){
  const s = getState();
  els.stages.innerHTML = '';
  STAGES.forEach(st=>{
    const b = document.createElement('button');
    b.className = 'chip' + (s.ui.stage===st.id?' active':'') + (stageDone(s,st.id) && s.ui.stage!==st.id?' done':'');
    b.textContent = st.label;
    b.onclick = ()=>{ s.ui.stage = st.id; save(); };
    els.stages.appendChild(b);
  });
  const wc = (s.structure||[]).filter(n=>n.type==='scene').reduce((a,n)=>a+(n.words||0),0);
  els.projMeta.textContent = (s.project.title||'новый проект') + (wc?` · ${wc.toLocaleString('ru')} сл.`:'');
}

function renderStage(){
  const s = getState();
  const stage = s.ui.stage;
  // сбрасываем классы панелей (split добавляют сами стадии)
  els.left.className='panel panel-left';
  els.right.className='panel panel-right';
  els.center.className='panel panel-center';
  if(stage==='concept'){ renderConcept(els); }
  else if(stage==='voice'){ renderVoice(els); }
  else if(stage==='structure'){ renderStructure(els); }
  else if(stage==='write'){ renderWrite(els); }
  else if(stage==='edit'){ renderEdit(els); }
  else { els.left.innerHTML=''; els.center.innerHTML=''; els.right.innerHTML=''; }
}

function rerender(){ renderRail(); renderStage(); }

// ── Изменяемые границы панелей ──
function initDividers(){
  document.querySelectorAll('.divider').forEach(div=>{
    div.addEventListener('mousedown', e=>{
      e.preventDefault();
      div.classList.add('dragging');
      const which = div.dataset.divider;
      const startX = e.clientX;
      const cols = getComputedStyle(els.body).gridTemplateColumns.split(' ').map(parseFloat);
      // cols: [left, 6, center, 6, right]
      const startLeft = cols[0], startRight = cols[4];
      function move(ev){
        const dx = ev.clientX - startX;
        let left = startLeft, right = startRight;
        if(which==='left') left = Math.max(160, Math.min(startLeft+dx, 460));
        if(which==='right') right = Math.max(220, Math.min(startRight-dx, 480));
        els.body.style.gridTemplateColumns = `${left}px 6px 1fr 6px ${right}px`;
      }
      function up(){ div.classList.remove('dragging'); document.removeEventListener('mousemove',move); document.removeEventListener('mouseup',up); }
      document.addEventListener('mousemove',move);
      document.addEventListener('mouseup',up);
    });
  });
}

// ── Настройки (API-ключ только в памяти) ──
function openSettings(){
  const s = getState();
  const g = s.global;
  els.modalRoot.innerHTML = `
    <div class="modal-bg" id="mbg">
      <div class="modal" onclick="event.stopPropagation()">
        <h2>Настройки</h2>
        <div class="field"><label>API-ключ <span class="hint">(только в памяти, не сохраняется на диск)</span></label>
          <input type="text" id="setKey" value="${escAttr(g.apiKey)}" placeholder="sk-..."></div>
        <div class="field"><label>Базовый URL</label>
          <input type="text" id="setUrl" value="${escAttr(g.baseURL)}"></div>
        <div class="field"><label>Модель</label>
          <input type="text" id="setModel" value="${escAttr(g.model)}"></div>
        <div class="row" style="justify-content:space-between;margin-top:6px">
          <button class="btn" id="setNew">Новый проект</button>
          <div class="row">
            <button class="btn" id="setExport">Экспорт .json</button>
            <button class="btn btn-primary" id="setSave">Готово</button>
          </div>
        </div>
      </div>
    </div>`;
  const close = ()=>{ els.modalRoot.innerHTML=''; };
  document.getElementById('mbg').onclick = close;
  document.getElementById('setSave').onclick = ()=>{
    g.apiKey = document.getElementById('setKey').value.trim();
    g.baseURL = document.getElementById('setUrl').value.trim();
    g.model = document.getElementById('setModel').value.trim();
    save(); close();
  };
  document.getElementById('setNew').onclick = ()=>{ if(confirm('Создать новый проект? Текущий сохранён в IndexedDB.')){ newProject(); close(); } };
  document.getElementById('setExport').onclick = ()=>{
    const blob = new Blob([exportCheckpoint(getState())], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = (getState().project.title||'litsovet')+'.json'; a.click();
  };
}

async function main(){
  await init();
  subscribe(()=>rerender());
  document.getElementById('settingsBtn').onclick = openSettings;
  initDividers();
  rerender();
}
main();
