// Разовый скрипт: живая проверка «Исторической разведки» (historian.js) —
// generateSearchQueries -> fetchWiki (/api/wiki) -> synthesizeFacts, теми же
// реальными платными вызовами, что и кнопка "🔍 Найти факты эпохи" в UI.
// Ничего не сохраняет в проект (только читает) — чистая функциональная проверка.

const BASE = 'https://litsovet-v2-production.up.railway.app';
const PROJECT_ID = 'proj_mrhv6oxw_e';
const API_KEY = process.env.LITSOVET_KEY;
if(!API_KEY){ console.error('Missing LITSOVET_KEY env var'); process.exit(1); }

const _fetch = global.fetch;
global.fetch = (url, opts) => {
  if (typeof url === 'string' && url.startsWith('/')) url = BASE + url;
  return _fetch(url, opts);
};

const { generateSearchQueries, fetchWiki, synthesizeFacts, runHistoricalResearch } = await import('./src/historian.js');

async function main(){
  const getRes = await fetch(`${BASE}/api/sync/${PROJECT_ID}`);
  const data = await getRes.json();
  const state = data.state || data;
  state.global.apiKey = API_KEY;

  console.log('project:', state.project.title, '| genre:', state.project.genre, '| era:', JSON.stringify(state.project.era));
  console.log('--- Шаг 1: generateSearchQueries ---');
  const queries = await generateSearchQueries(state);
  console.log('queries:', queries);
  if(!queries.length){ console.error('FAIL: 0 queries generated'); process.exit(1); }

  console.log('--- Шаг 2: fetchWiki (первые 3 запроса) ---');
  const allSummaries = [];
  for(const q of queries.slice(0,3)){
    const s = await fetchWiki(q);
    console.log(`  "${q}" ->`, s.map(x=>x.title));
    allSummaries.push(...s);
  }
  const seen = new Set();
  const deduped = allSummaries.filter(s => { if(seen.has(s.title)) return false; seen.add(s.title); return true; });
  console.log('deduped articles:', deduped.length);

  if(deduped.length){
    console.log('--- Шаг 3: synthesizeFacts ---');
    const facts = await synthesizeFacts(deduped, state);
    console.log('facts:', JSON.stringify(facts, null, 2));
  } else {
    console.log('SKIP synthesizeFacts: 0 articles found for these queries');
  }

  console.log('\n--- Полный цикл runHistoricalResearch (как реальная кнопка) ---');
  try{
    const result = await runHistoricalResearch(state, msg=>console.log('  ...', msg));
    console.log('OK. articleCount:', result.articleCount, '| facts:', result.facts.length);
    console.log(JSON.stringify(result.facts.slice(0,3), null, 2));
  }catch(e){
    console.log('runHistoricalResearch threw:', e.message);
  }
}
main().catch(e=>{ console.error('FATAL:', e); process.exit(1); });
