// Клиентская обёртка над /api/generate-image (server.js) — единый вызов,
// не зависящий от того, какой провайдер выбран (Gemini/Nano Banana, OpenAI, Qwen).
// Сервер сам знает разницу форматов запроса/ответа — отсюда только настройки.

// Очень грубая оценка стоимости на картинку (USD) — ориентир для автора ДО
// траты денег, не точный биллинг (у провайдеров своя точная тарификация).
// Qwen/DashScope — самая неуверенная оценка из трёх: цены Wanxiang в CNY и
// пересчёт очень приблизительный.
export const IMAGE_PRICE_ESTIMATE = {
  gemini: { standard: 0.02, hd: 0.04 },
  openai: { standard: 0.04, hd: 0.08 },
  qwen:   { standard: 0.02, hd: 0.03 },
};

export function estimateImageCost(provider, quality, count){
  const perImage = (IMAGE_PRICE_ESTIMATE[provider]||IMAGE_PRICE_ESTIMATE.gemini)[quality==='hd'?'hd':'standard'];
  return Math.round(perImage * (count||1) * 1000) / 1000;
}

// generateImage({provider, apiKey, model, prompt, size, quality, proxyToken}) → {dataUrl}
export async function generateImage(opts){
  const res = await fetch('/api/generate-image', {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({
      provider: ['openai','qwen'].includes(opts.provider) ? opts.provider : 'gemini',
      apiKey: opts.apiKey,
      model: opts.model,
      prompt: opts.prompt,
      size: opts.size,
      quality: opts.quality,
      proxyToken: opts.proxyToken,
    }),
  });
  if(!res.ok){
    const t = await res.text().catch(()=>'');
    throw new Error(t || ('HTTP '+res.status));
  }
  const j = await res.json();
  if(!j.dataUrl) throw new Error('Провайдер не вернул изображение.');
  return { dataUrl: j.dataUrl };
}
