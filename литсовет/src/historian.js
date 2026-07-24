// Историческая разведка: Wikipedia → LLM синтез → Bible записи.
// Ищет реальные факты эпохи и возвращает [{keys, text, plotHook}]
// для добавления в канон перед написанием.

import { callLLM, extractJSON } from './llm.js';

// Живой тест (3 прогона на реальном проекте) показал 73% промах запросов
// мимо Википедии, вплоть до полного провала прогона (0/9 статей): на
// temperature 0.7 модель периодически съезжает с поисковых запросов в
// аннотации-предложения вида «Портал (фантастика) — переход между мирами
// в литературе» — это не заголовок статьи и не то, что вообще ищут в
// поиске, Википедия закономерно ничего не находит на такую строку целиком.
// Ниже: temperature ниже (меньше дрейфа в этот режим), явный запрет формата
// с примерами хорошо/плохо, плюс защитный пост-процессинг на случай, если
// модель всё равно допишет пояснение через тире.
function sanitizeQuery(q){
  if(typeof q !== 'string') return '';
  // «Термин — пояснение почему это важно» → берём только термин. Скобки
  // (роман)/(фантастика) — легитимный вид неоднозначности в заголовках
  // Википедии, их не трогаем, только хвост после длинного тире/дефиса.
  return q.split(/\s+[—–-]\s+/)[0].trim();
}

// Шаг 1: LLM генерирует конкретные поисковые запросы для Wikipedia.
// opts.strict — второй, «аварийный» проход после того, как первый набор
// запросов не нашёл ни одной статьи (см. runHistoricalResearch): просит
// МЕНЬШЕ и заведомо более безопасных/известных тем, а не тот же самый риск
// повторно — иначе повтор с той же температурой/промптом с большой вероятностью
// снова попадёт в тот же провальный режим.
export async function generateSearchQueries(state, opts = {}) {
  const p = state.project, g = state.global;
  const strict = !!opts.strict;
  const msgs = [
    { role: 'system', content: strict
      ? 'Ты — историк-исследователь. Первая попытка поиска в Википедии провалилась (0 результатов). Сгенерируй ТОЛЬКО заведомо существующие, широко известные темы — если сомневаешься, бери более общую и точно существующую статью, а не узкую и точную по смыслу. КАЖДЫЙ запрос — 1–3 слова, буквально название статьи, без пояснений.'
      : 'Ты — историк-исследователь. Генерируй конкретные поисковые запросы для Википедии: реальные события, персоналии, организации, технологии, обычаи и места эпохи — то, что создаёт достоверность и сюжетные возможности.\n'
        + 'КАЖДЫЙ запрос — короткая именная фраза (2–5 слов), буквально заголовок статьи Википедии или близко к нему. НЕ предложение, НЕ пояснение через тире/двоеточие, НЕ вопрос.\n'
        + 'Хорошо: «Александр Македонский», «Чумной доктор», «Портал (фантастика)». Плохо: «Александр Македонский — завоеватель, изменивший карту мира», «Как распространялась чума в средневековье».' },
    { role: 'user', content: [
      `Жанр: ${p.genre || 'исторический детектив'}.`,
      p.era  ? `Эпоха / место: ${p.era}.`  : '',
      p.idea ? `Идея книги: ${p.idea}.`     : '',
      p.type === 'series' && p.seriesTitle ? `Серия «${p.seriesTitle}», книга ${p.seriesBook||1} из ${p.seriesTotal||3}.` : '',
      '',
      strict
        ? 'Сгенерируй 5 максимально безопасных, точно существующих поисковых запросов для Википедии на русском (1–3 слова каждый).'
        : 'Сгенерируй 7–9 поисковых запросов для Википедии на русском. Каждый — конкретный объект (не категория), короткой именной фразой.',
      'Верни JSON: { "queries": ["запрос1", …] }. Только JSON.',
    ].filter(Boolean).join('\n') },
  ];
  const res = await callLLM({ baseURL: g.baseURL, apiKey: g.apiKey, model: g.model, temperature: strict ? 0.2 : 0.4, messages: msgs, maxTokens: 480, retries: g.retries });
  const j = extractJSON(res.text);
  const queries = (j && Array.isArray(j.queries)) ? j.queries.slice(0, strict ? 5 : 9) : [];
  return queries.map(sanitizeQuery).filter(Boolean);
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
  // Раньше синтез не видел уже существующий канон вообще — на проекте с 217
  // фактами Библии это реальный риск дублей/пересечений с уже установленным
  // (найдено живым тестом: точный повтор факта между двумя своими же
  // прогонами). Передаём только keys (не полный текст — иначе раздувает
  // промпт без нужды), капаем на 150 записей — этого достаточно, чтобы
  // модель не предлагала то же самое, не утяжеляя запрос пропорционально
  // размеру всей книги.
  const existingKeys = [...new Set((state.bible||[]).map(b => (b.keys||'').trim()).filter(Boolean))].slice(0, 150);
  const existingBlock = existingKeys.length
    ? `\nУЖЕ ЕСТЬ В КАНОНЕ КНИГИ (не дублируй и не пересекайся с этими темами — ищи НОВОЕ): ${existingKeys.join('; ')}\n`
    : '';
  const msgs = [
    { role: 'system', content: 'Ты — литературный редактор-историк. Из текстов Википедии извлекаешь конкретные, проверяемые детали, полезные для художественного текста. Факты должны быть точными и создавать сюжетные возможности.' },
    { role: 'user', content: [
      `Жанр: ${p.genre || 'детектив'}. Эпоха: ${p.era || '—'}. Идея: ${p.idea || '—'}.`,
      existingBlock,
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
  const res = await callLLM({ baseURL: g.baseURL, apiKey: g.apiKey, model: g.model, temperature: 0.4, messages: msgs, maxTokens: 3000, retries: g.retries });
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
  // Живой инцидент: до 9 поисков × до 3 саммари = до ~36 запросов к Википедии
  // одним кликом — Википедия отвечала 429 (rate limit) после первых
  // нескольких, и это молча превращалось в «статья не найдена» (см. фикс
  // ретрая в server.js). Небольшая пауза между запросами по разным темам —
  // не спасает от единичного 429 внутри одного handleWiki (там свой ретрай),
  // но снижает саму частоту, с которой Википедия успевает начать троттлить.
  const searchWiki = async (qs) => {
    const summaries = [];
    for (let i=0; i<qs.length; i++){
      if(i>0) await new Promise(r=>setTimeout(r, 250));
      try { summaries.push(...await fetchWiki(qs[i])); } catch (e) {}
    }
    const seen = new Set();
    return summaries.filter(s => { if (seen.has(s.title)) return false; seen.add(s.title); return true; });
  };

  let deduped = await searchWiki(queries);
  // Живой тест: 1 прогон из 3 полностью проваливался (0/9 запросов нашли
  // хоть что-то) — обычно из-за того, что LLM на первой попытке сгенерировала
  // слишком специфичные/книжные темы. Один аварийный повтор с заведомо
  // безопасными, короткими запросами (см. opts.strict в generateSearchQueries)
  // вместо мгновенного отказа — тот же принцип «ретрай перед провалом», что
  // уже применяется в pipeline.js для обрывов токенами.
  if (!deduped.length) {
    onProgress('Ничего не найдено — повторяю с более простыми запросами…');
    const fallbackQueries = await generateSearchQueries(state, { strict: true });
    if (fallbackQueries.length) deduped = await searchWiki(fallbackQueries);
  }
  if (!deduped.length) throw new Error('Wikipedia не вернула результатов даже после повтора с более простыми запросами — попробуйте заполнить поле «Эпоха» в Концепции конкретнее.');

  onProgress(`Найдено ${deduped.length} статей. Синтезирую факты…`);
  const facts = await synthesizeFacts(deduped, state);
  if (!facts.length) throw new Error('Не удалось извлечь факты из найденных статей');

  return { facts, queries, articleCount: deduped.length };
}
