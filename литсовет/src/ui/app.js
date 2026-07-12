// Точка входа UI: инициализация, рейл, изменяемые границы, настройки,
// диспетчеризация стадий.

import { init, getState, subscribe, save, newProject, switchProject, APP_VERSION } from '../state.js';
import { renderConcept, renderVoice, renderStructure, renderWrite, renderEdit } from './stages.js';
import { renderDiagnostics } from './diagnostics.js';
import { renderIllustrations } from './illustrations.js';
import { renderWorld } from './world.js';
import { renderPublish } from './publish.js';
import { exportCheckpoint, listProjects, listServerProjects } from '../storage.js';
import { initTooltips } from './tooltips.js';
import { callLLM } from '../llm.js';
import { MODEL_OPTIONS } from '../imagegen.js';

function escAttr(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// Известные OpenAI-совместимые текстовые провайдеры — пресет URL+модель,
// но поля ниже остаются свободным текстом: если пресет неточен (эндпоинты
// меняются), автор просто поправит вручную, ничего не заблокировано.
const TEXT_PROVIDERS = [
  { v:'deepseek', label:'DeepSeek',       baseURL:'https://api.deepseek.com', model:'deepseek-chat' },
  { v:'openai',   label:'OpenAI',         baseURL:'https://api.openai.com/v1', model:'gpt-5' },
  { v:'gemini',   label:'Google Gemini',  baseURL:'https://generativelanguage.googleapis.com/v1beta/openai/', model:'gemini-2.5-flash' },
  { v:'qwen',     label:'Qwen (Alibaba)', baseURL:'https://dashscope.aliyuncs.com/compatible-mode/v1', model:'qwen-plus' },
  { v:'custom',   label:'Другой…',        baseURL:'', model:'' },
];
function matchTextProvider(baseURL){
  const found = TEXT_PROVIDERS.find(p=>p.v!=='custom' && p.baseURL===baseURL);
  return found ? found.v : 'custom';
}

const IC_MODEL_DEFAULT = { gemini:'gemini-2.5-flash-image', openai:'gpt-image-1', qwen:'wanx2.1-t2i-turbo', recraft:'recraftv4_1' };

const STAGES = [
  { id:'concept',   label:'Концепция' },
  { id:'world',     label:'Мир' },
  { id:'voice',     label:'Голос' },
  { id:'structure', label:'Структура' },
  { id:'write',     label:'Написание' },
  { id:'illustrations', label:'Иллюстрации' },
  { id:'edit',      label:'Редактура' },
  { id:'publish',   label:'Публикация' },
];

const els = {
  stages: document.getElementById('stages'),
  left: document.getElementById('panelLeft'),
  center: document.getElementById('panelCenter'),
  right: document.getElementById('panelRight'),
  projMeta: document.getElementById('projMeta'),
  projSpend: document.getElementById('projSpend'),
  body: document.getElementById('body'),
  modalRoot: document.getElementById('modalRoot'),
};

function stageDone(state, stageId){
  switch(stageId){
    case 'concept': return !!state.project.idea || !!state.project.title;
    case 'world':   return (state.bible||[]).some(b=>b.source==='world');
    case 'voice':   return (state.voice.examples||[]).length>0;
    case 'structure': return (state.structure||[]).some(n=>n.type==='scene');
    default: return false;
  }
}

function renderRail(){
  const s = getState();
  els.stages.innerHTML = '';
  const visibleStages = STAGES.filter(st=>{
    if(st.id==='voice') return !!s.project?.useVoice;
    return true;
  });
  visibleStages.forEach(st=>{
    const b = document.createElement('button');
    b.className = 'chip' + (s.ui.stage===st.id?' active':'') + (stageDone(s,st.id) && s.ui.stage!==st.id?' done':'');
    b.textContent = st.label;
    b.onclick = ()=>{ s.ui.stage = st.id; save(); };
    els.stages.appendChild(b);
  });
  const wc = (s.structure||[]).filter(n=>n.type==='scene').reduce((a,n)=>a+(n.words||0),0);
  els.projMeta.textContent = (s.project.title||'новый проект') + (wc?` · ${wc.toLocaleString('ru')} сл.`:'');
  // Суммарный расход на книгу — текст (все LLM-запросы) + картинки, см.
  // state.spend (llm.js/imagegen.js пишут туда после каждого успешного
  // вызова). Скрыт, пока расхода ещё нет (свежий проект) — не шумим "$0.000".
  const spend = s.spend || { text:0, images:0 };
  const totalSpend = spend.text + spend.images;
  if(els.projSpend){
    if(totalSpend > 0){
      els.projSpend.style.display = '';
      els.projSpend.textContent = `💰 $${totalSpend.toFixed(3)}`;
      els.projSpend.setAttribute('data-tip', `Текст: $${spend.text.toFixed(3)} · Картинки: $${spend.images.toFixed(3)}`);
    } else {
      els.projSpend.style.display = 'none';
    }
  }
}

function renderStage(){
  const s = getState();
  const stage = s.ui.stage;
  // сбрасываем классы панелей (split добавляют сами стадии)
  els.left.className='panel panel-left';
  els.right.className='panel panel-right';
  els.center.className='panel panel-center';
  if(stage==='concept'){ renderConcept(els); }
  else if(stage==='world'){ renderWorld(els); }
  else if(stage==='voice'){ renderVoice(els); }
  else if(stage==='structure'){ renderStructure(els); }
  else if(stage==='write'){ renderWrite(els); }
  else if(stage==='edit'){ renderEdit(els); }
  else if(stage==='illustrations'){ renderIllustrations(els); }
  else if(stage==='publish'){ renderPublish(els); }
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
    <div class="field">
      <span class="hint">нажмите чтобы открыть</span>
      <div id="projList" style="display:flex;flex-direction:column;gap:4px;max-height:200px;overflow-y:auto;margin-top:4px">
        ${projects.map(p=>`
          <button class="proj-item${p.id===curId?' proj-item-active':''}" data-pid="${escAttr(p.id)}">
            <span class="proj-item-title">${escAttr(p.title||'(без названия)')}</span>
            <span class="proj-item-date">${escAttr(fmtProjDate(p.updated))}</span>
            ${p.onServer?'<span class="proj-item-badge">☁</span>':''}
          </button>`).join('')}
      </div>
    </div>`;

  const keyRow = (id, value, placeholder, extraBtn)=>`
    <div class="row" style="gap:6px;align-items:stretch">
      <input type="password" id="${id}" value="${escAttr(value)}" placeholder="${placeholder||''}" style="flex:1">
      <button type="button" class="btn set-eye" data-for="${id}" title="Показать/скрыть ключ" style="padding:0 10px">👁</button>
      ${extraBtn||''}
    </div>`;

  els.modalRoot.innerHTML = `
    <div class="modal-bg" id="mbg">
      <div class="modal" style="max-height:88vh;overflow-y:auto" onclick="event.stopPropagation()">
        <h2>Настройки <span class="muted" style="font-size:12px;font-weight:400">· v${APP_VERSION}</span></h2>

        <div class="settings-section">Текст (проза)</div>
        <div class="field"><label>Провайдер <span class="hint">пресет URL+модели — поля ниже остаются свободными, можно поправить вручную</span></label>
          <select id="setProvider">
            ${TEXT_PROVIDERS.map(p=>`<option value="${p.v}"${matchTextProvider(g.baseURL)===p.v?' selected':''}>${escAttr(p.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>API-ключ <span class="hint">только в памяти, не сохраняется на диск</span></label>
          ${keyRow('setKey', g.apiKey, 'sk-...', '<button type="button" class="btn" id="setKeyTest" style="white-space:nowrap">Проверить</button>')}
        </div>
        <div class="row" style="gap:8px">
          <div class="field" style="flex:1;margin-bottom:0"><label>Базовый URL</label><input type="text" id="setUrl" value="${escAttr(g.baseURL)}"></div>
          <div class="field" style="flex:1;margin-bottom:0"><label>Модель</label><input type="text" id="setModel" value="${escAttr(g.model)}"></div>
        </div>
        <div class="field" style="margin-top:14px"><label>Бюджет контекста (токенов) <span class="hint">сколько токенов под память сцены; 32к = оптимум для большинства моделей, поднимайте выше для очень длинных серийных книг (70+ глав) на моделях с большим окном контекста</span></label>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="range" id="setBudgetRange" min="8000" max="150000" step="4000" value="${escAttr(g.budgetTokens??32000)}" style="flex:1" oninput="document.getElementById('setBudgetNum').value=this.value">
            <input type="number" id="setBudgetNum" value="${escAttr(g.budgetTokens??32000)}" min="8000" max="150000" step="4000" style="width:80px" oninput="document.getElementById('setBudgetRange').value=this.value">
          </div></div>

        <div class="settings-section">Иллюстрации</div>
        <div class="field"><span class="hint">свой ключ, отдельно от текстовой модели — тратит деньги за картинку</span></div>
        <div class="row" style="gap:8px">
          <select id="setIcProvider" style="flex:1">
            <option value="gemini"${(s.illustrations?.provider||'gemini')==='gemini'?' selected':''}>Google Gemini (Nano Banana)</option>
            <option value="openai"${s.illustrations?.provider==='openai'?' selected':''}>OpenAI (gpt-image-1)</option>
            <option value="qwen"${s.illustrations?.provider==='qwen'?' selected':''} title="Менее проверенная интеграция — асинхронный API DashScope">Qwen / DashScope (Wanxiang, менее проверено)</option>
            <option value="recraft"${s.illustrations?.provider==='recraft'?' selected':''}>Recraft V4.1</option>
          </select>
          <select id="setIcQuality" style="flex:1">
            <option value="standard"${(s.illustrations?.quality||'standard')==='standard'?' selected':''}>Стандарт</option>
            <option value="hd"${s.illustrations?.quality==='hd'?' selected':''}>HD (дороже)</option>
          </select>
        </div>
        <input type="text" id="setIcModel" list="setIcModelList" value="${escAttr(s.illustrations?.model||'')}"
          placeholder="Модель (пусто = ${IC_MODEL_DEFAULT[s.illustrations?.provider||'gemini']})" style="margin-top:6px">
        <datalist id="setIcModelList">${(MODEL_OPTIONS[s.illustrations?.provider||'gemini']||[]).map(m=>`<option value="${escAttr(m)}">`).join('')}</datalist>
        <div style="margin-top:6px">${keyRow('setIcKey', s.illustrations?.apiKey||'', 'Ключ провайдера картинок')}</div>

        <div class="settings-section">Мои книги</div>
        ${projListHtml || '<div class="hint">Пока только этот проект.</div>'}
        <div class="row" style="justify-content:space-between;margin-top:16px">
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
    s.illustrations = s.illustrations || {};
    s.illustrations.provider = document.getElementById('setIcProvider').value;
    s.illustrations.quality = document.getElementById('setIcQuality').value;
    s.illustrations.model = document.getElementById('setIcModel').value.trim();
    s.illustrations.apiKey = document.getElementById('setIcKey').value.trim();
    save(); close();
  };
  document.getElementById('setIcProvider').onchange = (ev)=>{
    const modelInp = document.getElementById('setIcModel');
    if(modelInp) modelInp.placeholder = 'Модель (пусто = '+IC_MODEL_DEFAULT[ev.target.value]+')';
    const list = document.getElementById('setIcModelList');
    if(list) list.innerHTML = (MODEL_OPTIONS[ev.target.value]||[]).map(m=>`<option value="${escAttr(m)}">`).join('');
  };
  document.getElementById('setProvider').onchange = (ev)=>{
    const p = TEXT_PROVIDERS.find(x=>x.v===ev.target.value);
    if(!p || p.v==='custom') return; // «Другой…» — не трогаем то, что уже введено
    document.getElementById('setUrl').value = p.baseURL;
    document.getElementById('setModel').value = p.model;
  };
  document.querySelectorAll('.set-eye').forEach(btn=>btn.onclick=()=>{
    const inp = document.getElementById(btn.dataset.for); if(!inp) return;
    const show = inp.type==='password';
    inp.type = show?'text':'password';
    btn.textContent = show?'🙈':'👁';
  });
  document.getElementById('setKeyTest').onclick = async ()=>{
    const btn = document.getElementById('setKeyTest');
    const key = document.getElementById('setKey').value.trim();
    const baseURL = document.getElementById('setUrl').value.trim();
    const model = document.getElementById('setModel').value.trim();
    if(!key){ alert('Сначала введите ключ.'); return; }
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = '…'; btn.style.color = '';
    try{
      await callLLM({ baseURL, apiKey:key, model, temperature:0, messages:[{role:'user',content:'ответь одним словом: привет'}], maxTokens:5, retries:0 });
      btn.textContent = '✓ работает'; btn.style.color = 'var(--ok)';
    }catch(e){
      btn.textContent = '✗ ошибка'; btn.style.color = 'var(--err)'; btn.title = e.message;
    }finally{
      btn.disabled = false;
      setTimeout(()=>{ if(document.body.contains(btn)){ btn.textContent = orig; btn.style.color=''; btn.title=''; } }, 4000);
    }
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
  const brand = document.querySelector('.brand');
  if(brand) brand.innerHTML = `Литсовет <span class="brand-ver">v${APP_VERSION}</span>`;
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
