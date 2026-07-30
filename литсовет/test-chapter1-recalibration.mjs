// Тест влияния новой калибровки Оценщика (few-shot оси + usedCliches +
// paceBaseline) на РЕАЛЬНЫЙ текст главы 1: прогоняем каждую из 5 уже
// готовых сцен через обычный автоматический цикл правки runScene
// (initialDraft = текущий текст, без кастомной директивы — пусть
// Стражи/Оценщик сами решают, что править, как в обычном пайплайне),
// сравниваем баллы по осям ДО/ПОСЛЕ и сохраняем новую версию, если она
// не хуже (тот же порог, что в improve-scene.mjs: -0.3).
// Использование: node test-chapter1-recalibration.mjs

const BASE = 'https://litsovet-v2-production.up.railway.app';
const PROJECT_ID = 'proj_mrhv6oxw_e';
const API_KEY = process.env.LITSOVET_KEY;
if(!API_KEY) { console.error('Missing LITSOVET_KEY env var'); process.exit(1); }

const CHAPTER1_SCENE_IDS = ['sc_mrv6jz6m_1','sc_mrv388z0_2a','sc_mrv388z0_2b','sc_mrv388z0_2c','sc_mrv388z0_2d'];

const _fetch = global.fetch;
global.fetch = (url, opts) => {
  if (typeof url === 'string' && url.startsWith('/')) url = BASE + url;
  return _fetch(url, opts);
};
process.on('unhandledRejection', ()=>{});
process.on('uncaughtException', (e)=>{ if(/indexedDB|document is not defined/.test(e.message||'')) return; console.error('uncaught:', e); process.exit(1); });

const { runScene } = await import('./src/pipeline.js');
const { summarizeScene, driftCheck, maybeRollup } = await import('./src/memory.js');
const { setState } = await import('./src/state.js');

const AXES = ['freshness','rhythm','concrete','voice','pace','brief'];

async function main(){
  const getRes = await fetch(`${BASE}/api/sync/${PROJECT_ID}`);
  const data = await getRes.json();
  const state = data.state || data;
  state.global.apiKey = API_KEY;
  setState(state);

  const results = [];

  for(const sceneId of CHAPTER1_SCENE_IDS){
    const scene = (state.structure||[]).find(n=>n.id===sceneId);
    if(!scene){ console.warn(`scene not found: ${sceneId}`); continue; }
    const oldText = scene.text;
    const oldEval = scene.lastEval;
    console.log(`\n=== "${scene.title}" (было: ${oldEval?.weighted ?? '?'}/10, ${scene.words} сл.) ===`);

    let result;
    try{
      result = await runScene(state, scene, { initialDraft: oldText }, (prog)=>{
        if(prog.log) console.log(`  [${prog.log.icon}] ${prog.log.text}`);
      });
    }catch(e){ console.error(`  FAILED: ${e.message}`); results.push({title:scene.title, error:e.message}); continue; }

    const newEval = result.eval;
    const newW = newEval?.ok ? newEval.weighted : null;
    const oldW = oldEval?.ok ? oldEval.weighted : null;
    const newWords = (result.text.match(/\S+/g)||[]).length;

    console.log(`  Стало: ${newW ?? '?'}/10, ${newWords} сл.`);
    if(oldEval?.scores && newEval?.scores){
      AXES.forEach(ax=>{
        const o = oldEval.scores[ax], n = newEval.scores[ax];
        console.log(`    ${ax}: ${o} -> ${n} ${n>o?'▲':n<o?'▼':'='}`);
      });
    }

    const worse = (newW != null && oldW != null && newW < oldW - 0.3);
    results.push({
      title: scene.title, sceneId,
      oldWeighted: oldW, newWeighted: newW,
      oldScores: oldEval?.scores || null, newScores: newEval?.scores || null,
      oldWords: scene.words, newWords,
      saved: !worse,
    });

    if(worse){
      console.log(`  НЕ СОХРАНЯЮ — новая версия хуже (${newW} < ${oldW - 0.3})`);
      continue;
    }

    scene.proseVersions = scene.proseVersions || [];
    scene.proseVersions.unshift(oldText);
    if(scene.proseVersions.length>10) scene.proseVersions.length=10;
    scene.text = result.text;
    scene.words = newWords;
    scene.status = 'done';
    scene.lastEval = newEval||null;
    scene.flags = result.flags||{};
    scene.handDone = false;
    scene.stale = false;

    try{
      await summarizeScene(state, scene);
      scene.drift = driftCheck(state, scene);
      await maybeRollup(state);
    }catch(e){ console.warn('  summarize failed:', e.message); }
  }

  state.updated = Date.now();
  const saveRes = await fetch(`${BASE}/api/sync/${PROJECT_ID}`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(data)
  });
  const saveText = await saveRes.text();
  if(!saveRes.ok) throw new Error(`save HTTP ${saveRes.status}: ${saveText}`);
  console.log('\nSave result:', saveText);

  console.log('\n\n=== ИТОГО ===');
  results.forEach(r=>{
    if(r.error){ console.log(`${r.title}: ОШИБКА — ${r.error}`); return; }
    console.log(`${r.title}: ${r.oldWeighted} -> ${r.newWeighted} (${r.saved?'сохранено':'НЕ сохранено'})`);
  });
  console.log('\nJSON_RESULTS_START');
  console.log(JSON.stringify(results));
  console.log('JSON_RESULTS_END');
}

main().catch(e=>{ console.error('FATAL:', e); process.exit(1); });
