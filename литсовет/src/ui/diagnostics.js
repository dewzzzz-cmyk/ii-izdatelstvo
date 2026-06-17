// Правая панель: диагностический режим — toggle агентов + трейс прогонов.

import { getState, save } from '../state.js';
import { getRuns, toggleAgent } from '../diagnostics.js';
import { RUBRIC_AXES } from '../agents.js';

function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

export function renderDiagnostics(){
  const s = getState();
  const agents = s.agents||[];
  const runs = getRuns();
  setTimeout(bindToggles, 0);
  return `
    <div class="ph">Агенты <span style="font-weight:400;text-transform:none;letter-spacing:0">диагностика</span></div>
    <div class="diag-section">
      ${agents.map(a=>`
        <div class="agent-toggle">
          <span style="font-size:15px">${a.icon}</span>
          <span class="at-name">${esc(a.name)} <span class="at-temp">${a.temp}</span></span>
          <div class="toggle ${a.enabled!==false?'on':''}" data-role="${a.role}"></div>
        </div>`).join('')}
    </div>
    <div class="ph">Прогоны</div>
    ${runs.length? runs.slice(0,5).map(renderRun).join('') : '<div class="empty-state">Прогонов ещё не было.</div>'}
  `;
}

function bindToggles(){
  document.querySelectorAll('.toggle[data-role]').forEach(t=>{
    t.onclick=()=>{ const role=t.dataset.role; const s=getState(); const a=s.agents.find(x=>x.role===role); toggleAgent(role, !(a.enabled!==false)); };
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
