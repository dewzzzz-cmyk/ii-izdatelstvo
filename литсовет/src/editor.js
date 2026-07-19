// Редактор (стилистическая построчная правка) — в отличие от Аа✓ (только
// орфография/пунктуация), ищет клише, эмоциональные ярлыки, однообразный
// ритм, слабые обороты. Возвращает СТРУКТУРИРОВАННЫЕ точечные правки
// (original → suggestion), а не сплошной переписанный текст — это нужно,
// чтобы подсвечивать фрагменты прямо в редакторе и принимать/отклонять
// каждую по отдельности (см. src/ui/stages.js, кнопка «📝 Редактор»).

import { callLLM } from './llm.js';

const SYSTEM = [
  'Ты — построчный литературный редактор. Ищешь МЕСТА для точечного улучшения:',
  '— клише и шаблонные обороты;',
  '— эмоциональные ярлыки («он испугался») вместо показа через действие/деталь;',
  '— однообразный синтаксис, слова-паразиты, лишние наречия;',
  '— слабые, невыразительные глаголы и обороты.',
  'НЕ трогаешь: сюжет, факты, смысл диалогов, авторский голос и осознанные приёмы.',
  'Каждая правка — короткий фрагмент (3-15 слов) для точечной замены, НЕ переписывай абзацы целиком.',
  'Цитата фрагмента должна быть ДОСЛОВНОЙ — символ в символ как в тексте, иначе её не найти.',
].join('\n');

function userPrompt(text, forbidden){
  return [
    forbidden && forbidden.length ? 'Особенно избегай: ' + forbidden.join(', ') + '.' : '',
    'ТЕКСТ:', text, '',
    'Найди 3-8 мест для правки (меньше, если текст короткий и чистый). Ответь строго в формате:',
    '[ПРАВКИ]',
    '- «дословная цитата фрагмента» → «замена» — короткая причина',
    '(каждая правка с новой строки; если править нечего — одна строка: нет)',
    '[/ПРАВКИ]',
  ].filter(Boolean).join('\n');
}

// Читает «сбалансированную» по глубине цитату «…», начиная с индекса
// открывающей «. Возвращает {content, end} (end — индекс сразу после
// закрывающей »), или null если она не закрылась на этой строке.
function readBalancedQuote(line, openIdx){
  if(line[openIdx] !== '«') return null;
  let depth = 1, i = openIdx + 1;
  for(; i < line.length; i++){
    if(line[i] === '«') depth++;
    else if(line[i] === '»'){ depth--; if(depth === 0) break; }
  }
  if(depth !== 0) return null;
  return { content: line.slice(openIdx+1, i), end: i+1 };
}

// Разбор ответа в список {original, suggestion, reason}. Правки, чью цитату
// не удалось найти дословно в тексте (перефразировала модель), отбрасываются —
// подсветить и применить их всё равно нельзя.
// Построчный разбор с подсчётом глубины скобок (та же техника, что и в
// guards.js parseRejected) — раньше единый регэксп поддерживал только ОДИН
// уровень вложенных «…» внутри цитаты и молча терял всю правку при 3+
// уровнях (модель процитировала фрагмент, который сам содержит цитату/диалог).
export function parseEditorSuggestions(raw, originalText){
  const out = [];
  if(!raw) return out;
  const body = (raw.match(/\[ПРАВКИ\]([\s\S]*?)(?:\[\/ПРАВКИ\]|$)/i) || [])[1] || raw;
  for(const line of body.split('\n')){
    const bm = line.match(/^\s*[-–—•]\s*/);
    if(!bm) continue;
    const first = readBalancedQuote(line, bm[0].length);
    if(!first) continue;
    const arrowIdx = line.indexOf('→', first.end);
    if(arrowIdx < 0) continue;
    let idx2 = arrowIdx + 1;
    while(line[idx2] === ' ') idx2++;
    const second = readBalancedQuote(line, idx2);
    if(!second) continue;
    const reason = line.slice(second.end).trim().replace(/^[—-]\s*/, '').trim();
    const original = first.content.trim(), suggestion = second.content.trim();
    if(!original || !suggestion || original === suggestion) continue;
    if(!originalText.includes(original)) continue;
    out.push({ original, suggestion, reason });
  }
  return out;
}

export async function suggestEdits(text, state){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ (⚙).');
  text = (text || '').trim();
  if(text.length < 40) throw new Error('Слишком короткий текст.');
  const maxTk = Math.min(2000, Math.round(text.length / 3) + 600);
  const res = await callLLM({
    baseURL: g.baseURL, apiKey: g.apiKey, model: g.model,
    temperature: 0.3, messages: [
      { role:'system', content: SYSTEM },
      { role:'user', content: userPrompt(text, state.style?.forbidden) },
    ], maxTokens: maxTk, retries: g.retries,
  });
  return parseEditorSuggestions(res.text, text);
}
