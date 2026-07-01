// Точка входа UI: инициализация, рейл, изменяемые границы, настройки,
// диспетчеризация стадий.

import { init, getState, subscribe, save, newProject, switchProject } from '../state.js';
import { renderConcept, renderVoice, renderStructure, renderWrite, renderEdit } from './stages.js';
import { renderDiagnostics } from './diagnostics.js';
import { exportCheckpoint, listProjects, listServerProjects } from '../storage.js';
import { initTooltips } from './tooltips.js';

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
  const visibleStages = s.project?.useVoice ? STAGES : STAGES.filter(st=>st.id!=='voice');
  visibleStages.forEach(st=>{
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

// ── Мобильная навигация ──
const MOB_TABS = [
  { key:'left',   ic:'≡', label:'Список'   },
  { key:'center', ic:'✎', label:'Редактор' },
  { key:'right',  ic:'◈', label:'Агенты'   },
  { key:'chat',   ic:'💬', label:'Чат'     },
];

function isMob(){ return window.innerWidth <= 767; }
function getMobPanel(){ return getState().ui.mobPanel || 'center'; }

function renderMobNav(activePanelKey){
  const nav = document.getElementById('mobNav');
  if(!nav) return;
  const cur = activePanelKey || getMobPanel();
  // не перестраивать если активная вкладка не изменилась
  const existing = nav.querySelector('.mob-tab.active');
  if(existing && existing.dataset.panel === cur) return;
  nav.innerHTML = MOB_TABS.map(t =>
    `<button class="mob-tab${cur===t.key?' active':''}" data-panel="${t.key}">
      <span class="mt-ic">${t.ic}</span><span>${t.label}</span>
    </button>`
  ).join('');
  nav.querySelectorAll('.mob-tab').forEach(btn => {
    btn.onclick = () => {
      const s=getState();
      s.ui.mobPanel=btn.dataset.panel;
      if(btn.dataset.panel==='chat') s.ui.rightTab='chat';
      save();
    };
  });
}

function applyMobileLayout(){
  if(!isMob()){
    els.left.classList.remove('mob-active');
    els.center.classList.remove('mob-active');
    els.right.classList.remove('mob-active');
    return;
  }
  let cur = getMobPanel();
  const isRight = cur === 'right' || cur === 'chat';
  // если выбранная панель пуста — автоматически показать центр
  const chosen = cur==='left' ? els.left : isRight ? els.right : els.center;
  if(!chosen.children.length) cur = 'center';
  const curIsRight = cur === 'right' || cur === 'chat';
  els.left.classList.toggle('mob-active', cur === 'left');
  els.center.classList.toggle('mob-active', cur === 'center');
  els.right.classList.toggle('mob-active', curIsRight);
  renderMobNav(cur);
}

function rerender(){ renderRail(); renderStage(); applyMobileLayout(); }

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
async function openSettings(){
  const s = getState();
  const g = s.global;
  const curId = s.id;

  // Загружаем список проектов параллельно
  const [localList, serverList] = await Promise.all([
    listProjects().catch(()=>[]),
    listServerProjects().catch(()=>[]),
  ]);
  // Мерж: строим Map id → {id, title, updated, onServer}
  const map = new Map();
  localList.forEach(p=>map.set(p.id,{...p, onServer:false}));
  serverList.forEach(p=>{
    const ex = map.get(p.id);
    if(!ex) map.set(p.id,{...p, onServer:true});
    else ex.onServer=true;
  });
  const projects = [...map.values()].sort((a,b)=>(b.updated||0)-(a.updated||0));

  const fmtProjDate = (ts)=>{
    if(!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString('ru', {day:'numeric', month:'short'}) + ' ' + d.toLocaleTimeString('ru', {hour:'2-digit', minute:'2-digit'});
  };
  const projListHtml = projects.length<2 ? '' : `
    <div class="field" style="margin-top:12px">
      <label>Мои книги <span class="hint">(нажмите чтобы открыть)</span></label>
      <div id="projList" style="display:flex;flex-direction:column;gap:4px;max-height:200px;overflow-y:auto;margin-top:4px">
        ${projects.map(p=>`
          <button class="proj-item${p.id===curId?' proj-item-active':''}" data-pid="${escAttr(p.id)}">
            <span class="proj-item-title">${escAttr(p.title||'(без названия)')}</span>
            <span class="proj-item-date">${escAttr(fmtProjDate(p.updated))}</span>
            ${p.onServer?'<span class="proj-item-badge">☁</span>':''}
          </button>`).join('')}
      </div>
    </div>`;

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
        <div class="field"><label>Бюджет контекста (токенов) <span class="hint">сколько токенов под память сцены; 32к = оптимум для большинства моделей</span></label>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="range" id="setBudgetRange" min="8000" max="60000" step="4000" value="${escAttr(g.budgetTokens??32000)}" style="flex:1" oninput="document.getElementById('setBudgetNum').value=this.value">
            <input type="number" id="setBudgetNum" value="${escAttr(g.budgetTokens??32000)}" min="8000" max="60000" step="4000" style="width:80px" oninput="document.getElementById('setBudgetRange').value=this.value">
          </div></div>
        ${projListHtml}
        <div class="row" style="justify-content:space-between;margin-top:12px">
          <button class="btn" id="setNew">+ Новый проект</button>
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
    const bv = parseInt(document.getElementById('setBudgetNum').value); if(bv>=8000) g.budgetTokens = bv;
    save(); close();
  };
  document.getElementById('setNew').onclick = ()=>{
    if(confirm('Создать новый проект? Текущий сохранён.')){ newProject(); close(); }
  };
  document.getElementById('setExport').onclick = ()=>{
    const blob = new Blob([exportCheckpoint(getState())], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = (getState().project.title||'litsovet')+'.json'; a.click();
  };
  document.getElementById('projList')?.querySelectorAll('.proj-item').forEach(btn=>{
    btn.onclick = async ()=>{
      const pid = btn.dataset.pid;
      if(pid === curId){ close(); return; }
      btn.disabled = true; btn.textContent = '⏳ Загрузка…';
      const ok = await switchProject(pid);
      if(ok){ close(); } else { btn.textContent = '⚠ Не найден'; btn.disabled=false; }
    };
  });
}

async function main(){
  await init();
  subscribe(()=>rerender());
  document.getElementById('settingsBtn').onclick = openSettings;
  initDividers();
  initTooltips();
  let _resizeRaf = null, _lastW = window.innerWidth;
  window.addEventListener('resize', ()=>{
    if(_resizeRaf) cancelAnimationFrame(_resizeRaf);
    _resizeRaf = requestAnimationFrame(()=>{
      const w = window.innerWidth;
      if(w !== _lastW){ _lastW = w; rerender(); } // смена ширины/ориентации
      else { applyMobileLayout(); }               // только высота = клавиатура, не трогать DOM
    });
  });
  rerender();
}
main();
