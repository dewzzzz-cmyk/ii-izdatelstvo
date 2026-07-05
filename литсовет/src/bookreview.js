// Целостный анализ ГОТОВОЙ (или частично готовой) книги — в отличие от Оценщика
// и Стражей, которые видят одну сцену за раз. Два инструмента:
//   Бета-ридер   — имитирует реальную анкету бета-ридера: цепляет ли начало,
//                  ясны ли мотивации героя, где проседает интерес, satisfying ли финал.
//   Чеховские ружья — отслеживает заявленные сюжетные заготовки (предмет/тайна/
//                  обещание) на масштабе всей книги: получили ли они развязку.
// Оба работают по СВОДКАМ сцен (не по полному тексту — иначе не влезет в контекст
// на книге в 80k+ слов), кроме первой и последней сцены — их бета-ридер читает
// целиком, потому что вопрос «цепляет ли начало» и «satisfying ли финал» нельзя
// честно оценить по пересказу.

import { callLLM, extractJSON } from './llm.js';

export function doneScenesOrdered(state){
  return (state.structure||[]).filter(n=>n.type==='scene' && n.status==='done' && n.text);
}

// Компактный обзор книги по порядку ЧТЕНИЯ (structure), не порядку написания.
// onlyWritten=true — пропускает ещё не написанные сцены целиком (не показывает даже
// их бриф-план): нужно Бета-ридеру и Критику, которые симулируют человека, реально
// прочитавшего рукопись, — им нельзя видеть бриф ненаписанной сцены как будто это
// уже случившееся событие книги. onlyWritten=false (по умолчанию) — прежнее
// поведение, весь план книги целиком: нужно трекеру чеховских ружей (сознательно
// смотрит на структуру наперёд) и подсказчику названий.
export function bookOverview(state, onlyWritten=false){
  const mem = state.memory||{};
  const nodes = state.structure||[];
  const parts = [];
  nodes.forEach(n=>{
    if(n.type==='chapter'){ parts.push(`\nГЛАВА: «${n.title}»`); }
    else if(n.type==='scene'){
      if(onlyWritten && !(n.status==='done' && n.text)) return;
      const sum = mem.scenes?.[n.id]?.current || n.brief || '';
      if(sum) parts.push(`  «${n.title}»${n.lastEval?.weighted?` [оценка ${n.lastEval.weighted}/10]`:''}: ${sum}`);
    }
  });
  return parts.join('\n');
}

function clamp10(n){ return Math.max(0, Math.min(10, Math.round(Number(n)||0))); }
function str(s){ return typeof s==='string' ? s.trim() : ''; }

// ── Бета-ридер ──
export function betaReaderMessages(state){
  const scenes = doneScenesOrdered(state);
  const first = scenes[0], last = scenes[scenes.length-1];
  const p = state.project;
  const lowScored = scenes.filter(s=>s.lastEval?.weighted).sort((a,b)=>a.lastEval.weighted-b.lastEval.weighted).slice(0,3);
  const sys = [
    'Ты — обычный читатель целевой аудитории этой книги, не редактор и не критик. Ты прочитал рукопись целиком и честно делишься впечатлением — так, как отвечал бы на анкету бета-ридера.',
    'Не придумывай похвалу из вежливости и не выдумывай проблем, которых нет — отвечай так, будто это реальное чтение.',
  ].join('\n');
  const user = [
    `Жанр: ${p.genre||'роман'}. Аудитория: ${p.audience||'широкая'}.`,
    '',
    'ПЕРВАЯ СЦЕНА КНИГИ (целиком — по ней вы решаете, читать ли дальше):',
    (first?.text||'').slice(0, 4000) || '(нет)',
    '',
    'ПОСЛЕДНЯЯ СЦЕНА КНИГИ (целиком):',
    (last?.text||'').slice(0, 4000) || '(нет)',
    '',
    'ОБЗОР ВСЕЙ КНИГИ ПО ГЛАВАМ И СЦЕНАМ (сводки по порядку, только написанные сцены):',
    bookOverview(state, true),
    lowScored.length ? '\nСцены с низкой внутренней оценкой (возможные места провала интереса): ' + lowScored.map(s=>`«${s.title}»`).join(', ') : '',
    '',
    'Ответь как бета-ридер. Верни JSON:',
    '{ "hookScore": 0-10, "hookNote": "затянула ли первая сцена, почему/почему нет", "motivationClarity": 0-10, "motivationNote": "ясны ли цели и мотивации героя, растёт ли он по ходу книги", "paceDrops": ["конкретные главы/сцены, где интерес проседал, с причиной — 0-4"], "endingScore": 0-10, "endingNote": "удовлетворяет ли финал, закрыты ли ожидания читателя", "overall": "2-3 предложения общего впечатления как реальный читатель, не редактор" }',
    'Только JSON.',
  ].filter(Boolean).join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

export async function runBetaRead(state){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ (⚙).');
  const scenes = doneScenesOrdered(state);
  if(scenes.length < 2) throw new Error('Нужно хотя бы 2 законченные сцены (нужны начало и финал).');
  const msgs = betaReaderMessages(state);
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.4, messages:msgs, maxTokens:1000, retries:g.retries });
  const j = extractJSON(res.text);
  if(!j) throw new Error('Не удалось разобрать ответ бета-ридера.');
  return {
    hookScore: clamp10(j.hookScore), hookNote: str(j.hookNote),
    motivationClarity: clamp10(j.motivationClarity), motivationNote: str(j.motivationNote),
    paceDrops: Array.isArray(j.paceDrops) ? j.paceDrops.slice(0,4).map(String) : [],
    endingScore: clamp10(j.endingScore), endingNote: str(j.endingNote),
    overall: str(j.overall),
  };
}

// ── Трекер чеховских ружей ──
export function chekhovMessages(state){
  const p = state.project;
  const sys = [
    'Ты — редактор, отслеживающий «чеховские ружья»: детали, объекты, факты, обещания сюжета, введённые с явным весом (не проходное упоминание, а то, на что автор явно обращает внимание читателя).',
    'Правило Чехова: если что-то введено как значимое — оно должно получить развязку. Ищи только заметные сюжетные заготовки (предмет, тайна, угроза, обещание, странность, нерешённый вопрос) — не бытовые детали.',
    'Красная сельдь (намеренный отвлекающий манёвр) — это не ошибка, если она явно СЛУЖИТ манёвром; отмечай только то, что выглядит забытым, а не осознанно оставленным без ответа.',
  ].join('\n');
  const user = [
    `Жанр: ${p.genre||'роман'}. Синопсис: ${p.synopsis||p.idea||''}`,
    '',
    'КНИГА ПО ГЛАВАМ И СЦЕНАМ (сводки по порядку):',
    bookOverview(state),
    '',
    'Найди сюжетные заготовки и для каждой определи: получила ли она развязку (и где) или осталась непогашенной. Верни JSON:',
    '{ "setups": [ { "what": "что заложено", "introducedIn": "где введено (глава/сцена)", "resolved": true|false, "resolvedIn": "где получило развязку, если resolved" } ] }',
    'До 8 самых значимых заготовок. Если книга ещё не закончена — заготовки из последних сцен, которым просто ещё рано получать развязку, НЕ считай непогашенными.',
    'Только JSON.',
  ].filter(Boolean).join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

// ── Литературный критик ──
// В отличие от Бета-ридера (анкета среднего читателя со баллами) — развёрнутая
// несокращённая рецензия профессионального критика: своя формулировка, не
// анкетная форма, без обязательной похвалы-в-довесок к каждой критике.
export function criticReviewMessages(state){
  const scenes = doneScenesOrdered(state);
  const first = scenes[0], last = scenes[scenes.length-1];
  const p = state.project;
  const lowScored = scenes.filter(s=>s.lastEval?.weighted).sort((a,b)=>a.lastEval.weighted-b.lastEval.weighted).slice(0,3)
    .filter(s=>s.id!==first?.id && s.id!==last?.id);
  const sys = [
    'Ты — литературный критик с 15-летним опытом рецензирования жанровой и серьёзной прозы. Тебя попросили дать честную, НЕСОКРАЩЁННУЮ рецензию на рукопись — развёрнутый профессиональный отзыв, а не анкету с баллами.',
    'НЕ смягчай оценку из вежливости и не строй отзыв по формуле «похвала-критика-похвала». Если книга слаба в чём-то — скажи прямо и обоснованно. Если сильна — тоже скажи прямо, без ложной скромности за автора. Ценность рецензии — в честности, не в дипломатичности.',
    'Опирайся на конкретные места в тексте (цитаты, названия сцен/глав), а не на общие фразы вроде «стиль хороший» или «есть проблемы с темпом».',
  ].join('\n');
  const user = [
    `Жанр: ${p.genre||'роман'}. Аудитория: ${p.audience||'широкая'}.`,
    '',
    'ПЕРВАЯ СЦЕНА (целиком):', (first?.text||'').slice(0, 4000) || '(нет)',
    '',
    'ПОСЛЕДНЯЯ СЦЕНА (целиком):', (last?.text||'').slice(0, 4000) || '(нет)',
    lowScored.length ? '\nСЦЕНЫ С НИЗКОЙ ВНУТРЕННЕЙ ОЦЕНКОЙ (целиком, вероятные слабые места):' : '',
    ...lowScored.flatMap(s=>[`«${s.title}»:`, (s.text||'').slice(0, 3000)]),
    '',
    'ОБЗОР ВСЕЙ КНИГИ ПО ГЛАВАМ И СЦЕНАМ (сводки по порядку, только написанные сцены):',
    bookOverview(state, true),
    '',
    'Напиши рецензию. Верни JSON:',
    '{ "verdict": "развёрнутое, живое мнение — 4-8 предложений, как настоящая рецензия, не анкета", "strengths": ["конкретные сильные стороны с примерами, 1-4"], "problems": [ { "issue": "конкретная проблема", "sceneTitle": "название сцены/главы, где заметнее всего, если применимо — иначе пусто", "note": "что именно исправить" } ], "recommendation": "одна фраза: рекомендовал бы читателям жанра или нет, и почему" }',
    'problems — до 6 самых важных, не мелочи. sceneTitle указывай ТОЛЬКО если проблема реально привязана к конкретной сцене, а не общая для всей книги. Только JSON.',
  ].filter(Boolean).join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

export async function runCriticReview(state){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ (⚙).');
  const scenes = doneScenesOrdered(state);
  if(scenes.length < 2) throw new Error('Нужно хотя бы 2 законченные сцены (нужны начало и финал).');
  const msgs = criticReviewMessages(state);
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.5, messages:msgs, maxTokens:1800, retries:g.retries });
  const j = extractJSON(res.text);
  if(!j) throw new Error('Не удалось разобрать ответ критика.');
  return {
    verdict: str(j.verdict),
    strengths: Array.isArray(j.strengths) ? j.strengths.slice(0,4).map(String) : [],
    problems: Array.isArray(j.problems) ? j.problems.slice(0,6).map(x=>({
      issue: String(x.issue||'').slice(0,300),
      sceneTitle: String(x.sceneTitle||'').slice(0,100),
      note: String(x.note||'').slice(0,300),
    })) : [],
    recommendation: str(j.recommendation),
  };
}

export async function runChekhovCheck(state){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ (⚙).');
  const scenes = doneScenesOrdered(state);
  if(scenes.length < 3) throw new Error('Нужно хотя бы 3 законченные сцены.');
  const msgs = chekhovMessages(state);
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.3, messages:msgs, maxTokens:1200, retries:g.retries });
  const j = extractJSON(res.text);
  if(!j || !Array.isArray(j.setups)) throw new Error('Не удалось разобрать ответ.');
  return j.setups.slice(0,8).map(s=>({
    what: String(s.what||'').slice(0,200),
    introducedIn: String(s.introducedIn||'').slice(0,100),
    resolved: !!s.resolved,
    resolvedIn: String(s.resolvedIn||'').slice(0,100),
  }));
}

// ── Предложение названий книги ──
// Минимальный порог для честного предложения: не только идея, а реально
// написанные главы — иначе ИИ придумывает название по одному предложению
// синопсиса, без чувства тона/содержания книги.
export function canSuggestTitles(state){
  const p = state.project||{};
  if(!p.idea && !p.synopsis) return false;
  const chapters = (state.structure||[]).filter(n=>n.type==='chapter');
  const scenes = (state.structure||[]).filter(n=>n.type==='scene');
  const chaptersWithProse = chapters.filter(ch=>scenes.some(sc=>sc.chapterId===ch.id && sc.status==='done' && sc.text));
  return chaptersWithProse.length >= 2;
}

export function titleSuggestMessages(state){
  const p = state.project;
  const sys = [
    'Ты — редактор, придумывающий рабочие названия для книги. Предлагаешь варианты — выбор всегда за автором, не навязывай один явный фаворит.',
    'Название должно продавать жанр и цеплять в каталоге/на полке, не быть буквальным пересказом сюжета одной фразой.',
  ].join('\n');
  const user = [
    `Жанр: ${p.genre||'роман'}. Аудитория: ${p.audience||'широкая'}.`,
    p.synopsis||p.idea ? `Синопсис: ${p.synopsis||p.idea}` : '',
    p.title ? `Текущее рабочее название (для контекста, не обязательно быть похожим): «${p.title}»` : '',
    '',
    'ОБЗОР КНИГИ ПО ГЛАВАМ И СЦЕНАМ (сводки по порядку):',
    bookOverview(state),
    '',
    'Предложи 5-8 вариантов названия. Разные по духу — не 8 вариаций одной и той же идеи: попробуй разные углы (атмосфера, центральный образ/предмет, ирония, прямое обещание жанра, вопрос без ответа).',
    'Верни JSON: { "titles": [ { "title":"вариант названия", "reason":"почему подходит — коротко, по-русски" } ] }',
    'Только JSON.',
  ].filter(Boolean).join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

export async function suggestTitles(state){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ (⚙).');
  if(!canSuggestTitles(state)) throw new Error('Нужна хотя бы идея книги и 2 написанные главы.');
  const msgs = titleSuggestMessages(state);
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.9, messages:msgs, maxTokens:900, retries:g.retries });
  const j = extractJSON(res.text);
  const arr = j && Array.isArray(j.titles) ? j.titles : null;
  if(!arr) throw new Error('Не удалось разобрать ответ.');
  return arr.slice(0,8).map(t=>({
    title: String(t.title||'').trim().slice(0,120),
    reason: String(t.reason||'').trim().slice(0,200),
  })).filter(t=>t.title);
}
