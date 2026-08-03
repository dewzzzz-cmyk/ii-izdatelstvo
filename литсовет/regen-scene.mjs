// Одноразовый скрипт: прогоняет runScene() напрямую (тот же код, что кнопка
// "Перегенерировать"/"Запустить агентов" в браузере), без UI — браузерный
// клик по строке сцены/кнопке ненадёжен в этой среде (баг масштабирования
// координат при resize_window). Повторяет полную последовательность из
// doRun() в ui/stages.js: runScene -> обновление полей сцены -> summarizeScene
// -> driftCheck -> maybeRollup -> save.

const BASE = 'https://litsovet-v2-production.up.railway.app';
const PROJECT_ID = 'proj_mrhv6oxw_e';
const SCENE_ID = process.argv[2];
const API_KEY = process.env.LITSOVET_KEY;

if(!SCENE_ID) { console.error('Usage: node regen-scene.mjs <sceneId>'); process.exit(1); }
if(!API_KEY) { console.error('Missing LITSOVET_KEY env var'); process.exit(1); }

const _fetch = global.fetch;
global.fetch = (url, opts) => {
  if (typeof url === 'string' && url.startsWith('/')) url = BASE + url;
  return _fetch(url, opts);
};

// diagnostics.js вызывает save() из state.js на каждый logStep() — это
// планирует персист в IndexedDB/DOM-индикатор через 400мс дебаунс. В Node
// того и другого нет, и это НЕ наш путь сохранения (свой POST ниже) — без
// перехвата процесс падал уже ПОСЛЕ успешного прогона, до нашего save().
process.on('unhandledRejection', (e)=>{ /* браузерный auto-persist, не наш путь сохранения */ });
process.on('uncaughtException', (e)=>{ if(/indexedDB|document is not defined/.test(e.message||'')) return; console.error('uncaught:', e); process.exit(1); });

const { runScene } = await import('./src/pipeline.js');
const { summarizeScene, driftCheck, maybeRollup } = await import('./src/memory.js');
const { setState } = await import('./src/state.js');

async function main(){
  const getRes = await fetch(`${BASE}/api/sync/${PROJECT_ID}`);
  const data = await getRes.json();
  const state = data.state || data;
  state.global.apiKey = API_KEY;
  // agentEnabled()/getState() etc. в diagnostics.js/state.js читают модульный
  // синглтон _state, а не аргумент state, переданный в runScene() — без этого
  // ВСЕ agentEnabled(role) молча возвращают false (Оценщик и Стражи не бегут).
  setState(state);
  console.log('agents loaded:', (state.agents||[]).length, 'enabled roles:', (state.agents||[]).filter(a=>a.enabled!==false).map(a=>a.role).join(','));

  const scene = (state.structure||[]).find(n=>n.id===SCENE_ID);
  if(!scene) throw new Error('scene not found: '+SCENE_ID);

  const wasDone = scene.status==='done' && !!scene.text;
  const oldText = scene.text;
  const oldEval = scene.lastEval;

  console.log(`Regenerating "${scene.title}" (${scene.id})...`);

  const result = await runScene(state, scene, {}, (prog)=>{
    if(prog.log) console.log(`  [${prog.log.icon}] ${prog.log.text}`);
    else if(prog.text && !prog.streaming) console.log('  ...', prog.text);
  });

  if(wasDone && oldText){
    scene.proseVersions = scene.proseVersions || [];
    scene.proseVersions.unshift(oldText);
    if(scene.proseVersions.length>10) scene.proseVersions.length=10;
  }
  scene.text = result.text;
  scene.words = (result.text.match(/\S+/g)||[]).length;
  scene.status = 'done';
  scene.lastEval = result.eval||null;
  scene.flags = result.flags||{};
  scene.handDone = false;
  scene.stale = false;

  if(oldEval?.ok && result.eval?.ok && ((oldEval.pass && !result.eval.pass) || result.eval.weighted < oldEval.weighted - 0.5)){
    console.log(`WARNING: new version scored worse: ${oldEval.weighted} -> ${result.eval.weighted}`);
  }

  if(wasDone){
    const scenes = (state.structure||[]).filter(n=>n.type==='scene');
    const i = scenes.findIndex(n=>n.id===scene.id);
    scenes.slice(i+1).forEach(n=>{ if(n.status==='done') n.stale=true; });
  }

  console.log('Summarizing...');
  try{
    await summarizeScene(state, scene);
    scene.drift = driftCheck(state, scene);
    await maybeRollup(state);
  }catch(e){ console.warn('summarize failed:', e.message); }

  state.updated = Date.now();
  const saveRes = await fetch(`${BASE}/api/sync/${PROJECT_ID}`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(data)
  });
  const saveText = await saveRes.text();
  if(!saveRes.ok) throw new Error(`save HTTP ${saveRes.status}: ${saveText}`);
  console.log('Save result:', saveText);
  console.log('Final eval:', JSON.stringify(result.eval));
  console.log('Word count:', scene.words);
  console.log('--- FINAL TEXT ---');
  console.log(result.text);
}

main().catch(e=>{ console.error('FATAL:', e); process.exit(1); });
