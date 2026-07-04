// Линейная оркестрация пайплайна сцены (спека: executor как идеи, не граф).
// ПП2-цепочка: [Архитектор] → Прозаик ⇄ Оценщик (петля).
// Каждый агент включаем/отключаем; всё пишется в диагностический трейс.

import { callLLM } from './llm.js';
import { buildSceneContext, bookContextBlock } from './context.js';
import { architectMessages, parseArchitect, architectToText,
         evaluatorMessages, parseEvaluator, RUBRIC_AXES } from './agents.js';
import { voiceGuardMessages, logicGuardMessages, eventsGuardMessages,
         lineEditMessages, runGuardParse, customGuardMessages, surgicalReviseMessages,
         parseDebateRevision, styleGuardMessages, readerGuardMessages, imageryGuardMessages,
         povGuardMessages, dialogueGuardMessages, findDuplicatePhrases } from './guards.js';
import { startRun, logStep, endRun, agentEnabled } from './diagnostics.js';
import { tokensOf, tfvec, cosine } from './bible.js';
import { recordObservedPattern, ag } from './state.js';

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

const GUARD_LABELS = {voiceguard:'Страж голоса', logic:'Страж логики', events:'Страж событий', styleguard:'Страж стиля', reader:'Читатель', imagery:'Страж образов', pov:'Страж точки зрения', dialogue:'Страж диалога', repeat:'Проверка повторов'};
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
function buildUnifiedDirective(verdict, allBanned, criticalFlags, factualQuestions){
  const parts = [];
  if((verdict.anchors||[]).length) parts.push('СОХРАНИ ДОСЛОВНО (якоря): ' + verdict.anchors.join('; '));
  parts.push(...(verdict.notes||[]));
  if(criticalFlags.length) parts.push('КРИТИЧЕСКИЕ ЗАМЕЧАНИЯ СТРАЖЕЙ:\n' + criticalFlags.join('\n'));
  // Отдельно от критических: вопросы фактических стражей (логика/события) с severity
  // "warning" — их собственный промпт называет их пробелом, на который не нужно
  // выдумывать ответ, а не командой исправить. Раньше они попадали в criticalFlags
  // наравне с настоящими critical — Прозаик был вынужден изобретать факт, которого
  // в сцене нет, лишь бы «исправить» то, что на деле было вопросом автору.
  if(factualQuestions && factualQuestions.length) parts.push('ВОПРОСЫ СТРАЖЕЙ ЛОГИКИ/СОБЫТИЙ (это пробел, не ошибка — не выдумывай факт: либо сделай формулировку нейтральной, либо оставь как есть для решения автора):\n' + factualQuestions.join('\n'));
  if(allBanned.length) parts.push('убери клише (все предыдущие итерации): ' + allBanned.join(', '));
  return parts.join('\n\n');
}
// Директивы прямо просят сократить/сжать текст — тогда безопасность-от-усечения
// (откат к prevDraft, если ответ короче 60% исходного) не должна срабатывать:
// иначе легитимное «сократи вдвое» автоматически отменялось тем же условием,
// что защищает от случайно оборванного ответа модели.
const SHORTEN_HINT_RE = /сократ|покороче|короче|уменьш|сожми|срежь|вырежи/i;
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
    const threshold = g.evaluatorThreshold ?? 7;
    const maxIter = agentEnabled('evaluator') ? (g.evaluatorMaxIter ?? 3) : 1;
    const hasGuards = agentEnabled('voiceguard') || agentEnabled('logic') || agentEnabled('events') ||
      agentEnabled('reader') || agentEnabled('imagery') || agentEnabled('pov') || agentEnabled('dialogue') ||
      (agentEnabled('styleguard') && (state.style?.rules||[]).filter(Boolean).length) ||
      (state.agents||[]).some(a=>a.custom && a.enabled!==false);
    let best = null, bestEval = null, bestClean = false, bestFlags = {};
    let directive = opts.directive || '';
    let prevDraft = opts.initialDraft || '';
    let lastGenerated = ''; // последний РЕАЛЬНО сгенерированный текст — переживает
    // reset prevDraft='' в ручном гейте Прозаика ниже, так что финальный fallback
    // (после выхода из цикла) никогда не сохраняет пустую сцену.
    let iter = 0, safety = 0;
    let flags = {};
    const bannedCliches = new Set();
    let anchorVerdict = null;   // оценки итерации 1 — baseline для стабильности Оценщика
    const scoreHistory = [];    // история scores по итерациям — детектор стагнации осей
    const AXIS_LABELS = Object.fromEntries(RUBRIC_AXES.map(a=>[a.key, a.label]));

    while(iter < maxIter && safety++ < 20){
      iter++;
      const isRevision = !!(iter > 1 && prevDraft || iter === 1 && prevDraft && directive);
      let streamed = '';
      const streamCb = chunk=>{ streamed+=chunk; onProgress && onProgress({stage:'prose', text:streamed, streaming:true}); };
      let pRes, logInput, logLayers;
      if(isRevision){
        onProgress && onProgress({stage:'prose', text:`Прозаик разбирает замечания и правит черновик (итерация ${iter})…`});
        const cap = Math.min(5000, Math.max(2000, Math.round(prevDraft.length/2) + 1400));
        pRes = await callLLM({ ...llmBase, temperature:0.4, messages: surgicalReviseMessages(prevDraft, directive, state.style?.rules), maxTokens: Math.max(proseAg.maxTokens ?? cap, cap) }, streamCb);
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
        if(pRes.text && pRes.text.length < prevDraft.length*0.6 && !SHORTEN_HINT_RE.test(directive)) pRes.text = prevDraft;
        logInput = '(разбор замечаний + точечная правка) ' + (directive||'');
      } else {
        onProgress && onProgress({stage:'prose', text:'Прозаик пишет…'});
        const ctx = buildSceneContext(state, scene, { prevSceneText, architectOutput:architectText, directive, prevDraft:'' });
        const sceneWords = scene.targetWords || 700;
        const dynMin = Math.max(2000, Math.round(sceneWords * 2.5));
        const proseMaxTk = proseAg.maxTokens != null ? Math.max(proseAg.maxTokens, dynMin) : dynMin;
        pRes = await callLLM({ ...llmBase, temperature: proseAg.temp ?? 0.85, messages:ctx.messages, maxTokens: proseMaxTk }, streamCb);
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
        const eMsgs = evaluatorMessages(scene, pRes.text, state.voice?.examples, bookContextBlock(state, scene), state.style?.rules);
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
        // Литературные стражи — только когда текст принят или итерации кончились
        if(evalAccepted || iter >= maxIter){
          if(agentEnabled('voiceguard')){
            if(voiceExamples.length > 0)
              guardJobs.push(guardJob(state,'voiceguard', llmBase, voiceGuardMessages(scene, pRes.text, voiceExamples, ag(state,'voiceguard').strictness), flags, onProgress));
            else
              onProgress && onProgress({log:{icon:'👁', text:'Страж голоса: пропущен — добавьте образцы голоса в настройках «Голос»', state:'warn'}});
          }
          if(agentEnabled('styleguard') && (state.style?.rules||[]).filter(Boolean).length)
            guardJobs.push(guardJob(state,'styleguard', llmBase, styleGuardMessages(pRes.text, state.style.rules, ag(state,'styleguard').strictness), flags, onProgress));
          if(agentEnabled('reader'))
            guardJobs.push(guardJob(state,'reader', llmBase, readerGuardMessages(scene, pRes.text, ag(state,'reader').strictness), flags, onProgress));
          if(agentEnabled('imagery'))
            guardJobs.push(guardJob(state,'imagery', llmBase, imageryGuardMessages(pRes.text, ag(state,'imagery').strictness, state.project?.genre), flags, onProgress));
          if(agentEnabled('pov'))
            guardJobs.push(guardJob(state,'pov', llmBase, povGuardMessages(pRes.text, ag(state,'pov').strictness), flags, onProgress));
          if(agentEnabled('dialogue'))
            guardJobs.push(guardJob(state,'dialogue', llmBase, dialogueGuardMessages(pRes.text, ag(state,'dialogue').strictness), flags, onProgress));
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
        factualQuestions = Object.entries(flags).flatMap(([role,arr])=>(arr||[])
          .filter(f=>f.severity==='warning' && isFactualGuard(state, role))
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
          const guardCandidates = ['voiceguard','logic','events','styleguard','reader','imagery','pov','dialogue',
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
      // Среди двух одинаково (не)чистых — выше балл.
      const thisClean = criticals.length === 0;
      if(!bestEval || (thisClean && !bestClean) ||
         (thisClean === bestClean && (!agentEnabled('evaluator') || (verdict.ok && verdict.weighted > (bestEval.weighted||0))))){
        // bestFlags — снимок flags ИМЕННО этой итерации (flags — общая переменная,
        // сбрасывается и переписывается на каждой итерации; без снимка возвращённые
        // флаги могли бы описывать текст из ДРУГОЙ, не победившей итерации —
        // например, дубль фразы, исправленный на итерации 2 (best), но снова
        // возникший на итерации 3 (не выигравшей) — так итог показывал бы
        // критическую находку для текста, которого в возвращённом best уже нет.
        best = pRes.text; bestEval = verdict; bestClean = thisClean; bestFlags = {...flags};
      }

      if(!agentEnabled('evaluator')){
        // Без Оценщика решение о завершении — только по Стражам.
        if(criticals.length === 0) break;
        directive = 'КРИТИЧЕСКИЕ ЗАМЕЧАНИЯ СТРАЖЕЙ:\n' + criticals.join('\n')
          + (factualQuestions.length ? '\n\nВОПРОСЫ СТРАЖЕЙ ЛОГИКИ/СОБЫТИЙ (не выдумывай ответ):\n' + factualQuestions.join('\n') : '');
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
        directive = gt.note || buildUnifiedDirective(verdict, allBanned, criticals, factualQuestions) || directive;
        continue;
      }

      // Консенсус: оценщик принял И стражи не нашли критических проблем → готово.
      if(evalAccepted && criticals.length === 0){ break; }

      // Директива строится от лучшего оценщика (bestEval), а не обязательно от текущего verdict.
      // Это важно когда guards запустились на финальной итерации, а best — из более ранней.
      const directiveVerdict = (bestEval && bestEval.weighted > (verdict.weighted||0)) ? bestEval : verdict;
      // Стагнация: если ось не растёт 2 итерации подряд — добавить радикальную инструкцию.
      // Сравниваем ТОЛЬКО реально соседние по номеру итерации записи (last.iter ===
      // prev.iter+1) — раньше scoreHistory хранил только успешно распарсенные
      // вердикты подряд, без номера итерации: если между двумя ok-вердиктами была
      // итерация с непропарсенным ответом Оценщика, детектор всё равно сравнивал их
      // как «подряд» и мог заявить «стагнация 2 итерации», хотя в промежутке был
      // пропуск, а не реальное отсутствие прогресса.
      let stagnantNote = '';
      if(scoreHistory.length >= 2){
        const last = scoreHistory[scoreHistory.length-1], prev = scoreHistory[scoreHistory.length-2];
        const adjacent = last && prev && last.iter === prev.iter + 1;
        const stuck = adjacent ? RUBRIC_AXES.map(a=>a.key).filter(k=>(last[k]||0) <= (prev[k]||0) + 0.5) : [];
        if(stuck.length){
          stagnantNote = '\n\nОСИ БЕЗ ПРОГРЕССА — измени подход РАДИКАЛЬНО, не шлифуй то же самое: ' + stuck.map(k=>AXIS_LABELS[k]||k).join(', ');
          onProgress && onProgress({log:{icon:'⚡', text:`Стагнация осей: ${stuck.map(k=>AXIS_LABELS[k]).join(', ')} — директива усилена`, state:'warn'}});
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
      directive = (buildUnifiedDirective(directiveVerdict, allBanned, criticals, factualQuestions) || directive) + stagnantNote + categoryNote;
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

    // ── 4. Линейный редактор (опц.) — единственный, кто правит текст ──
    if(agentEnabled('lineedit')){
      const leAg = ag(state,'lineedit');
      const beforeLineEdit = best;
      for(let g0=0; g0<6; g0++){
        onProgress && onProgress({stage:'lineedit', text:'Линейный редактор правит…'});
        try{
          const leRes = await callLLM({ ...llmBase, temperature:leAg.temp??0.3, messages:lineEditMessages(best, state.style?.forbidden), maxTokens:leAg.maxTokens??1600 });
          if(leRes.text && leRes.text.length > best.length*0.5){ // защита от усечённого ответа
            logStep({ agent:'lineedit', input:'(черновик)', output:leRes.text, tokensIn:leRes.tokensIn, tokensOut:leRes.tokensOut, cost:leRes.cost });
            onProgress && onProgress({log:{icon:'✂️', text:'Линейный редактор: текст подчищен'}});
            const gt = await gate(state,'lineedit','Линейный редактор', '', opts, {draft:leRes.text, editable:true});
            if(gt.approve){ best = (gt.text!=null && gt.text.trim())?gt.text.trim():leRes.text; break; }
            // переписать: оставляем прежний best, просим иначе — но без note менять нечего, выходим
            if(!gt.note){ break; }
          } else break;
        }catch(e){ logStep({ agent:'lineedit', output:'[АГЕНТ ПРОВАЛИЛСЯ] '+e.message }); break; }
      }
      // Линейный редактор — последний шаг, Стражи его результат уже не проверяют.
      // Если текст изменился, bestFlags относились к тексту ДО этой правки и
      // больше недостоверны (тот же принцип, что и сброс lastEval/flags при любой
      // правке текста мимо основного прогона — см. фиксы в ui/stages.js, ui/chat.js).
      if(best !== beforeLineEdit) bestFlags = {};
    }

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
