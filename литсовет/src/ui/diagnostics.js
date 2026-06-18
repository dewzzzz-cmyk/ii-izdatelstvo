// Правая панель: диагностический режим — toggle агентов + трейс прогонов.

import { getState, save, addCustomAgent, removeAgent } from '../state.js';
import { getRuns, toggleAgent } from '../diagnostics.js';
import { RUBRIC_AXES } from '../agents.js';
import { runAgentOnDemand } from '../ondemand.js';

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
    ${a.desc?`<div class="ap-desc">${esc(a.desc)}</div>`:''}
    ${a.custom?`<div class="ap-row"><span class="ap-label">Что проверять (промпт)</span>
      <textarea class="ap-prompt" data-aid="${a.id}" rows="2" placeholder="напр.: проверь, что даты и возраст персонажей не противоречат друг другу">${esc(a.prompt||'')}</textarea></div>`:''}
    ${specs.map(sp=>{
      const cur = sp.target==='agent' ? (a[sp.key]??sp.def) : (global[sp.key]??sp.def);
      return `<div class="ap-row">
        <div class="ap-head"><span class="ap-label">${sp.label}</span><span class="ap-val" data-valfor="${a.id}-${sp.key}">${sp.fmt(cur)}</span></div>
        <input type="range" class="ap-slider" min="${sp.min}" max="${sp.max}" step="${sp.step}" value="${cur}"
          data-aid="${a.id}" data-key="${sp.key}" data-target="${sp.target}">
        <div class="ap-hint">${sp.hint}</div>
      </div>`;
    }).join('')}
    ${a.custom?`<button class="btn ag-remove" data-aid="${a.id}" style="font-size:11px;color:var(--err)">🗑 Удалить стража</button>`:''}
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
          <span class="flag-role">${GUARD_LABELS[f.role] || (getState().agents.find(a=>a.id===f.role)?.name) || f.role}</span></div>
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

// Пайплайн агентов (тумблеры + настройки + бейджи + DnD) + прогоны.
const PARALLEL_ROLES = new Set(['voiceguard','logic','events','custom']);
export function renderAgentPipeline(){
  const s = getState();
  const agents = s.agents||[];
  const runs = getRuns();
  setTimeout(bindAgents, 0);
  let prevPar = false;
  const rows = agents.map((a,i)=>{
    const isPar = PARALLEL_ROLES.has(a.role) && a.enabled!==false;
    const sep = (isPar && !prevPar) ? '<div class="par-sep" data-tip="Эти агенты-стражи работают одновременно (параллельно) — быстрее и независимо друг от друга.">∥ параллельный шаг</div>' : '';
    prevPar = isPar;
    const badges =
      (a.role==='prose'&&a.loop?'<span class="ag-badge loop" data-tip="Петля с Оценщиком: Прозаик дорабатывает черновик, пока Оценщик не примет (до макс. итераций).">↻</span>':'') +
      (isPar?'<span class="ag-badge par" data-tip="Идёт параллельно с другими стражами.">∥</span>':'') +
      (a.manual?'<span class="ag-badge man" data-tip="Ручной режим: пауза после агента, вы подтверждаете каждый шаг.">✋</span>':'');
    return `${sep}
      <div class="agent-toggle ${isPar?'is-par':''}" data-open="${a.id}" draggable="true" data-drag="${a.id}" data-tip="${esc(a.desc||'')}">
        <span class="ag-grip" title="перетащить">⋮⋮</span>
        <span style="font-size:15px">${a.icon}</span>
        <span class="at-name">${esc(a.name)} ${badges}<span class="at-temp">${_openAgents.has(a.id)?'▾':'⚙'}</span></span>
        ${a.role!=='prose'?`<button class="ag-run" data-runid="${a.id}" data-tip="Запустить «${esc(a.name)}» вручную на текущей сцене и получить разбор: замечания и предложения правок. Текст не меняется (кроме применения правки Линейного редактора).">▶</button>`:''}
        <div class="toggle ${a.enabled!==false?'on':''}" data-role="${a.role}" data-id="${a.id}"></div>
      </div>
      ${_openAgents.has(a.id)?renderAgentParams(a, s.global):''}`;
  }).join('');
  return `
    <div class="diag-section" id="agentRows">${rows}</div>
    <button class="btn btn-block" id="addAgentBtn" style="margin:6px 12px;width:calc(100% - 24px)" data-tip="Добавить своего стража: он проверит сцену по вашему описанию и поставит флаги. Не меняет текст.">+ Добавить стража</button>
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

// Полная привязка панели агентов: тумблеры, раскрытие, ползунки, режим,
// добавление/удаление, drag-and-drop, промпт кастомного агента.
function bindAgents(){
  bindToggles();
  // тумблер вкл/выкл по id (включая кастомных)
  document.querySelectorAll('.toggle[data-id]').forEach(t=>{
    t.onclick=(e)=>{ e.stopPropagation(); const s=getState(); const a=s.agents.find(x=>x.id===t.dataset.id); if(a){ a.enabled=!(a.enabled!==false); save(); } };
  });
  // промпт кастомного агента
  document.querySelectorAll('.ap-prompt').forEach(t=>t.addEventListener('change',()=>{ const s=getState(); const a=s.agents.find(x=>x.id===t.dataset.aid); if(a){ a.prompt=t.value; save(); } }));
  // удалить кастомного агента
  document.querySelectorAll('.ag-remove').forEach(b=>b.onclick=(e)=>{ e.stopPropagation(); const s=getState(); if(removeAgent(s, b.dataset.aid)){ _openAgents.delete(b.dataset.aid); save(); } });
  // ручной запуск агента на текущей сцене → разбор с замечаниями
  document.querySelectorAll('.ag-run').forEach(b=>b.onclick=async(e)=>{
    e.stopPropagation();
    const s=getState(); const a=s.agents.find(x=>x.id===b.dataset.runid); if(!a) return;
    const scene=(s.structure||[]).find(n=>n.id===s.ui.activeScene);
    if(!scene){ alert('Откройте сцену.'); return; }
    const prev=b.textContent; b.textContent='…'; b.disabled=true;
    try{ openAgentResult(a, await runAgentOnDemand(s, scene, a), scene); }
    catch(err){ alert('Не удалось: '+err.message); }
    finally{ b.textContent=prev; b.disabled=false; }
  });
  // добавить стража
  const add=document.getElementById('addAgentBtn');
  if(add) add.onclick=()=>{
    const name=prompt('Название стража (напр.: «Страж дат»):'); if(name===null) return;
    const p=prompt('Что он должен проверять? (напр.: даты и возраст персонажей не противоречат)'); if(p===null) return;
    const s=getState(); const a=addCustomAgent(s, name.trim()||'Свой страж', p.trim()); _openAgents.add(a.id); save();
  };
  // drag-and-drop перестановка
  let dragId=null;
  document.querySelectorAll('.agent-toggle[data-drag]').forEach(row=>{
    row.addEventListener('dragstart',()=>{ dragId=row.dataset.drag; row.classList.add('dragging'); });
    row.addEventListener('dragend',()=>{ row.classList.remove('dragging'); document.querySelectorAll('.drag-over').forEach(x=>x.classList.remove('drag-over')); });
    row.addEventListener('dragover',e=>{ e.preventDefault(); row.classList.add('drag-over'); });
    row.addEventListener('dragleave',()=>row.classList.remove('drag-over'));
    row.addEventListener('drop',e=>{ e.preventDefault(); row.classList.remove('drag-over');
      const overId=row.dataset.drag; if(!dragId||dragId===overId) return;
      const s=getState(); const arr=s.agents; const from=arr.findIndex(a=>a.id===dragId); const to=arr.findIndex(a=>a.id===overId);
      if(from<0||to<0) return; const item=arr.splice(from,1)[0]; arr.splice(to,0,item); save();
    });
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

// ── Разбор ручного запуска агента (модалка) ──────────────────────────────
// Кладёт замечание в поле директивы Прозаику (если оно есть на экране).
function toDirective(text){
  const inp=document.getElementById('directive');
  if(!inp) return false;
  inp.value=text; inp.focus(); inp.scrollIntoView({block:'center'});
  const re=document.getElementById('reRun'); if(re) re.classList.add('btn-primary');
  return true;
}

function renderResultBody(r){
  if(r.kind==='evaluator'){
    const v=r.verdict;
    if(!v||!v.ok) return `<div class="muted">Оценщик не вернул разбор.</div>`;
    const axes=RUBRIC_AXES.map(a=>{ const val=v.scores[a.key]; const col=val>=7?'var(--ok)':val>=5?'var(--warn)':'var(--err)';
      return `<div class="ares-axis"><span>${a.label}</span><b style="color:${col}">${val}</b></div>`; }).join('');
    const cl=(v.cliches||[]).length?`<div class="ares-h">Клише в тексте</div>${v.cliches.map(c=>`<div class="ares-cl">«${esc(c)}»</div>`).join('')}`:'';
    const nt=(v.notes||[]).length?`<div class="ares-h">Замечания и что исправить</div>${v.notes.map(n=>`<div class="ares-note"><span>${esc(n)}</span><button class="ares-todir" data-dir="${esc(n)}">→ Прозаику</button></div>`).join('')}`:'';
    const all=((v.notes||[]).length||(v.cliches||[]).length)
      ? `<button class="btn btn-primary ares-all" style="margin-top:12px;width:100%">Все замечания → переписать сцену</button>`
      : `<div class="muted" style="margin-top:8px">Серьёзных замечаний нет — можно принимать.</div>`;
    return `<div class="ares-score ${v.pass?'pass':'revise'}">${v.weighted}/10 · ${v.pass?'принято':'на доработку'}<span class="muted"> · мин. ось ${v.minAxis}</span></div>
      <div class="ares-axes">${axes}</div>${cl}${nt}${all}`;
  }
  if(r.kind==='guard'){
    const flags=(r.flags||[]).filter(Boolean);
    if(!flags.length) return `<div class="muted">Страж не нашёл проблем — флагов нет.</div>`;
    return flags.map(f=>`<div class="ares-flag">
      <div class="ares-flag-head"><span class="flag-sev sev-${f.severity}">${f.severity==='critical'?'критич':f.severity==='warning'?'предупр':'норма'}</span> ${esc(f.title)}</div>
      ${f.detail?`<div class="ares-flag-d">${esc(f.detail)}</div>`:''}
      ${f.quote?`<div class="flag-quote">${esc(f.quote)}</div>`:''}
      ${f.severity!=='ok'?`<button class="ares-todir" data-dir="${esc(f.title+': '+(f.detail||''))}">→ Прозаику</button>`:''}
    </div>`).join('');
  }
  if(r.kind==='lineedit'){
    if(!r.text) return `<div class="muted">Правок не предложено.</div>`;
    return `<div class="ares-h">Предложенная правка</div>
      <div class="ares-edit">${esc(r.text)}</div>
      <div class="row" style="gap:8px;margin-top:10px;align-items:center">
        <button class="btn btn-primary ares-apply">Применить правку</button>
        <span class="muted" style="font-size:11px">прошлый вариант вернёте кнопкой ↶</span></div>`;
  }
  if(r.kind==='architect'){
    const p=r.plan; if(!p) return `<div class="muted">План не получен.</div>`;
    const dir='Учти план сцены: '+[...(p.anchors||[]),...(p.beats||[])].filter(Boolean).join('; ');
    return `${p.anchors.length?`<div class="ares-h">Якоря</div><div class="ares-list">${esc(p.anchors.join('; '))}</div>`:''}
      ${p.beats.length?`<div class="ares-h">Шаги сцены</div><div class="ares-list">${esc(p.beats.join(' → '))}</div>`:''}
      ${p.forbiddenWords.length?`<div class="ares-h">Избегать слов</div><div class="ares-list">${esc(p.forbiddenWords.join(', '))}</div>`:''}
      <button class="btn btn-primary ares-todir" data-dir="${esc(dir)}" style="margin-top:12px;width:100%">План → Прозаику</button>`;
  }
  return `<div class="muted">Готово.</div>`;
}

function openAgentResult(agent, result, scene){
  const root=document.getElementById('modalRoot'); if(!root) return;
  root.innerHTML=`<div class="modal-bg" id="aresBg"><div class="modal ares" style="width:600px;max-width:94vw" onclick="event.stopPropagation()">
    <h2>${agent.icon||''} ${esc(agent.name)} · разбор сцены</h2>
    <div class="ares-body">${renderResultBody(result)}</div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" id="aresClose">Закрыть</button></div>
  </div></div>`;
  const close=()=>root.innerHTML='';
  document.getElementById('aresBg').onclick=close;
  document.getElementById('aresClose').onclick=close;
  document.querySelectorAll('.ares-todir').forEach(b=>b.onclick=()=>{
    if(toDirective(b.dataset.dir)) close(); else alert('Откройте сцену в редакторе, чтобы передать замечание Прозаику.\n\n'+b.dataset.dir);
  });
  const all=document.querySelector('.ares-all');
  if(all) all.onclick=()=>{ const v=result.verdict;
    const parts=[...(v.notes||[]), ...((v.cliches||[]).length?['убрать клише: '+v.cliches.join(', ')]:[])];
    if(toDirective(parts.join('; '))) close(); else alert('Откройте сцену в редакторе.');
  };
  const apply=document.querySelector('.ares-apply');
  if(apply) apply.onclick=()=>{
    const s=getState(); const sc=(s.structure||[]).find(n=>n.id===scene.id); if(!sc) return;
    sc.proseVersions=sc.proseVersions||[]; sc.proseVersions.unshift(sc.text);
    if(sc.proseVersions.length>10) sc.proseVersions.length=10;
    sc.text=result.text; sc.words=(result.text.match(/\S+/g)||[]).length; save(); close();
  };
}
