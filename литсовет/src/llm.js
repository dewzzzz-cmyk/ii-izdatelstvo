// Клиент к /api/generate. Стриминг текста; ретраи; оценка стоимости.

import { estimateTokens } from './tokens.js';
import { PRICES, getState } from './state.js';

// Вызов LLM. messages — массив {role, content}. Возвращает {text, tokensIn, tokensOut, cost}.
// onToken(chunk) — колбэк для стрима (опц.). onRetry() — вызывается перед
// каждой повторной попыткой (опц.): чанки неудачной попытки уже переданы в
// onToken, и накопительный буфер вызывающего кода (напр. streamed в
// pipeline.js) иначе клеит их с началом успешного повтора без сброса.
// Должен буквально совпадать с маркером, который server.js дописывает в тело
// ответа при обрыве апстрим-соединения посреди стрима (см. комментарий там же) —
// иначе клиент снова не отличит оборванный ответ от штатно завершённого.
const STREAM_TRUNCATED_MARKER = '\n[[LITSOVET:STREAM_TRUNCATED]]';
// Должен совпадать с маркером, который server.js дописывает при
// stream_options.include_usage — реальные prompt/completion_tokens апстрима.
// Без него весь токен-учёт в приложении — только оценка на глаз (estimateTokens:
// кириллица/2 + прочее/4), которая на живых данных расходилась с реальностью
// (JSON-ответы Оценщика/Стражей на живом прогоне превышали заявленный
// maxTokens по оценке приложения, хотя апстрим честно уложился в лимит —
// эвристика просто иначе считает баланс кириллицы/пунктуации в JSON).
const USAGE_MARKER_RE = /\n\[\[LITSOVET:USAGE:(\{[\s\S]*?\})\]\]\s*$/;

// Обрыв по лимиту токенов для агентов ВНЕ пайплайна сцены (Мир, Структура,
// Критик книги, Иллюстрации, История, Серия). Все они разбирают ответ через
// extractJSON, а тот на оборванном JSON возвращает null — и вызывающий читает
// это как «ничего не найдено». Итог: «нестыковок нет» и «замечаний нет»
// неотличимы от «ответ не поместился». Бросаем понятную ошибку: у всех этих
// функций вызывающий UI уже ловит исключение и показывает текст автору, а
// молчаливый пустой результат не показывает ничего.
export function assertNotTruncated(res, что){
  if(res && res.hitLimit){
    throw new Error(`Ответ модели обрезан лимитом токенов (${что}). Результат неполный — не применяю. Увеличьте лимит этого агента в настройках или упростите запрос.`);
  }
}

// Инородная письменность в русской прозе. Живой инцидент: DeepSeek выдал
// «За十年的 работы» во ВТОРОМ предложении сцены, и это прошло через три
// черновика, 126 замечаний Стражей, Оценщика и Линейного редактора — ни одна
// проверка не смотрела на алфавит. Для моделей китайского происхождения утечка
// иероглифов в чужой язык — не разовая случайность, а класс дефекта.
//
// Латиница НЕ считается инородной намеренно: имена, названия судов, эпиграфы
// на европейских языках в русской книге легитимны. Ловим только письменности,
// появление которых в русском тексте почти наверняка означает сбой модели.
// Осознанная цитата на иврите или китайском даст ложное срабатывание — это
// приемлемо: находка показывается автору, а не правит текст молча.
const FOREIGN_SCRIPT = /[　-〿぀-ヿ㐀-䶿一-鿿가-힯ᄀ-ᇿ＀-￯֐-׿؀-ۿऀ-ॿ฀-๿]/;
export function findForeignScript(text){
  const s = String(text||'');
  if(!FOREIGN_SCRIPT.test(s)) return [];
  const g = new RegExp(FOREIGN_SCRIPT.source, 'g');
  const out = []; const виденные = new Set();
  let m;
  while((m = g.exec(s))){
    // Показываем не одинокий символ, а слово целиком с соседями: «十» само по
    // себе автору ничего не говорит, а «За十年的 работы» сразу видно, где искать.
    const от = Math.max(0, s.lastIndexOf(' ', m.index) + 1);
    let до = s.indexOf(' ', g.lastIndex); if(до < 0) до = s.length;
    const фрагмент = s.slice(от, до).trim();
    const ключ = фрагмент || m[0];
    if(!виденные.has(ключ)){ виденные.add(ключ); out.push({ char:m[0], quote:ключ }); }
    if(out.length >= 8) break;   // хватит, чтобы показать масштаб
  }
  return out;
}

export async function callLLM({ baseURL, apiKey, model, temperature, messages, maxTokens, retries=2 }, onToken, onRetry){
  const tokensIn = messages.reduce((s,m)=>s+estimateTokens(m.content), 0);
  let lastErr = null;
  for(let attempt=0; attempt<=retries; attempt++){
    if(attempt>0 && onRetry){ try{ onRetry(); }catch{} }
    const controller = new AbortController();
    // Таймаут БЕЗДЕЙСТВИЯ (90с без единого чанка), не общий потолок запроса.
    // Живой инцидент: генерация скелета книги (60 сцен, ~15 тыс. токенов
    // ответа после честного подъёма бюджета под entryState) легитимно идёт
    // дольше 90 секунд — жёсткий таймер убивал ЗДОРОВЫЙ стрим на середине.
    // Раньше это маскировалось тем, что заниженный maxTokens обрезал ответ
    // раньше, чем истекал таймер. Сбрасываем таймер на каждом чанке: висящий
    // мёртвый коннект по-прежнему отваливается за 90с, длинный живой — нет.
    let timeoutId = setTimeout(()=>controller.abort(new Error('LLM timeout (90s)')), 90000);
    const armTimeout = ()=>{ clearTimeout(timeoutId); timeoutId = setTimeout(()=>controller.abort(new Error('LLM timeout (90s без данных)')), 90000); };
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
      // Живой инцидент: маркер [[LITSOVET:USAGE:{...}]], который сервер
      // дописывает в САМ КОНЕЦ потока (см. USAGE_MARKER_RE ниже), утёк в
      // видимый автору текст («Добро пожаловать».\n[[LITSOVET:USAGE:...]]).
      // Причина: onToken(chunk) звал наружу СЫРЫЕ чанки по мере поступления —
      // некоторые вызывающие (напр. ui/stages.js, прямое присваивание
      // scene.text=prog.text при живом стриме) показывают и даже могут
      // сохранить их автору РАНЬШЕ, чем этот же код ниже успевает вырезать
      // маркер из финального text. Придерживаем хвост потока на LOOKBACK
      // символов — с большим запасом длиннее любого реального маркера — и
      // отдаём в onToken только то, что заведомо старше этого хвоста; сам
      // маркер, где бы он ни начался, никогда не покидает эту функцию.
      const LOOKBACK = 400;
      let emitted = '';
      const flushSafe = ()=>{
        if(text.length - emitted.length <= LOOKBACK) return;
        const safeUpto = text.length - LOOKBACK;
        const chunk = text.slice(emitted.length, safeUpto);
        emitted = text.slice(0, safeUpto);
        if(onToken && chunk) onToken(chunk);
      };
      while(true){
        const {value, done} = await reader.read();
        if(done) break;
        armTimeout(); // стрим живой — не даём таймауту убить длинный здоровый ответ
        text += dec.decode(value, {stream:true});
        flushSafe();
      }
      // Сервер дописывает этот маркер в тело ответа, если апстрим оборвался
      // посреди генерации (см. server.js) — раньше такой обрыв был неотличим от
      // штатного конца стрима, и оборванный на полуслове текст молча уходил
      // в пайплайн как «готовый». Превращаем маркер в обычную ретраимую ошибку —
      // ниже она попадёт в тот же catch(e), что и сетевые сбои.
      const truncIdx = text.indexOf(STREAM_TRUNCATED_MARKER);
      if(truncIdx !== -1) throw new Error('Соединение с сервером генерации оборвалось на середине ответа');
      // Реальные токены апстрима, если сервер их прислал (см. USAGE_MARKER_RE
      // выше) — маркер обрезается из текста ДО того, как он уйдёт дальше в
      // пайплайн прозой/JSON. Если апстрим usage не прислал (не-OpenAI-совместимый
      // провайдер, старый сервер до этого фикса) — тихо падаем на оценку, как раньше.
      let realTokensIn = null, realTokensOut = null, finishReason = '';
      const usageMatch = text.match(USAGE_MARKER_RE);
      if(usageMatch){
        text = text.slice(0, usageMatch.index);
        try{
          const usage = JSON.parse(usageMatch[1]);
          if(typeof usage.prompt_tokens === 'number') realTokensIn = usage.prompt_tokens;
          if(typeof usage.completion_tokens === 'number') realTokensOut = usage.completion_tokens;
          if(typeof usage.finish === 'string') finishReason = usage.finish;
        }catch{}
      }
      // Досылаем остаток, придержанный LOOKBACK-буфером выше — text уже
      // очищен от обоих маркеров, так что здесь гарантированно чистый хвост.
      if(onToken && text.length > emitted.length) onToken(text.slice(emitted.length));
      const finalTokensIn = realTokensIn ?? tokensIn;
      const tokensOut = realTokensOut ?? estimateTokens(text);
      // Модель без записи в PRICES считалась по тарифу DeepSeek — самому
      // дешёвому в таблице. Для gpt-класса это занижение в 20-100 раз, и
      // отличить «книга обошлась в $2» от «в $2 по чужому прайсу» было
      // нельзя. Тариф-заглушка остаётся (иначе счётчик застынет и станет
      // врать в другую сторону), но модель запоминается, и шапка честно
      // показывает, что сумма — нижняя оценка.
      const known = PRICES[model];
      const p = known || {in:0.14, out:0.28};
      const cost = finalTokensIn/1e6*p.in + tokensOut/1e6*p.out;
      // Единая точка учёта расхода на текущий проект — см. state.spend в
      // state.js. Считаем здесь, а не в каждой из ~20 функций, которые зовут
      // callLLM: так гарантированно не пропустим ни один запрос, независимо
      // от того, через какого агента/кнопку он прошёл.
      const st = getState();
      if(st){
        st.spend = st.spend || {text:0, images:0};
        st.spend.text += cost;
        if(!known && model){
          st.spend.unpriced = st.spend.unpriced || [];
          if(!st.spend.unpriced.includes(model)) st.spend.unpriced.push(model);
        }
      }
      // hitLimit — ДОСТОВЕРНЫЙ признак «ответ обрезан по maxTokens», сказанный
      // самим апстримом ('length' у OpenAI-совместимых, 'max_tokens' у Anthropic),
      // а не эвристика looksTokenTruncated по хвосту текста. Нужен всем ~44
      // вызовам вне пайплайна сцены (Мир, Структура, Критик книги, Иллюстрации,
      // История, Серия): все они разбирают ответ через extractJSON, а тот на
      // оборванном JSON возвращает null — и вызывающий читает это как «ничего
      // не найдено». Так «нестыковок нет» и «замечаний нет» становились
      // неотличимы от «ответ не поместился в лимит».
      const hitLimit = finishReason === 'length' || finishReason === 'max_tokens';
      return { text: text.trim(), tokensIn: finalTokensIn, tokensOut, cost, finishReason, hitLimit };
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
  // Первый СБАЛАНСИРОВАННЫЙ {...} в тексте. Раньше здесь стоял жадный
  // /\{[\s\S]*\}/ — он тянул до ПОСЛЕДНЕЙ скобки во всём ответе, поэтому
  // валидный JSON, за которым идёт проза со скобками (модель любит дописать
  // «шаблон {название} подставится сам»), разбирался в null: ответ был
  // корректным, а пайплайн считал его мусором. Считаем глубину и учитываем
  // строки с экранированием, чтобы скобка внутри значения не сбивала счёт.
  const obj = firstBalanced(text);
  if(obj){ try{ return JSON.parse(obj); }catch{} }
  return null;
}

// Первый сбалансированный {...}-фрагмент строки либо null.
function firstBalanced(text){
  const start = text.indexOf('{');
  if(start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for(let i = start; i < text.length; i++){
    const c = text[i];
    if(esc){ esc = false; continue; }
    if(c === '\\'){ if(inStr) esc = true; continue; }
    if(c === '"'){ inStr = !inStr; continue; }
    if(inStr) continue;
    if(c === '{') depth++;
    else if(c === '}'){ depth--; if(depth === 0) return text.slice(start, i+1); }
  }
  return null;   // скобки не закрылись — ответ оборван по токенам
}
