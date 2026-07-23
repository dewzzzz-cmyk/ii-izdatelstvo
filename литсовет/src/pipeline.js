// Линейная оркестрация пайплайна сцены (спека: executor как идеи, не граф).
// ПП2-цепочка: [Архитектор] → Прозаик ⇄ Оценщик (петля).
// Каждый агент включаем/отключаем; всё пишется в диагностический трейс.

import { callLLM } from './llm.js';
import { buildSceneContext, bookContextBlock } from './context.js';
import { architectMessages, parseArchitect, architectToText,
         evaluatorMessages, parseEvaluator, RUBRIC_AXES } from './agents.js';
import { voiceGuardMessages, logicGuardMessages, eventsGuardMessages,
         lineEditMessages, runGuardParse, customGuardMessages, surgicalReviseMessages,
         radicalReviseMessages, parseDebateRevision, styleGuardMessages, readerGuardMessages,
         imageryGuardMessages, povGuardMessages, dialogueGuardMessages, resolutionGuardMessages,
         atmosphereGuardMessages, humorGuardMessages, findDuplicatePhrases, findBoundaryRepeat,
         looksTokenTruncated } from './guards.js';
import { startRun, logStep, endRun, agentEnabled } from './diagnostics.js';
import { tokensOf, tfvec, cosine } from './bible.js';
import { recordObservedPattern, ag, effectiveRules } from './state.js';
import { genreWantsHumor } from './genres.js';

let _running = false; // защита от конкурентного прогона (переключение сцены и т.п.)
export function isRunning(){ return _running; }

// Фактические стражи — бегут каждую итерацию, пока текст ещё меняется (в отличие от
// литературных, которые видят текст только один раз, в конце).
const FACTUAL_GUARD_ROLES = new Set(['logic','events']);
// Кастомный страж может опционально отметить себя «фактическим» (a.factual===true,
// чекбокс в настройках стража) — тогда он тоже бежит каждую итерацию, а не только
// когда текст уже принят. Раньше это было жёстко захардкожено только на logic/events.
function isFactualGuard(state, role){
  if(FACTUAL_GUARD_ROLES.has(role)) return true;
  const a = ag(state, role);
  return !!(a.custom && a.factual);
}

const GUARD_LABELS = {voiceguard:'Страж голоса', logic:'Страж логики', events:'Страж событий', styleguard:'Страж стиля', reader:'Читатель', imagery:'Страж образов', pov:'Страж точки зрения', dialogue:'Страж диалога', resolution:'Страж развязки', atmosphere:'Страж атмосферы', humor:'Страж жанра', repeat:'Проверка повторов', freshness:'Повтор между сценами', boundary:'Повтор стыка сцен'};
function guardLabel(state, role){ return GUARD_LABELS[role] || ag(state, role).name || role; }

// Похожесть двух коротких замечаний (TF-IDF косинус на стеммированных токенах,
// см. bible.js) — используется, чтобы не подсвечивать замечание, которое
// Прозаик уже мотивированно отклонил как художественный приём.
// Поднято с 0.4 до 0.75: на коротких замечаниях с малым словарём (мало
// уникальных не-стоп-слов) косинус легко даёт 0.85-0.9 даже для РАЗНЫХ находок —
// например, head-hopping про одного персонажа и head-hopping про другого
// («переключение POV» — общие слова, разное имя) склеивались в одно отклонение,
// и вторая, реальная находка переставала подсвечиваться (найдено консилиумом).
const REJECT_SIM_THRESHOLD = 0.75;
function noteSimilarity(a, b){ return cosine(tfvec(tokensOf(a)), tfvec(tokensOf(b))); }
// Сколько итераций подряд один и тот же вопрос фактических стражей (логика/события)
// может остаться без ответа, прежде чем перестать быть необязательным пробелом и
// стать обязательной правкой (см. FACTUAL_ESCALATE_ITERS ниже по файлу).
const FACTUAL_ESCALATE_ITERS = 3;
function isRejectedNote(text, rejectedNotes){
  if(!rejectedNotes || !rejectedNotes.length || !text) return false;
  return rejectedNotes.some(rn => noteSimilarity(text, rn.quote + ' ' + (rn.reason||'')) >= REJECT_SIM_THRESHOLD);
}
// Запоминает вновь отклонённые пункты на сцене (дедуп против уже сохранённых).
function rememberRejected(scene, rejected){
  if(!rejected || !rejected.length) return;
  scene.rejectedNotes = scene.rejectedNotes || [];
  rejected.forEach(r=>{
    if(!r.quote) return;
    const dup = scene.rejectedNotes.some(rn => noteSimilarity(rn.quote, r.quote) >= REJECT_SIM_THRESHOLD);
    if(!dup) scene.rejectedNotes.push({ quote:r.quote, reason:r.reason||'', ts:Date.now() });
  });
  if(scene.rejectedNotes.length > 30) scene.rejectedNotes = scene.rejectedNotes.slice(-30);
}

// Конфиг агента по роли ИЛИ id (для кастомных). Настраивается ползунками.
function manual(state, role){ return ag(state, role).manual === true; }

// Пауза на подтверждение в ручном режиме. Возвращает {approve, note, text}.
// extra может нести {draft, editable} — тогда автор правит текст прямо в окне.
async function gate(state, role, label, output, opts, extra={}){
  if(!manual(state, role) || !opts.onApproval) return { approve:true };
  return await opts.onApproval({ role, label, output, ...extra });
}
// Объединённая директива: Прозаик получает всё сразу — оценщик + стражи + запреты.
function buildUnifiedDirective(verdict, allBanned, criticalFlags, factualQuestions, literaryNotes, tooShort){
  const parts = [];
  if((verdict.anchors||[]).length) parts.push('СОХРАНИ ДОСЛОВНО (якоря): ' + verdict.anchors.join('; '));
  // Ось «Темп» Оценщика пишет notes вида «избыточная деталь — сократи/убери» на
  // каждой итерации, не глядя на текущий объём сцены. Когда сцена уже заметно
  // короче цели (tooShort), эта команда — один голос среди прочих замечаний —
  // статистически перевешивает единственный lengthNote в конце директивы (найдено
  // на реальном прогоне: ось «Темп» + 6 правок диалога одной итерацией срезали
  // 761→671 слов, несмотря на lengthNote). Глушим команду «режь» ТОЧЕЧНО у
  // notes, где она встречается — сама претензия (что именно топчется) остаётся
  // видна, просто без указания как её решать.
  const notes = (verdict.notes||[]).map(n=>
    (tooShort && SHORTEN_HINT_RE.test(n)) ? n + ' — НЕ сокращай: сцена и так короче цели, реши другим способом.' : n);
  parts.push(...notes);
  if(criticalFlags.length) parts.push('КРИТИЧЕСКИЕ ЗАМЕЧАНИЯ СТРАЖЕЙ:\n' + criticalFlags.join('\n'));
  // Отдельно от критических: вопросы фактических стражей (логика/события) с severity
  // "warning" — их собственный промпт называет их пробелом, на который не нужно
  // выдумывать ответ, а не командой исправить. Раньше они попадали в criticalFlags
  // наравне с настоящими critical — Прозаик был вынужден изобретать факт, которого
  // в сцене нет, лишь бы «исправить» то, что на деле было вопросом автору.
  if(factualQuestions && factualQuestions.length) parts.push('ВОПРОСЫ СТРАЖЕЙ ЛОГИКИ/СОБЫТИЙ (это пробел, не ошибка — не выдумывай факт: либо сделай формулировку нейтральной, либо оставь как есть для решения автора):\n' + factualQuestions.join('\n'));
  // Замечания литературных стражей (голос/стиль/юмор/диалог/развязка/атмосфера/...)
  // с severity 'warning' — раньше эти стражи физически не успевали отработать до
  // последней итерации (см. гейт iter>=maxIter-1 выше), так что их находки было
  // некому применить. Теперь они успевают, но по своей природе это стилистические
  // рекомендации, а не обязательные к исправлению ошибки — формулируем как совет.
  if(literaryNotes && literaryNotes.length) parts.push('ЗАМЕЧАНИЯ ЛИТЕРАТУРНЫХ СТРАЖЕЙ (стиль/приём — учти при правке, если не противоречит другим указаниям):\n' + literaryNotes.join('\n'));
  if(allBanned.length) parts.push('убери клише (все предыдущие итерации): ' + allBanned.join(', '));
  return parts.join('\n\n');
}
// Директивы прямо просят сократить/сжать текст — тогда безопасность-от-усечения
// (откат к prevDraft, если ответ короче 60% исходного) не должна срабатывать:
// иначе легитимное «сократи вдвое» автоматически отменялось тем же условием,
// что защищает от случайно оборванного ответа модели.
const SHORTEN_HINT_RE = /сократ|покороче|короче|уменьш|сожми|срежь|вырежи/i;
// looksTokenTruncated теперь общий экспорт guards.js (используется и в ondemand.js).
function flagsText(flags){
  const all=[]; Object.entries(flags).forEach(([role,arr])=>(arr||[]).forEach(f=>all.push(`[${f.severity}] ${f.title}: ${f.detail||''}`)));
  return all.length? all.join('\n') : 'Флагов нет.';
}

// Запустить пайплайн для одной сцены. Возвращает {text, eval, runId}.
// onProgress({stage, text}) — для UI стрима.
export async function runScene(state, scene, opts={}, onProgress){
  if(_running) throw new Error('Уже идёт прогон — дождитесь завершения.');
  _running = true;
  const g = state.global;
  const llmBase = { baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, retries:g.retries };
  const prevSceneText = opts.prevSceneText || prevDoneSceneText(state, scene);
  const runId = startRun(scene.id, 'Сцена: ' + (scene.title||scene.id));

  try {
    // ── 1. Архитектор сцены (опц.) ──
    let architectText = '';
    if(agentEnabled('architect')){
      const ac = ag(state,'architect');
      const aMsgs = architectMessages(state, scene);
      for(let g0=0; g0<6; g0++){
        onProgress && onProgress({stage:'architect', text:'Архитектор планирует сцену…'});
        const aRes = await callLLM({ ...llmBase, temperature:ac.temp??0.4, messages:aMsgs, maxTokens:ac.maxTokens??600 });
        const plan = parseArchitect(aRes.text);
        architectText = architectToText(plan, scene);
        if(plan && plan.presentChars.length) scene.presentChars = plan.presentChars;
        logStep({ agent:'architect', input:aMsgs[1].content, output:aRes.text,
          tokensIn:aRes.tokensIn, tokensOut:aRes.tokensOut, cost:aRes.cost });
        onProgress && onProgress({log:{icon:'🏗', text:'Архитектор: план сцены готов'}});
        const gt = await gate(state,'architect','Архитектор сцены', architectText||aRes.text, opts);
        if(gt.approve) break;
        aMsgs.push({ role:'user', content:'Переделай план сцены. '+(gt.note||'') });
      }
    }

    // ── 2+3. Единая петля: Прозаик ⇄ Оценщик + Стражи ──
    // Стражи — часть той же петли, не отдельный цикл.
    // Прозаик получает объединённую директиву (оценщик + стражи вместе) и разбирает всё в [РАЗБОР].
    // Консенсус = Оценщик принял И Стражи молчат.
    const proseAg = ag(state,'prose'), evalAg = ag(state,'evaluator');
    const threshold = g.evaluatorThreshold ?? 7.5;
    const maxIter = agentEnabled('evaluator') ? (g.evaluatorMaxIter ?? 5) : 1;
    // 'auto' (умолчание) — решает жанр, как раньше. Явная настройка автора
    // (style.humorLevel) может как включить стража юмора вне «иронических»
    // жанров ('light'/'strong'), так и выключить его в них ('off').
    const humorLevel = state.style?.humorLevel;
    const wantsHumor = humorLevel==='off' ? false
      : (humorLevel==='light' || humorLevel==='strong') ? true
      : genreWantsHumor(state.project?.genre);
    const hasGuards = agentEnabled('voiceguard') || agentEnabled('logic') || agentEnabled('events') ||
      agentEnabled('reader') || agentEnabled('imagery') || agentEnabled('pov') || agentEnabled('dialogue') ||
      agentEnabled('resolution') || agentEnabled('atmosphere') || (agentEnabled('humor') && wantsHumor) ||
      (agentEnabled('styleguard') && (state.style?.rules||[]).filter(Boolean).length) ||
      (state.agents||[]).some(a=>a.custom && a.enabled!==false);
    let best = null, bestEval = null, bestClean = false, bestFlags = {}, bestLiteraryChecked = false;
    let directive = opts.directive || '';
    let prevDraft = opts.initialDraft || '';
    let lastGenerated = ''; // последний РЕАЛЬНО сгенерированный текст — переживает
    // reset prevDraft='' в ручном гейте Прозаика ниже, так что финальный fallback
    // (после выхода из цикла) никогда не сохраняет пустую сцену.
    let iter = 0, safety = 0;
    let flags = {};
    const bannedCliches = new Set();
    // Клише из ДРУГИХ уже написанных сцен книги (state.usedCliches) — Прозаик
    // видит их в директиве («убери клише») уже с итерации 1, не только клише
    // из ЭТОЙ сцены. Живой пример: «птица — резко, как по металлу» повторилась
    // почти дословно в двух разных сценах, потому что раньше это множество
    // обнулялось при каждом новом runScene().
    (state.usedCliches||[]).forEach(c=>bannedCliches.add(c));
    const crossSceneCliches = [...bannedCliches]; // снимок ДО этой сцены — для проверки похожести ниже
    let anchorVerdict = null;   // оценки итерации 1 — baseline для стабильности Оценщика
    const scoreHistory = [];    // история scores по итерациям — детектор стагнации осей
    // История вопросов фактических стражей по итерациям — детектор «застрявшего»
    // пробела (см. FACTUAL_ESCALATE_ITERS ниже): один и тот же вопрос без ответа
    // много итераций подряд эскалируется в обязательную правку.
    let factualWarningTracker = [];
    const AXIS_LABELS = Object.fromEntries(RUBRIC_AXES.map(a=>[a.key, a.label]));
    // true, если предыдущая итерация обнаружила стагнацию осей — на СЛЕДУЮЩУЮ
    // итерацию идём через radicalReviseMessages вместо surgicalReviseMessages
    // (см. комментарий там же): иначе директива «измени РАДИКАЛЬНО» уходит в
    // промпт, который тут же безусловно запрещает именно это, и застревание
    // никогда не выходит из локального минимума точечных правок.
    let stagnantLastIter = false;

    while(iter < maxIter && safety++ < 20){
      iter++;
      const isRevision = !!(iter > 1 && prevDraft || iter === 1 && prevDraft && directive);
      let streamed = '';
      const streamCb = chunk=>{ streamed+=chunk; onProgress && onProgress({stage:'prose', text:streamed, streaming:true}); };
      // Сброс накопленного превью при внутреннем ретрае callLLM (см. llm.js) —
      // иначе чанки неудачной попытки, уже показанные через streamCb, оставались
      // склеены с началом успешного повтора на несколько секунд стриминга.
      const streamRetry = ()=>{ streamed = ''; };
      let pRes, logInput, logLayers;
      if(isRevision){
        onProgress && onProgress({stage:'prose', text: stagnantLastIter
          ? `Прозаик перерабатывает застрявшие места шире обычного (итерация ${iter})…`
          : `Прозаик разбирает замечания и правит черновик (итерация ${iter})…`});
        // Живой замер по уже написанной книге (14 сцен): реальная плотность
        // токен/слово ≈2.78 по собственной оценке приложения (estimateTokens в
        // tokens.js) — выше, чем закладывал старый потолок в 5000 для длинных
        // сцен, да ещё без запаса на текст самого [РАЗБОР] перед [ТЕКСТ]. Раньше
        // это и роняло сцены в обрыв на правке (см. looksTokenTruncated чуть
        // ниже) при абсолютно нормальном, не сетевом сбое — модели физически не
        // хватало лимита дописать переписанную прозу после разбора замечаний.
        const cap = Math.min(11000, Math.max(2500, Math.round(prevDraft.length/2) + 2000));
        const reviseMsgs = stagnantLastIter
          ? radicalReviseMessages(prevDraft, directive, effectiveRules(state.style))
          : surgicalReviseMessages(prevDraft, directive, effectiveRules(state.style));
        pRes = await callLLM({ ...llmBase, temperature:0.4, messages: reviseMsgs, maxTokens: Math.max(proseAg.maxTokens ?? cap, cap) }, streamCb, streamRetry);
        const parsed = parseDebateRevision(pRes.text);
        if(parsed.debate) logStep({ agent:'prose-debate', iter, input:directive, output:parsed.debate, tokensIn:0, tokensOut:0, cost:0 });
        if(parsed.rejected && parsed.rejected.length){
          rememberRejected(scene, parsed.rejected);
          onProgress && onProgress({log:{icon:'🖋', text:`Прозаик мотивированно отклонил ${parsed.rejected.length} замеч. (${parsed.rejected.map(r=>'«'+r.quote.slice(0,40)+'»').join(', ')}) — больше не будут подсвечиваться`}});
        }
        if(parsed.truncated){
          onProgress && onProgress({log:{icon:'⚠️', text:'Прозаик: ответ обрезан токенами (нет секции [ТЕКСТ]) — используем предыдущий черновик', state:'warn'}});
          pRes.text = prevDraft;
        } else if(parsed.prose) pRes.text = parsed.prose;
        // parsed.truncated ловит только «тега [ТЕКСТ] почти нет» (обрыв сразу после
        // тега) — но тег может быть на месте, а сама проза внутри него оборваться
        // на полуслове чуть дальше (обрыв ближе к концу ответа, формально не «почти
        // пусто»). Живой инцидент: две сцены книги ушли в финал с последним
        // предложением, обрывающимся посреди слова — ни parsed.truncated (тег и
        // текст были), ни проверка длины ниже (обрыв был не настолько драматичным,
        // чтобы просесть под 60%) этого не поймали. looksTokenTruncated — та же
        // эвристика, что уже стоит на первом черновике и на Линейном редакторе.
        if(pRes.text && pRes.text !== prevDraft && looksTokenTruncated(pRes.text)){
          onProgress && onProgress({log:{icon:'⚠️', text:'Прозаик: правка обрывается не на знаке препинания (похоже на обрыв токенами, хотя тег [ТЕКСТ] был на месте) — используем предыдущий черновик', state:'warn'}});
          pRes.text = prevDraft;
        }
        if(pRes.text && pRes.text.length < prevDraft.length*0.6 && !SHORTEN_HINT_RE.test(directive)) pRes.text = prevDraft;
        logInput = '(разбор замечаний + точечная правка) ' + (directive||'');
      } else {
        onProgress && onProgress({stage:'prose', text:'Прозаик пишет…'});
        const ctx = buildSceneContext(state, scene, { prevSceneText, architectOutput:architectText, directive, prevDraft:'' });
        const sceneWords = scene.targetWords || 700;
        // 3.5 ток/слово (не 2.5) — с запасом над реальной плотностью ≈2.78,
        // измеренной на уже написанных сценах книги (см. cap чуть выше по файлу).
        const dynMin = Math.max(2500, Math.round(sceneWords * 3.5));
        const proseMaxTk = proseAg.maxTokens != null ? Math.max(proseAg.maxTokens, dynMin) : dynMin;
        pRes = await callLLM({ ...llmBase, temperature: proseAg.temp ?? 0.85, messages:ctx.messages, maxTokens: proseMaxTk }, streamCb, streamRetry);
        // Первый черновик не проходит через parseDebateRevision (нет секции [ТЕКСТ] —
        // это просто сырая проза), поэтому обрыв по лимиту токенов раньше не ловился
        // вообще: текст молча уходил дальше по пайплайну оборванным на полуслове.
        // Настоящая проза почти всегда кончается на пунктуацию конца предложения —
        // резкий обрыв без неё сильный сигнал упора в maxTokens, не завершения мысли.
        if(looksTokenTruncated(pRes.text)){
          // Раньше потолок в 8000 срезал повтор до +28% вместо честного ×2 для
          // сцен с proseMaxTk уже за 4000 (2500+ слов) — повтор с почти тем же
          // лимитом почти гарантированно упирался туда же.
          const retryMaxTk = Math.min(16000, proseMaxTk * 2);
          onProgress && onProgress({log:{icon:'⚠️', text:`Прозаик: черновик похож на обрыв токенами (${proseMaxTk} ток.) — повтор с лимитом ${retryMaxTk}`, state:'warn'}});
          pRes = await callLLM({ ...llmBase, temperature: proseAg.temp ?? 0.85, messages:ctx.messages, maxTokens: retryMaxTk }, streamCb, streamRetry);
          // Раньше результат повтора принимался безусловно — если обрыв повторялся
          // (редко, но бывает: тот же лимит или второй сетевой обрыв подряд), никто
          // это уже не перепроверял. draftTruncated ниже по циклу всё равно не даст
          // такому черновику победить в отборе best/консенсусе — это предупреждение
          // просто делает причину видимой автору сразу, а не постфактум.
          if(looksTokenTruncated(pRes.text)){
            onProgress && onProgress({log:{icon:'⚠️', text:'Прозаик: черновик всё ещё обрывается после повтора с удвоенным лимитом — консенсус для этой итерации будет заблокирован, проверьте сцену', state:'warn'}});
          }
        }
        logInput = ctx.messages[1].content; logLayers = ctx.layers;
      }
      prevDraft = pRes.text;
      if(pRes.text) lastGenerated = pRes.text;
      logStep({ agent:'prose', iter, input:logInput, output:pRes.text,
        layers:logLayers, tokensIn:pRes.tokensIn, tokensOut:pRes.tokensOut, cost:pRes.cost });
      const _budget = (state.global && state.global.budgetTokens) || 32000;
      const _pct = Math.round((pRes.tokensIn||0) / _budget * 100);
      onProgress && onProgress({log:{icon:'✍️', text:isRevision?`Прозаик: черновик ${iter} (разобрал замечания)`:`Прозаик: черновик ${iter} написан · контекст ${pRes.tokensIn||0} / ${_budget} ток. (${_pct}%)`}});
      if(!isRevision && (pRes.tokensIn||0) > _budget * 0.8){
        onProgress && onProgress({log:{icon:'⚠️', text:`Контекст заполнен на ${_pct}% — часть памяти (сводки сцен, глав) могла быть урезана. Увеличьте бюджет в Настройках или свёртывайте старые сцены.`, state:'warn'}});
      }

      // Если Оценщик тоже ручной, его гейт покажет тот же черновик + оценку сразу после —
      // не спрашиваем дважды подряд одно и то же без контекста.
      const evaluatorWillGate = agentEnabled('evaluator') && manual(state,'evaluator');
      if(manual(state,'prose') && !evaluatorWillGate){
        const gt = await gate(state,'prose','Прозаик'+(iter>1?` · итерация ${iter}`:''), '', opts, {draft:pRes.text, editable:true});
        if(!gt.approve){ directive=gt.note||directive; prevDraft=''; iter--; continue; }
        if(gt.text!=null && gt.text.trim()){ pRes.text=gt.text.trim(); prevDraft=pRes.text; }
      }

      let verdict = null;
      if(agentEnabled('evaluator')){
        onProgress && onProgress({stage:'evaluator', text:'Оценщик судит черновик…'});
        const eMsgs = evaluatorMessages(scene, pRes.text, state.voice?.examples, bookContextBlock(state, scene), effectiveRules(state.style));
        // Anchor-score: передаём baseline итерации 1 чтобы Оценщик не дрейфовал между итерациями
        if(iter > 1 && anchorVerdict?.ok){
          const baseStr = Object.entries(anchorVerdict.scores).map(([k,v])=>`${AXIS_LABELS[k]||k}:${v}`).join(', ');
          eMsgs[1].content += `\n\nИтерация ${iter}. Базовые оценки черновика 1: [${baseStr}]. Оценивай ТЕКУЩИЙ черновик относительно baseline — ось должна расти там где проблема устранена, и падать если добавлена новая.`;
        }
        const eRes = await callLLM({ ...llmBase, temperature:evalAg.temp??0.2, messages:eMsgs, maxTokens:evalAg.maxTokens??900 });
        verdict = parseEvaluator(eRes.text, threshold);
        // Якорь ставим на ПЕРВЫЙ успешно распарсенный вердикт, не строго на итерации
        // 1 — раньше, если итерация 1 не распарсилась (verdict.ok===false), anchorVerdict
        // навсегда оставался null на всю сцену: условие `iter===1 && verdict.ok`
        // больше никогда не выполнялось, и стабилизация оценок между итерациями
        // молча отключалась.
        if(!anchorVerdict && verdict.ok) anchorVerdict = verdict;
        if(verdict.ok) scoreHistory.push({...verdict.scores, iter});
        logStep({ agent:'evaluator', iter, input:'(черновик)', output:eRes.text, verdict,
          tokensIn:eRes.tokensIn, tokensOut:eRes.tokensOut, cost:eRes.cost });
        const evalLogExtra = (verdict.anchors?.length?` · ✦ ${verdict.anchors[0]}`:'')
          + (verdict.questions?.length?` · ? ${verdict.questions[0]}`:'');
        const deltaStr = iter > 1 && anchorVerdict?.ok && verdict.ok
          ? ` (Δ${verdict.weighted > anchorVerdict.weighted ? '+' : ''}${(verdict.weighted - anchorVerdict.weighted).toFixed(1)})`
          : '';
        onProgress && onProgress({log:{ icon:'⚖️',
          text:`Оценщик: ${verdict.ok?verdict.weighted+'/10'+deltaStr:'—'} ${verdict.pass?'✓ принято':'↻ на доработку'}`
            + (verdict.cliches?.length?` · клише: ${verdict.cliches.join(', ')}`
               : (verdict.notes?.length?` · ${verdict.notes[0]}`:'')+evalLogExtra),
          state: verdict.pass?'ok':'warn' }});
        (verdict.cliches||[]).forEach(c=>bannedCliches.add(c));
      }
      const allBanned = [...bannedCliches];
      const hasCliches = !!(verdict && (verdict.cliches||[]).length > 0);
      // Без Оценщика (выключен) «принято» тривиально верно — завершение решают
      // тогда только Стражи, через критический/warning-флаг.
      const evalAccepted = !agentEnabled('evaluator') || (verdict.ok && verdict.pass && !(hasCliches && iter < maxIter));
      // Черновик уже заметно короче цели — используется и директивой ниже (глушит
      // команды «сократи» из notes Оценщика), и в самом lengthNote дальше по циклу.
      const curWords = (pRes.text.match(/\S+/g)||[]).length;
      const tooShort = !!(scene.targetWords && curWords < scene.targetWords*0.7);
      // Грубый недобор (<60% цели) — отдельный, жёсткий порог: такая сцена
      // почти всегда не «лаконична», а недописана — выброшены сущности брифа
      // (живой случай: открывающая сцена 621 из 1500 слов прошла консенсус,
      // потеряв целиком линию матери, на которой держится сделка следующей
      // сцены). Ниже блокирует консенсус до последней итерации.
      const grossShort = !!(scene.targetWords && curWords < scene.targetWords*0.6);
      // Финальная страховка от обрыва токенами/сетью — независимо от того, каким
      // путём (первый черновик, правка, ретрай) текст сюда дошёл. Ниже фактически
      // приравнивается к критической находке Стражей: обрывок не должен побеждать
      // в отборе best и не должен закрывать консенсус, даже если Оценщик почему-то
      // оценил его высоко (он не обучен узнавать обрыв — судит только то, что видит).
      const draftTruncated = looksTokenTruncated(pRes.text);
      if(draftTruncated) onProgress && onProgress({log:{icon:'⚠️', text:'Обрыв токенами/сетью в этом черновике — он не будет принят как готовый, даже если Оценщик оценит его высоко (Оценщик не умеет узнавать обрыв)', state:'warn'}});

      // ── Стражи: проверяют ТЕКУЩИЙ черновик (pRes.text), не исторический best.
      // Раньше проверяли best — если следующий черновик по сути исправлял находку
      // Стража, но чуть проседал по литературному баллу Оценщика, best не
      // обновлялся, и Стражи продолжали смотреть на старый, ещё бракованный текст.
      // Раньше блок Стражей был вложен в «Оценщик включён и автоматический» — при
      // ручном или выключенном Оценщике Стражи не запускались вовсе (и flags
      // оставался пустым в возвращаемом результате).
      flags = {};
      let criticals = [];
      let factualQuestions = [];
      let literaryNotes = [];
      // true, если ЭТА итерация прошла полный набор литературных стражей
      // (голос/стиль/юмор/POV/диалог/развязка/атмосфера/читатель) — они
      // намеренно запускаются не на каждой итерации (дорого), только когда
      // evalAccepted или до конца цикла осталась 1 итерация (см. ниже). Нужно
      // для best-сравнения дальше — иначе непроверенный ранний черновик может
      // обойти проверенный поздний просто по случайному баллу Оценщика.
      let literaryChecked = false;
      const voiceExamples = (state.voice?.examples||[]).filter(Boolean);

      // Проверка механических повторов (не LLM, см. guards.js) — не завязана на
      // hasGuards/agentEnabled: это не творческое суждение, а детерминированная
      // проверка на артефакт стыковки правки, дешёвая и без ложных срабатываний
      // на обычный повтор имён/слов по сцене. Всегда обязательна к исправлению.
      const dupFound = findDuplicatePhrases(pRes.text);
      if(dupFound.length){
        flags.repeat = dupFound.map(d=>({ severity:'critical', title:'Механический повтор фразы',
          detail:'Фрагмент текста повторён почти дословно рядом с собой — похоже на артефакт правки, не осознанный приём.',
          quote:d.quote }));
      }

      // Тот же принцип, но на СТЫКЕ со сценой раньше: живой инцидент — конец
      // «Первый вздох» дословно повторился как начало «Приёмная гильдии» (см.
      // findBoundaryRepeat в guards.js). dupFound выше это не ловит — сравнивает
      // текст только сам с собой в пределах ОДНОЙ сцены.
      const boundaryFound = findBoundaryRepeat(prevSceneText, pRes.text);
      if(boundaryFound.length){
        flags.boundary = boundaryFound.map(d=>({ severity:'critical', title:'Повтор конца предыдущей сцены',
          detail:'Начало этой сцены почти дословно повторяет конец предыдущей — герой уже сделал это действие, сцена должна продолжить ДАЛЬШЕ, а не пересказывать тот же момент заново.',
          quote:d.quote }));
      }

      // Клише этого черновика (verdict.cliches) против clichés из ДРУГИХ сцен книги
      // (crossSceneCliches — снимок state.usedCliches ДО этой сцены). Живой пример:
      // «птица — резко, как по металлу» повторилась почти дословно в двух разных
      // сценах — «убери клише» в директиве Прозаику само по себе не мешает ему
      // изобрести НОВУЮ фразу с той же структурой в другой сцене, если он не видит,
      // что это уже было. Порог REJECT_SIM_THRESHOLD — тот же, что и для повторных
      // вопросов Стражей (см. выше), уже проверен на реальных парах фраз.
      const crossSceneRepeats = (verdict?.cliches||[]).map(c=>{
        const cv = tfvec(tokensOf(c));
        let bestOld = null, bestSim = 0;
        crossSceneCliches.forEach(old=>{
          const sim = cosine(cv, tfvec(tokensOf(old)));
          if(sim > bestSim){ bestSim = sim; bestOld = old; }
        });
        return bestSim >= REJECT_SIM_THRESHOLD ? { quote:c, matched:bestOld } : null;
      }).filter(Boolean);
      if(crossSceneRepeats.length){
        // Явно предлагаем ДВА равноценных выхода, не только «придумай другой
        // образ» — иначе Прозаик под давлением «обязательной правки» рискует
        // заменить так себе сравнение на другое, столь же притянутое, лишь бы
        // не повторяться. Если сравнение необязательно — проще и лучше убрать
        // его вовсе, чем городить второй натянутый образ ради новизны.
        flags.freshness = crossSceneRepeats.map(r=>({ severity:'critical', title:'Повтор образа из другой сцены книги',
          detail:`Почти дословно повторяет образ, уже использованный в другой сцене: «${r.matched}». Замени на другой образ ИЛИ, если сравнение необязательно, просто убери его — не изобретай замену ради новизны, если проще обойтись без сравнения вовсе.`,
          quote:r.quote }));
      }

      if(hasGuards){
        const guardJobs = [];
        // Фактические стражи — запускаем на каждой итерации
        if(agentEnabled('logic'))  guardJobs.push(guardJob(state,'logic', llmBase, logicGuardMessages(state, scene, pRes.text, ag(state,'logic').strictness), flags, onProgress));
        if(agentEnabled('events')) guardJobs.push(guardJob(state,'events', llmBase, eventsGuardMessages(state, scene, pRes.text, ag(state,'events').strictness), flags, onProgress));
        // Кастомные стражи, отмеченные автором как «фактические» (a.factual) — тоже
        // каждую итерацию, не только когда текст уже принят.
        (state.agents||[]).filter(a=>a.custom && a.enabled!==false && a.factual).forEach(a=>{
          guardJobs.push(guardJob(state, a.id, llmBase, customGuardMessages(state, scene, pRes.text, a.prompt, a.strictness), flags, onProgress));
        });
        // Литературные стражи — когда текст принят, или за одну итерацию до конца
        // (не строго на последней): иначе их находки физически некому применить —
        // после последней итерации Прозаик уже не переписывает черновик.
        if(evalAccepted || iter >= maxIter - 1){
          literaryChecked = true;
          if(agentEnabled('voiceguard')){
            if(voiceExamples.length > 0)
              guardJobs.push(guardJob(state,'voiceguard', llmBase, voiceGuardMessages(scene, pRes.text, voiceExamples, ag(state,'voiceguard').strictness), flags, onProgress));
            else
              onProgress && onProgress({log:{icon:'👁', text:'Страж голоса: пропущен — добавьте образцы голоса в настройках «Голос»', state:'warn'}});
          }
          if(agentEnabled('styleguard') && (state.style?.rules||[]).filter(Boolean).length)
            guardJobs.push(guardJob(state,'styleguard', llmBase, styleGuardMessages(pRes.text, effectiveRules(state.style), ag(state,'styleguard').strictness), flags, onProgress));
          if(agentEnabled('reader'))
            guardJobs.push(guardJob(state,'reader', llmBase, readerGuardMessages(scene, pRes.text, ag(state,'reader').strictness), flags, onProgress));
          if(agentEnabled('imagery'))
            guardJobs.push(guardJob(state,'imagery', llmBase, imageryGuardMessages(pRes.text, ag(state,'imagery').strictness, state.project?.genre), flags, onProgress));
          if(agentEnabled('pov'))
            guardJobs.push(guardJob(state,'pov', llmBase, povGuardMessages(pRes.text, ag(state,'pov').strictness), flags, onProgress));
          if(agentEnabled('dialogue'))
            guardJobs.push(guardJob(state,'dialogue', llmBase, dialogueGuardMessages(pRes.text, ag(state,'dialogue').strictness), flags, onProgress));
          if(agentEnabled('resolution'))
            guardJobs.push(guardJob(state,'resolution', llmBase, resolutionGuardMessages(pRes.text, ag(state,'resolution').strictness), flags, onProgress));
          if(agentEnabled('atmosphere'))
            guardJobs.push(guardJob(state,'atmosphere', llmBase, atmosphereGuardMessages(pRes.text, ag(state,'atmosphere').strictness, state.project?.genre), flags, onProgress));
          // Только для иронических жанров (см. genreWantsHumor) — на остальных
          // проверка бессмысленна и просто тратила бы токены на пустой критерий.
          if(agentEnabled('humor') && wantsHumor)
            guardJobs.push(guardJob(state,'humor', llmBase, humorGuardMessages(pRes.text, ag(state,'humor').strictness, state.project?.genre), flags, onProgress));
          (state.agents||[]).filter(a=>a.custom && a.enabled!==false && !a.factual).forEach(a=>{
            guardJobs.push(guardJob(state, a.id, llmBase, customGuardMessages(state, scene, pRes.text, a.prompt, a.strictness), flags, onProgress));
          });
        }
        if(guardJobs.length){
          onProgress && onProgress({stage:'guards', text:iter>1?`Стражи перепроверяют (итерация ${iter})…`:'Стражи проверяют сцену…'});
          await Promise.all(guardJobs);
        }
      }

      // ── Свод замечаний — ВСЕГДА, не только когда сработали LLM-стражи: проверка
      // повторов (findDuplicatePhrases выше) не завязана на hasGuards и должна
      // доходить до criticals/директивы, даже если все LLM-стражи выключены.
      {
        // Замечания, которые Прозаик уже мотивированно отклонил (художественный
        // приём) — не подсвечиваем повторно и не гоняем по кругу в директиве.
        if(scene.rejectedNotes && scene.rejectedNotes.length){
          let droppedCount = 0;
          Object.keys(flags).forEach(role=>{
            const before = (flags[role]||[]).length;
            flags[role] = (flags[role]||[]).filter(f=>f.severity==='ok' || !isRejectedNote(f.title+' '+(f.detail||''), scene.rejectedNotes));
            droppedCount += before - flags[role].length;
          });
          if(droppedCount) onProgress && onProgress({log:{icon:'🖋', text:`Скрыто ${droppedCount} замеч. — уже отклонено автором ранее как приём`}});
        }

        const flagList = Object.entries(flags).flatMap(([role,arr])=>(arr||[]).filter(f=>f.severity!=='ok').map(f=>({role,severity:f.severity,title:f.title,detail:f.detail||''})));
        // Критично — от любого стража. severity:'critical' — это ошибка, Прозаик обязан
        // её исправить.
        criticals = Object.entries(flags).flatMap(([role,arr])=>(arr||[])
          .filter(f=>f.severity==='critical')
          .map(f=>`[${GUARD_LABELS[role]||role}] ${f.title}: ${f.detail||''}`));
        // warning от ФАКТИЧЕСКИХ стражей (логика/события/кастомный factual) — это,
        // по их собственному промпту, ПРОБЕЛ-ВОПРОС автору («не выдумывай ответ»),
        // а не ошибка. Раньше приравнивался к critical: Прозаик был вынужден
        // изобретать факт, которого в сцене нет, лишь бы «исправить» вопрос — и это
        // же заставляло его блокировать консенсус наравне с настоящими ошибками.
        // Теперь идёт отдельным списком — виден в директиве, но не блокирует
        // завершение сцены и не требует придумывать ответ.
        //
        // НО «не выдумывай факт» на практике означало «можно просто игнорировать
        // раз за разом» — живой прогон показал ОДИН И ТОТ ЖЕ вопрос («откуда часы
        // в кармане», «откуда у героя сюртук, если минуту назад была куртка») слово
        // в слово 4-5 итераций подряд: Прозаик ни разу не выбрал «сделай нейтральной»,
        // дыра уходила в финальный текст и путала читателя на стыке сцен. Считаем
        // повторы того же вопроса по сходству ЗАГОЛОВКА (не заголовок+detail —
        // проверено на реальных данных: одна и та же дыра почти всегда получает
        // от стража один и тот же короткий заголовок вроде «источник часов»
        // дословно или почти дословно, а вот развёрнутый detail страж каждый раз
        // формулирует заново другими словами и сходство title+detail тонет в этом
        // шуме, ни разу не достигая порога даже для 4 повторов подряд одного и
        // того же вопроса). Порог — тот же REJECT_SIM_THRESHOLD, что и у уже
        // отклонённых автором находок выше.
        //
        // Трекер копится за ВСЁ время работы над сценой, а не только по соседним
        // итерациям: страж не обязан поднимать один и тот же вопрос БУКВАЛЬНО
        // каждый раз (иногда пропускает раунд, если внимание ушло на другую
        // находку) — на живых данных «источник часов» встретился на итерациях
        // 1, 3 и 5 из 5, с другими вопросами между. Подсчёт только по соседним
        // итерациям обнулял счётчик на каждом таком пропуске и эскалация
        // никогда не срабатывала. Записи не удаляются до конца сцены — при
        // ограниченном числе итераций (maxIter, обычно ≤5-20) массив небольшой.
        // После FACTUAL_ESCALATE_ITERS появлений вопрос перестаёт быть
        // необязательным пробелом и уходит в criticals: у Прозаика было 2
        // бесплатных шанса промолчать по делу, дальше непроявленная деталь
        // (одежда, предмет в кармане и т.п.) — уже ошибка.
        const rawFactual = Object.entries(flags).flatMap(([role,arr])=>(arr||[])
          .filter(f=>f.severity==='warning' && isFactualGuard(state, role))
          .map(f=>({role, title:f.title, detail:f.detail||''})));
        const escalatedFactual = [];
        rawFactual.forEach(f=>{
          let entry = factualWarningTracker.find(t => noteSimilarity(f.title, t.title) >= REJECT_SIM_THRESHOLD);
          if(!entry){ entry = { title:f.title, count:0 }; factualWarningTracker.push(entry); }
          entry.count++;
          if(entry.count >= FACTUAL_ESCALATE_ITERS) escalatedFactual.push(f);
        });
        if(escalatedFactual.length){
          criticals.push(...escalatedFactual.map(f=>`[${GUARD_LABELS[f.role]||f.role}] (повторяется ${FACTUAL_ESCALATE_ITERS}+ итерации без изменений — уже не пробел, а ошибка) ${f.title}: ${f.detail}`));
          onProgress && onProgress({log:{icon:'⚡', text:`Вопрос стражей логики/событий повторился ${FACTUAL_ESCALATE_ITERS}+ раз без ответа — эскалирован в обязательную правку: ${escalatedFactual.map(f=>f.title).join(', ')}`, state:'warn'}});
        }
        const escalatedTitles = new Set(escalatedFactual.map(f=>f.title));
        factualQuestions = rawFactual.filter(f=>!escalatedTitles.has(f.title))
          .map(f=>`[${GUARD_LABELS[f.role]||f.role}] ${f.title}: ${f.detail}`);
        // warning от ЛИТЕРАТУРНЫХ стражей (голос/стиль/юмор/диалог/...) — раньше
        // никуда не шли дальше flagList (видны в логе, но не в директиве Прозаику):
        // с гейтом на iter>=maxIter-1 они теперь успевают появиться ДО последней
        // итерации, так что должны реально доходить до правки, а не только до лога.
        literaryNotes = Object.entries(flags).flatMap(([role,arr])=>(arr||[])
          .filter(f=>f.severity==='warning' && !isFactualGuard(state, role))
          .map(f=>`[${GUARD_LABELS[role]||role}] ${f.title}: ${f.detail||''}`));
        if(flagList.length || dupFound.length){
          onProgress && onProgress({log:{icon:'🛡',
            text: flagList.length
              ? `Стражи: ${flagList.length} замечаний${criticals.length?` (${criticals.length} крит.)`:''}${factualQuestions.length?` (${factualQuestions.length} вопр.)`:''}`
              : 'Стражи: замечаний нет',
            flags:flagList, state: flagList.length?'warn':'ok'}});
        }

        // agentEnabled() матчит только по role — для кастомных стражей (все с role:'custom')
        // это находит не того агента, поэтому здесь читаем enabled/manual напрямую через ag().
        if(hasGuards){
          const guardCandidates = ['voiceguard','logic','events','styleguard','reader','imagery','pov','dialogue','resolution','atmosphere','humor',
            ...(state.agents||[]).filter(a=>a.custom).map(a=>a.id)];
          const manualGuard = guardCandidates.find(r=>{ const a=ag(state,r); return a.enabled!==false && a.manual===true; });
          if(manualGuard && (evalAccepted || iter >= maxIter)){
            const gt = await gate(state, manualGuard, 'Стражи · флаги сцены', flagsText(flags), opts);
            if(gt.approve) criticals = [];
          }
        }
      }

      // ── best/bestEval: черновик БЕЗ критических замечаний Стражей побеждает
      // черновик с ними, даже если у второго выше литературный балл Оценщика —
      // иначе в финал уйдёт более «гладкий», но логически бракованный текст.
      // Среди двух одинаково (не)чистых — сначала проверенный литературными
      // стражами побеждает непроверенный, и только среди одинаковых по этому
      // признаку — выше балл. Раньше сравнение шло сразу по баллу: живой
      // прогон показал, что ранняя итерация (никогда не видевшая стража
      // развязки/читателя/юмора, потому что они запускаются только на
      // evalAccepted/последних итерациях) выигрывала по баллу Оценщика
      // (шум субъективных осей freshness/rhythm/±1) у поздней итерации,
      // где эти же стражи реально нашли и Прозаик реально исправил пассивную
      // победу героя и неуместный пафос — правки тихо терялись, потому что
      // непроверенный черновик выглядел «чище» просто за счёт того, что его
      // никто не проверял.
      const thisClean = criticals.length === 0 && !draftTruncated;
      if(!bestEval || (thisClean && !bestClean) ||
         (thisClean === bestClean && (
           (literaryChecked && !bestLiteraryChecked) ||
           (literaryChecked === bestLiteraryChecked && (!agentEnabled('evaluator') || (verdict.ok && verdict.weighted > (bestEval.weighted||0))))
         ))){
        // bestFlags — снимок flags ИМЕННО этой итерации (flags — общая переменная,
        // сбрасывается и переписывается на каждой итерации; без снимка возвращённые
        // флаги могли бы описывать текст из ДРУГОЙ, не победившей итерации —
        // например, дубль фразы, исправленный на итерации 2 (best), но снова
        // возникший на итерации 3 (не выигравшей) — так итог показывал бы
        // критическую находку для текста, которого в возвращённом best уже нет.
        best = pRes.text; bestEval = verdict; bestClean = thisClean; bestFlags = {...flags}; bestLiteraryChecked = literaryChecked;
      }

      if(!agentEnabled('evaluator')){
        // Без Оценщика решение о завершении — только по Стражам (+ проверка обрыва).
        if(criticals.length === 0 && !draftTruncated) break;
        directive = 'КРИТИЧЕСКИЕ ЗАМЕЧАНИЯ СТРАЖЕЙ:\n' + criticals.join('\n')
          + (factualQuestions.length ? '\n\nВОПРОСЫ СТРАЖЕЙ ЛОГИКИ/СОБЫТИЙ (не выдумывай ответ):\n' + factualQuestions.join('\n') : '')
          + (draftTruncated ? '\n\nПРЕДЫДУЩИЙ ОТВЕТ ОБОРВАЛСЯ НА ПОЛУСЛОВЕ (упор в лимит токенов/сети) — допиши/перепиши сцену целиком до естественного конца, не редактируй точечно.' : '');
        continue;
      }

      if(manual(state,'evaluator')){
        // Раньше гейт показывал только вердикт Оценщика — Стражи к этому моменту
        // уже отработали (см. блок выше), но их находки автору не показывались:
        // клик «Принять» мог зафиксировать сцену с критической ошибкой логики,
        // которую автор ни разу не видел. Передаём guardFlags/criticalCount, чтобы
        // approvalGate (ui/stages.js) отрисовал их в той же модалке.
        const guardFlagList = Object.entries(flags).flatMap(([role,arr])=>(arr||[])
          .filter(f=>f.severity!=='ok')
          .map(f=>({role:guardLabel(state,role), severity:f.severity, title:f.title, detail:f.detail||''})));
        const gt = await gate(state,'evaluator',`Оценщик · ${verdict.ok?verdict.weighted+'/10':'?'}`, '', opts,
          {draft:pRes.text, editable:true, verdict, guardFlags:guardFlagList, criticalCount:criticals.length});
        if(gt.approve){
          const edited = gt.text?.trim();
          best = edited || pRes.text; bestEval = verdict;
          // Если автор правил текст в гейте вручную — flags этой итерации относились
          // к тексту ДО правки, дальше недостоверны (тот же принцип, что и сброс
          // lastEval/flags при ручной правке в редакторе — см. фикс в ui/stages.js).
          bestFlags = edited ? {} : {...flags};
          break;
        }
        if(gt.text?.trim()){ pRes.text=gt.text.trim(); prevDraft=pRes.text; }
        directive = gt.note || buildUnifiedDirective(verdict, allBanned, criticals, factualQuestions, literaryNotes, tooShort) || directive;
        continue;
      }

      // Консенсус: оценщик принял И стражи не нашли критических проблем → готово.
      // grossShort блокирует консенсус, но не на последней итерации — иначе
      // сцена, которую модель упорно пишет коротко, зациклила бы прогон впустую;
      // на выходе такой текст всё равно помечен бейджем недобора в UI.
      if(evalAccepted && criticals.length === 0 && !draftTruncated && (!grossShort || iter >= maxIter)){ break; }
      if(evalAccepted && criticals.length === 0 && !draftTruncated && grossShort){
        onProgress && onProgress({log:{icon:'📏', text:`Объём критически ниже цели (${curWords} из ${scene.targetWords} сл.) — консенсус отложен, следующая правка расширяет сцену`, state:'warn'}});
      }

      // Директива строится от лучшего оценщика (bestEval), а не обязательно от текущего verdict.
      // Это важно когда guards запустились на финальной итерации, а best — из более ранней.
      const directiveVerdict = (bestEval && bestEval.weighted > (verdict.weighted||0)) ? bestEval : verdict;
      // Если директива взята от bestEval (эта итерация просела) — черновик, который
      // пойдёт на правку следующей итерацией, должен быть ТЕМ ЖЕ текстом, что
      // оценивал bestEval, а не текущим (просевшим) prevDraft. Раньше directive
      // описывал проблемы одного черновика, а surgicalReviseMessages правил другой —
      // на следующей итерации модель «чинила» давно решённую проблему в тексте,
      // который её уже не содержал, вместо реального движения вперёд. Из-за этого
      // серия итераций топталась вокруг оценки черновика 1, а не росла от лучшего
      // достигнутого варианта — это и есть застревание оценки на 6.4-6.6 при
      // нескольких прогонах подряд.
      if(directiveVerdict === bestEval && best && best !== prevDraft) prevDraft = best;
      // Стагнация: если ось не растёт 2 итерации подряд — добавить радикальную инструкцию.
      // Сравниваем ТОЛЬКО реально соседние по номеру итерации записи (last.iter ===
      // prev.iter+1) — раньше scoreHistory хранил только успешно распарсенные
      // вердикты подряд, без номера итерации: если между двумя ok-вердиктами была
      // итерация с непропарсенным ответом Оценщика, детектор всё равно сравнивал их
      // как «подряд» и мог заявить «стагнация 2 итерации», хотя в промежутке был
      // пропуск, а не реальное отсутствие прогресса.
      let stagnantNote = '';
      stagnantLastIter = false;
      if(scoreHistory.length >= 2){
        const last = scoreHistory[scoreHistory.length-1], prev = scoreHistory[scoreHistory.length-2];
        const adjacent = last && prev && last.iter === prev.iter + 1;
        const stuck = adjacent ? RUBRIC_AXES.map(a=>a.key).filter(k=>(last[k]||0) <= (prev[k]||0) + 0.5) : [];
        if(stuck.length){
          stagnantNote = '\n\nОСИ БЕЗ ПРОГРЕССА — измени подход РАДИКАЛЬНО, не шлифуй то же самое: ' + stuck.map(k=>AXIS_LABELS[k]||k).join(', ');
          stagnantLastIter = true;
          onProgress && onProgress({log:{icon:'⚡', text:`Стагнация осей: ${stuck.map(k=>AXIS_LABELS[k]).join(', ')} — директива усилена, следующая правка пойдёт шире обычной`, state:'warn'}});
        }
      }
      // Бан точной фразы не спасает от клише — модель просто перефразирует ту же идею
      // ("сердце в горле" → "кожа на затылке стянулась"). Категорию называет сам
      // Оценщик (clicheCategory) — надёжнее самодельного словаря стемов/ключевых слов.
      const categoryNote = directiveVerdict.clicheCategory
        ? '\n\nИЗБЕГАЙ ЦЕЛОЙ КАТЕГОРИИ (не просто других слов той же идеи): ' + directiveVerdict.clicheCategory + ' — передай тревогу через другой канал: звук, свет, память, деталь обстановки.'
        : '';
      // Запоминаем категорию на уровне книги (не только этой сцены) — если она
      // всплывёт снова в другой сцене, автор увидит подсказку «уже случалось» в
      // Памяти вместо того, чтобы Оценщик каждый раз находил её заново с нуля.
      if(directiveVerdict.clicheCategory) recordObservedPattern(state, scene.id, directiveVerdict.clicheCategory);
      // Директива правки никогда не напоминает про объём (только самый первый
      // черновик видит scene.targetWords, см. buildTask в context.js) — а ось
      // «Темп» Оценщика на каждой итерации честно просит резать «избыточные
      // детали». Без противовеса это копится: черновик усыхает итерация за
      // итерацией без единого сигнала «уже ниже цели, хватит резать» (найдено
      // на реальной сцене: 751→747→651→629→619 слов при цели 1500 — 5 правок
      // подряд без единого отскока вверх). Не запрещаем резать (замечание может
      // быть правильным), только просим не резать ДАЛЬШЕ без необходимости.
      const lengthNote = grossShort
        ? `\n\nОБЪЁМ КРИТИЧЕСКИ НИЖЕ ЦЕЛИ (${curWords} из ${scene.targetWords} слов): расширь сцену минимум до ${Math.round(scene.targetWords*0.75)} слов — НЕ водой и не растягиванием фраз, а развитием того, что бриф требует, но текст пропустил или свернул: недостающие сущности брифа, реакции и память героя, сенсорика места, подтекст в диалоге.`
        : tooShort
          ? `\n\nОБЪЁМ: черновик уже заметно короче цели (${curWords} из ${scene.targetWords} слов) — если конкретное замечание выше не требует прямо резать текст, ищи другой способ его выполнить (не удаляй абзацы целиком ради мелкой правки).`
          : '';
      const truncNote = draftTruncated
        ? '\n\nПРЕДЫДУЩИЙ ОТВЕТ ОБОРВАЛСЯ НА ПОЛУСЛОВЕ (упор в лимит токенов/сети) — допиши/перепиши сцену целиком до естественного конца, не редактируй точечно.'
        : '';
      directive = (buildUnifiedDirective(directiveVerdict, allBanned, criticals, factualQuestions, literaryNotes, tooShort) || directive) + stagnantNote + categoryNote + lengthNote + truncNote;
    }
    if(!best){
      // Ни одна итерация не набрала "best" (например: автор 20 раз подряд
      // отклонил черновик в ручном гейте — safety исчерпан раньше maxIter, а
      // prevDraft к этому моменту уже сброшен в '' веткой gate ниже). Раньше
      // здесь падали на prevDraft, который в этом сценарии тоже пуст — сцена
      // сохранялась пустой строкой без единого предупреждения. lastGenerated
      // всегда хранит последний реально написанный текст, даже отклонённый.
      best = lastGenerated || prevDraft || '';
      if(best) onProgress && onProgress({log:{icon:'⚠️', text:'Сцена сохранена без подтверждённого консенсуса (лимит попыток исчерпан) — проверьте текст вручную', state:'warn'}});
    }
    // Последний рубеж — на случай, если обрыв всё же дошёл до best (например,
    // автор вручную нажал «Принять» в гейте Оценщика на обрезанном токенами
    // черновике, не заметив обрыва в конце длинного текста): не блокируем —
    // решение автора, — но громко предупреждаем, а не молчим, как раньше.
    if(best && looksTokenTruncated(best)){
      onProgress && onProgress({log:{icon:'🚨', text:'Итоговый текст сцены обрывается не на знаке препинания — похоже на обрыв токенами/сетью. Проверьте конец сцены вручную перед публикацией.', state:'warn'}});
    }

    // ── 4. Линейный редактор (опц.) — единственный, кто правит текст ──
    if(agentEnabled('lineedit')){
      const leAg = ag(state,'lineedit');
      const beforeLineEdit = best;
      // Линейный редактор возвращает ВЕСЬ отредактированный текст сцены целиком
      // (не диф/список правок) — в отличие от статичного maxTokens он должен
      // расти вместе со сценой, иначе на длинных сценах (проект на 90 тыс. слов
      // при 48 сценах — уже ~1875 слов на сцену в среднем, кульминационные ещё
      // длиннее) ответ обрывается раньше, чем текст дописан. Тот же приём и та
      // же формула (3.5 ток/слово, с запасом над измеренной плотностью ≈2.78),
      // что и у Прозаика чуть выше по файлу.
      const bestWords = (best.match(/\S+/g)||[]).length;
      const leDynMin = Math.max(2500, Math.round(bestWords * 3.5));
      const leMaxTk = Math.max(leAg.maxTokens ?? 3600, leDynMin);
      let leNote = '';
      for(let g0=0; g0<6; g0++){
        onProgress && onProgress({stage:'lineedit', text:'Линейный редактор правит…'});
        try{
          const leRes = await callLLM({ ...llmBase, temperature:leAg.temp??0.3, messages:lineEditMessages(best, state.style?.forbidden, leNote), maxTokens:leMaxTk });
          // Защита от усечённого ответа — раньше проверяла ТОЛЬКО длину (>50% исходного).
          // Живой прогон показал обрыв на 90% длины (3710 из 4139 симв., без завершающей
          // пунктуации, посреди слова) — формально проходил порог длины и сохранялся как
          // финальный текст сцены. looksTokenTruncated() (та же проверка, что уже ловит
          // обрыв ПЕРВОГО черновика Прозаика чуть выше по файлу) ловит именно этот случай:
          // обрыв не на конце предложения — сильный сигнал упора в maxTokens, даже если
          // абсолютная длина ответа кажется достаточной.
          if(leRes.text && leRes.text.length > best.length*0.5 && !looksTokenTruncated(leRes.text)){
            logStep({ agent:'lineedit', input:'(черновик)'+(leNote?' + заметка автора: '+leNote:''), output:leRes.text, tokensIn:leRes.tokensIn, tokensOut:leRes.tokensOut, cost:leRes.cost });
            onProgress && onProgress({log:{icon:'✂️', text:'Линейный редактор: текст подчищен'}});
            const gt = await gate(state,'lineedit','Линейный редактор', '', opts, {draft:leRes.text, editable:true});
            if(gt.approve){ best = (gt.text!=null && gt.text.trim())?gt.text.trim():leRes.text; break; }
            // переписать с заметкой — раньше gt.note нигде не читался, и повтор
            // был идентичен первому запросу (отличался только сэмплированием)
            if(!gt.note){ break; }
            leNote = gt.note;
          } else {
            // Раньше это било молча — сцена просто оставалась без правки
            // Линейного редактора без единого следа, автор не мог отличить
            // «текст уже был идеален» от «ответ обрезался лимитом токенов».
            const reason = (leRes.text && looksTokenTruncated(leRes.text))
              ? 'ответ обрывается не на знаке препинания (похоже на обрыв лимитом токенов, хотя по длине выглядел приемлемо)'
              : `ответ короче половины исходного текста (похоже на обрыв лимитом ${leMaxTk} ток.)`;
            onProgress && onProgress({log:{icon:'⚠️', text:`Линейный редактор: ${reason} — правка пропущена, текст остаётся как был`, state:'warn'}});
            break;
          }
        }catch(e){ logStep({ agent:'lineedit', output:'[АГЕНТ ПРОВАЛИЛСЯ] '+e.message }); break; }
      }
      // Линейный редактор — последний шаг, Стражи его результат уже не проверяют.
      // Если текст изменился, bestFlags относились к тексту ДО этой правки и
      // больше недостоверны (тот же принцип, что и сброс lastEval/flags при любой
      // правке текста мимо основного прогона — см. фиксы в ui/stages.js, ui/chat.js).
      if(best !== beforeLineEdit) bestFlags = {};
    }

    // Клише этой сцены (свои + унаследованные от предыдущих) — обратно в
    // state.usedCliches, чтобы СЛЕДУЮЩАЯ сцена книги видела их с итерации 1.
    // Обрезаем до последних 150 — иначе список бесконечно растёт на длинной книге.
    state.usedCliches = [...bannedCliches].slice(-150);

    const run = endRun('done');
    return { text: best || '', eval: bestEval, flags: bestFlags, runId, run };
  } catch(e){
    logStep({ agent:'error', output: e.message });
    const run = endRun('error');
    throw Object.assign(e, { runId, run });
  } finally {
    _running = false;
  }
}

// Запуск одного Стража с устойчивостью к падению (спека 11: не валим весь прогон).
async function guardJob(state, role, llmBase, messages, flagsOut, onProgress){
  const a = ag(state, role);
  try{
    const res = await callLLM({ ...llmBase, temperature:a.temp??0.2, messages, maxTokens:a.maxTokens??700 });
    const flags = runGuardParse(res.text);
    flagsOut[role] = flags;
    logStep({ agent:role, input:'(черновик)', output:res.text, flags, tokensIn:res.tokensIn, tokensOut:res.tokensOut, cost:res.cost });
  }catch(e){
    flagsOut[role] = [];
    logStep({ agent:role, output:'[АГЕНТ ПРОВАЛИЛСЯ] '+e.message });
    // Раньше падение Стража было видно ТОЛЬКО в диагностическом трейсе — в основном
    // логе прогона (то, что реально смотрит автор) 0 флагов от упавшего Стража были
    // неотличимы от «страж проверил и не нашёл проблем». Теперь явный warn-лог.
    onProgress && onProgress({log:{icon:'⚠️', text:`Страж «${guardLabel(state,role)}» не ответил (${e.message}) — проверка пропущена на этой итерации`, state:'warn'}});
  }
}

function prevDoneSceneText(state, scene){
  const scenes = (state.structure||[]).filter(n=>n.type==='scene');
  const idx = scenes.findIndex(s=>s.id===scene.id);
  for(let i=idx-1; i>=0; i--){ if(scenes[i].text) return scenes[i].text; }
  return '';
}
