// Headless-аналог автопилота "Написать главу целиком" (runChapterAutopilot в
// ui/stages.js) — та же логика (runScene по недописанным сценам, summarize,
// closeChapter, переход к следующей главе), без DOM-привязки для рендера.
// Использование: node write-chapters.mjs <firstChapterId> <lastChapterId>
// Пишет все главы от first до last включительно (по порядку в structure).

const BASE = 'https://litsovet-v2-production.up.railway.app';
const PROJECT_ID = 'proj_mrhv6oxw_e';
const FIRST_CH = process.argv[2];
const LAST_CH = process.argv[3] || FIRST_CH;
const API_KEY = process.env.LITSOVET_KEY;

if(!FIRST_CH) { console.error('Usage: node write-chapters.mjs <firstChapterId> [lastChapterId]'); process.exit(1); }
if(!API_KEY) { console.error('Missing LITSOVET_KEY env var'); process.exit(1); }

const _fetch = global.fetch;
global.fetch = (url, opts) => {
  if (typeof url === 'string' && url.startsWith('/')) url = BASE + url;
  return _fetch(url, opts);
};
process.on('unhandledRejection', ()=>{});
process.on('uncaughtException', (e)=>{ if(/indexedDB|document is not defined/.test(e.message||'')) return; console.error('uncaught:', e); process.exit(1); });

const { setState } = await import('./src/state.js');
const { runScene } = await import('./src/pipeline.js');
const { summarizeScene, driftCheck, maybeRollup } = await import('./src/memory.js');
const { closeChapter } = await import('./src/ui/author-control.js');

async function saveState(data){
  const res = await fetch(`${BASE}/api/sync/${PROJECT_ID}`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(data)
  });
  const text = await res.text();
  // server.js/handleSyncSave требует rev == тому, что уже лежит на диске
  // (защита от перезаписи устаревшим клиентом). Без прокидывания rev назад
  // в data этот скрипт сам стал «устаревшим клиентом» после первого же
  // успешного save — каждый следующий save() уходил с тем же нулевым rev,
  // получал 409 и молча (res.text() не проверялся) терял готовую сцену:
  // генерация отрабатывала, но текст так и не долетал до сервера.
  if(!res.ok) throw new Error(`saveState HTTP ${res.status}: ${text}`);
  try{ const parsed = JSON.parse(text); if(typeof parsed.rev === 'number') data.rev = parsed.rev; }catch{}
  return text;
}

async function runOneScene(state, scene){
  const wasDone = scene.status==='done' && !!scene.text;
  console.log(`  Сцена: "${scene.title}" (${scene.id})`);
  const result = await runScene(state, scene, {}, (prog)=>{
    if(prog.log) console.log(`    [${prog.log.icon}] ${prog.log.text}`);
  });
  if(wasDone && scene.text){
    scene.proseVersions = scene.proseVersions || [];
    scene.proseVersions.unshift(scene.text);
    if(scene.proseVersions.length>10) scene.proseVersions.length=10;
  }
  scene.text = result.text;
  scene.words = (result.text.match(/\S+/g)||[]).length;
  scene.status = 'done';
  scene.lastEval = result.eval||null;
  scene.flags = result.flags||{};
  scene.handDone = false;
  scene.stale = false;
  try{
    await summarizeScene(state, scene);
    scene.drift = driftCheck(state, scene);
    await maybeRollup(state);
  }catch(e){ console.warn('  summarize failed:', e.message); }
  console.log(`  -> ${scene.words} сл., оценка ${result.eval?.weighted ?? '—'}`);
}

async function main(){
  const getRes = await fetch(`${BASE}/api/sync/${PROJECT_ID}`);
  const data = await getRes.json();
  const state = data.state || data;
  state.global.apiKey = API_KEY;
  setState(state);

  const chapters = (state.structure||[]).filter(n=>n.type==='chapter');
  const startIdx = chapters.findIndex(c=>c.id===FIRST_CH);
  const endIdx = chapters.findIndex(c=>c.id===LAST_CH);
  if(startIdx<0 || endIdx<0) throw new Error('chapter not found');

  for(let ci=startIdx; ci<=endIdx; ci++){
    const ch = chapters[ci];
    console.log(`\n=== Глава: "${ch.title}" (${ch.id}) ===`);
    const idx = (state.structure||[]).findIndex(n=>n.id===ch.id);
    const scenes = [];
    for(let i=idx+1; i<state.structure.length; i++){
      const n = state.structure[i];
      if(n.type==='chapter') break;
      if(n.type==='scene') scenes.push(n);
    }
    for(const scene of scenes){
      if(scene.status==='done' && scene.text){ console.log(`  Сцена "${scene.title}" уже готова, пропуск.`); continue; }
      await runOneScene(state, scene);
      state.updated = Date.now();
      console.log('  save:', await saveState(data));
    }
    console.log(`Закрываю главу "${ch.title}"...`);
    await closeChapter(state, ch.id);
    state.updated = Date.now();
    console.log('save:', await saveState(data));
  }
  console.log('\nDONE.');
}

main().catch(e=>{ console.error('FATAL:', e); process.exit(1); });
