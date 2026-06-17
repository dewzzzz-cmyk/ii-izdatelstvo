// Режим серии (спека 5.2): из импортированной книги извлекаем голос,
// персонажей (с состоянием на конец книги), факты в Bible, сводку книги.

import { callLLM, extractJSON } from './llm.js';
import { extractVoice } from './voice.js';
import { rebuildBibleVecs } from './bible.js';
import { smartTrunc } from './tokens.js';

function extractMessages(title, text){
  // ограничим вход: начало + конец книги (smartTrunc), чтобы поймать завязку и финал
  const sample = smartTrunc(text, 16000);
  const sys = 'Ты — архивариус серии. Из текста книги извлекаешь канон для продолжения: персонажей с их состоянием НА КОНЕЦ книги, ключевые факты мира, краткую сводку.';
  const user = [
    'Книга: ' + (title||''),
    '',
    'ТЕКСТ (начало и конец книги):',
    sample,
    '',
    'Верни JSON: {',
    '  "summary": "сводка книги до 300 слов — сюжетная дуга и итоги",',
    '  "characters": [{"name":"имя","desc":"кто это","state":"состояние/положение на конец книги"}],',
    '  "facts": [{"keys":"ключи через запятую","text":"канонический факт о мире/персонажах"}]',
    '}',
    'characters — главные и важные второстепенные. facts — места, предметы, правила мира (5-15). Только JSON.',
  ].join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

// Импортировать книгу в проект-серию. Мутирует state, возвращает отчёт.
export async function importSeriesBook(state, title, text){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ.');

  // 1. Голос — из образца текста (примеры + метрики)
  const voiceSample = text.slice(0, 4000);
  const extractedVoice = extractVoice(voiceSample, 6);
  // дифф-эволюция: если голос уже был — запомним сдвиг средней длины
  const prevAvg = state.voice?.metrics?.avgSentence;
  state.voice = extractedVoice;
  if(prevAvg && extractedVoice.metrics){
    state.voice.evolution = state.voice.evolution || [];
    state.voice.evolution.push({ book:title, avgSentence:extractedVoice.metrics.avgSentence, delta: extractedVoice.metrics.avgSentence - prevAvg });
  }

  // 2. Канон/персонажи/сводка — через LLM
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.3, messages:extractMessages(title, text), maxTokens:2000 });
  const j = extractJSON(res.text) || {};

  // персонажи
  let chAdded=0;
  (Array.isArray(j.characters)?j.characters:[]).forEach(c=>{
    if(!c||!c.name) return;
    let ex = state.characters.find(x=>x.name.toLowerCase()===c.name.toLowerCase());
    if(!ex){ ex={name:c.name, desc:'', stateNote:'', book:title}; state.characters.push(ex); chAdded++; }
    ex.desc = c.desc||ex.desc; ex.stateNote = c.state||ex.stateNote; ex.book = title;
  });

  // факты в Bible
  let factsAdded=0;
  (Array.isArray(j.facts)?j.facts:[]).forEach(f=>{
    if(!f||!f.text) return;
    if(!state.bible.some(b=>(b.text||'').toLowerCase()===f.text.toLowerCase())){ state.bible.push({keys:f.keys||'', text:f.text}); factsAdded++; }
  });
  if(factsAdded) rebuildBibleVecs(state.bible);

  // сводка книги → серия
  const summary = typeof j.summary==='string'? j.summary.trim() : '';
  state.series = state.series || [];
  state.series.push({ title, summary, importedAt: Date.now() });
  state.project.type = 'series';

  return { voiceExamples: state.voice.examples.length, charactersAdded: chAdded, factsAdded, summary, wordCount: (text.match(/\S+/g)||[]).length };
}
