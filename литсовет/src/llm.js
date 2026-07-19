// Клиент к /api/generate. Стриминг текста; ретраи; оценка стоимости.

import { estimateTokens } from './tokens.js';
import { PRICES, getState } from './state.js';

// Вызов LLM. messages — массив {role, content}. Возвращает {text, tokensIn, tokensOut, cost}.
// onToken(chunk) — колбэк для стрима (опц.). onRetry() — вызывается перед
// каждой повторной попыткой (опц.): чанки неудачной попытки уже переданы в
// onToken, и накопительный буфер вызывающего кода (напр. streamed в
// pipeline.js) иначе клеит их с началом успешного повтора без сброса.
export async function callLLM({ baseURL, apiKey, model, temperature, messages, maxTokens, retries=2 }, onToken, onRetry){
  const tokensIn = messages.reduce((s,m)=>s+estimateTokens(m.content), 0);
  let lastErr = null;
  for(let attempt=0; attempt<=retries; attempt++){
    if(attempt>0 && onRetry){ try{ onRetry(); }catch{} }
    const controller = new AbortController();
    const timeoutId = setTimeout(()=>controller.abort(new Error('LLM timeout (90s)')), 90000);
    try{
      const res = await fetch('/api/generate', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ baseURL, apiKey, model, temperature, messages,
          ...(maxTokens?{max_tokens:maxTokens}:{}) }),
        signal: controller.signal,
      });
      if(!res.ok){
        const body = await res.text().catch(()=> '');
        // 429/5xx — ретраим с бэкоффом; остальное (401/400/403 и т.п. — неверный
        // ключ, битый payload, несуществующая модель) фатально и от повтора не
        // исправится — раньше эти статусы ретраились наравне с сетевыми ошибками
        // через общий catch ниже, впустую тратя время на каждом узле пайплайна.
        const retryable = res.status===429 || res.status>=500;
        if(retryable && attempt<retries){
          await sleep(500 * Math.pow(2, attempt)); lastErr = body; continue;
        }
        const err = new Error(`HTTP ${res.status}: ${body.slice(0,200)}`);
        if(!retryable) err.nonRetryable = true;
        throw err;
      }
      // стрим text/plain
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let text = '';
      while(true){
        const {value, done} = await reader.read();
        if(done) break;
        const chunk = dec.decode(value, {stream:true});
        text += chunk;
        if(onToken) onToken(chunk);
      }
      const tokensOut = estimateTokens(text);
      const p = PRICES[model] || {in:0.14, out:0.28};
      const cost = tokensIn/1e6*p.in + tokensOut/1e6*p.out;
      // Единая точка учёта расхода на текущий проект — см. state.spend в
      // state.js. Считаем здесь, а не в каждой из ~20 функций, которые зовут
      // callLLM: так гарантированно не пропустим ни один запрос, независимо
      // от того, через какого агента/кнопку он прошёл.
      const st = getState();
      if(st){ st.spend = st.spend || {text:0, images:0}; st.spend.text += cost; }
      return { text: text.trim(), tokensIn, tokensOut, cost };
    }catch(e){
      if(e.nonRetryable) throw e;
      lastErr = e.message;
      if(attempt>=retries) throw new Error(lastErr);
      await sleep(500 * Math.pow(2, attempt));
    }finally{
      clearTimeout(timeoutId);
    }
  }
  throw new Error(lastErr || 'LLM call failed');
}

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

// Извлечь JSON-объект из ответа модели (модель часто оборачивает в ```json).
export function extractJSON(text){
  if(!text) return null;
  // попытка прямого парса
  try{ return JSON.parse(text); }catch{}
  // блок ```json ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if(fence){ try{ return JSON.parse(fence[1]); }catch{} }
  // первый {...} в тексте
  const brace = text.match(/\{[\s\S]*\}/);
  if(brace){ try{ return JSON.parse(brace[0]); }catch{} }
  return null;
}
