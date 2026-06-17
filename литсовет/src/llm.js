// Клиент к /api/generate. Стриминг текста; ретраи; оценка стоимости.

import { estimateTokens } from './tokens.js';
import { PRICES } from './state.js';

// Вызов LLM. messages — массив {role, content}. Возвращает {text, tokensIn, tokensOut, cost}.
// onToken(chunk) — колбэк для стрима (опц.).
export async function callLLM({ baseURL, apiKey, model, temperature, messages, maxTokens, retries=2 }, onToken){
  const tokensIn = messages.reduce((s,m)=>s+estimateTokens(m.content), 0);
  let lastErr = null;
  for(let attempt=0; attempt<=retries; attempt++){
    try{
      const res = await fetch('/api/generate', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ baseURL, apiKey, model, temperature, messages,
          ...(maxTokens?{max_tokens:maxTokens}:{}) }),
      });
      if(!res.ok){
        const body = await res.text().catch(()=> '');
        // 429/5xx — ретраим с бэкоффом
        if((res.status===429 || res.status>=500) && attempt<retries){
          await sleep(500 * Math.pow(2, attempt)); lastErr = body; continue;
        }
        throw new Error(`HTTP ${res.status}: ${body.slice(0,200)}`);
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
      return { text: text.trim(), tokensIn, tokensOut, cost };
    }catch(e){
      lastErr = e.message;
      if(attempt>=retries) throw new Error(lastErr);
      await sleep(500 * Math.pow(2, attempt));
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
