// Линейная оркестрация пайплайна сцены (спека: executor как идеи, не граф).
// ПП2-цепочка: [Архитектор] → Прозаик ⇄ Оценщик (петля).
// Каждый агент включаем/отключаем; всё пишется в диагностический трейс.

import { callLLM, extractJSON, findForeignScript, MAX_OUTPUT_TOKENS } from './llm.js';
import { buildSceneContext, bookContextBlock, LAYER_LABELS } from './context.js';
import { architectMessages, parseArchitect, architectToText,
         evaluatorMessages, parseEvaluator, RUBRIC_AXES, axisOfNote } from './agents.js';
import { voiceGuardMessages, logicGuardMessages, eventsGuardMessages,
         lineEditMessages, runGuardParse, customGuardMessages, surgicalReviseMessages,
         radicalReviseMessages, parseDebateRevision, styleGuardMessages, readerGuardMessages,
         imageryGuardMessages, povGuardMessages, dialogueGuardMessages, resolutionGuardMessages,
         atmosphereGuardMessages, humorGuardMessages, findDuplicatePhrases, findBoundaryRepeat,
         looksTokenTruncated, coercePassive,
         findMonotonousOpenings, MONOTONY_THRESHOLD } from './guards.js';
import { startRun, logStep, endRun, agentEnabled } from './diagnostics.js';
import { tokensOf, tfvec, cosine } from './bible.js';
import { recordObservedPattern, ag, effectiveRules, llmFor } from './state.js';
import { genreWantsHumor } from './genres.js';

let _running = false; // защита от конкурентного прогона (переключение сцены и т.п.)
export function isRunning(){ return _running; }

// ── Отмена прогона ──────────────────────────────────────────────────────
// Прогон сцены — это десяток платных вызовов подряд (Прозаик, Оценщик и все
// Стражи на каждой итерации), и до сих пор прервать его было нечем: кнопки
// нет, единственный способ — перезагрузить страницу, потеряв уже написанное.
// Флаг проверяется на границах итераций и перед платными шагами: текущий
// вызов LLM дорабатывает (обрывать его на полпути незачем — он уже оплачен),
// но следующего не будет. Лучший на момент отмены черновик сохраняется, как
// при обычном завершении, — отмена не должна стоить автору текста.
// Отмена реализована ВЫХОДОМ ИЗ ЦИКЛА, а не исключением: так лучший черновик
// сохраняется тем же штатным путём, что и при обычном завершении, и не нужно
// поднимать best/bestEval/bestFlags из тела try наружу ради catch. Отмена — не
// ошибка, а «хватит, доволен тем, что есть».
let _cancelRequested = false;
export function requestCancel(){ if(_running) _cancelRequested = true; }
export function isCancelRequested(){ return _cancelRequested; }

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

const GUARD_LABELS = {voiceguard:'Страж голоса', logic:'Страж логики', events:'Страж событий', styleguard:'Страж стиля', reader:'Читатель', imagery:'Страж образов', pov:'Страж точки зрения', dialogue:'Страж диалога', resolution:'Страж развязки', atmosphere:'Страж атмосферы', humor:'Страж жанра', repeat:'Проверка повторов', freshness:'Повтор между сценами', boundary:'Повтор стыка сцен', script:'Инородная письменность', rhythm:'Однообразие входов'};
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
// Собственный шум Оценщика — измерен, не назначен: три оценки ОДНОГО и того же
// текста (прод, сцена «Последний спуск») дали 6.3 / 6.7 / 6.5, разброс 0.4.
// Любое решение «балл вырос» обязано требовать разницы БОЛЬШЕ этой, иначе мы
// принимаем подбрасывание монеты за улучшение. Тот же допуск уже стоял на
// откате правки Линейного редактора — там его подобрали по той же причине.
export const EVAL_NOISE = 0.5;
function noteSimilarity(a, b){ return cosine(tfvec(tokensOf(a)), tfvec(tokensOf(b))); }
// Якоря Оценщика обещаны как ДОСЛОВНЫЕ цитаты (buildUnifiedDirective просит
// Прозаика «СОХРАНИ ДОСЛОВНО») — проверка поэтому точная (нормализация только
// регистра/кавычек/пробелов), не косинусная: перефраз якоря по определению
// этой проверки уже потеря, не совпадение.
function normalizeAnchor(s){ return String(s||'').toLowerCase().replace(/[«»"'''`]/g,'').replace(/\s+/g,' ').trim(); }
function anchorSurvives(text, anchor){ return !anchor || normalizeAnchor(text).includes(normalizeAnchor(anchor)); }
// Потерян ЛИШЬ тот якорь, который БЫЛ во входе и пропал в выходе. Условие «был
// во входе» — не придирка, а суть проверки: без него она отвечает на вопрос
// «есть ли эта строка в тексте», а рапортует, будто на вопрос «не убрал ли её
// агент». Живой прогон: Линейный редактор получил отказ в 3 сценах из 3, при
// этом якоря были цитатами из ЧУЖОГО черновика — best остаётся черновиком 1,
// пока оценка не выросла СТРОГО (см. условие обновления best), а якоря берутся
// из последней итерации. Редактор эти фразы в глаза не видел, а обвиняли его.
// Кто из двух черновиков лучше. Порядок приоритетов сохранён прежний
// (проверен литературно → чист → выше балл), добавлены только тай-брейки при
// РАВНОМ балле. Причина: в трёх живых прогонах подряд балл стоял намертво
// (6.3 → 6.3 → 6.3), а правило требовало СТРОГО большего — значит best
// навсегда оставался черновиком 1, и всё, что Прозаик делал дальше,
// выбрасывалось независимо от качества. Именно это рассинхронизировало якоря
// Линейного редактора (он правил черновик 1, а якоря приходили от оценки
// черновика 3). При равном балле судим тем, что система и так измеряет:
// сначала критические находки, потом нерешённые вопросы Стражей.
// Полное равенство оставляет РАННИЙ черновик — иначе поздние итерации
// вытесняли бы равные ранние без единой причины.
export function draftBeatsBest(c, b){
  if(!b) return true;
  if(c.literaryChecked !== b.literaryChecked) return !!c.literaryChecked;
  if(c.clean !== b.clean) return !!c.clean;
  // Оценщик выключен — балла не существует, сравнивать нечем. Сохраняем прежнее
  // правило «побеждает последний»: менять его заодно я не собирался.
  if(c.noScore) return true;
  if(!c.scored) return false;          // оценка есть, но не разобралась — не побеждает
  // Порог «баллы реально различаются» обязан стоять ВЫШЕ собственного шума
  // Оценщика. Замер на одном и том же тексте: 6.3 / 6.7 / 6.5 — разброс 0.4.
  // Раньше здесь стояло 0.05, и это было безопасно ровно до тех пор, пока в
  // промпт подставлялся якорь с прошлыми баллами: он искусственно держал
  // оценку неподвижной. Якорь убран (он искажал на 2.7 при шуме 0.4), шум
  // вернулся — и с порогом 0.05 случайная разница в 0.3 объявлялась бы
  // «улучшением» и перебивала честный тай-брейк по критическим находкам.
  // Тот же принцип уже применён к откату правки Линейного редактора (допуск
  // 0.5 «гасит обычный шум LLM-судьи») — держим единую логику.
  const dс = (c.weighted||0) - (b.weighted||0);
  if(Math.abs(dс) >= EVAL_NOISE) return dс > 0;
  if((c.criticals||0) !== (b.criticals||0)) return (c.criticals||0) < (b.criticals||0);
  return (c.questions||0) < (b.questions||0);
}

export function anchorsLostBy(before, after, anchors){
  return (anchors||[]).filter(a => a && anchorSurvives(before, a) && !anchorSurvives(after, a));
}
// Сколько итераций подряд один и тот же вопрос фактических стражей (логика/события)
// может остаться без ответа, прежде чем перестать быть необязательным пробелом и
// стать обязательной правкой (см. FACTUAL_ESCALATE_ITERS ниже по файлу).
const FACTUAL_ESCALATE_ITERS = 3;
// Запись об отклонении, похожая на это замечание (или undefined).
function findRejectedNote(text, rejectedNotes){
  if(!rejectedNotes || !rejectedNotes.length || !text) return undefined;
  return rejectedNotes.find(x => noteSimilarity(text, x.quote + ' ' + (x.reason||'')) >= REJECT_SIM_THRESHOLD);
}
// Сколько раз это замечание уже отклоняли (0 — ни разу).
function rejectedCount(text, rejectedNotes){
  const rn = findRejectedNote(text, rejectedNotes);
  return rn ? (rn.count||1) : 0;
}
// Отклонённое замечание глушится, пока отказ выглядит как художественный
// выбор. Начиная с REJECT_STUBBORN_TIMES-го отказа подряд это уже не выбор, а
// увиливание: замечание снова становится видимым — и автору, и следующей
// итерации. Порог тот же по смыслу, что FACTUAL_ESCALATE_ITERS у фактических
// стражей, просто применён ко всем замечаниям.
const REJECT_STUBBORN_TIMES = 3;
// Экспортирована для UI: панель «Анализ сцены» помечает погашенные замечания
// прямо в списке флагов. Матчинг по сходству живёт ТОЛЬКО здесь — иначе UI и
// пайплайн разошлись бы в том, что считается «тем же замечанием», и автор видел
// бы «погашено», а Прозаик всё равно получал бы это в директиве.
export function isRejectedNote(text, rejectedNotes){
  const rn = findRejectedNote(text, rejectedNotes);
  if(!rn) return false;
  // Отклонение АВТОРА (кнопка «✕ Это приём» в панели «Анализ сцены») не
  // истекает. Счётчик-до-трёх выше — про отказы ПРОЗАИКА: три отказа подряд от
  // модели читаются как увиливание от правки, и замечание возвращается в
  // работу. К решению живого автора это правило неприменимо: он не увиливает,
  // а распоряжается своим текстом, и возвращать ему одно и то же на каждой
  // итерации — значит спорить с ним его же деньгами (каждый круг платный).
  // Отменяется кнопкой «↺ показывать снова» в той же панели.
  if(rn.byAuthor) return true;
  const n = rn.count||1;
  return n > 0 && n < REJECT_STUBBORN_TIMES;
}
// Отклонение замечания РУКОЙ АВТОРА (кнопка в панели «Анализ сцены»). Отдельно
// от rememberRejected: у автора нет «счётчика упрямства», его решение
// постоянно (см. byAuthor в isRejectedNote), а текст замечания приходит из UI
// как единая строка «заголовок: детали», без разбора на quote/reason.
export function rejectNoteByAuthor(scene, text){
  const t = String(text||'').trim();
  if(!t) return false;
  scene.rejectedNotes = scene.rejectedNotes || [];
  const прежний = scene.rejectedNotes.find(rn => noteSimilarity(rn.quote, t) >= REJECT_SIM_THRESHOLD);
  if(прежний){ прежний.byAuthor = true; прежний.ts = Date.now(); }
  else scene.rejectedNotes.push({ quote:t, reason:'', ts:Date.now(), count:1, byAuthor:true });
  if(scene.rejectedNotes.length > 30) scene.rejectedNotes = scene.rejectedNotes.slice(-30);
  return true;
}
// Запоминает вновь отклонённые пункты на сцене (дедуп против уже сохранённых).
// Экспортирована — переиспользуется из ondemand.js (patchScene), чтобы
// отклонение замечания через точечную правку («Патч текста») запоминалось
// так же, как отклонение внутри основного пайплайна: иначе один и тот же
// Страж мог заново поднять уже осознанно отклонённый вопрос на следующей
// автоматической проверке, будто спор с автором никогда не происходил.
export function rememberRejected(scene, rejected){
  if(!rejected || !rejected.length) return;
  scene.rejectedNotes = scene.rejectedNotes || [];
  rejected.forEach(r=>{
    if(!r.quote) return;
    // Повтор НЕ отбрасывается молча, а считается: «отклонил один раз» и
    // «отклонил трижды подряд» — разные вещи. Первый отказ — художественный
    // выбор, третий — увиливание, и с этого момента замечание перестаёт
    // глушиться (см. фильтр в основном цикле). Это та же логика, что у
    // эскалации фактических стражей, распространённая на все замечания.
    const прежний = scene.rejectedNotes.find(rn => noteSimilarity(rn.quote, r.quote) >= REJECT_SIM_THRESHOLD);
    if(прежний){ прежний.count = (прежний.count||1) + 1; прежний.ts = Date.now(); }
    else scene.rejectedNotes.push({ quote:r.quote, reason:r.reason||'', ts:Date.now(), count:1 });
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
// Сколько НЕобязательных пунктов максимум уходит Прозаику за одну итерацию.
// Критические замечания Стражей и якоря в бюджет не входят — они обязательны
// всегда. Число выведено из живого замера: директива на 22-25 пунктов при
// сцене в 900 слов — это новое требование каждые 36 слов, и Прозаик физически
// может только точечно пропатчить каждое, а не переосмыслить сцену. Восемь
// пунктов оставляют место на реальную переработку; остальное не теряется, а
// ждёт следующей итерации (Оценщик и Стражи всё равно найдут это снова, если
// проблема не ушла).
const DIRECTIVE_BUDGET = 8;
// Разделение фаз (см. фазы ниже): Оценщик и Стражи проверяют РАЗНОЕ, и смешивать
// их в одной директиве — значит тратить бюджет внимания Прозаика на то, за что
// балл не выставляется. Живой замер третьей итерации: 1394 симв. от Оценщика
// против 8590 от Стражей — 86% инструкции уходило в измерение, которого нет ни
// на одной оси рубрики, при том что низкие оси (Ритм 4-5, Конкретность 5,
// Свежесть 5) не двигались три итерации подряд. Теперь итерации чередуются:
// нечётная — проза (оси Оценщика), чётная — факты и приёмы (замечания Стражей).
// Критические замечания идут в ОБЕИХ фазах — они не пожелание, а ошибка.
function directivePhase(iter){ return (iter % 2 === 1) ? 'prose' : 'guards'; }

// Объединённая директива: Прозаик получает всё сразу — оценщик + стражи + запреты.
// opts: { phase:'prose'|'guards', scores, onDefer } — phase выбирает, чьи замечания
// доминируют на этой итерации; scores (оси вердикта) сортируют замечания Оценщика
// так, чтобы бюджет уходил на самые провальные оси; onDefer(n, что) сообщает
// автору, сколько пунктов отложено на следующую итерацию.
export function buildUnifiedDirective(verdict, allBanned, criticalFlags, factualQuestions, literaryNotes, tooShort, opts={}){
  const parts = [];
  const phase = opts.phase || 'prose';
  const scores = opts.scores || verdict.scores || {};
  const deferred = [];
  // «Бери первые N» — не то же самое, что «бери N самых нужных». Раньше список
  // шёл в директиву как есть, порядком от модели, и замечание по оси с баллом 4
  // могло стоять после трёх замечаний по осям с баллом 7. Сортируем по баллу
  // оси возрастанием (сортировка устойчивая — внутри одной оси порядок модели
  // сохраняется), незамеченные — в конец: их приоритет неизвестен.
  const byAxis = (notes)=>notes
    .map((n,i)=>({ n, i, ax:axisOfNote(n) }))
    .sort((a,b)=>{
      const sa = a.ax ? (scores[a.ax] ?? 10) : 99, sb = b.ax ? (scores[b.ax] ?? 10) : 99;
      return sa !== sb ? sa - sb : a.i - b.i;
    })
    .map(o=>o.n);
  const take = (list, n, label)=>{
    if(list.length > n) deferred.push(`${list.length - n} ${label}`);
    return list.slice(0, n);
  };
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
  // В фазе прозы Оценщик забирает почти весь бюджет; в фазе Стражей ему
  // остаются только 2 самые провальные оси — чтобы низкие оси не проваливались
  // обратно, пока Прозаик занят логикой и фактурой.
  const notesQuota = phase === 'prose' ? DIRECTIVE_BUDGET - 2 : 2;
  const chosenNotes = take(byAxis(notes), notesQuota, 'замеч. Оценщика');
  if(chosenNotes.length) parts.push((phase === 'prose'
    ? 'ГЛАВНОЕ НА ЭТОЙ ИТЕРАЦИИ — КАЧЕСТВО ПРОЗЫ (по этим осям тебя и оценивают, они идут от самой провальной):\n'
    : 'Оси с самым низким баллом — не дай им просесть ещё сильнее:\n') + chosenNotes.join('\n'));
  if(criticalFlags.length) parts.push('КРИТИЧЕСКИЕ ЗАМЕЧАНИЯ СТРАЖЕЙ:\n' + criticalFlags.join('\n'));
  // Нарушенные ПРАВИЛА АВТОРА идут в ОБЕИХ фазах и вне общего бюджета — как
  // критические. Это не мнение критика, а явное распоряжение автора: он сам
  // записал правило, и «отложить на следующую итерацию» здесь значит «ещё круг
  // писать вопреки прямому указанию». Свой потолок (4) всё же есть — чтобы
  // длинный список правил не вытеснил всё остальное из внимания Прозаика.
  const styleNotes = opts.styleNotes || [];
  if(styleNotes.length){
    const показать = styleNotes.slice(0, 4);
    if(styleNotes.length > показать.length) deferred.push(`${styleNotes.length - показать.length} наруш. правил`);
    parts.push('НАРУШЕНЫ ПРАВИЛА АВТОРА (обязательны к исправлению — это его прямое указание, не вопрос вкуса):\n' + показать.join('\n'));
  }
  // Отдельно от критических: вопросы фактических стражей (логика/события) с severity
  // "warning" — их собственный промпт называет их пробелом, на который не нужно
  // выдумывать ответ, а не командой исправить. Раньше они попадали в criticalFlags
  // наравне с настоящими critical — Прозаик был вынужден изобретать факт, которого
  // в сцене нет, лишь бы «исправить» то, что на деле было вопросом автору.
  // В фазе прозы вопросы Стражей откладываются целиком: они не влияют ни на
  // одну ось Оценщика, а объёмом легко перекрывают всё остальное. Ничего не
  // теряется — трекер повторов (factualWarningTracker) считает их на КАЖДОЙ
  // итерации независимо от того, показаны ли они, и после FACTUAL_ESCALATE_ITERS
  // повторов вопрос уходит в criticalFlags, которые идут в обеих фазах.
  const chosenFactual = phase === 'guards'
    ? take(factualQuestions||[], 4, 'вопр. Стражей')
    : ((factualQuestions||[]).length ? (deferred.push(`${factualQuestions.length} вопр. Стражей`), []) : []);
  if(chosenFactual.length) parts.push('ВОПРОСЫ СТРАЖЕЙ ЛОГИКИ/СОБЫТИЙ (это пробел, не ошибка — не выдумывай факт: либо сделай формулировку нейтральной, либо оставь как есть для решения автора):\n' + chosenFactual.join('\n'));
  // Замечания литературных стражей (голос/стиль/юмор/диалог/развязка/атмосфера/...)
  // с severity 'warning' — раньше эти стражи физически не успевали отработать до
  // последней итерации (см. гейт iter>=maxIter-1 выше), так что их находки было
  // некому применить. Теперь они успевают, но по своей природе это стилистические
  // рекомендации, а не обязательные к исправлению ошибки — формулируем как совет.
  // Тот же принцип, что и для вопросов выше: советы литературных стражей — это
  // отдельный вид работы, и в фазе прозы они только размывают фокус. Остаток
  // бюджета после вопросов Стражей достаётся им.
  const litQuota = phase === 'guards' ? Math.max(0, DIRECTIVE_BUDGET - 2 - chosenFactual.length) : 0;
  const chosenLit = litQuota
    ? take(literaryNotes||[], litQuota, 'сов. лит. стражей')
    : ((literaryNotes||[]).length ? (deferred.push(`${literaryNotes.length} сов. лит. стражей`), []) : []);
  if(chosenLit.length) parts.push('ЗАМЕЧАНИЯ ЛИТЕРАТУРНЫХ СТРАЖЕЙ (стиль/приём — учти при правке, если не противоречит другим указаниям):\n' + chosenLit.join('\n'));
  // Раньше сюда уходил ВЕСЬ накопленный список (до 150 оборотов со всей книги —
  // см. state.usedCliches) под формулировкой «убери клише». Две проблемы разом:
  // список сам по себе весил больше, чем все замечания вместе, и главное —
  // «убери эти обороты» не мешает написать НОВЫЕ клише на их месте. Живой замер
  // подтвердил ровно это: каждая итерация давала ровно 3 клише, все три — новые,
  // и ось «Свежесть» физически не могла вырасти. Теперь список урезан до
  // последних 12 (остальное всё равно не читается), а запрет сформулирован как
  // КЛАСС приёма с явным указанием, чем заменять — конкретной деталью, а не
  // синонимом той же идеи.
  if(allBanned.length){
    const показать = allBanned.slice(-12);
    parts.push('НЕ ИСПОЛЬЗУЙ эти обороты — они уже забракованы Оценщиком в этой книге'
      + (allBanned.length > показать.length ? ` (показаны последние ${показать.length} из ${allBanned.length})` : '') + ': '
      + показать.join(', ')
      + '\nЗамена — НЕ синоним и НЕ другой образ той же идеи: это тот же штамп другими словами, и следующая проверка забракует его так же. Замена — конкретная наблюдаемая деталь ЭТОГО места: что именно видно, слышно, что делает тело или предмет здесь и сейчас. Если без образа фраза работает — убери образ совсем, это лучше нового сравнения.');
  }
  if(deferred.length && opts.onDefer) opts.onDefer(deferred);
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
  _cancelRequested = false;   // прошлая отмена не должна убивать новый прогон
  const g = state.global;
  const prevSceneText = opts.prevSceneText || prevDoneSceneText(state, scene);
  const runId = startRun(scene.id, 'Сцена: ' + (scene.title||scene.id));

  try {
    // ── 1. Архитектор сцены (опц.) ──
    let architectText = '';
    if(agentEnabled('architect')){
      const ac = ag(state,'architect');
      const aMsgs = architectMessages(state, scene, bookContextBlock(state, scene));
      for(let g0=0; g0<6; g0++){
        onProgress && onProgress({stage:'architect', text:'Архитектор планирует сцену…'});
        const architectMaxTk = ac.maxTokens??720;
        let aRes = await callLLM({ ...llmFor(state,ac), temperature:ac.temp??0.4, messages:aMsgs, maxTokens: architectMaxTk });
        let plan = parseArchitect(aRes.text);
        // Обрыв по токенам посреди JSON парсится в null — architectToText(null)
        // тихо схлопывается в '', и Прозаик пишет первый черновик вообще без
        // плана сцены (якорей/шагов/цели/препятствия), а лог всё равно ниже
        // безусловно писал «план сцены готов» — неотличимо от настоящего
        // успеха. Тот же принцип повтора с увеличенным лимитом, что уже стоит
        // у Прозаика/Оценщика/Стражей.
        if(!plan && aRes.text && aRes.text.trim()){
          const retryMaxTk = Math.max(architectMaxTk+1, Math.min(MAX_OUTPUT_TOKENS, architectMaxTk*2));
          onProgress && onProgress({log:{icon:'⚠️', text:`Архитектор: ответ не распарсился (похоже на обрыв токенами, лимит был ${architectMaxTk}) — повтор с лимитом ${retryMaxTk}`, state:'warn'}});
          aRes = await callLLM({ ...llmFor(state,ac), temperature:ac.temp??0.4, messages:aMsgs, maxTokens: retryMaxTk });
          plan = parseArchitect(aRes.text);
        }
        architectText = architectToText(plan, scene);
        if(plan && plan.presentChars.length) scene.presentChars = plan.presentChars;
        logStep({ agent:'architect', input:aMsgs[1].content, output:aRes.text,
          tokensIn:aRes.tokensIn, tokensOut:aRes.tokensOut, cost:aRes.cost });
        onProgress && onProgress({log:{icon:'🏗', text: plan ? 'Архитектор: план сцены готов' : 'Архитектор: план не удалось получить — Прозаик пишет без плана', state: plan?undefined:'warn'}});
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
    // Ось «Голос» судится сверкой с образцами голоса автора. Их нет — судить
    // не по чему, и ось исключается из балла (см. skipAxes в parseEvaluator).
    // Объявлено здесь, а не рядом с voiceExamples ниже: Оценщик вызывается
    // РАНЬШЕ блока Стражей, где та переменная появляется.
    const evalSkipAxes = (state.voice?.examples||[]).filter(Boolean).length ? [] : ['voice'];
    // ?? 3, а не 5: дефолт этого поля — 3 (defaultState в state.js). Расхождение
    // фолбэка с настоящим дефолтом означало, что проект без явно заданного поля
    // молча работал с другим числом итераций, чем показывали Настройки.
    const maxIter = agentEnabled('evaluator') ? (g.evaluatorMaxIter ?? 3) : 1;
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
    // Нужны для тай-брейка при РАВНОМ балле (см. draftBeatsBest): без них
    // «6.3 против 6.3» было неразрешимо, и побеждал всегда первый черновик.
    let bestCriticals = 0, bestQuestions = 0;
    // opts.directive — «стоячее» указание (например, от целевой правки по
    // конкретным находкам, заданной вызывающим кодом), не разовая подсказка.
    // Раньше directive безусловно перезаписывался в конце КАЖДОЙ итерации
    // текстом, собранным ТОЛЬКО из текущих находок Оценщика/Стражей — исходная
    // формулировка автора учитывалась лишь в первой правке и затем терялась
    // безвозвратно. Живой инцидент: целевая правка сцены с конкретной
    // инструкцией «дай источник знания персонажу N» отработала на итерации 1,
    // но все 4 следующие итерации Прозаик её уже не видел и просто отклонял
    // те же находки Стражей как «авторский приём» — балл не сдвинулся.
    const standingDirective = opts.directive || '';
    // Домешивается в директиву КАЖДОЙ итерации (не только первой) во всех трёх
    // местах, где directive пересобирается заново.
    const standingBlock = standingDirective
      ? '\n\nПОСТОЯННОЕ УКАЗАНИЕ АВТОРА (учитывать на каждой правке, не только на первой — это не разовая подсказка):\n' + standingDirective
      : '';
    let directive = standingDirective;
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
    // Якоря ПРЕДЫДУЩЕЙ итерации (verdict.anchors — дословные цитаты, которые
    // Оценщик пометил «работает, не трогай», см. buildUnifiedDirective). Сама
    // инструкция сохранить их уже уходит в директиву, но раньше ничто не
    // проверяло, выполнил ли её Прозаик — модель может молча срезать якорь
    // вместе с «водой» вокруг него. Живой инцидент: при повторной автоматической
    // правке уже готовой сцены пропали финальный сюжетный крючок и часть
    // фактуры места из брифа, а балл Оценщика при этом вырос (короче и чище
    // читается как «лучше» по темпу, хотя реально текст обеднел). prevIterAnchors
    // хранится между итерациями для сверки с ТЕКУЩИМ черновиком ниже по циклу.
    let prevIterAnchors = [];
    // История вопросов фактических стражей по итерациям — детектор «застрявшего»
    // пробела (см. FACTUAL_ESCALATE_ITERS ниже): один и тот же вопрос без ответа
    // много итераций подряд эскалируется в обязательную правку.
    let factualWarningTracker = [];
    const AXIS_LABELS = Object.fromEntries(RUBRIC_AXES.map(a=>[a.key, a.label]));
    // Нарушения ЯВНЫХ правил автора (Страж стиля) — отдельно от мнений остальных
    // литературных стражей, см. обоснование у места заполнения ниже.
    // Объявлено ЗДЕСЬ, а не внутри цикла итераций, хотя заполняется именно там:
    // directiveOpts — замыкание, создаваемое ДО цикла, и оно читает эту
    // переменную. Объявление `let styleNotes` внутри тела цикла давало другую
    // область видимости, и первый же реальный вызов падал с
    // «styleNotes is not defined» (живой прогон 1.75.0). Внутри цикла теперь
    // только присваивание — оно же и сбрасывает список на каждой итерации.
    let styleNotes = [];
    // Общие опции сборки директивы для обеих веток (ручной гейт Оценщика и
    // автоматическая). Фаза считается от НОМЕРА текущей итерации, поэтому это
    // функция, а не объект: iter меняется на каждом витке цикла.
    const directiveOpts = (v)=>({
      phase: directivePhase(iter),
      scores: v?.scores,
      styleNotes,   // нарушенные правила автора — идут в обеих фазах, см. buildUnifiedDirective
      onDefer: (list)=> onProgress && onProgress({log:{icon:'📋',
        text:`Директива сжата до ${DIRECTIVE_BUDGET} пунктов (${directivePhase(iter)==='prose'?'фаза прозы — оси Оценщика':'фаза стражей — логика и приёмы'}). Отложено на следующую итерацию: ${list.join(', ')}`}}),
    });
    // true, если предыдущая итерация обнаружила стагнацию осей — на СЛЕДУЮЩУЮ
    // итерацию идём через radicalReviseMessages вместо surgicalReviseMessages
    // (см. комментарий там же): иначе директива «измени РАДИКАЛЬНО» уходит в
    // промпт, который тут же безусловно запрещает именно это, и застревание
    // никогда не выходит из локального минимума точечных правок.
    let stagnantLastIter = false;
    let fullStagnationStreak = 0;   // подряд идущие итерации, где встали ВСЕ оси

    while(iter < maxIter && safety++ < 20){
      // Точка отмены на границе итерации: текущий платный вызов уже оплачен и
      // доработал, следующего не будет. Лучший черновик сохранится ниже.
      if(_cancelRequested){
        onProgress && onProgress({log:{icon:'🛑', text:`Остановлено автором на итерации ${iter}. Сохраняю лучший черновик из уже написанных — ничего не потеряно.`, state:'warn'}});
        break;
      }
      iter++;
      const isRevision = !!(iter > 1 && prevDraft || iter === 1 && prevDraft && directive);
      let streamed = '';
      const streamCb = chunk=>{ streamed+=chunk; onProgress && onProgress({stage:'prose', text:streamed, streaming:true}); };
      // Сброс накопленного превью при внутреннем ретрае callLLM (см. llm.js) —
      // иначе чанки неудачной попытки, уже показанные через streamCb, оставались
      // склеены с началом успешного повтора на несколько секунд стриминга.
      const streamRetry = ()=>{ streamed = ''; };
      // Отчёт бюджета контекста живёт на уровне итерации: сам ctx объявлен
      // внутри ветки «первый черновик», а предупреждение печатается ниже, уже
      // за обеими ветками. На правке (isRevision) контекст не пересобирается —
      // там остаётся пустым, и предупреждение справедливо молчит.
      let ctxTrimmed = [];
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
        // Запас под [РАЗБОР] раньше был плоским (+2000) независимо от того,
        // сколько замечаний Прозаику нужно разобрать. Живой замер (трейс
        // прогона «Подпольщики в подвале», state.diagnostics.runs): загрузка
        // потолка правки росла 86%→87%→83%→92%→94% от итерации к итерации по
        // мере накопления находок Стражей — запас таял именно тогда, когда
        // критики находили БОЛЬШЕ всего, а не когда сцена становилась длиннее.
        // Масштабируем запас от длины самой директивы (chars/2 — та же
        // кир.-эвристика, что и для прозы), а не фиксированной константой.
        const debateAllowance = Math.max(1500, Math.round(directive.length/2) + 500);
        // +20% по запросу автора (общий проход по всем лимитам токенов приложения).
        const cap = Math.round(Math.min(70000, Math.max(2500, Math.round(prevDraft.length/2) + debateAllowance)) * 1.2);
        const reviseMsgs = stagnantLastIter
          ? radicalReviseMessages(prevDraft, directive, effectiveRules(state.style))
          : surgicalReviseMessages(prevDraft, directive, effectiveRules(state.style));
        const reviseMaxTk = Math.max(proseAg.maxTokens ?? cap, cap);
        pRes = await callLLM({ ...llmFor(state,proseAg), temperature:0.4, messages: reviseMsgs, maxTokens: reviseMaxTk }, streamCb, streamRetry);
        let parsed = parseDebateRevision(pRes.text);
        // Разбор/раздор side-effects (лог дебата + запомненные отклонения) общие
        // для первой попытки и повтора ниже — вынесены, чтобы не дублировать.
        const applyDebateSideEffects = (p)=>{
          if(p.debate) logStep({ agent:'prose-debate', iter, input:directive, output:p.debate, tokensIn:0, tokensOut:0, cost:0 });
          if(p.rejected && p.rejected.length){
            rememberRejected(scene, p.rejected);
            // «больше не будут подсвечиваться» было неправдой: отказ — это ЗАЯВКА
            // Прозаика, а решение принимает фильтр ниже, и он оставляет
            // критические и уже эскалированные находки. Сколько реально скрыто —
            // говорит отдельная строка «Скрыто N замеч.».
            onProgress && onProgress({log:{icon:'🖋', text:`Прозаик мотивированно отклонил ${p.rejected.length} замеч. (${p.rejected.map(r=>'«'+r.quote.slice(0,40)+'»').join(', ')}) — критические и эскалированные из них останутся видимыми`}});
          }
        };
        applyDebateSideEffects(parsed);
        if(parsed.truncated){
          // Раньше обрыв токенами на ПРАВКЕ (в отличие от первого черновика чуть
          // ниже по файлу) молча откатывался к prevDraft без единой попытки
          // повторить с большим лимитом — сцена, застрявшая в правке, не могла
          // сдвинуться с места вообще: каждая попытка правки обрывалась, текст не
          // менялся, те же замечания Стражей закономерно возвращались снова и
          // снова (живой репорт «почему 4-я сцена не может улучшиться»). Тот же
          // принцип повтора с удвоенным лимитом, что уже стоит на первом черновике.
          const retryMaxTk = Math.max(reviseMaxTk + 1, Math.min(MAX_OUTPUT_TOKENS, reviseMaxTk * 2));
          onProgress && onProgress({log:{icon:'⚠️', text:`Прозаик: ответ обрезан токенами (лимит был ${reviseMaxTk}) — повтор с лимитом ${retryMaxTk}`, state:'warn'}});
          pRes = await callLLM({ ...llmFor(state,proseAg), temperature:0.4, messages: reviseMsgs, maxTokens: retryMaxTk }, streamCb, streamRetry);
          parsed = parseDebateRevision(pRes.text);
          applyDebateSideEffects(parsed);
          if(parsed.truncated){
            onProgress && onProgress({log:{icon:'⚠️', text:'Прозаик: повтор тоже обрезан токенами — используем предыдущий черновик', state:'warn'}});
            pRes.text = prevDraft;
          } else if(parsed.prose) pRes.text = parsed.prose;
        } else if(parsed.prose) pRes.text = parsed.prose;
        // parsed.truncated ловит только «тега [ТЕКСТ] почти нет» (обрыв сразу после
        // тега) — но тег может быть на месте, а сама проза внутри него оборваться
        // на полуслове чуть дальше (обрыв ближе к концу ответа, формально не «почти
        // пусто»). Живой инцидент: две сцены книги ушли в финал с последним
        // предложением, обрывающимся посреди слова — ни parsed.truncated (тег и
        // текст были), ни проверка длины ниже (обрыв был не настолько драматичным,
        // чтобы просесть под 60%) этого не поймали. looksTokenTruncated — та же
        // эвристика, что уже стоит на первом черновике и на Линейном редакторе.
        // pRes.hitLimit — достоверный признак от самого апстрима (finish_reason):
        // ловит и обрыв, который случайно пришёлся на знак препинания и поэтому
        // не виден эвристике по хвосту текста.
        if(pRes.text && pRes.text !== prevDraft && (pRes.hitLimit || looksTokenTruncated(pRes.text))){
          onProgress && onProgress({log:{icon:'⚠️', text:'Прозаик: правка обрывается не на знаке препинания (похоже на обрыв токенами, хотя тег [ТЕКСТ] был на месте) — используем предыдущий черновик', state:'warn'}});
          pRes.text = prevDraft;
        }
        // Живой инцидент: «Оценщик: 1/10 · Черновик отсутствует — предоставлен
        // пустой текст». Причина — здесь стояло `pRes.text && pRes.text.length
        // < ...`: если parsed.prose оказывался ПУСТОЙ строкой (тег [ТЕКСТ] был,
        // но без [РАЗБОР] и без содержимого — узкий случай, который не ловит
        // parsed.truncated выше, т.к. тот требует hasDebate), `pRes.text && ...`
        // был ЛОЖЬЮ уже на пустой строке — откат к prevDraft не срабатывал
        // именно тогда, когда он нужнее всего. Итог: пустая «правка» уходила
        // прямиком Стражам и Оценщику как черновик сцены, тратя вызов впустую.
        if((!pRes.text || pRes.text.length < prevDraft.length*0.6) && !SHORTEN_HINT_RE.test(directive)){
          if(!pRes.text) onProgress && onProgress({log:{icon:'⚠️', text:'Прозаик: правка вернула пустой текст — используем предыдущий черновик', state:'warn'}});
          pRes.text = prevDraft;
        }
        logInput = '(разбор замечаний + точечная правка) ' + (directive||'');
      } else {
        onProgress && onProgress({stage:'prose', text:'Прозаик пишет…'});
        const ctx = buildSceneContext(state, scene, { prevSceneText, architectOutput:architectText, directive, prevDraft:'' });
        ctxTrimmed = ctx.trimmed || [];
        const sceneWords = scene.targetWords || 700;
        // 3.5 ток/слово (не 2.5) — с запасом над реальной плотностью ≈2.78,
        // измеренной на уже написанных сценах книги (см. cap чуть выше по файлу).
        // +20% по запросу автора (общий проход по всем лимитам токенов приложения).
        const dynMin = Math.round(Math.max(2500, Math.round(sceneWords * 3.5)) * 1.2);
        const proseMaxTk = proseAg.maxTokens != null ? Math.max(proseAg.maxTokens, dynMin) : dynMin;
        pRes = await callLLM({ ...llmFor(state,proseAg), temperature: proseAg.temp ?? 0.85, messages:ctx.messages, maxTokens: proseMaxTk }, streamCb, streamRetry);
        // Первый черновик не проходит через parseDebateRevision (нет секции [ТЕКСТ] —
        // это просто сырая проза), поэтому обрыв по лимиту токенов раньше не ловился
        // вообще: текст молча уходил дальше по пайплайну оборванным на полуслове.
        // Настоящая проза почти всегда кончается на пунктуацию конца предложения —
        // резкий обрыв без неё сильный сигнал упора в maxTokens, не завершения мысли.
        // pRes.hitLimit — прямой finish_reason апстрима, ловит и совпадение, когда
        // обрыв пришёлся ровно на знак препинания и эвристика ниже промолчала бы.
        if(pRes.hitLimit || looksTokenTruncated(pRes.text)){
          // Раньше потолок в 8000 срезал повтор до +28% вместо честного ×2 для
          // сцен с proseMaxTk уже за 4000 (2500+ слов) — повтор с почти тем же
          // лимитом почти гарантированно упирался туда же.
          // Тот же защитный Math.max, что и у Оценщика ниже по файлу: для очень
          // длинных целевых сцен (targetWords в тысячах) proseMaxTk сам может
          // превысить 9600, и Math.min(19200, proseMaxTk*2) без Math.max отдал
          // бы ретрай МЕНЬШЕ исходного лимита — тот же обрыв гарантированно.
          const retryMaxTk = Math.max(proseMaxTk + 1, Math.min(MAX_OUTPUT_TOKENS, proseMaxTk * 2));
          onProgress && onProgress({log:{icon:'⚠️', text:`Прозаик: черновик похож на обрыв токенами (${proseMaxTk} ток.) — повтор с лимитом ${retryMaxTk}`, state:'warn'}});
          pRes = await callLLM({ ...llmFor(state,proseAg), temperature: proseAg.temp ?? 0.85, messages:ctx.messages, maxTokens: retryMaxTk }, streamCb, streamRetry);
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
      // Текст, который Прозаик РЕАЛЬНО правил на этой итерации — снимок до
      // перезаписи строкой ниже. Нужен проверке якорей: она обязана спрашивать
      // «был во входе и пропал в выходе», а prevDraft к моменту проверки уже
      // равен pRes.text, и сравнение шло бы текста с самим собой.
      const revisedFrom = prevDraft;
      prevDraft = pRes.text;
      if(pRes.text) lastGenerated = pRes.text;
      logStep({ agent:'prose', iter, input:logInput, output:pRes.text,
        layers:logLayers, tokensIn:pRes.tokensIn, tokensOut:pRes.tokensOut, cost:pRes.cost });
      const _budget = (state.global && state.global.budgetTokens) || 128000;
      const _pct = Math.round((pRes.tokensIn||0) / _budget * 100);
      onProgress && onProgress({log:{icon:'✍️', text:isRevision?`Прозаик: черновик ${iter} (разобрал замечания)`:`Прозаик: черновик ${iter} написан · контекст ${pRes.tokensIn||0} / ${_budget} ток. (${_pct}%)`}});
      // Раньше здесь стояла догадка по размеру входа: «часть памяти МОГЛА быть
      // урезана». Она и врала в обе стороны — молчала, когда бюджет реально
      // выбил канон при заполнении ниже 80%, и пугала, когда всё влезло. Теперь
      // buildSceneContext возвращает факт: что именно урезано и на сколько.
      // Отдельно выделяем канон и персонажей: их потеря означает, что Прозаик
      // пишет сцену, не зная фактов собственной книги, — это не деградация
      // качества, а прямой источник противоречий.
      const _trim = ctxTrimmed;
      if(_trim.length){
        const текст = _trim.map(t=>{
          const имя = LAYER_LABELS[t.слой] || t.слой;
          return t.вид==='частично' ? `${имя} (${t.сколько} самых старых)` : t.вид==='ужат' ? `${имя} (сжат)` : `${имя} — ЦЕЛИКОМ`;
        }).join(', ');
        const критично = _trim.some(t=>(t.слой==='bible'||t.слой==='characters') && t.вид==='целиком');
        onProgress && onProgress({log:{icon: критично?'🛑':'⚠️',
          text: `Контекст не влез в бюджет (${pRes.tokensIn||0} из ${_budget} ток.) — урезано: ${текст}.`
            + (критично ? ' Прозаик писал сцену БЕЗ канона книги — вероятны противоречия с уже написанным. Поднимите бюджет в Настройках.' : ' Поднимите бюджет в Настройках, если это повторяется.'),
          state:'warn'}});
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
        // Внешние эталоны для «Свежести»/«Темпа» (см. agents.js) — оба
        // self-referential к ЭТОЙ книге (не жанровый норматив), поэтому
        // работают одинаково для любого жанра/типа прозы без настройки.
        const doneWords = (state.structure||[]).filter(n=>n.type==='scene' && n.status==='done' && n.words).map(n=>n.words);
        let paceBaseline = null;
        if(doneWords.length >= 3){
          const sorted = [...doneWords].sort((a,b)=>a-b);
          paceBaseline = { medianWords: sorted[Math.floor(sorted.length/2)], sceneWords: (pRes.text.match(/\S+/g)||[]).length };
        }
        const eMsgs = evaluatorMessages(scene, pRes.text, state.voice?.examples, bookContextBlock(state, scene), effectiveRules(state.style), { usedCliches: state.usedCliches, paceBaseline, recentEndings: state.recentSceneEndings });
        // ЗДЕСЬ БЫЛ ЯКОРЬ: Оценщику дописывали оси черновика 1 «чтобы он не
        // дрейфовал между итерациями». Замер на одном и том же тексте показал,
        // что лекарство хуже болезни:
        //   собственный шум без якоря  — 6.3 / 6.7 / 6.5, разброс 0.4
        //   с якорем                   — 5.0 … 7.7,        разброс 2.7
        // Балл ехал за подставленным числом: с ложным низким якорем [3,3,3,3,3]
        // тот же текст получил 5.0, с ложным высоким [9,9,9,9,9] — 7.7. То есть
        // оценивался не текст, а наша же подсказка.
        //
        // Отсюда и «балл не растёт»: якорь — это ВСЕГДА оси первого черновика
        // (anchorVerdict фиксируется один раз и не обновляется), поэтому каждая
        // итерация подтягивалась обратно к стартовой сетке, и улучшению негде
        // было проявиться. Вдобавок формулировка «ось должна падать, если
        // добавлена новая проблема» заставляла модель на похожем тексте
        // страховаться в минус: с настоящим якорем тот же черновик получил 6.0
        // против 6.7 без него.
        //
        // anchorVerdict остаётся — он нужен для показа Δ в логе и для детектора
        // стагнации, которые смотрят на разобранные вердикты, а не на промпт.
        // Ценой отказа остаётся собственный шум ±0.4: сцена у самого порога
        // может пройти или не пройти на удачном броске. Это честнее, чем
        // управляемая нами же оценка.
        const evalMaxTk = evalAg.maxTokens ?? 1080;
        let eRes = await callLLM({ ...llmFor(state,evalAg), temperature:evalAg.temp??0.2, messages:eMsgs, maxTokens:evalMaxTk });
        verdict = parseEvaluator(eRes.text, threshold, { skipAxes: evalSkipAxes });
        // Живой инцидент: реальный usage апстрима (не оценка) показал tokensOut
        // РОВНО на заявленном maxTokens — JSON оборвался и не распарсился
        // (verdict.ok=false). Раньше это молча проглатывалось: черновик без
        // валидной оценки мог всё равно победить в отборе best (см. thisClean
        // ниже — теперь требует verdict.ok), и сцена уходила в книгу без
        // реальной проверки качества. Один ретрай с удвоенным лимитом — тот же
        // приём, что уже стоит на первом черновике Прозаика.
        if(!verdict.ok){
          // Живой инцидент: сообщение ВСЕГДА винило «обрыв токенами», даже когда
          // ответ был вдвое короче лимита (значит дело не в лимите, а в том, что
          // JSON сломан по другой причине — экранирование кавычек, лишний текст
          // и т.п.) — автору не по чему было отличить «нужен лимит больше» от
          // «формат ответа сломан». eRes.hitLimit — прямой finish_reason от
          // апстрима (см. llm.js), достовернее приблизительного сравнения
          // tokensOut с потолком; ratio-эвристика остаётся запасным вариантом
          // для провайдеров, не присылающих finish_reason.
          const nearLimit = eRes.hitLimit || (eRes.tokensOut||0) >= evalMaxTk*0.85;
          // Живой инцидент: автор поднял слайдер Оценщика до 8000 (максимум
          // слайдера) — старый потолок ретрая (константа 7200) оказался НИЖЕ
          // исходного лимита, так что «повтор с большим лимитом» на самом деле
          // повторял с МЕНЬШИМ (7200 < 8000), гарантированно тем же обрывом.
          // Math.max ниже гарантирует, что ретрай никогда не будет уже исходной
          // попытки, независимо от того, что задал автор на слайдере.
          const evalRetryTk = Math.max(evalMaxTk + 1, Math.min(MAX_OUTPUT_TOKENS, evalMaxTk * 2));
          onProgress && onProgress({log:{icon:'⚠️', text:`Оценщик: ответ не распарсился (${nearLimit?`похоже на обрыв токенами, лимит был ${evalMaxTk}`:`НЕ похоже на обрыв лимита — ответ ${eRes.tokensOut||0} из ${evalMaxTk} ток., скорее всего сломан формат JSON`}) — повтор с лимитом ${evalRetryTk}`, state:'warn'}});
          // Раньше сырой ответ ПЕРВОЙ (неудачной) попытки нигде не сохранялся —
          // logStep ниже логирует только финальный eRes (после ретрая), и если
          // ретрай тоже не распарсился, единственная сохранённая копия — снова
          // только вторая попытка. Причину первого провала невозможно было
          // посмотреть постфактум. Логируем её отдельным шагом для диагностики.
          logStep({ agent:'evaluator-retry', iter, input:`(попытка 1, ${nearLimit?'похоже на обрыв':'формат сломан'})`, output:eRes.text, tokensIn:eRes.tokensIn, tokensOut:eRes.tokensOut, cost:eRes.cost });
          eRes = await callLLM({ ...llmFor(state,evalAg), temperature:evalAg.temp??0.2, messages:eMsgs, maxTokens:evalRetryTk });
          verdict = parseEvaluator(eRes.text, threshold, { skipAxes: evalSkipAxes });
        }
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
      // 0.7 → 0.9. Замерено на живом прогоне: сцены приземляются на 78-87% цели
      // (561/720 и 624/720), то есть СТАРЫЙ порог не срабатывал ни разу, и
      // противовес существовал только на бумаге. Механика перекоса: у Оценщика
      // есть оси, толкающие объём ВНИЗ (темп, «вода»/padding — он находил их на
      // каждой из трёх итераций), Линейный редактор режет следом, а вверх не
      // толкает никто. Отсюда систематический недобор 10-20%, который никто не
      // замечает, потому что каждая отдельная правка выглядит разумной.
      // 0.9 означает: пока сцена не дотянула до цели, замечание про «воду»
      // решается переписыванием, а не удалением. Сцену это не «раздувает» —
      // редактировать по-прежнему можно, нельзя только укорачивать.
      const tooShort = !!(scene.targetWords && curWords < scene.targetWords*0.9);
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
      // Потеря якорей ПРЕДЫДУЩЕЙ итерации — та же логика, что draftTruncated:
      // независимо от того, что скажет Оценщик про ЭТОТ черновик, если он молча
      // потерял то, что сам же Оценщик на прошлой итерации попросил сохранить
      // дословно, это регресс, а не улучшение. Не применяется к самому первому
      // черновику (isRevision===false) — там ещё нечего было терять.
      // Та же поправка, что у Линейного редактора: якоря приходят от оценки
      // ПРЕДЫДУЩЕГО черновика, а правил Прозаик revisedFrom — и это не всегда
      // один и тот же текст (см. подмену prevDraft на best ниже по файлу, когда
      // директива строится от bestEval). Без условия «был во входе» проверка
      // обвиняла бы Прозаика в потере того, чего ему не давали.
      const lostAnchors = (isRevision && prevIterAnchors.length)
        ? anchorsLostBy(revisedFrom, pRes.text, prevIterAnchors)
        : [];
      if(lostAnchors.length) onProgress && onProgress({log:{icon:'📌', text:`Правка потеряла якорь(я), закреплённые предыдущей оценкой: «${lostAnchors[0].slice(0,60)}»${lostAnchors.length>1?` (+${lostAnchors.length-1})`:''} — консенсус отложен, следующая правка должна их вернуть`, state:'warn'}});

      // ── Стражи: проверяют ТЕКУЩИЙ черновик (pRes.text), не исторический best.
      // Раньше проверяли best — если следующий черновик по сути исправлял находку
      // Стража, но чуть проседал по литературному баллу Оценщика, best не
      // обновлялся, и Стражи продолжали смотреть на старый, ещё бракованный текст.
      // Раньше блок Стражей был вложен в «Оценщик включён и автоматический» — при
      // ручном или выключенном Оценщике Стражи не запускались вовсе (и flags
      // оставался пустым в возвращаемом результате).
      flags = {};
      let criticals = [];
      // Сколько из criticals — от ФАКТИЧЕСКИХ стражей (логика/события/кастомный
      // factual) плюс эскалированные фактические вопросы. Отделено от общего
      // счёта ради thisClean ниже: см. подробное обоснование там.
      let criticalsFactual = 0;
      let factualQuestions = [];
      let literaryNotes = [];
      // styleNotes объявлен ВЫШЕ цикла (его читает замыкание directiveOpts) —
      // здесь только сброс на новую итерацию.
      styleNotes = [];
      // true, если ЭТА итерация прошла полный набор литературных стражей
      // (голос/стиль/юмор/POV/диалог/развязка/атмосфера/читатель) — по просьбе
      // автора запускаются теперь с первой итерации (см. комментарий у самого
      // запуска ниже), но флаг всё равно нужен для best-сравнения дальше —
      // если когда-нибудь снова понадобится запускать их не на каждой итерации,
      // непроверенный черновик не должен обходить проверенный просто по
      // случайному баллу Оценщика.
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

      // Инородная письменность (см. findForeignScript в llm.js). Тот же класс,
      // что и повторы выше: детерминированная проверка на артефакт модели, а не
      // творческое суждение. Отдельной строкой в лог — находка обязана быть
      // видна автору сразу, даже если Прозаик её потом не исправит: именно
      // молчание и было проблемой, а не сам факт иероглифов.
      const чужойАлфавит = findForeignScript(pRes.text);
      if(чужойАлфавит.length){
        flags.script = чужойАлфавит.map(d=>({ severity:'critical', title:'Инородная письменность в тексте',
          detail:'В русский текст попали символы чужой письменности — это сбой модели, а не приём. Замени фрагмент русским словом, сохранив смысл.',
          quote:d.quote }));
        onProgress && onProgress({log:{icon:'🔤',
          text:`Инородная письменность в черновике: ${чужойАлфавит.map(d=>'«'+d.quote+'»').join(', ')} — отправлено Прозаику как обязательная правка`}});
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

      // Однообразный вход в предложение («Он шагнул… Гурьев кивнул… Она
      // обернулась…»). Тот же класс, что повторы и чужая письменность выше:
      // считаем сами, без вызова модели. Правило автора об этом существует, но
      // три прогона подряд не исполнялось — а измеренная находка с номерами
      // предложений попадает в директиву наравне с критическими, и Прозаику
      // нечего трактовать: сказано, какие именно фразы перестроить.
      // Имена — из состояния книги, а не угаданные по тексту: угадывание ломают
      // падежи, а компенсация падежей даёт ложные срабатывания (см. guards.js).
      // presentChars сцены + общий список персонажей книги: первый точнее,
      // второй нужен, когда Архитектор не заполнил presentChars.
      const имена = [...new Set([...(scene.presentChars||[]),
                                 ...(state.characters||[]).map(c=>c.name)].filter(Boolean))];
      const однообразие = findMonotonousOpenings(pRes.text, имена);
      if(однообразие){
        onProgress && onProgress({log:{icon:'🎼',
          text:`Вход «герой + глагол»: ${однообразие.однотипных} из ${однообразие.предложений} предложений (${однообразие.доля}%). Для сравнения на тех же объёмах: Чехов 1.1%, Куприн 2.7–5.7%, Бунин 3.7–7.3%. Это справка автору, а не правка Прозаику.`}});
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
        if(agentEnabled('logic'))  guardJobs.push(guardJob(state,'logic', logicGuardMessages(state, scene, pRes.text, ag(state,'logic').strictness), flags, onProgress));
        if(agentEnabled('events')) guardJobs.push(guardJob(state,'events', eventsGuardMessages(state, scene, pRes.text, ag(state,'events').strictness), flags, onProgress));
        // Кастомные стражи, отмеченные автором как «фактические» (a.factual) — тоже
        // каждую итерацию, не только когда текст уже принят.
        (state.agents||[]).filter(a=>a.custom && a.enabled!==false && a.factual).forEach(a=>{
          guardJobs.push(guardJob(state, a.id, customGuardMessages(state, scene, pRes.text, a.prompt, a.strictness), flags, onProgress));
        });
        // Литературные стражи — раньше только когда текст принят или за одну
        // итерацию до конца (иначе их находки физически некому применить — после
        // последней итерации Прозаик уже не переписывает черновик). По просьбе
        // автора: с сокращением evaluatorMaxIter 5→3 (см. state.js) на «подождать
        // до конца» остаётся мало итераций, а отбор best уже приоритизирует
        // проверенный черновик над непроверенным (см. 1.20.7) — включаем стражей
        // с ПЕРВОЙ итерации: Прозаик получает их замечания в директиве раньше и
        // успевает исправить за оставшиеся попытки, вместо одного шанса в конце.
        {
          literaryChecked = true;
          if(agentEnabled('voiceguard')){
            if(voiceExamples.length > 0)
              guardJobs.push(guardJob(state,'voiceguard', voiceGuardMessages(scene, pRes.text, voiceExamples, ag(state,'voiceguard').strictness), flags, onProgress));
            else
              onProgress && onProgress({log:{icon:'👁', text:'Страж голоса: пропущен — добавьте образцы голоса в настройках «Голос»', state:'warn'}});
          }
          if(agentEnabled('styleguard')){
            // Тот же паттерн, что у Стража голоса чуть выше: раньше при пустых
            // style.rules страж молча не запускался вовсе — автор видел тумблер
            // включённым и был уверен, что проверка идёт, хотя guardJobs её
            // просто никогда не получал. Теперь явно предупреждаем, как и там.
            if((state.style?.rules||[]).filter(Boolean).length)
              guardJobs.push(guardJob(state,'styleguard', styleGuardMessages(pRes.text, effectiveRules(state.style), ag(state,'styleguard').strictness), flags, onProgress));
            else
              onProgress && onProgress({log:{icon:'🚦', text:'Страж стиля: пропущен — добавьте правила автора в настройках «Голос»', state:'warn'}});
          }
          if(agentEnabled('reader'))
            guardJobs.push(guardJob(state,'reader', readerGuardMessages(scene, pRes.text, ag(state,'reader').strictness, state.project?.genre), flags, onProgress, scene));
          if(agentEnabled('imagery'))
            guardJobs.push(guardJob(state,'imagery', imageryGuardMessages(pRes.text, ag(state,'imagery').strictness, state.project?.genre), flags, onProgress));
          if(agentEnabled('pov'))
            guardJobs.push(guardJob(state,'pov', povGuardMessages(pRes.text, ag(state,'pov').strictness), flags, onProgress));
          if(agentEnabled('dialogue'))
            guardJobs.push(guardJob(state,'dialogue', dialogueGuardMessages(pRes.text, ag(state,'dialogue').strictness), flags, onProgress));
          if(agentEnabled('resolution'))
            guardJobs.push(guardJob(state,'resolution', resolutionGuardMessages(pRes.text, ag(state,'resolution').strictness, state.project?.genre), flags, onProgress));
          if(agentEnabled('atmosphere'))
            guardJobs.push(guardJob(state,'atmosphere', atmosphereGuardMessages(pRes.text, ag(state,'atmosphere').strictness, state.project?.genre), flags, onProgress));
          // Только для иронических жанров (см. genreWantsHumor) — на остальных
          // проверка бессмысленна и просто тратила бы токены на пустой критерий.
          if(agentEnabled('humor') && wantsHumor)
            guardJobs.push(guardJob(state,'humor', humorGuardMessages(pRes.text, ag(state,'humor').strictness, state.project?.genre), flags, onProgress));
          (state.agents||[]).filter(a=>a.custom && a.enabled!==false && !a.factual).forEach(a=>{
            guardJobs.push(guardJob(state, a.id, customGuardMessages(state, scene, pRes.text, a.prompt, a.strictness), flags, onProgress));
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
        // ИСКЛЮЧЕНИЕ: находки фактических стражей, УЖЕ эскалированные (см.
        // FACTUAL_ESCALATE_ITERS ниже) — не даём «мотивированному отказу»
        // заглушить их навсегда. Смысл эскалации именно в том, что у Прозаика
        // кончились бесплатные пропуски; отказ на этом этапе — тот же пропуск,
        // просто сформулированный как обоснование. Живой инцидент: один и тот
        // же список из 9 уже эскалированных находок («Неустановленная
        // посылка» — целиком незакрытая цепочка знаний героя) был отклонён
        // Прозаиком ОДНИМ ходом под шаблонное «художественный приём» — без
        // этого исключения rememberRejected() стёр бы их из flags ДО того,
        // как эскалация на следующей итерации вообще успела бы их увидеть
        // (эскалация читает flags ПОСЛЕ этого фильтра, см. ниже), и находка
        // молча исчезла бы навсегда вместо того, чтобы остаться видимой.
        if(scene.rejectedNotes && scene.rejectedNotes.length){
          let droppedCount = 0;
          Object.keys(flags).forEach(role=>{
            const before = (flags[role]||[]).length;
            flags[role] = (flags[role]||[]).filter(f=>{
              if(f.severity==='ok') return true;
              // Критическое замечание не глушится отказом — от ЛЮБОГО стража, не
              // только фактического. Живой прогон: единственной критической
              // находкой была «Читатель: Герой полностью пассивен — за всю сцену
              // не принимает ни одного самостоятельного решения», и Прозаик
              // погасил её своим же отказом на первой итерации, вместе с 11
              // другими, одним ходом. Исключение ниже её не спасало: «Читатель»
              // не фактический страж. Получалось, что самый сильный сигнал
              // системы отменяет тот, кого он критикует. Отказ по-прежнему
              // возможен для warning — там цена ошибки несопоставима.
              if(f.severity==='critical') return true;
              const alreadyEscalated = isFactualGuard(state, role)
                && factualWarningTracker.some(t => t.count>=FACTUAL_ESCALATE_ITERS && noteSimilarity(f.title, t.title) >= REJECT_SIM_THRESHOLD);
              return alreadyEscalated || !isRejectedNote(f.title+' '+(f.detail||''), scene.rejectedNotes);
            });
            droppedCount += before - flags[role].length;
          });
          if(droppedCount) onProgress && onProgress({log:{icon:'🖋', text:`Скрыто ${droppedCount} замеч. — уже отклонено автором ранее как приём`}});
        }

        const flagList = Object.entries(flags).flatMap(([role,arr])=>(arr||[]).filter(f=>f.severity!=='ok').map(f=>({role,severity:f.severity,title:f.title,detail:f.detail||''})));
        // Критично — от любого стража. severity:'critical' — это ошибка, Прозаик обязан
        // её исправить.
        const criticalEntries = Object.entries(flags).flatMap(([role,arr])=>(arr||[])
          .filter(f=>f.severity==='critical')
          .map(f=>({ role, text:`[${GUARD_LABELS[role]||role}] ${f.title}: ${f.detail||''}` })));
        criticals = criticalEntries.map(c=>c.text);
        criticalsFactual = criticalEntries.filter(c=>isFactualGuard(state, c.role)).length;
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
          // Эскалированный вопрос фактического стража — по определению
          // фактическая ошибка, а не вопрос степени: идёт в жёсткое вето.
          criticalsFactual += escalatedFactual.length;
          onProgress && onProgress({log:{icon:'⚡', text:`Вопрос стражей логики/событий повторился ${FACTUAL_ESCALATE_ITERS}+ раз без ответа — эскалирован в обязательную правку: ${escalatedFactual.map(f=>f.title).join(', ')}`, state:'warn'}});
        }
        const escalatedTitles = new Set(escalatedFactual.map(f=>f.title));
        factualQuestions = rawFactual.filter(f=>!escalatedTitles.has(f.title))
          .map(f=>`[${GUARD_LABELS[f.role]||f.role}] ${f.title}: ${f.detail}`);
        // warning от ЛИТЕРАТУРНЫХ стражей (голос/стиль/юмор/диалог/...) — раньше
        // никуда не шли дальше flagList (видны в логе, но не в директиве Прозаику):
        // с гейтом на iter>=maxIter-1 они теперь успевают появиться ДО последней
        // итерации, так что должны реально доходить до правки, а не только до лога.
        // Находки Стража стиля вынесены ОТДЕЛЬНО от остальных литературных.
        // Причина не косметическая: остальные литературные стражи высказывают
        // профессиональное мнение («тут темп провис», «образ не сработал»), а
        // Страж стиля проверяет ЯВНОЕ ПРАВИЛО, которое автор сам записал —
        // это не вопрос вкуса, а нарушенное распоряжение. Раньше они шли одним
        // списком literaryNotes, а тот получает бюджет только в фазе стражей,
        // то есть один круг из трёх. Живой замер (прогон с 5 новыми правилами):
        // Страж стиля точно назвал 4 нарушения по номерам правил, но два из них
        // (одно имя ПОВ-героя, «водолаз» со стороны) Прозаик так и не исправил —
        // при 19 замечаниях на 8 слотов они просто не доехали до директивы.
        const styleRole = 'styleguard';
        styleNotes = (flags[styleRole]||[])
          .filter(f=>f.severity==='warning')
          .map(f=>`[Правило автора] ${f.title}: ${f.detail||''}`);
        literaryNotes = Object.entries(flags).flatMap(([role,arr])=>(arr||[])
          .filter(f=>f.severity==='warning' && !isFactualGuard(state, role) && role!==styleRole)
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
      // verdict.ok===false (Оценщик не распарсился, даже после ретрая выше) не
      // должен автоматически выигрывать отбор best только за счёт «нет
      // критических флагов Стражей» — Стражи и Оценщик проверяют РАЗНОЕ, и
      // нулевые критические флаги ничего не говорят о литературном качестве.
      // Живой инцидент: черновик с нераспарсенным вердиктом выиграл именно так
      // и ушёл в книгу с lastEval.ok=false — не низкой, а ОТСУТСТВУЮЩЕЙ оценкой.
      //
      // КРИТИЧНО: literaryChecked теперь проверяется ПЕРВЫМ, thisClean —
      // тай-брейк ВНУТРИ него, а не наоборот (было раньше). Причина: литературные
      // стражи (голос/стиль/развязка/атмосфера/юмор/...) бегут только на
      // evalAccepted или iter>=maxIter-1 — на РАННИХ итерациях literaryChecked
      // всегда false, а значит criticals там физически не может содержать их
      // находки (они ещё не проверялись), и thisClean у такой итерации был
      // «чист» просто потому, что её никто не смотрел. При старом порядке
      // (thisClean первым) это давало ложную победу: живой прогон книги (см.
      // «Мгновенное принятие говорящей тени» Стража развязки на итерациях 4-5)
      // подтвердил на симуляции реального лога — при старом порядке в best
      // уходила итерация 2, которую литературные стражи вообще НИ РАЗУ не
      // видели, а не итерация 4/5, где Страж развязки реально нашёл и не успел
      // исправить критическую проблему. Итог — сцена уходила в книгу без
      // единой литературной проверки, при этом сам факт непроверенности был
      // неотличим от «стражи проверили и всё чисто». Теперь проверенный
      // (пусть и с находками) черновик всегда предпочитается непроверенному —
      // «мы знаем, что не так» лучше, чем «никто не смотрел».
      // criticalsFactual, а НЕ criticals.length: живой прогон 1.72.0 на сцене
      // «Ящик на причале» показал цену бинарного вето от ремесленного стража.
      // Черновики: 1 — 6.5 балла и 1 критическая от Стража развязки
      // («мгновенное принятие невероятного»); 2 — 5.8 балла и НОЛЬ критических;
      // 3 — 6.2 балла и 2 критические. Так как clean стоит выше балла, победил
      // черновик 2 — на 0.7 балла ХУЖЕ лучшего, то есть заметно выше шума
      // Оценщика (EVAL_NOISE=0.5). Сцена в книге стала 5.7 вместо 6.5.
      //
      // Причина не в конкретном страже, а в том, что бинарный флаг от шумного
      // LLM-судьи безусловно перебивал измеренную оценку по 6 осям. Разделяю
      // по природе находки:
      //   • ФАКТИЧЕСКИЕ (логика/события/кастомный factual + эскалированные
      //     вопросы) — реальные ошибки: противоречие, ложный факт, потерянная
      //     судьба персонажа. Их нельзя «перевесить» балльной красотой —
      //     остаются жёстким вето, как раньше.
      //   • РЕМЕСЛЕННЫЕ (развязка/жанр/читатель/образы/POV/диалог/атмосфера) —
      //     вопросы СТЕПЕНИ («слишком быстро разрешилось», «темп провис»).
      //     Они по-прежнему идут в criticals → в директиву, Прозаик обязан их
      //     править, и они по-прежнему решают исход при РАВНОМ балле (тай-брейк
      //     по criticals внутри EVAL_NOISE, см. draftBeatsBest). Но перебить
      //     разницу балла выше шума они больше не могут.
      const thisClean = criticalsFactual === 0 && !draftTruncated && !lostAnchors.length && (!agentEnabled('evaluator') || verdict.ok);
      const этот = { literaryChecked, clean:thisClean, noScore:!agentEnabled('evaluator'),
        scored:!!verdict.ok, weighted:verdict.weighted||0,
        criticals:criticals.length, questions:factualQuestions.length };
      const лучший = bestEval ? { literaryChecked:bestLiteraryChecked, clean:bestClean,
        noScore:!agentEnabled('evaluator'), scored:!!bestEval.ok, weighted:bestEval.weighted||0,
        criticals:bestCriticals, questions:bestQuestions } : null;
      if(draftBeatsBest(этот, лучший)){
        // bestFlags — снимок flags ИМЕННО этой итерации (flags — общая переменная,
        // сбрасывается и переписывается на каждой итерации; без снимка возвращённые
        // флаги могли бы описывать текст из ДРУГОЙ, не победившей итерации —
        // например, дубль фразы, исправленный на итерации 2 (best), но снова
        // возникший на итерации 3 (не выигравшей) — так итог показывал бы
        // критическую находку для текста, которого в возвращённом best уже нет.
        best = pRes.text; bestEval = verdict; bestClean = thisClean; bestFlags = {...flags}; bestLiteraryChecked = literaryChecked;
        bestCriticals = criticals.length; bestQuestions = factualQuestions.length;
      }

      // Заметка про потерянные якоря — общая для обеих веток (с/без Оценщика).
      const anchorNote = lostAnchors.length
        ? '\n\nПОТЕРЯНЫ ЗАКРЕПЛЁННЫЕ ЯКОРЯ (предыдущая оценка просила сохранить дословно, правка их убрала): ' + lostAnchors.join('; ') + ' — верни их дословно или явно замени на равноценную по функции деталь, если решил осознанно её убрать.'
        : '';

      if(!agentEnabled('evaluator')){
        // Без Оценщика решение о завершении — только по Стражам (+ проверка обрыва).
        // lostAnchors блокирует так же, как и без Оценщика больше некому его ловить —
        // не на последней итерации, иначе прогон зациклится без выхода.
        if(criticals.length === 0 && !draftTruncated && (!lostAnchors.length || iter >= maxIter)) break;
        directive = 'КРИТИЧЕСКИЕ ЗАМЕЧАНИЯ СТРАЖЕЙ:\n' + criticals.join('\n')
          + (factualQuestions.length ? '\n\nВОПРОСЫ СТРАЖЕЙ ЛОГИКИ/СОБЫТИЙ (не выдумывай ответ):\n' + factualQuestions.join('\n') : '')
          + (draftTruncated ? '\n\nПРЕДЫДУЩИЙ ОТВЕТ ОБОРВАЛСЯ НА ПОЛУСЛОВЕ (упор в лимит токенов/сети) — допиши/перепиши сцену целиком до естественного конца, не редактируй точечно.' : '')
          + anchorNote + standingBlock;
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
          best = edited || pRes.text;
          // Если автор правил текст в гейте вручную — verdict (как и flags) этой
          // итерации относился к тексту ДО правки, дальше недостоверен (тот же
          // принцип, что и сброс lastEval/flags при ручной правке в редакторе —
          // см. фикс в ui/stages.js). Комментарий ниже уже называл оба поля, но
          // раньше обнулялся только bestFlags — bestEval оставался старым баллом
          // и приписывался тексту, который Оценщик никогда не видел.
          bestEval = edited ? null : verdict;
          bestFlags = edited ? {} : {...flags};
          break;
        }
        if(gt.text?.trim()){ pRes.text=gt.text.trim(); prevDraft=pRes.text; }
        directive = (gt.note || buildUnifiedDirective(verdict, allBanned, criticals, factualQuestions, literaryNotes, tooShort, directiveOpts(verdict)) || directive) + standingBlock;
        continue;
      }

      // Консенсус: оценщик принял И стражи не нашли критических проблем → готово.
      // grossShort/lostAnchors блокируют консенсус, но не на последней итерации —
      // иначе сцена, которую модель упорно пишет коротко или упорно теряет якоря,
      // зациклила бы прогон впустую; на выходе такой текст всё равно помечен
      // бейджем недобора в UI (якоря — только предупреждением в логе).
      if(evalAccepted && criticals.length === 0 && !draftTruncated && (!grossShort || iter >= maxIter) && (!lostAnchors.length || iter >= maxIter)){ break; }
      if(evalAccepted && criticals.length === 0 && !draftTruncated && grossShort){
        onProgress && onProgress({log:{icon:'📏', text:`Объём критически ниже цели (${curWords} из ${scene.targetWords} сл.) — консенсус отложен, следующая правка расширяет сцену`, state:'warn'}});
      }
      // Недобор в полосе 60-90% консенсус НЕ откладывает (сцена может быть
      // короткой намеренно — это вопрос ритма, а не брака), но автор обязан о
      // нём знать: раньше он не знал ничего, пока не сверял числа руками.
      else if(tooShort && !grossShort){
        onProgress && onProgress({log:{icon:'📏', text:`Объём ниже цели: ${curWords} из ${scene.targetWords} сл. (${Math.round(curWords/scene.targetWords*100)}%) — в директиву добавлена задача довести до цели за счёт замечаний Стражей, а не воды`, state:'warn'}});
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
        // Считаем только по осям, реально присутствующим в ОБОИХ замерах.
        // Ось, исключённая из оценки (например «Голос» без образцов голоса —
        // см. skipAxes в parseEvaluator), в scores не попадает, и старое
        // `(last[k]||0) <= (prev[k]||0)+0.5` давало 0 <= 0.5 → «застряла»
        // ВСЕГДА. Это не косметика: полная стагнация (все оси разом) досрочно
        // обрывает прогон, так что отсутствующая ось молча приближала выход
        // из цикла на каждой итерации.
        const судимыеОси = RUBRIC_AXES.map(a=>a.key).filter(k=>last[k]!=null && prev[k]!=null);
        const stuck = adjacent ? судимыеОси.filter(k=>last[k] <= prev[k] + 0.5) : [];
        if(stuck.length){
          stagnantNote = '\n\nОСИ БЕЗ ПРОГРЕССА — измени подход РАДИКАЛЬНО, не шлифуй то же самое: ' + stuck.map(k=>AXIS_LABELS[k]||k).join(', ');
          stagnantLastIter = true;
          onProgress && onProgress({log:{icon:'⚡', text:`Стагнация осей: ${stuck.map(k=>AXIS_LABELS[k]).join(', ')} — директива усилена, следующая правка пойдёт шире обычной`, state:'warn'}});
        }
        // Застряли ВСЕ оси разом — считаем серию. Одна такая итерация ещё не
        // приговор: усиленная директива («измени подход РАДИКАЛЬНО») иногда
        // срабатывает со второго раза. Две подряд означают, что цикл крутится
        // впустую, и каждая следующая итерация — это полный набор вызовов
        // (Прозаик + Оценщик + все Стражи) за деньги автора без результата.
        // Живой прогон новой книги: на третьей итерации встали все шесть осей
        // сразу, пайплайн честно это написал и продолжил работать.
        fullStagnationStreak = (судимыеОси.length && stuck.length === судимыеОси.length) ? fullStagnationStreak + 1 : 0;
      }
      if(fullStagnationStreak >= 2 && iter < maxIter){
        onProgress && onProgress({log:{icon:'🛑', text:`Две итерации подряд не сдвинулась ни одна ось — дальше цикл только тратит деньги. Останавливаюсь на лучшем черновике; если он не устраивает, помогут ручная правка или перезапуск с другой директивой.`, state:'warn'}});
        break;
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
          // Раньше здесь стояла ТОЛЬКО просьба не резать дальше — пассивная
          // защита. Живой прогон новой книги: сцена закрылась на 544 из 675
          // (81%), то есть внутри этой полосы, и ничто её не подняло: команда
          // на рост есть лишь у grossShort (<60%). Получалось, что порог 0.9
          // защищает от усыхания, но не доводит до цели, и 10-20% недобора
          // остаются навсегда. Теперь в полосе 60-90% тоже стоит цель — с той
          // же оговоркой «не водой», что и у grossShort, и с указанием на
          // замечания выше как на готовый материал для развёртывания: Стражи
          // регулярно просят сенсорики и бытовой детали, а их правки объём не
          // добавляют, потому что никто не связал одно с другим.
          ? `\n\nОБЪЁМ: черновик короче цели (${curWords} из ${scene.targetWords} слов, ${Math.round(curWords/scene.targetWords*100)}%). Доведи примерно до ${Math.round(scene.targetWords*0.95)} слов — НЕ водой и не растягиванием фраз, а развитием того, что замечания выше и так требуют: недостающая сенсорика места, реакция и память героя, подтекст в диалоге, пропущенный шаг действия. Если замечание требует что-то убрать — убирай, но компенсируй объём в другом месте сцены.`
          : '';
      const truncNote = draftTruncated
        ? '\n\nПРЕДЫДУЩИЙ ОТВЕТ ОБОРВАЛСЯ НА ПОЛУСЛОВЕ (упор в лимит токенов/сети) — допиши/перепиши сцену целиком до естественного конца, не редактируй точечно.'
        : '';
      directive = (buildUnifiedDirective(directiveVerdict, allBanned, criticals, factualQuestions, literaryNotes, tooShort, directiveOpts(directiveVerdict)) || directive) + stagnantNote + categoryNote + lengthNote + truncNote + anchorNote + standingBlock;
      // Якоря для сверки со СЛЕДУЮЩЕЙ итерацией обязаны принадлежать ТОМУ ЖЕ
      // тексту, что станет prevDraft на следующем витке — а это directiveVerdict
      // (bestEval, если эта итерация просела, см. подмену prevDraft=best чуть
      // выше), не обязательно verdict текущей итерации. Раньше здесь стояло
      // verdict.anchors: если balll просел и prevDraft был подменён на best,
      // директива корректно просила сохранить якоря bestEval, а якоря для
      // ПРОВЕРКИ на следующей итерации брались от текста, который тут же был
      // отброшен (текущего, просевшего). anchorsLostBy(revisedFrom, ...) там
      // требует «якорь был во входе» (см. комментарий у anchorSurvives) — якорь
      // из отброшенного черновика в prevDraft=best чаще всего отсутствовал, и
      // условие «был во входе» просто тихо снимало его с проверки: реальная
      // потеря якоря bestEval, который directive как раз просила сохранить,
      // оставалась незамеченной. Обновляем только если directiveVerdict реально
      // распарсился — иначе держим прошлые якоря, а не обнуляем их из-за одного
      // нераспарсенного ответа.
      if(directiveVerdict && directiveVerdict.ok) prevIterAnchors = directiveVerdict.anchors || [];
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
      // +20% по запросу автора (общий проход по всем лимитам токенов приложения).
      const leDynMin = Math.round(Math.max(2500, Math.round(bestWords * 3.5)) * 1.2);
      const leMaxTk = Math.max(leAg.maxTokens ?? 4320, leDynMin);
      let leNote = '';
      // Якоря финальной оценки (verdict.anchors — фразы, которые Оценщик
      // явно попросил сохранить дословно) + замечания, которые Прозаик уже
      // осознанно отклонил как приём (scene.rejectedNotes) — обе категории
      // «уже решено, не трогать» передаём Линейному редактору в промпт (см.
      // lineEditMessages), а якоря ещё и проверяем ПОСЛЕ его правки тем же
      // способом, что уже стоит в цикле Прозаик⇄Стражи (anchorSurvives) —
      // раньше только этот шаг во всём пайплайне не имел такой проверки.
      const leAnchors = prevIterAnchors;
      for(let g0=0; g0<6; g0++){
        // Отмена действует и здесь: нажав «Стоп», автор не должен оплачивать
        // ещё один вызов только потому, что цикл правок уже завершился.
        if(_cancelRequested) break;
        onProgress && onProgress({stage:'lineedit', text:'Линейный редактор правит…'});
        try{
          const leRes = await callLLM({ ...llmFor(state,leAg), temperature:leAg.temp??0.3, messages:lineEditMessages(best, state.style?.forbidden, leNote, { anchors: leAnchors, rejectedNotes: scene.rejectedNotes, targetWords: scene.targetWords }), maxTokens:leMaxTk });
          // Защита от усечённого ответа — раньше проверяла ТОЛЬКО длину (>50% исходного).
          // Живой прогон показал обрыв на 90% длины (3710 из 4139 симв., без завершающей
          // пунктуации, посреди слова) — формально проходил порог длины и сохранялся как
          // финальный текст сцены. looksTokenTruncated() (та же проверка, что уже ловит
          // обрыв ПЕРВОГО черновика Прозаика чуть выше по файлу) ловит именно этот случай:
          // обрыв не на конце предложения — сильный сигнал упора в maxTokens, даже если
          // абсолютная длина ответа кажется достаточной.
          if(leRes.text && leRes.text.length > best.length*0.5 && !looksTokenTruncated(leRes.text)){
            logStep({ agent:'lineedit', input:'(черновик)'+(leNote?' + заметка автора: '+leNote:''), output:leRes.text, tokensIn:leRes.tokensIn, tokensOut:leRes.tokensOut, cost:leRes.cost });
            // Раньше здесь безусловно печаталось «текст подчищен» — ДО всех
            // проверок ниже и до приёмки. Живой прогон: редактор вернул текст
            // байт в байт совпадающий с черновиком, а автор прочёл «подчищен»
            // и был уверен, что правка была. Хуже того, если проверка ниже
            // отклоняла правку, лог показывал «подчищен» и следом «правка
            // отклонена» — два противоречащих сообщения об одном шаге. Теперь
            // об итоге сообщаем в точке приёмки, где он уже известен.
            // Запрет на укорачивание уже короткой сцены — ЗАПРЕТ, а не просьба.
            // В 1.44.0 я дал Линейному редактору targetWords и строку «итог по
            // объёму — не меньше», и на живом прогоне он её просто
            // проигнорировал: цикл прозы поднял сцену 560→613→672 (90% цели),
            // а последний шаг срезал до 580 (77%). Текстовая инструкция здесь
            // не работает, потому что «убрать лишнее» — прямая задача этого
            // агента. Приёмка ниже проверяла только `length > best.length*0.5`,
            // то есть 14% потери проходили свободно. Логика та же, что у
            // потерянных якорей строкой ниже: правку не уговариваем, а
            // отклоняем, оставляя текст до неё. 2% допуска — на замену
            // многословных оборотов, ради которой Линейный редактор и нужен.
            const beforeWords = (best.match(/\S+/g)||[]).length;
            const afterWords = (leRes.text.match(/\S+/g)||[]).length;
            const belowTarget = !!(scene.targetWords && beforeWords < scene.targetWords*0.95);
            if(belowTarget && afterWords < beforeWords*0.98){
              onProgress && onProgress({log:{icon:'📏', text:`Линейный редактор срезал ${beforeWords-afterWords} сл. (${beforeWords}→${afterWords}) на сцене, которая и так короче цели (${scene.targetWords}) — правка отклонена, текст остаётся как до неё`, state:'warn'}});
              break;
            }
            // Линейный редактор идёт ПОСЛЕ того, как Оценщик и Стражи приняли
            // текст, и его результат уже никто не проверяет: bestEval не
            // пересчитывается, то есть балл на сцене относится к тексту ДО его
            // правки. Значит его свобода должна быть ограничена не уговорами, а
            // проверками — как у якорей ниже.
            //
            // 1. Клише, забаненные Оценщиком, не должны вернуться. Проверка
            //    бесплатная: список уже собран в bannedCliches по ходу цикла.
            const вернувшиесяКлише = [...bannedCliches].filter(c =>
              c && c.length >= 8 && leRes.text.includes(c) && !best.includes(c));
            if(вернувшиесяКлише.length){
              onProgress && onProgress({log:{icon:'🚫', text:`Линейный редактор вернул клише, забракованное Оценщиком («${вернувшиесяКлише[0].slice(0,50)}»${вернувшиесяКлише.length>1?` +${вернувшиесяКлише.length-1}`:''}) — правка отклонена, текст остаётся как до неё`, state:'warn'}});
              break;
            }
            // 2. Это ЛЁГКАЯ правка, а не переписывание. Если изменилось больше
            //    трети слов, агент вышел за свою роль и переписал то, что
            //    Оценщик и Стражи уже утвердили. Сравниваем множества слов —
            //    грубо, зато без единого вызова и без ложных срабатываний на
            //    перестановке предложений.
            const словаДо = new Set((best.toLowerCase().match(/[а-яёa-z]+/g)||[]));
            const словаПосле = (leRes.text.toLowerCase().match(/[а-яёa-z]+/g)||[]);
            const общих = словаПосле.filter(w=>словаДо.has(w)).length;
            const доляНовых = словаПосле.length ? 1 - общих/словаПосле.length : 0;
            if(доляНовых > 0.33){
              onProgress && onProgress({log:{icon:'✋', text:`Линейный редактор переписал ${Math.round(доляНовых*100)}% слов — это уже не шлифовка, а переписывание утверждённого Оценщиком и Стражами текста. Правка отклонена.`, state:'warn'}});
              break;
            }
            const gt = await gate(state,'lineedit','Линейный редактор', '', opts, {draft:leRes.text, editable:true});
            if(gt.approve){
              const candidate = (gt.text!=null && gt.text.trim())?gt.text.trim():leRes.text;
              const leLostAnchors = anchorsLostBy(beforeLineEdit, candidate, leAnchors);
              if(leLostAnchors.length){
                onProgress && onProgress({log:{icon:'📌', text:`Линейный редактор потерял закреплённый якорь («${leLostAnchors[0].slice(0,60)}»${leLostAnchors.length>1?` +${leLostAnchors.length-1}`:''}) — правка отклонена, текст остаётся как до Линейного редактора`, state:'warn'}});
                break;
              }
              // Итог шага — по факту, а не по намерению. Живой прогон: редактор
              // вернул текст, совпадающий с черновиком байт в байт, и «подчищен»
              // было прямым враньём.
              if(candidate.trim() === beforeLineEdit.trim()){
                onProgress && onProgress({log:{icon:'✂️', text:'Линейный редактор: изменений не потребовалось — текст остался прежним'}});
              } else {
                const сл1 = (beforeLineEdit.match(/\S+/g)||[]).length, сл2 = (candidate.match(/\S+/g)||[]).length;
                onProgress && onProgress({log:{icon:'✂️', text:`Линейный редактор: текст подчищен (${сл1}→${сл2} сл.)`}});
              }
              best = candidate; break;
            }
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

      // Балл сцены принадлежал тексту ДО Линейного редактора — и это было не
      // мелкой неточностью, а систематическим враньём: живой замер показал, что
      // редактор срезал 125 слов из 988 (−12.6%) уже ПОСЛЕ того, как Оценщик
      // выставил 5.7, и в книгу ушёл текст, который никто не оценивал. Гарантии
      // выше (клише не возвращаются, не больше 33% новых слов, якоря на месте)
      // ограничивают ущерб, но не заменяют измерения. Пересчитываем — это +1
      // платный вызов на сцену, и он оправдан только когда текст реально
      // изменился.
      if(best !== beforeLineEdit && agentEnabled('evaluator') && bestEval?.ok){
        try{
          onProgress && onProgress({stage:'evaluator', text:'Оценщик перепроверяет текст после Линейного редактора…'});
          const doneWords2 = (state.structure||[]).filter(n=>n.type==='scene' && n.status==='done' && n.words).map(n=>n.words);
          let paceBaseline2 = null;
          if(doneWords2.length >= 3){
            const sorted2 = [...doneWords2].sort((a,b)=>a-b);
            paceBaseline2 = { medianWords: sorted2[Math.floor(sorted2.length/2)], sceneWords: (best.match(/\S+/g)||[]).length };
          }
          const fMsgs = evaluatorMessages(scene, best, state.voice?.examples, bookContextBlock(state, scene), effectiveRules(state.style), { usedCliches: state.usedCliches, paceBaseline: paceBaseline2, recentEndings: state.recentSceneEndings });
          const fMaxTk = evalAg.maxTokens ?? 1080;
          let fRes = await callLLM({ ...llmFor(state,evalAg), temperature:evalAg.temp??0.2, messages:fMsgs, maxTokens:fMaxTk });
          let fVerdict = parseEvaluator(fRes.text, threshold, { skipAxes: evalSkipAxes });
          // Тот же ретрай с удвоенным лимитом, что уже стоит на основном вызове
          // Оценщика внутри цикла (см. evalRetryTk выше) — раньше здесь его не
          // было вовсе: обрыв токенами на этой, финальной, перепроверке молча
          // не давал второго шанса, и bestEval оставался баллом ДО Линейного
          // редактора без единого предупреждения о причине (лог ниже говорит
          // «не распарсилась», но раньше терял ровно тот случай, что чаще всего
          // и есть причина — обрыв по лимиту).
          if(!fVerdict.ok){
            const fRetryTk = Math.max(fMaxTk + 1, Math.min(MAX_OUTPUT_TOKENS, fMaxTk * 2));
            onProgress && onProgress({log:{icon:'⚠️', text:`Перепроверка после Линейного редактора: ответ не распарсился (лимит был ${fMaxTk}) — повтор с лимитом ${fRetryTk}`, state:'warn'}});
            logStep({ agent:'evaluator-final-retry', input:'(попытка 1)', output:fRes.text, tokensIn:fRes.tokensIn, tokensOut:fRes.tokensOut, cost:fRes.cost });
            fRes = await callLLM({ ...llmFor(state,evalAg), temperature:evalAg.temp??0.2, messages:fMsgs, maxTokens:fRetryTk });
            fVerdict = parseEvaluator(fRes.text, threshold, { skipAxes: evalSkipAxes });
          }
          logStep({ agent:'evaluator-final', input:'(перепроверка после Линейного редактора)', output:fRes.text, tokensIn:fRes.tokensIn, tokensOut:fRes.tokensOut, cost:fRes.cost });
          if(fVerdict.ok){
            const было = bestEval.weighted, стало = fVerdict.weighted;
            // Просадка больше половины балла — редактор ухудшил текст, который
            // Оценщик и Стражи уже утвердили. Мы теперь ЗНАЕМ это (раньше не
            // знали), и оставлять худший вариант, имея измерение, бессмысленно —
            // откатываемся. Допуск 0.5 гасит обычный шум LLM-судьи между двумя
            // вызовами на почти одинаковом тексте, чтобы откат не срабатывал
            // на дрожании оценки.
            if(стало < было - 0.5){
              onProgress && onProgress({log:{icon:'↩️', text:`Перепроверка после Линейного редактора: ${было}→${стало} — правка ухудшила текст, откатываю к варианту, который утвердили Оценщик и Стражи`, state:'warn'}});
              best = beforeLineEdit;
            } else {
              bestEval = fVerdict; bestFlags = {};
              onProgress && onProgress({log:{icon:'⚖️', text:`Балл сцены пересчитан по финальному тексту (после Линейного редактора): ${было}→${стало}`, state: стало >= было ? 'ok' : 'warn'}});
            }
          } else {
            // Не молчим: без этого автор видел бы балл, не зная, что он от
            // другого текста — ровно та проблема, которую пересчёт и решает.
            onProgress && onProgress({log:{icon:'⚠️', text:`Перепроверка после Линейного редактора не распарсилась — балл сцены относится к тексту ДО его правки`, state:'warn'}});
          }
        }catch(e){
          logStep({ agent:'evaluator-final', output:'[АГЕНТ ПРОВАЛИЛСЯ] '+e.message });
          onProgress && onProgress({log:{icon:'⚠️', text:`Перепроверка после Линейного редактора не удалась (${e.message}) — балл относится к тексту ДО его правки`, state:'warn'}});
        }
      }
    }

    // Клише этой сцены (свои + унаследованные от предыдущих) — обратно в
    // state.usedCliches, чтобы СЛЕДУЮЩАЯ сцена книги видела их с итерации 1.
    // Обрезаем до последних 150 — иначе список бесконечно растёт на длинной книге.
    state.usedCliches = [...bannedCliches].slice(-150);
    // Тот же принцип для концовки этой сцены (см. recentSceneEndings в
    // state.js) — следующая сцена увидит, чем закончились недавние, чтобы
    // Оценщик мог поймать повтор ПРИЁМА закрытия, не только дословной фразы.
    if(best) state.recentSceneEndings = [...(state.recentSceneEndings||[]), best.trim().slice(-200)].slice(-10);

    // Последний рубеж. Прозаик может НЕ исправить инородную письменность —
    // именно так и было в живом прогоне: «За十年的 работы» пережило три
    // черновика. Тогда сцена уходит в книгу с иероглифами, и единственное, что
    // здесь ещё можно сделать, — не дать этому случиться молча. Флаг ставим
    // заново по итоговому тексту: bestFlags относятся к черновику, который
    // выиграл, а он мог смениться после Линейного редактора.
    const чужойВИтоге = findForeignScript(best);
    if(чужойВИтоге.length){
      bestFlags = { ...(bestFlags||{}), script: чужойВИтоге.map(d=>({ severity:'critical',
        title:'Инородная письменность осталась в готовой сцене',
        detail:'Прозаик не убрал символы чужой письменности за отведённые итерации — исправьте вручную или перезапустите сцену.',
        quote:d.quote })) };
      onProgress && onProgress({log:{icon:'🔤',
        text:`В ГОТОВОЙ сцене осталась инородная письменность: ${чужойВИтоге.map(d=>'«'+d.quote+'»').join(', ')} — почините вручную, автоматика уже не поможет`}});
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
async function guardJob(state, role, messages, flagsOut, onProgress, scene){
  const a = ag(state, role);
  try{
    const maxTk = a.maxTokens??840;
    let res = await callLLM({ ...llmFor(state,a), temperature:a.temp??0.2, messages, maxTokens: maxTk });
    let j = extractJSON(res.text);
    // Страж, чей ответ оборвался посреди JSON по лимиту токенов, парсится в
    // extractJSON КАК null — то же самое значение, что вернул бы страж, честно
    // проверивший сцену и не нашедший ни одной проблемы (flags:[]). Раньше это
    // было неотличимо (тот же класс проблемы, что уже отмечен в комментарии про
    // упавший запрос ниже — там про сетевую ошибку, тут про обрыв по лимиту).
    // Тот же принцип повтора с увеличенным лимитом, что уже стоит у Прозаика и
    // Оценщика — потолок ниже (4000), т.к. ответ Стража штатно короткий (title/
    // detail/quote на пару флагов), не полноценная проза.
    // res.hitLimit — достоверный finish_reason апстрима (см. llm.js): ловит и
    // случай, когда обрыв пришёлся ровно на закрывающую скобку — JSON.parse
    // формально прошёл (j не null), а содержимое всё равно неполное, и без
    // этой проверки страж прошёл бы как «честно проверил» без единого ретрая.
    if((!j || res.hitLimit) && res.text && res.text.trim()){
      const retryMaxTk = Math.max(maxTk+1, Math.min(4000, maxTk*2));
      const причина = !j ? `ответ не распарсился (похоже на обрыв токенами, лимит был ${maxTk})` : `ответ обрублен лимитом токенов (${maxTk}), хотя JSON формально сошёлся`;
      onProgress && onProgress({log:{icon:'⚠️', text:`Страж «${guardLabel(state,role)}»: ${причина} — повтор с лимитом ${retryMaxTk}`, state:'warn'}});
      res = await callLLM({ ...llmFor(state,a), temperature:a.temp??0.2, messages, maxTokens: retryMaxTk });
      j = extractJSON(res.text);
      // Раньше результат повтора принимался безусловно — если обрыв повторился
      // (тот же лимит или второй сбой подряд), это нигде не всплывало: flags
      // ниже становился [] и выглядел как «страж проверил и не нашёл проблем»,
      // а не «проверка не удалась второй раз».
      if((!j || res.hitLimit) && res.text && res.text.trim()){
        onProgress && onProgress({log:{icon:'⚠️', text:`Страж «${guardLabel(state,role)}»: повтор тоже не поместился в лимит — замечания этой итерации не проверены`, state:'warn'}});
      }
    }
    const flags = runGuardParse(res.text);
    flagsOut[role] = flags;
    // Страж-читатель уже отвечает на вопрос о пассивности героя (readerGuardMessages,
    // guards.js) — вытаскиваем структурное поле "passive" тем же самым ответом,
    // без дополнительного LLM-вызова, и копим на самой сцене для накопительной
    // проверки по книге (см. bookreview.js/passivityIsSystemic). Жанронезависимо —
    // работает для любого протагониста в любом типе прозы.
    if(role==='reader' && scene && j){ const p = coercePassive(j.passive); if(p!=null) scene.passivityFlag = p; }
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
