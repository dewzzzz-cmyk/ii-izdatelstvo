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

// Разбор ответа в список {original, suggestion, reason}. Правки, чью цитату
// не удалось найти дословно в тексте (перефразировала модель), отбрасываются —
// подсветить и применить их всё равно нельзя.
export function parseEditorSuggestions(raw, originalText){
  const out = [];
  if(!raw) return out;
  const body = (raw.match(/\[ПРАВКИ\]([\s\S]*?)(?:\[\/ПРАВКИ\]|$)/i) || [])[1] || raw;
  // Внутренние группы допускают один уровень вложенных «…» (см. guards.js parseRejected).
  const re = /[-–—•]\s*«((?:[^«»]|«[^»]*»)*)»\s*→\s*«((?:[^«»]|«[^»]*»)*)»\s*[—-]?\s*(.*)/g;
  let m;
  while((m = re.exec(body))){
    const original = m[1].trim(), suggestion = m[2].trim(), reason = (m[3] || '').trim();
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
