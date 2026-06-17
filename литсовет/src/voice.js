// Голос автора. Из образца прозы извлекаем:
//   - examples: отобранные предложения (управляющий вход few-shot в промпт)
//   - metrics:  числовые показатели (ТОЛЬКО индикатор UI, не инжектируются)
// Спека раздел 5.2, 7: модели идут примеры, не числа.

import { tokensOf } from './bible.js';

function splitSentences(text){
  return (text||'')
    .replace(/\s+/g,' ')
    .match(/[^.!?…]+[.!?…]+(?:["»)]+)?/g) || [];
}

// Метрики стиля (для отображения автору).
export function computeMetrics(sample){
  const sents = splitSentences(sample).map(s=>s.trim()).filter(Boolean);
  if(!sents.length) return null;
  const wordCounts = sents.map(s=>tokensOf(s).length);
  const avgLen = Math.round(wordCounts.reduce((a,b)=>a+b,0) / sents.length);
  // доля диалога — предложения, начинающиеся с — или содержащие кавычки реплик
  const dialogue = sents.filter(s=>/^[—–-]\s|[«"]/.test(s.trim())).length;
  const dialogueRatio = Math.round(dialogue / sents.length * 100);
  // ритм — стандартное отклонение длины (вариативность)
  const mean = avgLen;
  const variance = wordCounts.reduce((a,b)=>a+(b-mean)**2,0)/wordCounts.length;
  const rhythm = Math.round(Math.sqrt(variance));
  return { avgSentence: avgLen, dialogueRatio, rhythmStdev: rhythm, sentenceCount: sents.length };
}

// Отбор N характерных примеров: предпочитаем разнообразие длины
// (короткие + средние + длинные), чтобы передать ритм, а не только среднее.
export function pickExamples(sample, n=5){
  const sents = splitSentences(sample).map(s=>s.trim()).filter(s=>tokensOf(s).length>=3);
  if(sents.length<=n) return sents;
  const withLen = sents.map(s=>({s, len:tokensOf(s).length}));
  withLen.sort((a,b)=>a.len-b.len);
  // равномерная выборка по отсортированной длине → захватываем спектр ритма
  const picked = [];
  for(let i=0;i<n;i++){
    const idx = Math.round(i * (withLen.length-1) / (n-1));
    picked.push(withLen[idx].s);
  }
  return [...new Set(picked)];
}

// Извлечь голос из образца: заполняет examples + metrics.
export function extractVoice(sample, n=5){
  return {
    sample,
    examples: pickExamples(sample, n),
    metrics: computeMetrics(sample),
  };
}

// Текстовый блок голоса для промпта (только примеры + запреты).
export function voicePromptBlock(voice, forbidden){
  const lines = [];
  if(voice.examples && voice.examples.length){
    lines.push('Примеры предложений в голосе автора (подражай ритму и интонации, НЕ копируй дословно):');
    voice.examples.forEach(e=>lines.push('  «' + e + '»'));
  }
  if(forbidden && forbidden.length){
    lines.push('Запрещено: ' + forbidden.join(', ') + '.');
  }
  return lines.join('\n');
}
