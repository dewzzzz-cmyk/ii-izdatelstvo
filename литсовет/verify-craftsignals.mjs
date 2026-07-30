// Живая проверка нового кросс-сценового детектора (craftsignals.js) +
// пассивности + Оценщика-калибровки на реальной книге. Ретроактивно
// извлекает craftSignature для уже написанных сцен (в обычном режиме это
// делается один раз при завершении сцены, здесь — догоняем существующие),
// затем прогоняет чистый агрегатор и печатает, что он находит.
// Использование: node verify-craftsignals.mjs

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

const { extractCraftSignature, detectRepeatingHumorPattern, dominantExpositionChannel } = await import('./src/craftsignals.js');
const { passivityIsSystemic } = await import('./src/bookreview.js');
const { setState } = await import('./src/state.js');

async function main(){
  const getRes = await fetch(`${BASE}/api/sync/${PROJECT_ID}`);
  const data = await getRes.json();
  const state = data.state || data;
  state.global.apiKey = API_KEY;
  setState(state);

  const doneScenes = (state.structure||[]).filter(n=>n.type==='scene' && n.status==='done' && n.text);
  console.log(`Done scenes: ${doneScenes.length}`);

  state.memory = state.memory || {};
  state.memory.craftSignals = state.memory.craftSignals || {};
  let extracted = 0;
  for(const scene of doneScenes){
    if(state.memory.craftSignals[scene.id]) continue;
    try{
      const sig = await extractCraftSignature(state, scene);
      if(sig){
        state.memory.craftSignals[scene.id] = sig;
        extracted++;
        console.log(`  [${scene.title}] beats=${sig.beats.length} exposition="${sig.expositionChannel}"`);
      }
    }catch(e){ console.warn(`  extractCraftSignature failed for "${scene.title}":`, e.message); }
  }
  console.log(`Extracted ${extracted} new signatures (${Object.keys(state.memory.craftSignals).length} total stored).`);

  const sceneTitleById = Object.fromEntries((state.structure||[]).filter(n=>n.type==='scene').map(n=>[n.id, n.title]));
  const humorPattern = detectRepeatingHumorPattern(state.memory.craftSignals, sceneTitleById);
  const expositionDominance = dominantExpositionChannel(state.memory.craftSignals, sceneTitleById);
  const passivity = passivityIsSystemic(state);

  console.log('\n--- detectRepeatingHumorPattern ---');
  console.log(JSON.stringify(humorPattern, null, 2));
  console.log('\n--- dominantExpositionChannel ---');
  console.log(JSON.stringify(expositionDominance, null, 2));
  console.log('\n--- passivityIsSystemic ---');
  console.log(JSON.stringify(passivity, null, 2));

  state.updated = Date.now();
  const saveRes = await fetch(`${BASE}/api/sync/${PROJECT_ID}`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(data)
  });
  const saveText = await saveRes.text();
  if(!saveRes.ok) throw new Error(`save HTTP ${saveRes.status}: ${saveText}`);
  console.log('\nSave result:', saveText);
}

main().catch(e=>{ console.error('FATAL:', e); process.exit(1); });
