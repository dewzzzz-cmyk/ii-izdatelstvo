// Оценка токенов и умное усечение. Перенесено из ИИ-Издательства.
// Кириллица ≈ длина/2 токена, латиница ≈ длина/4 — грубо, для бюджета.

export function estimateTokens(text){
  if(!text) return 0;
  const s = String(text);
  const cyr = (s.match(/[а-яёА-ЯЁ]/g)||[]).length;
  const other = s.length - cyr;
  return Math.ceil(cyr/2 + other/4);
}

// Сохраняет начало и конец, убирает середину (модель лучше помнит края).
export function smartTrunc(text, maxLen){
  if(!text || text.length<=maxLen) return text||'';
  const half = Math.floor(maxLen*0.45);
  return text.slice(0,half) + '\n…[середина сжата для экономии контекста]…\n' + text.slice(-half);
}

// Усечь текст до целевого числа токенов через smartTrunc (с запасом по символам).
export function trimToTokens(text, maxTokens){
  if(estimateTokens(text) <= maxTokens) return text||'';
  // приблизительно: средний символ ~ 0.35 токена для смешанного RU-текста
  const approxChars = Math.floor(maxTokens / 0.4);
  return smartTrunc(text, approxChars);
}
