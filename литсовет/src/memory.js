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

export function rollback(state, level, id, versionIdx){
  const bucket = state.memory[level];
  const entry = bucket && bucket[id];
  if(!entry || !entry.versions[versionIdx]) return false;
  const restore = entry.versions[versionIdx].text;
  // текущее уходит в версии, восстановленное становится текущим
  entry.versions.splice(versionIdx,1);
  entry.versions.unshift({ text: entry.current, at: Date.now() });
  entry.current = restore;
  return true;
}

// Суммаризировать одну завершённую сцену: обновляет сводку, состояния, Bible.
export async function summarizeScene(state, scene){
  const g = state.global;
  if(!g.apiKey || !scene.text) return null;
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

  // новые факты в Bible
  let added = 0;
  parsed.facts.forEach(f=>{
    const exists = state.bible.some(b=>(b.text||'').toLowerCase()===(f.text||'').toLowerCase());
    if(!exists){ state.bible.push({ keys:f.keys||'', text:f.text }); added++; }
  });
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
export function driftCheck(state, scene){
  const signals = [];
  // (1) оценочный дрейф голоса
  const voiceScores = (state.structure||[]).filter(n=>n.type==='scene' && n.lastEval && n.lastEval.scores)
    .map(n=>Number(n.lastEval.scores.voice)||0);
  if(scene.lastEval && scene.lastEval.scores && voiceScores.length>=3){
    const prior = voiceScores.slice(0,-1);
    const avg = prior.reduce((a,b)=>a+b,0)/prior.length;
    const cur = Number(scene.lastEval.scores.voice)||0;
    if(avg - cur >= 2) signals.push(`оценка голоса упала: ${cur} против среднего ${avg.toFixed(1)}`);
  }
  // (2) расстояние до образца
  if(state.voice && state.voice.sample && scene.text){
    const sampleVec = tfvec(tokensOf(state.voice.sample));
    const sceneVec = tfvec(tokensOf(scene.text));
    const sim = cosine(sampleVec, sceneVec);
    // низкое лексическое сходство — не строгий сигнал, но индикатор
    if(sim < 0.04) signals.push(`низкое лексическое сходство с образцом (${sim.toFixed(3)})`);
  }
  return signals;
}

// Воссоздать _vec после загрузки из IndexedDB (векторы не сериализуются).
export function rehydrateBible(state){
  if(state.bible && state.bible.length && !state.bible.some(b=>b._vec)){
    rebuildBibleVecs(state.bible);
  }
}
