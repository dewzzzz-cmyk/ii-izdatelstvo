// Целевая проверка нового anchor-persistence фикса в pipeline.js: берём ТУ ЖЕ
// сцену и ТОТ ЖЕ исходный черновик (621 сл., сохранён в proseVersions[0] после
// прошлого теста), прогоняем через runScene ещё раз и смотрим, ловит ли новая
// проверка потерю якорей, которая раньше прошла консенсус незамеченной.
const BASE = 'https://litsovet-v2-production.up.railway.app';
const PROJECT_ID = 'proj_mrhv6oxw_e';
const SCENE_ID = 'sc_mrv6jz6m_1';
const API_KEY = process.env.LITSOVET_KEY;
if(!API_KEY) { console.error('Missing LITSOVET_KEY env var'); process.exit(1); }

const _fetch = global.fetch;
global.fetch = (url, opts) => {
  if (typeof url === 'string' && url.startsWith('/')) url = BASE + url;
  return _fetch(url, opts);
};
process.on('unhandledRejection', ()=>{});
process.on('uncaughtException', (e)=>{ if(/indexedDB|document is not defined/.test(e.message||'')) return; console.error('uncaught:', e); process.exit(1); });

const { runScene } = await import('./src/pipeline.js');
const { setState } = await import('./src/state.js');

async function main(){
  const getRes = await fetch(`${BASE}/api/sync/${PROJECT_ID}`);
  const data = await getRes.json();
  const state = data.state || data;
  state.global.apiKey = API_KEY;
  setState(state);

  const scene = (state.structure||[]).find(n=>n.id===SCENE_ID);
  const originalDraft = scene.proseVersions && scene.proseVersions[0];
  if(!originalDraft){ console.error('no proseVersions[0] found — nothing to test against'); process.exit(1); }
  console.log(`Testing against ORIGINAL draft: ${(originalDraft.match(/\S+/g)||[]).length} words`);
  console.log('(this run does NOT save — read-only test of the anchor-loss detector)\n');

  const result = await runScene(state, scene, { initialDraft: originalDraft }, (prog)=>{
    if(prog.log) console.log(`  [${prog.log.icon}] ${prog.log.text}`);
  });

  console.log('\n=== RESULT ===');
  console.log('New eval:', result.eval?.ok ? result.eval.weighted+'/10' : '?');
  console.log('New words:', (result.text.match(/\S+/g)||[]).length);
  console.log('\n--- FINAL TEXT ---');
  console.log(result.text);
}
main().catch(e=>{ console.error('FATAL:', e); process.exit(1); });
