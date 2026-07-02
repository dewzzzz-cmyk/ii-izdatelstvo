// Управление иерархической памятью (спека 7, 7.1).
// Хранит сводки сцен/глав/книг с версионированием (откат при дрейфе).
// Обновляет состояния персонажей. Численный детектор дрейфа.

import { callLLM } from './llm.js';
import { sceneSummaryMessages, parseSceneSummary,
         chapterSummaryMessages, bookSummaryMessages, parseSummary } from './summarizer.js';
import { rebuildBibleVecs, tokensOf, tfvec, cosine } from './bible.js';
import { RUBRIC_AXES } from './agents.js';

// Запись памяти с версиями: { current, versions:[{text, at}] }
function putVersioned(bucket, id, text){
  const prev = bucket[id];
  const entry = prev || { current:'', versions:[] };
  if(entry.current && entry.current !== text){
    entry.versions.unshift({ text: entry.current, at: Date.now() });
    if(entry.versions.length > 8) entry.versions.length = 8;
  }
  entry.current = text;
  bucket[id] = entry;
  return entry;
}

export function memText(bucket, id){ return bucket && bucket[id] ? bucket[id].current : ''; }

// Сколько последних посценных сводок держать «развёрнутыми» в контексте.
// Более старые сворачиваются в бегущий синопсис книги (ограничивает рост контекста).
export const KEEP_SCENES = 8;
const RUNNING_KEY = '__running__';

// Сцены в порядке написания (по writtenAt; запасной вариант — порядок в structure).
export function scenesInWriteOrder(state){
  return (state.structure||[]).filter(n=>n.type==='scene' && n.text)
    .slice().sort((a,b)=>(a.writtenAt||0)-(b.writtenAt||0));
}

// Развёрнутые (не свёрнутые) посценные сводки — для контекста.
export function activeSceneSummaries(state){
  const mem = state.memory||{};
  return scenesInWriteOrder(state)
    .filter(n=>!n.rolledUp && (mem.scenes||{})[n.id]?.current)
    .map(n=>({ id:n.id, title:n.title, text:mem.scenes[n.id].current }));
}

export function runningSynopsis(state){ return memText(state.memory.books||{}, RUNNING_KEY); }

// Свернуть переполнение: когда развёрнутых сводок > KEEP_SCENES, старейшие
// сжимаются в бегущий синопсис книги и помечаются rolledUp (исчезают из контекста).
export async function maybeRollup(state){
  const g = state.global;
  const active = activeSceneSummaries(state);
  if(active.length <= KEEP_SCENES || !g.apiKey) return null;
  const overflow = active.slice(0, active.length - KEEP_SCENES); // старейшие
  const prevSynopsis = runningSynopsis(state);
  const parts = [prevSynopsis, ...overflow.map(o=>o.text)].filter(Boolean);
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.3,
    messages: bookSummaryMessages(state.project.title||'книга', parts), maxTokens:600, retries:g.retries });
  const synopsis = parseSummary(res.text);
  if(synopsis){
    state.memory.books = state.memory.books || {};
    putVersioned(state.memory.books, RUNNING_KEY, synopsis);
    const ids = new Set(overflow.map(o=>o.id));
    (state.structure||[]).forEach(n=>{ if(ids.has(n.id)) n.rolledUp = true; });
  }
  return synopsis;
}

export function rollback(state, level, id, versionIdx){
  const bucket = state.memory[level];
  const entry = bucket && bucket[id];
  if(!entry || !entry.versions[versionIdx]) return false;
  // Честный откат (LIFO): раньше клали текущее обратно в ту же позицию, из
  // которой брали версию — второй клик по «↶» возвращал вперёд, а версии
  // старше первой становились навсегда недостижимы, хотя счётчик кнопки
  // обещал N версий назад (см. фикс revertSkeleton).
  entry.current = entry.versions.splice(versionIdx,1)[0].text;
  return true;
}

// Суммаризировать одну завершённую сцену: обновляет сводку, состояния, Bible.
export async function summarizeScene(state, scene){
  const g = state.global;
  if(!g.apiKey || !scene.text) return null;
  if(!scene.writtenAt) scene.writtenAt = Date.now(); // порядок написания для дрейфа/сворачивания
  const msgs = sceneSummaryMessages(scene, scene.text);
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.3, messages:msgs, maxTokens:500, retries:g.retries });
  const parsed = parseSceneSummary(res.text);
  if(!parsed) return null;

  state.memory.scenes = state.memory.scenes || {};
  if(parsed.summary) putVersioned(state.memory.scenes, scene.id, parsed.summary);

  // обновляем состояния персонажей
  parsed.characters.forEach(c=>{
    let ch = state.characters.find(x=>x.name.toLowerCase()===c.name.toLowerCase());
    if(!ch){ ch = { name:c.name, desc:'', stateNote:'', book:state.project.title }; state.characters.push(ch); }
    ch.stateNote = c.state || ch.stateNote;
  });

  // новые факты в Bible — дедуп по СХОДСТВУ (не только точному совпадению) + лимит
  let added = 0;
  parsed.facts.forEach(f=>{
    if(!f.text) return;
    const fvec = tfvec(tokensOf((f.keys||'')+' '+f.text));
    const dup = state.bible.some(b=>{
      if((b.text||'').toLowerCase()===f.text.toLowerCase()) return true;
      const bv = b._vec || tfvec(tokensOf((b.keys||'')+' '+(b.text||'')));
      return cosine(fvec, bv) > 0.6; // близкий по смыслу факт уже есть
    });
    if(!dup){ state.bible.push({ keys:f.keys||'', text:f.text, _vec:fvec }); added++; }
  });
  // лимит размера Bible (защита от раздувания на длинной книге): держим последние 300
  if(state.bible.length > 300) state.bible.splice(0, state.bible.length-300);
  if(added) rebuildBibleVecs(state.bible);

  return { summary: parsed.summary, charUpdates: parsed.characters.length, factsAdded: added };
}

// Суммаризировать главу (по сводкам её сцен).
export async function summarizeChapter(state, chapter){
  const g = state.global;
  const scenes = scenesOfChapter(state, chapter.id);
  const sums = scenes.map(s=>memText(state.memory.scenes, s.id)).filter(Boolean);
  if(!sums.length || !g.apiKey) return null;
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.3,
    messages: chapterSummaryMessages(chapter.title, sums), maxTokens:500, retries:g.retries });
  const summary = parseSummary(res.text);
  state.memory.chapters = state.memory.chapters || {};
  if(summary) putVersioned(state.memory.chapters, chapter.id, summary);
  return summary;
}

function scenesOfChapter(state, chapterId){
  // плоский structure: сцены между этой главой и следующей
  const nodes = state.structure||[];
  const ci = nodes.findIndex(n=>n.id===chapterId);
  if(ci<0) return nodes.filter(n=>n.type==='scene');
  const out=[];
  for(let i=ci+1;i<nodes.length;i++){ if(nodes[i].type==='chapter') break; if(nodes[i].type==='scene') out.push(nodes[i]); }
  return out;
}

// ── Детектор дрейфа (спека 7.1): численный сигнал, не ручная вычитка ──
// 1) падение оси «Голос» Оценщика ниже скользящего среднего на ≥2
// 2) рост cosine-расстояния текста сцены до образца голоса
const DRIFT_WINDOW = 5; // скользящее окно предыдущих сцен
export function driftCheck(state, scene){
  const signals = [];
  if(!scene.lastEval || !scene.lastEval.scores) return signals;
  // сцены в порядке написания, строго ДО текущей
  const ordered = scenesInWriteOrder(state).filter(n=>n.id!==scene.id && n.lastEval?.scores);

  // (1) оценочный дрейф голоса: текущая ось «Голос» против среднего по окну предыдущих
  const window = ordered.slice(-DRIFT_WINDOW).map(n=>Number(n.lastEval.scores.voice)||0);
  if(window.length>=3){
    const avg = window.reduce((a,b)=>a+b,0)/window.length;
    const cur = Number(scene.lastEval.scores.voice)||0;
    if(avg - cur >= 2) signals.push(`оценка голоса упала: ${cur} против среднего ${avg.toFixed(1)} (окно ${window.length})`);
  }

  // (2) лексическое сходство с образцом: ОТНОСИТЕЛЬНЫЙ спад против окна, не абсолютный порог
  if(state.voice && state.voice.sample && scene.text){
    const sampleVec = tfvec(tokensOf(state.voice.sample));
    const simOf = t => cosine(sampleVec, tfvec(tokensOf(t)));
    const cur = simOf(scene.text);
    const priorSims = ordered.slice(-DRIFT_WINDOW).filter(n=>n.text).map(n=>simOf(n.text));
    if(priorSims.length>=3){
      const avg = priorSims.reduce((a,b)=>a+b,0)/priorSims.length;
      // флаг только при заметном относительном спаде (>40% ниже среднего окна)
      if(avg>0 && cur < avg*0.6) signals.push(`лексика отдалилась от образца: ${cur.toFixed(3)} против среднего ${avg.toFixed(3)}`);
    }
  }
  return signals;
}

// Воссоздать _vec после загрузки из IndexedDB (векторы не сериализуются).
export function rehydrateBible(state){
  if(state.bible && state.bible.length && !state.bible.some(b=>b._vec)){
    rebuildBibleVecs(state.bible);
  }
}
