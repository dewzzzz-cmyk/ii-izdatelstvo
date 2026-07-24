// Голос автора. Из образца прозы извлекаем:
//   - examples: отобранные предложения (управляющий вход few-shot в промпт)
//   - metrics:  числовые показатели (ТОЛЬКО индикатор UI, не инжектируются)
// Спека раздел 5.2, 7: модели идут примеры, не числа.

import { tokensOf } from './bible.js';
import { callLLM, extractJSON } from './llm.js';

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
  if(n<=1) return sents.slice(0,1);
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

// Разбор манеры письма по образцу: явные правила (не голые примеры) по граням —
// диалоги, описание мира/окружения, синтаксис и ритм, образность. Правила работают
// надёжнее, чем "угадай паттерн по 5 примерам" (см. Правила автора).
export async function analyzeStyleManner(sample, state){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ (⚙).');
  if((sample||'').trim().length < 40) throw new Error('Слишком короткий образец.');
  const msgs = [
    { role:'system', content: 'Ты — литературный редактор. Анализируешь образец прозы автора и формулируешь ЯВНЫЕ правила его манеры письма — чтобы другой автор мог писать в той же манере, не копируя текст.' },
    { role:'user', content: [
      'ОБРАЗЕЦ ПРОЗЫ АВТОРА:',
      sample,
      '',
      'Сформулируй 6-10 конкретных правил манеры письма, по граням:',
      '— Диалоги: как оформлены реплики (теги, ритм, длина), подтекст vs прямота.',
      '— Описание мира/окружения: через что показывается (действие, деталь, сенсорика), сколько текста на это уходит.',
      '— Синтаксис и ритм: длина и структура предложений, характерные конструкции.',
      '— Образность: какие тропы использует автор или намеренно избегает.',
      'Каждое правило — конкретная действующая инструкция для другого автора (как в брифе), НЕ пересказ содержания образца и не общие слова вроде "живой язык".',
      'Верни JSON: { "rules": ["правило1", "правило2", …] }. Только JSON.',
    ].join('\n') },
  ];
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.3, messages:msgs, maxTokens:1440 });
  const j = extractJSON(res.text);
  return Array.isArray(j?.rules) ? j.rules.filter(Boolean) : [];
}

// Превращает разовое наблюдение (клише/замечание/цитата фрагмента), привязанное
// к конкретному месту в тексте, в общий принцип письма — для кнопки "⊕ В правило".
export async function generalizeToRule(text, state){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ (⚙).');
  if(!(text||'').trim()) throw new Error('Нечего обобщать.');
  const msgs = [
    { role:'system', content: 'Ты помогаешь автору превращать разовое наблюдение о своём тексте в общий принцип письма — применимый ко всем будущим сценам, а не привязанный к одной.' },
    { role:'user', content: [
      'НАБЛЮДЕНИЕ (привязано к конкретному месту в тексте):',
      text,
      '',
      'Переформулируй как ОБЩЕЕ правило-принцип для автора: одно предложение, без ссылок на конкретную сцену, фразу или имя персонажа. Верни только текст правила, без кавычек и пояснений.',
    ].join('\n') },
  ];
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.3, messages:msgs, maxTokens:240 });
  return (res.text||'').trim().replace(/^["«]+|["»]+$/g,'');
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
