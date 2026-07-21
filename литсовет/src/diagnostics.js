// Диагностический харнесс — встроенная наблюдаемость (спека 12.2).
// Трейс каждого прогона по run_id: какие слои контекста ушли в промпт
// каждого агента, вход/выход, токены, стоимость, итерации, вердикты.

import { getState, save, uid } from './state.js';

let _active = null; // текущий открытый трейс

export function startRun(sceneId, label){
  _active = {
    runId: uid('run'),
    sceneId,
    label: label || 'прогон',
    started: Date.now(),
    steps: [],         // по агенту: {agent, input, output, tokensIn, tokensOut, cost, iters, verdict, layers}
    totalCost: 0,
    totalTokens: 0,
    status: 'running',
  };
  return _active.runId;
}

export function logStep(step){
  if(!_active) return;
  _active.steps.push(step);
  _active.totalCost += step.cost || 0;
  _active.totalTokens += (step.tokensIn||0) + (step.tokensOut||0);
}

export function endRun(status='done'){
  if(!_active) return null;
  _active.status = status;
  _active.ended = Date.now();
  const st = getState();
  if(st){
    st.diagnostics = st.diagnostics || { runs: [] };
    st.diagnostics.runs.unshift(_active);
    // храним последние 50 прогонов
    // 50 → 10: каждый трейс хранит ВСЕ промпты/ответы агентов целиком
    // (~180 КБ на прогон) и целиком ездит на сервер при каждом save() —
    // 33 прогона давали 5.9 МБ из 23 МБ общего веса проекта (живой инцидент
    // «очень медленно загружается»). 10 последних прогонов хватает для
    // отладки, migrate() в state.js подрезает уже раздутые проекты.
    if(st.diagnostics.runs.length > 10) st.diagnostics.runs.length = 10;
    save();
  }
  const finished = _active;
  _active = null;
  return finished;
}

export function activeRun(){ return _active; }

export function getRuns(){
  const st = getState();
  return st?.diagnostics?.runs || [];
}

export function getRun(runId){
  return getRuns().find(r=>r.runId===runId) || null;
}

// Включён ли агент (toggle).
export function agentEnabled(role){
  const st = getState();
  const a = (st?.agents||[]).find(x=>x.role===role);
  return a ? a.enabled !== false : false;
}

// По id, не по role: несколько кастомных агентов могут делить один role
// ('custom') — поиск по role находил бы всегда ПЕРВОГО такого агента,
// независимо от того, чей тумблер реально нажали.
export function toggleAgent(id, on){
  const st = getState();
  const a = (st?.agents||[]).find(x=>x.id===id);
  if(a){ a.enabled = on; save(); }
}
