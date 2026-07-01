// Правая панель: диагностический режим — toggle агентов + трейс прогонов.

import { getState, save, addCustomAgent, removeAgent, addRule } from '../state.js';
import { getRuns, toggleAgent } from '../diagnostics.js';
import { RUBRIC_AXES } from '../agents.js';
import { runAgentOnDemand, patchScene, askSceneQuestion } from '../ondemand.js';

function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
// Нормализует прозаический текст для HTML: одиночный \n внутри абзаца → пробел, двойной \n\n → <br><br>
function escProse(s){
  const norm = String(s==null?'':s)
    .replace(/\r\n/g,'\n')
    .replace(/([^\n])\n([^\n])/g,'$1 $2')  // одиночный перенос внутри абзаца → пробел
    .replace(/([^\n])\n([^\n])/g,'$1 $2');  // второй проход для смежных
  return norm.split('\n\n').map(p=>esc(p.trim())).filter(Boolean).join('<br><br>');
}

const GUARD_LABELS = { voiceguard:'Страж голоса', logic:'Страж логики', events:'Страж событий', styleguard:'Страж стиля' };
const _openAgents = new Set();

// Параметры агента (реально влияют на прогон). target:'agent' пишет в агента, 'global' — в state.global.
function paramSpecs(a){
  const specs = [
    { key:'temp', label:'Температура', hint:'выше — креативнее, ниже — стабильнее', min:0, max:1, step:0.05, target:'agent', def:0.5, fmt:v=>v.toFixed(2) },
    { key:'maxTokens', label:'Макс. токенов', hint:'потолок длины ответа — Прозаику нужно ≥2400 для 700-слов. сцены', min:200, max:4000, step:100, target:'agent', def:700, fmt:v=>Math.round(v) },
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
  const fixable = all.filter(f=>f.severity!=='ok').length;
  return `<div class="ph">Флаги сцены <span style="font-weight:400;text-transform:none;letter-spacing:0">${crit?crit+' критич':''}${crit&&warn?', ':''}${warn?warn+' предупр':''}${!crit&&!warn?'норма':''}</span></div>
    ${fixable>1?`<div class="flags-toolbar" id="flagsToolbar">
      <label class="fl-selall"><input type="checkbox" id="flagSelAll"> Выбрать все (${fixable})</label>
      <span id="flagSelCount" class="muted" style="font-size:12px"></span>
      <button class="btn" id="flagMultiFix" style="display:none" data-tip="Точечная правка сразу по всем выбранным замечаниям">→ Прозаику</button>
      <button class="btn" id="flagMultiRewrite" style="display:none" data-tip="Переписать сцену с учётом всех выбранных замечаний">↺ Переписать все</button>
    </div>`:''}
    <div class="flags-list" id="flagsList">
      ${all.map((f,i)=>`<div class="flag-item${f.severity!=='ok'?' flag-selectable':''}" data-fi="${i}">
        ${f.severity!=='ok'?`<label class="flag-cb-wrap" onclick="event.stopPropagation()"><input type="checkbox" class="flag-cb" data-fix="${esc(f.title+': '+f.detail)}" data-fi="${i}"></label>`:''}
        <div class="flag-head"><span class="flag-sev sev-${f.severity}">${f.severity==='critical'?'критич':f.severity==='warning'?'предупр':'норма'}</span>
          <span class="flag-role">${GUARD_LABELS[f.role] || (getState().agents.find(a=>a.id===f.role)?.name) || f.role}</span></div>
        <div class="flag-title">${esc(f.title)}</div>
        ${f.detail?`<div class="flag-detail">${esc(f.detail)}</div>`:''}
        ${f.quote?`<div class="flag-quote">${esc(f.quote)}</div>`:''}
        ${f.severity!=='ok'?`<div class="flag-acts">
          <button class="flag-fix" data-fix="${esc(f.title+': '+f.detail)}" data-tip="Точечная правка: Прозаик меняет только нужные фразы, остальное сохраняет">→ Прозаику</button>
          <button class="flag-rewrite" data-fix="${esc(f.title+': '+f.detail)}" data-tip="Полная перезапись сцены с учётом этого замечания">↺ Переписать</button>
        </div>`:''}
      </div>`).join('')}
    </div>`;
}

function bindFlagFix(){
  // individual → Прозаику
  document.querySelectorAll('.flag-fix').forEach(b=>b.onclick=()=>{
    if(!getState().global.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
    b.textContent='⏳ Запускаю…'; b.disabled=true;
    document.dispatchEvent(new CustomEvent('litsovet:flag-fix', {detail:{directive:b.dataset.fix}}));
  });
  // individual ↺ Переписать (2-click confirmation)
  document.querySelectorAll('.flag-rewrite').forEach(b=>b.onclick=()=>{
    if(b.dataset.confirmed==='1'){
      if(!getState().global.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
      b.textContent='⏳ Запускаю…'; b.disabled=true;
      document.dispatchEvent(new CustomEvent('litsovet:flag-fix', {detail:{directive:b.dataset.fix, rewrite:true}}));
      return;
    }
    const orig=b.textContent;
    b.dataset.confirmed='1'; b.textContent='Нажми ещё раз — точно?';
    b.style.cssText='background:var(--accent);color:#fff;font-weight:600;border-color:var(--accent)';
    setTimeout(()=>{ if(b.dataset.confirmed==='1'){ delete b.dataset.confirmed; b.textContent=orig; b.style.cssText=''; } }, 3000);
  });

  // multi-select: click anywhere on flag-item (except buttons/checkbox) toggles checkbox
  document.querySelectorAll('.flag-selectable').forEach(item=>{
    item.addEventListener('click', e=>{
      if(e.target.closest('button')||e.target.closest('.flag-cb-wrap')) return;
      const cb=item.querySelector('.flag-cb'); if(!cb) return;
      cb.checked=!cb.checked; cb.dispatchEvent(new Event('change',{bubbles:true}));
    });
  });

  function updateMultiBar(){
    const cbs=[...document.querySelectorAll('.flag-cb')];
    const checked=cbs.filter(c=>c.checked);
    const n=checked.length;
    const fixBtn=document.getElementById('flagMultiFix');
    const rwBtn=document.getElementById('flagMultiRewrite');
    const countEl=document.getElementById('flagSelCount');
    if(!fixBtn) return;
    if(n>0){
      countEl.textContent=`${n} выбрано`;
      fixBtn.style.display=''; fixBtn.textContent=`→ Прозаику (${n})`;
      rwBtn.style.display=''; rwBtn.textContent=`↺ Переписать выбранные (${n})`;
    } else {
      countEl.textContent='';
      fixBtn.style.display='none';
      rwBtn.style.display='none';
    }
    // sync select-all checkbox state
    const selAll=document.getElementById('flagSelAll');
    if(selAll){ selAll.checked=n===cbs.length && n>0; selAll.indeterminate=n>0&&n<cbs.length; }
  }

  document.querySelectorAll('.flag-cb').forEach(cb=>cb.addEventListener('change', ()=>{
    cb.closest('.flag-selectable')?.classList.toggle('flag-selected', cb.checked);
    updateMultiBar();
  }));

  const selAll=document.getElementById('flagSelAll');
  if(selAll) selAll.onchange=()=>{
    document.querySelectorAll('.flag-cb').forEach(cb=>{
      cb.checked=selAll.checked;
      cb.closest('.flag-selectable')?.classList.toggle('flag-selected', selAll.checked);
    });
    updateMultiBar();
  };

  function combinedDirective(){
    const checks=[...document.querySelectorAll('.flag-cb:checked')];
    if(!checks.length) return null;
    return checks.map((c,i)=>`${i+1}. ${c.dataset.fix}`).join('\n');
  }

  const fixBtn=document.getElementById('flagMultiFix');
  if(fixBtn) fixBtn.onclick=()=>{
    const d=combinedDirective(); if(!d) return;
    if(!getState().global.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
    fixBtn.textContent='⏳ Запускаю…'; fixBtn.disabled=true;
    document.dispatchEvent(new CustomEvent('litsovet:flag-fix', {detail:{directive:d}}));
  };

  const rwBtn=document.getElementById('flagMultiRewrite');
  if(rwBtn) rwBtn.onclick=()=>{
    if(rwBtn.dataset.confirmed==='1'){
      const d=combinedDirective(); if(!d) return;
      if(!getState().global.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
      rwBtn.textContent='⏳ Запускаю…'; rwBtn.disabled=true;
      document.dispatchEvent(new CustomEvent('litsovet:flag-fix', {detail:{directive:d, rewrite:true}}));
      return;
    }
    const orig=rwBtn.textContent;
    rwBtn.dataset.confirmed='1'; rwBtn.textContent='Нажми ещё раз — точно?';
    rwBtn.style.cssText='background:var(--accent);color:#fff;font-weight:600;border-color:var(--accent)';
    setTimeout(()=>{ if(rwBtn.dataset.confirmed==='1'){ delete rwBtn.dataset.confirmed; rwBtn.textContent=orig; rwBtn.style.cssText=''; } }, 3000);
  };
}

// Анализ сцены (правая панель, верх): строка вопроса + флаги Стражей.
export function renderSceneAnalysis(){
  const s = getState();
  const activeScene = (s.structure||[]).find(n=>n.id===s.ui.activeScene);
  setTimeout(()=>{ bindFlagFix(); bindAskScene(activeScene); }, 0);
  const ask = `<div class="ask-scene">
    <input type="text" id="askInput" placeholder="Спросить о сцене: «где показано, что его заметили?»" data-tip="Разовый вопрос стражу о текущей сцене. Он ответит по тексту (с цитатой) и предложит правку — без создания агента.">
    <button class="btn" id="askBtn">Спросить</button>
  </div>`;
  return ask + (renderFlags(activeScene) || `<div class="ph">Анализ сцены</div><div class="empty-state">Задайте вопрос о сцене выше или запустите агентов — флаги появятся здесь.</div>`);
}

function bindAskScene(scene){
  const btn=document.getElementById('askBtn'), inp=document.getElementById('askInput');
  if(!btn) return;
  const go=async ()=>{
    const q=inp.value.trim(); if(!q) return;
    const s=getState();
    const sc=scene || (s.structure||[]).find(n=>n.id===s.ui.activeScene);
    if(!sc){ alert('Откройте сцену.'); return; }
    btn.disabled=true; const lbl=btn.textContent; btn.innerHTML='<span class="spinner"></span>';
    try{ const res=await askSceneQuestion(s, sc, q); openAgentResult({icon:'❓', name:'Вопрос: '+q.slice(0,48)}, res, sc); }
    catch(e){ alert('Не удалось: '+e.message); }
    finally{ btn.disabled=false; btn.textContent=lbl; }
  };
  btn.onclick=go;
  inp.onkeydown=(e)=>{ if(e.key==='Enter'){ e.preventDefault(); go(); } };
}

const GUARD_PRESETS = [
  // Факты и логика
  { cat:'Факты',       name:'Страж дат',        prompt:'Проверь хронологию: даты, возраст персонажей и временны́е промежутки между событиями не противоречат друг другу и предыдущим сценам.' },
  { cat:'Факты',       name:'Страж места',       prompt:'Проверь описания локаций: расположение предметов, размеры помещений и маршруты персонажей не должны противоречить предыдущим сценам.' },
  { cat:'Факты',       name:'Страж знаний',      prompt:'Проверь, что персонажи не знают и не упоминают информацию, которую они ещё не могли получить по ходу сюжета.' },
  { cat:'Факты',       name:'Страж физики',      prompt:'Проверь что физические действия реалистичны: усилие, скорость, расстояния, вес предметов соответствуют возможностям персонажа и законам мира.' },
  { cat:'Факты',       name:'Страж погоды',      prompt:'Проверь что время суток, освещение и погода согласованы внутри сцены и не противоречат предыдущим сценам того же дня.' },
  // Персонажи
  { cat:'Персонажи',   name:'Страж имён',        prompt:'Проверь единообразие имён: написание, форма обращения и прозвища персонажей совпадают с библией и предыдущими сценами.' },
  { cat:'Персонажи',   name:'Страж характеров',  prompt:'Проверь что поведение, реакции и решения персонажей соответствуют их характеристикам, мотивации и истории из библии.' },
  { cat:'Персонажи',   name:'Страж отношений',   prompt:'Проверь что отношения между персонажами (доверие, вражда, симпатия, иерархия) согласованы с предыдущими сценами и не противоречат установленному.' },
  // Язык и стиль
  { cat:'Стиль',       name:'Страж повторов',     prompt:'Отметь слова, фразы и образы, которые встречаются больше двух раз в пределах этой сцены и создают ощущение однообразия.' },
  { cat:'Стиль',       name:'Страж диалогов',     prompt:'Проверь что голос каждого персонажа в диалоге различим: словарь, темп, манера — разные у разных людей, не усреднённые.' },
  { cat:'Стиль',       name:'Страж темпа',        prompt:'Отметь если три и более абзаца подряд идут без действия, диалога или события (пробуксовка темпа). Отметь и обратное — если важный момент смят.' },
  { cat:'Стиль',       name:'Страж показа',       prompt:'Найди места где автор называет чувство или качество прямо («он испугался», «она была добра»), вместо того чтобы показать его через действие или деталь.' },
];

const GUARD_CATS = ['Все', 'Факты', 'Персонажи', 'Стиль'];

function renderGuardPresets(activeCat, query){
  const q=(query||'').toLowerCase().trim();
  return GUARD_PRESETS
    .map((p,i)=>({...p,i}))
    .filter(p=>(activeCat==='Все'||p.cat===activeCat) && (!q||p.name.toLowerCase().includes(q)||p.prompt.toLowerCase().includes(q)))
    .map(p=>`<button class="agd-preset" data-i="${p.i}" title="${esc(p.prompt)}"
      style="display:flex;flex-direction:column;gap:2px;text-align:left;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg);cursor:pointer;width:100%">
      <span style="font-size:13px;font-weight:500">${esc(p.name)}</span>
      <span style="font-size:11px;color:var(--text-3);line-height:1.4">${esc(p.prompt.slice(0,80))}…</span>
    </button>`).join('') || '<div style="font-size:13px;color:var(--text-3);padding:8px 0">Ничего не найдено</div>';
}

function openAddGuardModal(){
  const root=document.getElementById('modalRoot'); if(!root) return;
  let activeCat='Все';
  const render=()=>{
    const q=root.querySelector('#agdSearch')?.value||'';
    root.querySelector('#agdPresetList').innerHTML=renderGuardPresets(activeCat,q);
    root.querySelectorAll('.agd-preset').forEach(b=>b.onclick=()=>{
      const p=GUARD_PRESETS[+b.dataset.i];
      root.querySelector('#agdName').value=p.name;
      root.querySelector('#agdPrompt').value=p.prompt;
      root.querySelectorAll('.agd-preset').forEach(x=>{ x.style.background='var(--bg)'; x.style.borderColor='var(--border)'; });
      b.style.background='var(--accent-bg,#eef2ff)'; b.style.borderColor='var(--accent)';
    });
  };
  root.innerHTML=`<div class="modal-bg" id="agdBg"><div class="modal" style="width:480px;max-width:93vw;max-height:90vh;display:flex;flex-direction:column" onclick="event.stopPropagation()">
    <h2 style="flex-shrink:0">🛡 Свой страж</h2>
    <div style="font-size:13px;color:var(--text-2);margin-bottom:14px;line-height:1.6;flex-shrink:0">
      Страж читает сцену и ставит флаги по вашему критерию.
      <b>Не переписывает</b> — только сообщает о нарушениях.
      Запускается параллельно с другими стражами при каждом прогоне.
    </div>
    <div style="flex-shrink:0;margin-bottom:8px">
      <div style="display:flex;gap:6px;margin-bottom:8px">
        ${GUARD_CATS.map(c=>`<button class="agd-cat ${c==='Все'?'agd-cat-active':''}" data-cat="${esc(c)}"
          style="font-size:12px;padding:3px 10px;border-radius:20px;border:1px solid var(--border);cursor:pointer;background:${c==='Все'?'var(--accent)':'var(--bg)'};color:${c==='Все'?'#fff':'var(--text)'}">${esc(c)}</button>`).join('')}
      </div>
      <input id="agdSearch" class="ares-input" style="width:100%;box-sizing:border-box" placeholder="Поиск по названию или описанию…">
    </div>
    <div id="agdPresetList" style="overflow-y:auto;max-height:220px;display:flex;flex-direction:column;gap:4px;margin-bottom:14px;flex-shrink:0">
      ${renderGuardPresets('Все','')}
    </div>
    <div style="flex-shrink:0;margin-bottom:10px">
      <label style="font-size:12px;color:var(--text-2);display:block;margin-bottom:4px">Название <span style="color:var(--text-3)">(или выберите пресет выше)</span></label>
      <input id="agdName" class="ares-input" style="width:100%;box-sizing:border-box" placeholder="Страж дат" maxlength="40" value="">
    </div>
    <div style="flex-shrink:0;margin-bottom:16px">
      <label style="font-size:12px;color:var(--text-2);display:block;margin-bottom:4px">Что проверять</label>
      <textarea id="agdPrompt" class="apv-draft" rows="3" style="min-height:70px" placeholder="напр.: проверь что у каждого персонажа свой голос в диалоге"></textarea>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-shrink:0">
      <button class="btn" id="agdCancel">Отмена</button>
      <button class="btn btn-primary" id="agdOk">Создать стража</button>
    </div>
  </div></div>`;
  render();
  root.querySelector('#agdBg').onclick=()=>root.innerHTML='';
  root.querySelector('#agdCancel').onclick=()=>root.innerHTML='';
  root.querySelector('#agdSearch').addEventListener('input',render);
  root.querySelectorAll('.agd-cat').forEach(b=>b.onclick=()=>{
    activeCat=b.dataset.cat;
    root.querySelectorAll('.agd-cat').forEach(x=>{ x.style.background='var(--bg)'; x.style.color='var(--text)'; });
    b.style.background='var(--accent)'; b.style.color='#fff';
    render();
  });
  root.querySelector('#agdOk').onclick=()=>{
    const name=(root.querySelector('#agdName').value||'').trim()||'Свой страж';
    const prompt=(root.querySelector('#agdPrompt').value||'').trim();
    if(!prompt){ root.querySelector('#agdPrompt').focus(); return; }
    const s=getState(); const a=addCustomAgent(s, name, prompt);
    _openAgents.add(a.id); save(); root.innerHTML='';
  };
  setTimeout(()=>root.querySelector('#agdSearch').focus(),50);
}

// Пайплайн агентов (тумблеры + настройки + бейджи + DnD) + прогоны.
const PARALLEL_ROLES = new Set(['voiceguard','logic','events','styleguard','custom','reader']);
// Фактические стражи — бегут каждую итерацию петли; литературные — только при принятом тексте.
const FACTUAL_GUARD_ROLES = new Set(['logic','events']);

// ── Живая схема пайплайна ─────────────────────────────────────────────────
function renderPipelineFlow(agents){
  const get = r => agents.find(a=>a.role===r);
  const arch  = get('architect');
  const prose = get('prose');
  const eval_ = get('evaluator');
  const le    = get('lineedit');
  const guards = agents.filter(a=>PARALLEL_ROLES.has(a.role));

  const nd = a => `<div class="pf-nd ${!a||a.enabled===false?'pf-off':''}" title="${esc(a?a.name:'')}">${a?a.icon:''}</div>`;
  const arr = `<span class="pf-arr">→</span>`;

  const loopGroup = `<div class="pf-group pf-loop-grp">
    <div class="pf-loop-row">${nd(prose)}<span class="pf-loop-sym">↻</span>${nd(eval_)}</div>
    <div class="pf-glbl">петля</div>
  </div>`;

  const guardsGroup = guards.length ? `${arr}<div class="pf-group pf-par-grp">
    <div class="pf-par-row">${guards.map(nd).join('')}</div>
    <div class="pf-glbl">∥ параллельно</div>
  </div>` : '';

  const leNode = le ? `${arr}${nd(le)}` : '';

  return `<div class="pf-flow">${arch?nd(arch)+arr:''}${loopGroup}${guardsGroup}${leNode}</div>`;
}
const AGENT_FILTER_CATS = ['Все','Основные','Стражи','Мои'];
const CORE_ROLES = new Set(['architect','prose','evaluator','lineedit']);
const GUARD_ROLES = new Set(['voiceguard','logic','events','styleguard']);
let _agentFilter = 'Все';

function agentMatchesFilter(a, filter){
  if(filter==='Все') return true;
  if(filter==='Основные') return CORE_ROLES.has(a.role);
  if(filter==='Стражи')   return GUARD_ROLES.has(a.role);
  if(filter==='Мои')      return !!a.custom;
  return true;
}

export function renderAgentPipeline(){
  const s = getState();
  const agents = s.agents||[];
  const runs = getRuns();
  setTimeout(bindAgents, 0);
  const flowHtml = renderPipelineFlow(agents);
  // Заголовок «∥ параллельный шаг» показываем один раз перед первым включённым стражем —
  // не по соседству со «своей группой» (позиция в списке — чисто отображение, порядок
  // на выполнение не влияет), иначе перетаскивание/выключение стража посреди списка
  // рвёт группу на несколько заголовков подряд.
  let sepShown = false;
  const visible = agents.filter(a=>agentMatchesFilter(a, _agentFilter));
  const rows = visible.map((a)=>{
    const isPar = PARALLEL_ROLES.has(a.role) && a.enabled!==false;
    const sep = (isPar && !sepShown) ? '<div class="par-sep" data-tip="Эти агенты-стражи работают одновременно (параллельно) — быстрее и независимо друг от друга.">∥ параллельный шаг</div>' : '';
    if(isPar) sepShown = true;
    const isFactual = FACTUAL_GUARD_ROLES.has(a.role);
    const parTip = isFactual
      ? 'Фактический страж: работает параллельно на каждой итерации петли — ловит противоречия сразу, пока текст ещё меняется.'
      : (PARALLEL_ROLES.has(a.role) && !a.custom)
        ? 'Литературный страж: работает параллельно, только когда Оценщик принял текст — незачем проверять голос на черновике.'
        : 'Идёт параллельно с другими стражами.';
    const badges =
      (a.role==='prose'&&a.loop?'<span class="ag-badge loop" data-tip="Петля с Оценщиком: Прозаик дорабатывает черновик, пока Оценщик не примет (до макс. итераций).">↻</span>':'') +
      (isPar?`<span class="ag-badge par" data-tip="${parTip}">∥</span>`:'') +
      (isFactual && isPar?'<span class="ag-badge loop" data-tip="Запускается на каждой итерации петли, не ждёт финального принятия.">↻</span>':'') +
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
  const customCount = agents.filter(a=>a.custom).length;
  const filterTabs = AGENT_FILTER_CATS.map(c=>{
    const active = c===_agentFilter;
    return `<button class="ap-fcat ${active?'ap-fcat-active':''}" data-fcat="${esc(c)}"
      style="font-size:11px;padding:2px 9px;border-radius:20px;border:1px solid ${active?'var(--accent)':'var(--border)'};background:${active?'var(--accent)':'transparent'};color:${active?'#fff':'var(--text-2)'};cursor:pointer">${esc(c)}${c==='Мои'&&customCount?` <span style="background:var(--accent);color:#fff;border-radius:8px;padding:0 5px;font-size:10px">${customCount}</span>`:''}</button>`;
  }).join('');
  return `
    ${flowHtml}
    <div style="display:flex;gap:5px;flex-wrap:wrap;padding:6px 12px 0" id="agentFilterBar">${filterTabs}</div>
    <div class="diag-section" id="agentRows">${rows||'<div class="empty-state">Нет агентов в этой категории.</div>'}</div>
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
  // фильтр категорий агентов
  document.querySelectorAll('.ap-fcat').forEach(b=>b.onclick=()=>{ _agentFilter=b.dataset.fcat; rerenderDiag(); });
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
  if(add) add.onclick=()=>openAddGuardModal();
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

// Кнопки на замечание: точечная правка, полная переработка, и «в правило».
function fixActions(text){
  const t = esc(text);
  return `<div class="ares-acts">
    <button class="ares-patch" data-fix="${t}" data-tip="Внести только эту правку в текущий текст. Остальное не трогается, цикл агентов не запускается. Можно откатить ↶.">✎ Поправить точечно</button>
    <button class="ares-todir" data-dir="${t}" data-tip="Положить замечание в задачу Прозаику для полной переработки сцены через цикл (Прозаик → Оценщик → Стражи).">↻ Прозаику</button>
    <button class="ares-rule" data-rule="${t}" data-tip="Сделать постоянным правилом автора: впредь Прозаик это не порождает, Оценщик штрафует, Страж стиля ловит.">⊕ В правило</button>
  </div>`;
}

function renderResultBody(r){
  if(r.kind==='evaluator'){
    const v=r.verdict;
    if(!v||!v.ok) return `<div class="muted">Оценщик не вернул разбор.</div>`;
    const axes=RUBRIC_AXES.map(a=>{ const val=v.scores[a.key]; const col=val>=7?'var(--ok)':val>=5?'var(--warn)':'var(--err)';
      return `<div class="ares-axis"><span>${a.label}</span><b style="color:${col}">${val}</b></div>`; }).join('');
    const cl=(v.cliches||[]).length?`<div class="ares-h">Клише в тексте</div>${v.cliches.map(c=>`<div class="ares-cl">«${esc(c)}» <button class="ares-rule" data-rule="${esc('избегай штампа «'+c+'» и подобных шаблонных оборотов')}" data-tip="Сделать правилом — впредь избегать">⊕ В правило</button></div>`).join('')}`:'';
    const nt=(v.notes||[]).length?`<div class="ares-h">Замечания и что исправить</div>${v.notes.map(n=>`<div class="ares-note"><span>${esc(n)}</span>${fixActions(n)}</div>`).join('')}`:'';
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
      ${f.severity!=='ok'?fixActions(f.title+': '+(f.detail||'')):''}
    </div>`).join('');
  }
  if(r.kind==='lineedit'){
    if(!r.text) return `<div class="muted">Правок не предложено.</div>`;
    return `<div class="ares-h">Предложенная правка</div>
      <div class="ares-edit">${escProse(r.text)}</div>
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
  // точечная правка: вносим только это замечание в текущий текст, без цикла. Модалка остаётся открытой.
  document.querySelectorAll('.ares-patch').forEach(b=>b.onclick=async()=>{
    const s=getState(); const sc=(s.structure||[]).find(n=>n.id===scene.id); if(!sc) return;
    const prev=b.textContent; b.textContent='…'; b.disabled=true;
    try{
      const fixed=await patchScene(s, sc, b.dataset.fix);
      sc.proseVersions=sc.proseVersions||[]; sc.proseVersions.unshift(sc.text);
      if(sc.proseVersions.length>10) sc.proseVersions.length=10;
      sc.text=fixed; sc.words=(fixed.match(/\S+/g)||[]).length; save(); // перерисует редактор за модалкой
      b.textContent='✓ применено'; b.classList.add('done'); b.disabled=true;
    }catch(e){ b.textContent=prev; b.disabled=false; alert('Не удалось: '+e.message); }
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
  document.querySelectorAll('.ares-rule').forEach(b=>b.onclick=()=>{
    const t=prompt('Правило автора (как принцип, не привязка к одной сцене):', b.dataset.rule);
    if(t==null||!t.trim()) return;
    addRule(getState(), t.trim()); save();
    b.textContent='✓ правило'; b.classList.add('done'); b.disabled=true;
  });
}
