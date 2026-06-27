// Историческая разведка: Wikipedia → LLM синтез → Bible записи.
// Ищет реальные факты эпохи и возвращает [{keys, text, plotHook}]
// для добавления в канон перед написанием.

import { callLLM, extractJSON } from './llm.js';

// Шаг 1: LLM генерирует конкретные поисковые запросы для Wikipedia
export async function generateSearchQueries(state) {
  const p = state.project, g = state.global;
  const msgs = [
    { role: 'system', content: 'Ты — историк-исследователь. Генерируй конкретные поисковые запросы для Википедии: реальные события, персоналии, организации, технологии, обычаи и места эпохи — то, что создаёт достоверность и сюжетные возможности.' },
    { role: 'user', content: [
      `Жанр: ${p.genre || 'исторический детектив'}.`,
      p.era  ? `Эпоха / место: ${p.era}.`  : '',
      p.idea ? `Идея книги: ${p.idea}.`     : '',
      p.type === 'series' && p.seriesTitle ? `Серия «${p.seriesTitle}», книга ${p.seriesBook||1} из ${p.seriesTotal||3}.` : '',
      '',
      'Сгенерируй 7–9 поисковых запросов для Википедии на русском. Каждый — конкретный объект (не категория).',
      'Верни JSON: { "queries": ["запрос1", …] }. Только JSON.',
    ].filter(Boolean).join('\n') },
  ];
  const res = await callLLM({ baseURL: g.baseURL, apiKey: g.apiKey, model: g.model, temperature: 0.7, messages: msgs, maxTokens: 400 });
  const j = extractJSON(res.text);
  return (j && Array.isArray(j.queries)) ? j.queries.slice(0, 9) : [];
}

// Шаг 2: Вызов /api/wiki прокси → список {title, extract}
export async function fetchWiki(query, lang = 'ru') {
  const res = await fetch('/api/wiki', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, lang, limit: 3 }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.summaries || [];
}

// Шаг 3: LLM синтезирует Wikipedia-тексты в готовые Bible-записи
export async function synthesizeFacts(summaries, state) {
  const p = state.project, g = state.global;
  if (!summaries.length) return [];
  const texts = summaries.map(s => `=== ${s.title} ===\n${s.extract}`).join('\n\n').slice(0, 7000);
  const msgs = [
    { role: 'system', content: 'Ты — литературный редактор-историк. Из текстов Википедии извлекаешь конкретные, проверяемые детали, полезные для художественного текста. Факты должны быть точными и создавать сюжетные возможности.' },
    { role: 'user', content: [
      `Жанр: ${p.genre || 'детектив'}. Эпоха: ${p.era || '—'}. Идея: ${p.idea || '—'}.`,
      '',
      'ТЕКСТЫ ИЗ WIKIPEDIA:',
      texts,
      '',
      'Извлеки 8–12 наиболее ценных фактов. Требования к каждому:',
      '• keys — 2–4 ключевых слова через запятую (по ним Прозаик найдёт факт при написании сцены)',
      '• text — сам факт: конкретно, с именами/датами/местами (1–3 предложения)',
      '• plotHook — одна идея: как использовать этот факт именно в детективном сюжете (1 предложение)',
      '',
      'Верни JSON: { "facts": [ { "keys": "…", "text": "…", "plotHook": "…" } ] }. Только JSON.',
    ].filter(Boolean).join('\n') },
  ];
  const res = await callLLM({ baseURL: g.baseURL, apiKey: g.apiKey, model: g.model, temperature: 0.4, messages: msgs, maxTokens: 2500 });
  const j = extractJSON(res.text);
  return (j && Array.isArray(j.facts)) ? j.facts.filter(f => f.keys && f.text) : [];
}

// Полный цикл: queries → wiki → synthesis.
// onProgress(msg) — строка прогресса (опционально).
export async function runHistoricalResearch(state, onProgress = () => {}) {
  onProgress('Генерирую поисковые запросы…');
  const queries = await generateSearchQueries(state);
  if (!queries.length) throw new Error('Не удалось сгенерировать запросы (проверьте API-ключ и заполните поле «Эпоха» в Концепции)');

  onProgress(`${queries.length} запросов. Ищу в Википедии…`);
  const allSummaries = [];
  for (const q of queries) {
    try { allSummaries.push(...await fetchWiki(q)); } catch (e) {}
  }

  const seen = new Set();
  const deduped = allSummaries.filter(s => { if (seen.has(s.title)) return false; seen.add(s.title); return true; });
  if (!deduped.length) throw new Error('Wikipedia не вернула результатов — проверьте поле «Эпоха» в настройках Концепции');

  onProgress(`Найдено ${deduped.length} статей. Синтезирую факты…`);
  const facts = await synthesizeFacts(deduped, state);
  if (!facts.length) throw new Error('Не удалось извлечь факты из найденных статей');

  return { facts, queries, articleCount: deduped.length };
}
