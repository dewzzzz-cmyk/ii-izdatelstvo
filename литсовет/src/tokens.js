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
  const s = text||'';
  const total = estimateTokens(s);
  if(total <= maxTokens) return s;
  // Раньше здесь стоял ПЛОСКИЙ коэффициент (0.4 ток/симв) независимо от того,
  // что реально в тексте: estimateTokens сам считает кириллицу и всё
  // остальное разными коэффициентами (1/2 и 1/4) — для чисто кириллической
  // прозы (обычный случай для этого приложения) реальная плотность ≈0.5
  // ток/симв, а не 0.4. approxChars, посчитанный по плоским 0.4, получался
  // БОЛЬШЕ, чем нужно, и итоговый текст после smartTrunc всё равно оставался
  // ВЫШЕ запрошенного maxTokens — единственный вызывающий (context.js,
  // «последний рубеж» ужатия живого контекста перед отправкой в LLM) не
  // получал гарантии, которую сам же и просил. Берём фактическую плотность
  // ЭТОГО текста (её же считает estimateTokens), а не универсальную константу.
  const ratio = total / s.length; // ток/симв для конкретного текста
  const approxChars = Math.floor(maxTokens / Math.max(ratio, 0.01));
  return smartTrunc(s, approxChars);
}
