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

function doneScenesOrdered(state){
  return (state.structure||[]).filter(n=>n.type==='scene' && n.status==='done' && n.text);
}

// Компактный обзор книги по порядку ЧТЕНИЯ (structure), не порядку написания.
function bookOverview(state){
  const mem = state.memory||{};
  const nodes = state.structure||[];
  const parts = [];
  nodes.forEach(n=>{
    if(n.type==='chapter'){ parts.push(`\nГЛАВА: «${n.title}»`); }
    else if(n.type==='scene'){
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
    'ОБЗОР ВСЕЙ КНИГИ ПО ГЛАВАМ И СЦЕНАМ (сводки по порядку):',
    bookOverview(state),
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
