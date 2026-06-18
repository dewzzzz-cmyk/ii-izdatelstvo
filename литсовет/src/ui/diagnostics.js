// Правая панель: диагностический режим — toggle агентов + трейс прогонов.

import { getState, save } from '../state.js';
import { getRuns, toggleAgent } from '../diagnostics.js';
import { RUBRIC_AXES } from '../agents.js';

function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

const GUARD_LABELS = { voiceguard:'Страж голоса', logic:'Страж логики', events:'Страж событий' };
const _openAgents = new Set();

// Параметры агента (реально влияют на прогон). target:'agent' пишет в агента, 'global' — в state.global.
function paramSpecs(a){
  const specs = [
    { key:'temp', label:'Температура', hint:'выше — креативнее, ниже — стабильнее', min:0, max:1, step:0.05, target:'agent', def:0.5, fmt:v=>v.toFixed(2) },
    { key:'maxTokens', label:'Макс. токенов', hint:'потолок длины ответа', min:200, max:2400, step:100, target:'agent', def:700, fmt:v=>Math.round(v) },
  ];
  if(a.role==='evaluator'){
    specs.push({ key:'evaluatorThreshold', label:'Порог принятия', hint:'выше — строже петля', min:5, max:9, step:0.5, target:'global', def:7, fmt:v=>v.toFixed(1) });
    specs.push({ key:'evaluatorMaxIter', label:'Макс. итераций', hint:'сколько раз дорабатывать', min:1, max:5, step:1, target:'global', def:3, fmt:v=>Math.round(v) });
  }
  if(['voiceguard','logic','events'].includes(a.role)){
    specs.push({ key:'strictness', label:'Строгость', hint:'1 мягко · 3 придирчиво', min:1, max:3, step:1, target:'agent', def:2, fmt:v=>['','мягко','обычно','строго'][Math.round(v)]||v });
  }
  if(a.role==='prose'){
    specs.push({ key:'retries', label:'Повторов при сбое', hint:'устойчивость к ошибкам сети', min:0, max:4, step:1, target:'global', def:2, fmt:v=>Math.round(v) });
  }
  return specs;
}

function renderAgentParams(a, global){
  const specs = paramSpecs(a);
  return `<div class="agent-params">
    <div class="ap-mode">
      <span class="ap-label">Режим</span>
      <div class="mode-mini">
        <button class="mm-btn ${!a.manual?'on':''}" data-mode="auto" data-aid="${a.id}">Авто</button>
        <button class="mm-btn ${a.manual?'on':''}" data-mode="manual" data-aid="${a.id}">Ручной</button>
      </div>
    </div>
    <div class="ap-hint" style="margin:-4px 0 8px">${a.manual?'пауза после агента — вы подтверждаете каждый шаг':'агент работает без остановок'}</div>
    ${specs.map(sp=>{
      const cur = sp.target==='agent' ? (a[sp.key]??sp.def) : (global[sp.key]??sp.def);
      return `<div class="ap-row">
        <div class="ap-head"><span class="ap-label">${sp.label}</span><span class="ap-val" data-valfor="${a.id}-${sp.key}">${sp.fmt(cur)}</span></div>
        <input type="range" class="ap-slider" min="${sp.min}" max="${sp.max}" step="${sp.step}" value="${cur}"
          data-aid="${a.id}" data-key="${sp.key}" data-target="${sp.target}">
        <div class="ap-hint">${sp.hint}</div>
      </div>`;
    }).join('')}
  </div>`;
}
const SEV_RANK = { critical:0, warning:1, ok:2 };

function renderFlags(scene){
  if(!scene || !scene.flags) return '';
  const all = [];
  Object.entries(scene.flags).forEach(([role,arr])=>{ (arr||[]).forEach(f=>all.push({...f, role})); });
  if(!all.length) return '';
  all.sort((a,b)=>(SEV_RANK[a.severity]??1)-(SEV_RANK[b.severity]??1));
  const crit = all.filter(f=>f.severity==='critical').length;
  const warn = all.filter(f=>f.severity==='warning').length;
  return `<div class="ph">Флаги сцены <span style="font-weight:400;text-transform:none;letter-spacing:0">${crit?crit+' критич':''}${crit&&warn?', ':''}${warn?warn+' предупр':''}${!crit&&!warn?'норма':''}</span></div>
    <div class="flags-list">
      ${all.map(f=>`<div class="flag-item">
        <div class="flag-head"><span class="flag-sev sev-${f.severity}">${f.severity==='critical'?'критич':f.severity==='warning'?'предупр':'норма'}</span>
          <span class="flag-role">${GUARD_LABELS[f.role]||f.role}</span></div>
        <div class="flag-title">${esc(f.title)}</div>
        ${f.detail?`<div class="flag-detail">${esc(f.detail)}</div>`:''}
        ${f.quote?`<div class="flag-quote">${esc(f.quote)}</div>`:''}
        ${f.severity!=='ok'?`<button class="flag-fix" data-fix="${esc(f.title+': '+f.detail)}">→ Прозаику</button>`:''}
      </div>`).join('')}
    </div>`;
}

function bindFlagFix(){
  document.querySelectorAll('.flag-fix').forEach(b=>b.onclick=()=>{
    const inp=document.getElementById('directive');
    if(inp){ inp.value=b.dataset.fix; inp.focus(); inp.scrollIntoView({block:'center'});
      const re=document.getElementById('reRun'); if(re){ re.classList.add('btn-primary'); }
    }
  });
}

// Анализ сцены (правая панель, верх): флаги Стражей.
export function renderSceneAnalysis(){
  const s = getState();
  const activeScene = (s.structure||[]).find(n=>n.id===s.ui.activeScene);
  setTimeout(bindFlagFix, 0);
  return renderFlags(activeScene) || `<div class="ph">Анализ сцены</div><div class="empty-state">Флаги Стражей появятся после прогона.</div>`;
}

// Пайплайн агентов (тумблеры + настройки) + прогоны.
export function renderAgentPipeline(){
  const s = getState();
  const agents = s.agents||[];
  const runs = getRuns();
  setTimeout(bindToggles, 0);
  return `
    <div class="diag-section">
      ${agents.map(a=>`
        <div class="agent-toggle" data-open="${a.id}">
          <span style="font-size:15px">${a.icon}</span>
          <span class="at-name">${esc(a.name)} <span class="at-temp">${_openAgents.has(a.id)?'▾':'⚙'}</span></span>
          <div class="toggle ${a.enabled!==false?'on':''}" data-role="${a.role}"></div>
        </div>
        ${_openAgents.has(a.id)?renderAgentParams(a, s.global):''}`).join('')}
    </div>
    <div class="ph">Прогоны</div>
    ${runs.length? runs.slice(0,4).map(renderRun).join('') : '<div class="empty-state">Прогонов ещё не было.</div>'}
  `;
}

export function renderDiagnostics(){ return renderSceneAnalysis() + renderAgentPipeline(); }

function rerenderDiag(){
  const host=document.getElementById('agentHost'); if(host){ host.innerHTML=renderAgentPipeline(); return; }
  const body=document.getElementById('rtabBody'); if(body) body.innerHTML=renderDiagnostics();
}

function bindToggles(){
  document.querySelectorAll('.toggle[data-role]').forEach(t=>{
    t.onclick=(e)=>{ e.stopPropagation(); const role=t.dataset.role; const s=getState(); const a=s.agents.find(x=>x.role===role); toggleAgent(role, !(a.enabled!==false)); };
  });
  // клик по строке агента (не по тумблеру) — раскрыть/свернуть настройки
  document.querySelectorAll('.agent-toggle[data-open]').forEach(row=>{
    row.onclick=(e)=>{ if(e.target.closest('.toggle')) return; const id=row.dataset.open; if(_openAgents.has(id))_openAgents.delete(id); else _openAgents.add(id); rerenderDiag(); };
  });
  // ползунки параметров — живо обновляем значение, сохраняем по отпусканию
  document.querySelectorAll('.mm-btn').forEach(b=>b.onclick=(e)=>{
    e.stopPropagation();
    const s=getState(); const a=s.agents.find(x=>x.id===b.dataset.aid);
    if(a){ a.manual = b.dataset.mode==='manual'; save(); }
  });
  document.querySelectorAll('.ap-slider').forEach(sl=>{
    const s=getState(); const a=s.agents.find(x=>x.id===sl.dataset.aid); if(!a) return;
    const spec=paramSpecs(a).find(x=>x.key===sl.dataset.key);
    const apply=(v)=>{
      let val=parseFloat(v); if(spec.step>=1) val=Math.round(val);
      if(sl.dataset.target==='agent') a[sl.dataset.key]=val; else s.global[sl.dataset.key]=val;
      const lbl=document.querySelector(`[data-valfor="${a.id}-${sl.dataset.key}"]`); if(lbl) lbl.textContent=spec.fmt(val);
    };
    sl.addEventListener('input',()=>apply(sl.value));
    sl.addEventListener('change',()=>{ apply(sl.value); save(); });
  });
  document.querySelectorAll('.run-card .rc-head').forEach(h=>{
    h.onclick=()=>{ const b=h.nextElementSibling; if(b) b.style.display = b.style.display==='none'?'block':'none'; };
  });
}

function renderRun(run){
  const cost = run.totalCost? '$'+run.totalCost.toFixed(3) : '';
  const evalStep = (run.steps||[]).filter(st=>st.agent==='evaluator').slice(-1)[0];
  return `<div class="run-card">
    <div class="rc-head">
      <span class="rc-title">${esc(run.label||'прогон')}</span>
      <span class="muted">${run.status==='error'?'⚠ ':''}${cost}</span>
    </div>
    <div style="display:none">
      ${(run.steps||[]).map(renderStep).join('')}
      ${evalStep && evalStep.verdict && evalStep.verdict.ok ? renderScores(evalStep.verdict) : ''}
    </div>
  </div>`;
}

function renderStep(st){
  if(st.agent==='error') return `<div class="run-step" style="border-color:var(--err-border)"><b>ошибка:</b> ${esc(st.output)}</div>`;
  const layers = st.layers? ' · слои: '+st.layers.map(l=>`${l.name}(${l.tokens})`).join(', ') : '';
  const it = st.iter? ` #${st.iter}`:'';
  return `<div class="run-step"><b>${esc(st.agent)}${it}</b> · ${(st.tokensIn||0)+(st.tokensOut||0)} ток.${layers}</div>`;
}

function renderScores(v){
  return `<div class="score-bars">
    ${RUBRIC_AXES.map(a=>{
      const val=Number(v.scores[a.key])||0;
      const col = val>=7?'var(--ok)':val>=5?'var(--warn)':'var(--err)';
      return `<div class="score-row"><span class="sl">${a.label}</span><span class="score-bar"><span class="score-fill" style="width:${val*10}%;background:${col}"></span></span><span class="score-val">${val}</span></div>`;
    }).join('')}
    <div class="verdict ${v.pass?'pass':'revise'}">${v.pass?'✓ принято':'↻ доработка'} · ${v.weighted}/10</div>
  </div>`;
}
