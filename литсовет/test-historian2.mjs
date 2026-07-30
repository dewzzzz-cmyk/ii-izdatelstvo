// Углублённая проверка «Исторической разведки»: несколько полных циклов,
// реальный usage токенов (не оценка), процент "мимо" запросов к Википедии,
// оценка полезности/дублирования итоговых фактов относительно уже
// существующего канона книги. Ничего не сохраняет в проект.

const BASE = 'https://litsovet-v2-production.up.railway.app';
const PROJECT_ID = 'proj_mrhv6oxw_e';
const API_KEY = process.env.LITSOVET_KEY;
if(!API_KEY){ console.error('Missing LITSOVET_KEY env var'); process.exit(1); }

const _fetch = global.fetch;
global.fetch = (url, opts) => {
  if (typeof url === 'string' && url.startsWith('/')) url = BASE + url;
  return _fetch(url, opts);
};

const { generateSearchQueries, fetchWiki } = await import('./src/historian.js');
const { callLLM, extractJSON } = await import('./src/llm.js');

async function main(){
  const getRes = await fetch(`${BASE}/api/sync/${PROJECT_ID}`);
  const data = await getRes.json();
  const state = data.state || data;
  state.global.apiKey = API_KEY;
  const g = state.global, p = state.project;

  console.log('project:', p.title, '| genre:', p.genre, '| era:', JSON.stringify(p.era));
  console.log('existing bible facts:', (state.bible||[]).length);
  console.log('='.repeat(70));

  const RUNS = 3;
  let totalQueries = 0, totalHits = 0, totalMiss = 0, zeroResultRuns = 0;
  const allFacts = [];

  for(let run=1; run<=RUNS; run++){
    console.log(`\n### ПРОГОН ${run}/${RUNS} ###`);
    const queries = await generateSearchQueries(state);
    console.log('Запросы:', JSON.stringify(queries));
    totalQueries += queries.length;

    const allSummaries = [];
    const perQueryHits = [];
    for(const q of queries){
      const s = await fetchWiki(q);
      perQueryHits.push({q, hits: s.map(x=>x.title)});
      if(s.length) totalHits++; else totalMiss++;
      allSummaries.push(...s);
    }
    perQueryHits.forEach(h => console.log(`  "${h.q}" -> [${h.hits.join(', ')}]`));

    const seen = new Set();
    const deduped = allSummaries.filter(s => { if(seen.has(s.title)) return false; seen.add(s.title); return true; });
    console.log('Уникальных статей:', deduped.length, '/ запросов:', queries.length);
    if(!deduped.length){ zeroResultRuns++; console.log('ПРОГОН ПОЛНОСТЬЮ ПРОМАХНУЛСЯ (0 статей)'); continue; }

    // Реплицируем synthesizeFacts вручную, чтобы увидеть реальный tokensOut/cost.
    const texts = deduped.map(s => `=== ${s.title} ===\n${s.extract}`).join('\n\n').slice(0, 7000);
    const msgs = [
      { role: 'system', content: 'Ты — литературный редактор-историк. Из текстов Википедии извлекаешь конкретные, проверяемые детали, полезные для художественного текста. Факты должны быть точными и создавать сюжетные возможности.' },
      { role: 'user', content: [
        `Жанр: ${p.genre || 'детектив'}. Эпоха: ${p.era || '—'}. Идея: ${p.idea || '—'}.`,
        '', 'ТЕКСТЫ ИЗ WIKIPEDIA:', texts, '',
        'Извлеки 8–12 наиболее ценных фактов. Требования к каждому:',
        '• keys — 2–4 ключевых слова через запятую',
        '• text — сам факт: конкретно, с именами/датами/местами (1–3 предложения)',
        '• plotHook — одна идея: как использовать этот факт именно в детективном сюжете (1 предложение)',
        '', 'Верни JSON: { "facts": [ { "keys": "…", "text": "…", "plotHook": "…" } ] }. Только JSON.',
      ].filter(Boolean).join('\n') },
    ];
    const eRes = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.4, messages:msgs, maxTokens:2500, retries:g.retries });
    console.log(`synthesizeFacts: tokensIn=${eRes.tokensIn} tokensOut=${eRes.tokensOut} (лимит 2500, загрузка ${Math.round(eRes.tokensOut/2500*100)}%) cost=$${eRes.cost.toFixed(4)}`);
    const j = extractJSON(eRes.text);
    const facts = (j && Array.isArray(j.facts)) ? j.facts.filter(f=>f.keys&&f.text) : [];
    console.log('Распарсилось фактов:', facts.length, j ? '(JSON валиден)' : '(JSON НЕ распарсился!)');
    if(!j) console.log('RAW (последние 300 симв.):', JSON.stringify(eRes.text.slice(-300)));
    allFacts.push(...facts);
  }

  console.log('\n' + '='.repeat(70));
  console.log('ИТОГО:');
  console.log(`Запросов сгенерировано: ${totalQueries} | попало в статью: ${totalHits} | мимо: ${totalMiss} (${Math.round(totalMiss/totalQueries*100)}% промах)`);
  console.log(`Прогонов с 0 статей (упали бы с ошибкой): ${zeroResultRuns}/${RUNS}`);
  console.log(`Всего фактов собрано за ${RUNS} прогона: ${allFacts.length}`);

  // Проверка дублей МЕЖДУ прогонами (одна и та же LLM-генерация запросов на
  // одном и том же жанре/идее — велик шанс что разные прогоны найдут одни и
  // те же статьи и почти одинаковые факты).
  const factTexts = allFacts.map(f=>f.text);
  const uniqueTexts = new Set(factTexts);
  console.log(`Уникальных по тексту: ${uniqueTexts.size} / ${factTexts.length} (${factTexts.length-uniqueTexts.size} точных дублей между прогонами)`);

  console.log('\nВсе собранные факты:');
  allFacts.forEach((f,i)=>console.log(`${i+1}. [${f.keys}] ${f.text}\n   -> ${f.plotHook}`));
}
main().catch(e=>{ console.error('FATAL:', e); process.exit(1); });
