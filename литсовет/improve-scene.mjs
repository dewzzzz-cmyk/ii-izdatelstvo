// Целевой раунд УЛУЧШЕНИЯ сцены: не с нуля (initialDraft = текущий текст),
// а цикл правки от конкретных находок Оценщика/Стражей, переданных директивой.
// Тот же runScene, что и кнопка в UI — просто с явной стартовой директивой.
// Использование: node improve-scene.mjs <sceneId> <directive-file>

const BASE = 'https://litsovet-v2-production.up.railway.app';
const PROJECT_ID = 'proj_mrhv6oxw_e';
const SCENE_ID = process.argv[2];
const DIRECTIVE_FILE = process.argv[3];
const API_KEY = process.env.LITSOVET_KEY;

if(!SCENE_ID || !DIRECTIVE_FILE) { console.error('Usage: node improve-scene.mjs <sceneId> <directiveFile>'); process.exit(1); }
if(!API_KEY) { console.error('Missing LITSOVET_KEY env var'); process.exit(1); }

import { readFileSync } from 'fs';
const DIRECTIVE = readFileSync(DIRECTIVE_FILE, 'utf8').trim();

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

async function main(){
  const getRes = await fetch(`${BASE}/api/sync/${PROJECT_ID}`);
  const data = await getRes.json();
  const state = data.state || data;
  state.global.apiKey = API_KEY;
  setState(state);

  const scene = (state.structure||[]).find(n=>n.id===SCENE_ID);
  if(!scene) throw new Error('scene not found: '+SCENE_ID);
  const oldText = scene.text;
  const oldEval = scene.lastEval;
  console.log(`Improving "${scene.title}" from ${oldEval?.weighted ?? '?'}/10 (${scene.words} сл.)...`);

  const result = await runScene(state, scene, { initialDraft: oldText, directive: DIRECTIVE }, (prog)=>{
    if(prog.log) console.log(`  [${prog.log.icon}] ${prog.log.text}`);
    else if(prog.text && !prog.streaming) console.log('  ...', prog.text);
  });

  // Принимаем новую версию только если она НЕ хуже: балл не просел больше чем
  // на 0.3 (шум Оценщика) и текст цел. Иначе оставляем старую.
  const newW = result.eval?.ok ? result.eval.weighted : null;
  const oldW = oldEval?.ok ? oldEval.weighted : null;
  if(newW != null && oldW != null && newW < oldW - 0.3){
    console.log(`NEW VERSION WORSE (${newW} < ${oldW}) — keeping old text, no save.`);
    return;
  }

  scene.proseVersions = scene.proseVersions || [];
  scene.proseVersions.unshift(oldText);
  if(scene.proseVersions.length>10) scene.proseVersions.length=10;
  scene.text = result.text;
  scene.words = (result.text.match(/\S+/g)||[]).length;
  scene.status = 'done';
  scene.lastEval = result.eval||null;
  scene.flags = result.flags||{};
  scene.handDone = false;
  scene.stale = false;

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
  console.log(`Score: ${oldW ?? '?'} -> ${newW ?? '?'} | words: ${scene.words}`);
}

main().catch(e=>{ console.error('FATAL:', e); process.exit(1); });
