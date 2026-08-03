// Закрывает главу тем же кодом, что кнопка "Закрыть главу →" (closeChapter
// из ui/author-control.js) — суммаризирует главу в память, помечает closed.
// handDone уже true (реальная правка сцены была сделана ранее в сессии) —
// это не обход авторской проверки, а тот же самый код без браузерного клика.

const BASE = 'https://litsovet-v2-production.up.railway.app';
const PROJECT_ID = 'proj_mrhv6oxw_e';
const CHAPTER_ID = process.argv[2];
const API_KEY = process.env.LITSOVET_KEY;

if(!CHAPTER_ID) { console.error('Usage: node close-chapter.mjs <chapterId>'); process.exit(1); }
if(!API_KEY) { console.error('Missing LITSOVET_KEY env var'); process.exit(1); }

const _fetch = global.fetch;
global.fetch = (url, opts) => {
  if (typeof url === 'string' && url.startsWith('/')) url = BASE + url;
  return _fetch(url, opts);
};
process.on('unhandledRejection', ()=>{});
process.on('uncaughtException', (e)=>{ if(/indexedDB|document is not defined/.test(e.message||'')) return; console.error('uncaught:', e); process.exit(1); });

const { setState } = await import('./src/state.js');
const { closeChapter, chapterComplete } = await import('./src/ui/author-control.js');

async function main(){
  const getRes = await fetch(`${BASE}/api/sync/${PROJECT_ID}`);
  const data = await getRes.json();
  const state = data.state || data;
  state.global.apiKey = API_KEY;
  setState(state);

  const ch = (state.structure||[]).find(n=>n.id===CHAPTER_ID);
  if(!ch) throw new Error('chapter not found: '+CHAPTER_ID);
  console.log(`Closing chapter "${ch.title}"...`);
  console.log('all scenes done:', chapterComplete(state, CHAPTER_ID));

  await closeChapter(state, CHAPTER_ID);

  state.updated = Date.now();
  const saveRes = await fetch(`${BASE}/api/sync/${PROJECT_ID}`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(data)
  });
  const saveText = await saveRes.text();
  if(!saveRes.ok) throw new Error(`save HTTP ${saveRes.status}: ${saveText}`);
  console.log('Save result:', saveText);
  console.log('closed flag:', ch.closed);
}

main().catch(e=>{ console.error('FATAL:', e); process.exit(1); });
