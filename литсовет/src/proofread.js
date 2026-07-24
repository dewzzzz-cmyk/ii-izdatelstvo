// ИИ-корректор: орфография, пунктуация, грамматическое согласование.
// НЕ трогает стиль — этим занимаются Линейный редактор и Стражи.
// Формат ответа секциями [ПРАВКИ]/[ТЕКСТ], а не JSON: полный текст сцены
// в JSON-строке ломается на экранировании переносов.

import { callLLM } from './llm.js';

const SYSTEM = [
  'Ты — корректор русского художественного текста. Исправляешь ТОЛЬКО ошибки:',
  '— орфография и опечатки;',
  '— пунктуация по правилам русского языка (запятые при оборотах, тире в диалогах, прямая речь);',
  '— грамматическое согласование (род, число, падеж, вид глагола).',
  'ЗАПРЕЩЕНО менять: стиль, лексику, порядок слов, ритм, разбиение на абзацы, авторские приёмы.',
  'Авторская пунктуация (тире, многоточия, парцелляция, намеренные повторы) — НЕ ошибка.',
  'Если сомневаешься, ошибка это или приём — НЕ трогай.',
].join('\n');

function userPrompt(text){
  return [
    'ТЕКСТ:',
    text,
    '',
    'Ответь строго в формате:',
    '[ПРАВКИ]',
    '- «фрагмент с ошибкой» → «исправление» — короткая причина',
    '(каждая правка с новой строки; если ошибок нет — одна строка: нет)',
    '[ТЕКСТ]',
    'полный текст с внесёнными исправлениями, без комментариев',
  ].join('\n');
}

// Разбор ответа: список правок + исправленный текст.
export function parseProofread(raw, original){
  const out = { fixes: [], corrected: original };
  if(!raw) return out;
  const m = raw.match(/\[ПРАВКИ\]([\s\S]*?)\[ТЕКСТ\]([\s\S]*)$/i);
  if(!m){
    // Секций нет — модель могла вернуть просто текст; без списка правок применять опасно.
    return out;
  }
  out.fixes = m[1].split('\n').map(l=>l.replace(/^\s*[-–—•]\s*/,'').trim())
    .filter(l=>l && !/^нет\.?$/i.test(l))
    // пустышки: модель иногда перечисляет проверенные места без изменений
    .filter(l=>!/ошибк[аи]\s+нет|без изменений|не требует/i.test(l))
    .filter(l=>{ const q=l.match(/«([^»]*)»\s*→\s*«([^»]*)»/); return !q || q[1]!==q[2]; });
  const corrected = m[2].trim();
  // Защита от усечённого ответа: исправленный текст не может быть сильно короче оригинала.
  if(corrected && corrected.length >= original.length * 0.7) out.corrected = corrected;
  else out.fixes = [];   // текст обрезан — правки не применяем
  return out;
}

// Прогнать текст через корректора. Возвращает { fixes: string[], corrected, cost }.
export async function proofreadText(text, state){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ (⚙).');
  text = (text||'').trim();
  if(text.length < 20) throw new Error('Слишком короткий текст.');
  const maxTk = Math.round(Math.min(8000, Math.round(text.length / 2) + 800) * 1.2); // кириллица ≈ 2 симв./токен
  const res = await callLLM({
    baseURL: g.baseURL, apiKey: g.apiKey, model: g.model,
    temperature: 0.1, messages: [
      { role:'system', content: SYSTEM },
      { role:'user', content: userPrompt(text) },
    ], maxTokens: maxTk, retries: g.retries,
  });
  const parsed = parseProofread(res.text, text);
  return { ...parsed, cost: res.cost, tokensIn: res.tokensIn, tokensOut: res.tokensOut };
}
