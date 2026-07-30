// Headless-аналог "Сгенерировать скелет" + авто-цикл "Улучшить структуру"
// (runIterativeArchitect в ui/stages.js), без DOM-привязки для рендера.
// Использование: node generate-skeleton.mjs

const BASE = 'https://litsovet-v2-production.up.railway.app';
const PROJECT_ID = 'proj_mrhv6oxw_e';
const API_KEY = process.env.LITSOVET_KEY;

if(!API_KEY) { console.error('Missing LITSOVET_KEY env var'); process.exit(1); }

const _fetch = global.fetch;
global.fetch = (url, opts) => {
  if (typeof url === 'string' && url.startsWith('/')) url = BASE + url;
  return _fetch(url, opts);
};
process.on('unhandledRejection', ()=>{});
process.on('uncaughtException', (e)=>{ if(/indexedDB|document is not defined/.test(e.message||'')) return; console.error('uncaught:', e); process.exit(1); });

const { setState } = await import('./src/state.js');
const { runBookArchitect, applySkeleton, runStructureEval } = await import('./src/architect-book.js');

let _idc = 0;
function uid(prefix='id'){ return prefix + '_' + Date.now().toString(36) + '_' + (++_idc).toString(36); }

function currentSkeletonAsPrevious(s){
  const chapters = (s.structure||[]).filter(n=>n.type==='chapter');
  return chapters.length ? {
    chapters: chapters.map(ch=>({
      title: ch.title, arc: ch.arc,
      scenes: (s.structure||[]).filter(n=>n.type==='scene' && n.chapterId===ch.id)
        .map(sc=>({ title:sc.title, brief:sc.brief, emotion:sc.emotion, entryState:sc.entryState, targetWords:sc.targetWords, sceneType:sc.sceneType }))
    }))
  } : null;
}

function hintFromEval(ev){
  const issues = (ev.issues||[]).join('\n');
  const suggestions = (ev.suggestions||[]).join('\n');
  return [issues && 'ПРОБЛЕМЫ:\n'+issues, suggestions && 'РЕКОМЕНДАЦИИ:\n'+suggestions].filter(Boolean).join('\n\n');
}

async function saveState(state){
  const res = await fetch(`${BASE}/api/sync/${PROJECT_ID}`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(state)
  });
  const text = await res.text();
  // См. write-chapters.mjs: без прокидывания rev назад в state каждый
  // следующий save() в этом же прогоне (несколько итераций Архитектора)
  // уходил бы со старым rev и молча терял результат на 409.
  if(!res.ok) throw new Error(`saveState HTTP ${res.status}: ${text}`);
  try{ const parsed = JSON.parse(text); if(typeof parsed.rev === 'number') state.rev = parsed.rev; }catch{}
  return text;
}

async function main(){
  const getRes = await fetch(`${BASE}/api/sync/${PROJECT_ID}`);
  const state = await getRes.json();
  state.global.apiKey = API_KEY;
  setState(state);

  if((state.structure||[]).length) throw new Error(`state.structure не пуст (${state.structure.length} узлов) — ожидалась предварительно очищенная книга.`);

  const maxIter = Math.max(1, state.global.structureMaxIter ?? 3);
  let prevEval = null, prevScore = null, skeleton = null, evalResult = null;
  let bestScore = null, bestIter = 0;

  for(let iter=1; iter<=maxIter; iter++){
    console.log(`\n=== Прогон ${iter}/${maxIter}: Архитектор ${prevEval?'перерабатывает':'проектирует'} структуру ===`);
    const previousSkeleton = prevEval ? currentSkeletonAsPrevious(state) : null;
    const freshSkeleton = await runBookArchitect(state, { hint: prevEval?hintFromEval(prevEval):'', previousSkeleton });
    applySkeleton(state, freshSkeleton, uid);
    skeleton = currentSkeletonAsPrevious(state);
    state.structureEval = null;
    state.updated = Date.now();
    console.log(`  Глав: ${skeleton.chapters.length}, сцен: ${skeleton.chapters.reduce((n,c)=>n+c.scenes.length,0)}`);
    console.log('  save:', await saveState(state));

    console.log('  Оценщик проверяет структуру...');
    evalResult = await runStructureEval(state, skeleton, prevEval);
    if(evalResult && prevScore!=null) evalResult.prevScore = prevScore;
    state.structureEval = evalResult;
    state.updated = Date.now();
    console.log('  save:', await saveState(state));
    console.log(`  Оценка: ${evalResult.score}/10 (арка ${evalResult.axes.arc}, темп ${evalResult.axes.pacing}, конфликт ${evalResult.axes.conflict}, баланс ${evalResult.axes.balance}, финал ${evalResult.axes.ending})`);
    if(evalResult.issues.length) console.log('  Проблемы:', evalResult.issues.map(s=>'\n   - '+s).join(''));

    if(evalResult && (bestScore==null || evalResult.score > bestScore)){ bestScore = evalResult.score; bestIter = iter; }
    if(!evalResult || evalResult.score >= 8) break;
    prevEval = evalResult; prevScore = evalResult.score;
  }

  console.log(`\nDONE. Итоговая оценка: ${evalResult?.score}/10 (лучшая была на прогоне ${bestIter}: ${bestScore}/10)`);
  console.log('Глав:', state.structure.filter(n=>n.type==='chapter').length, '| Сцен:', state.structure.filter(n=>n.type==='scene').length);
  console.log('Первые 3 главы:');
  state.structure.filter(n=>n.type==='chapter').slice(0,3).forEach(ch=>console.log('  -', ch.id, ch.title));
}

main().catch(e=>{ console.error('FATAL:', e); process.exit(1); });
