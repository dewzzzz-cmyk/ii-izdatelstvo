// Сборка контекста сцены (спека 7.1). Сердце продукта.
// ПП2 — минимальная версия: голос + запреты + Bible топ-5 + живой контекст.
// Полная иерархическая память (серия/книги/главы/сцены) добавляется в ПП3.

import { estimateTokens, smartTrunc, trimToTokens } from './tokens.js';
import { bibleForPrompt, bibleMatches, formatBibleEntries } from './bible.js';
import { voicePromptBlock } from './voice.js';
import { activeSceneSummaries, runningSynopsis } from './memory.js';
import { charNamesMatch, effectiveRules } from './state.js';
import { genreToneNote, genreJudgeNote, humorLevelNote } from './genres.js';

const SEP = '\n\n';

// Сериализация состояний персонажей, присутствующих в сцене.
// charNamesMatch (не точное сравнение) — чтобы отметка «Олег» в сцене всё
// равно находила карточку «Олег К.», если форма имени успела разъехаться.
export function serializeCharacterStates(characters, presentNames){
  if(!characters || !characters.length) return '';
  // presentNames==null — фильтр не задан (Архитектор ещё не запускался и т.п.) →
  // показать всех. presentNames===[] — автор явно снял все чекбоксы («в сцене
  // никого») → показать никого. Раньше [] и null обрабатывались одинаково
  // (пустой массив.length===0 — falsy), поэтому явное «никого» тихо превращалось
  // во «всех» — состояния персонажей, которых в сцене нет, утекали в контекст.
  const present = presentNames == null
    ? characters
    : characters.filter(c=>presentNames.some(nm=>charNamesMatch(nm, c.name)));
  return present.filter(c=>c.stateNote).map(c=>`${c.name} — ${c.stateNote}`).join('\n');
}

// Компактный контекст книги для Оценщика: чтобы его замечания учитывали
// сюжет, канон и состояния персонажей, а не висели в вакууме. Без блока голоса
// (это отдельная ось) и без полной памяти — только грунтовка для замечаний.
export function bookContextBlock(state, scene){
  const proj = state.project || {};
  const parts = [];
  const head = [proj.genre && `Жанр: ${proj.genre}.`, proj.era && `Эпоха: ${proj.era}.`].filter(Boolean).join(' ');
  if(head) parts.push(head);
  const judgeNote = genreJudgeNote(proj.genre);
  if(judgeNote) parts.push(judgeNote);
  const synopsis = runningSynopsis(state) || proj.synopsis || proj.idea;
  if(synopsis) parts.push('Сюжет: ' + synopsis);
  const chars = serializeCharacterStates(state.characters, scene.presentChars);
  if(chars) parts.push('Персонажи в сцене:\n' + chars);
  const bible = bibleForPrompt(state.bible, (scene.brief||scene.title||'') + ' ' + (proj.synopsis||''), 5);
  if(bible) parts.push('Канон:\n' + bible);
  return parts.join('\n');
}

// Текущая или предпоследняя глава книги — усиливаем формулировку совета по
// открытым линиям (закрыть/осознанно оставить), пока ещё не поздно решить.
function isNearBookEnd(state, scene){
  const chapters = (state.structure||[]).filter(n=>n.type==='chapter');
  const idx = chapters.findIndex(c=>c.id===scene.chapterId);
  if(idx < 0) return false;
  return (chapters.length - idx) <= 2;
}

// Собрать сообщения для Прозаика на одну сцену.
// Возвращает {messages, layers} — layers для диагностики (что попало в промпт).
export function buildSceneContext(state, scene, opts={}){
  const { voice, style, bible, characters, global } = state;
  const BUDGET = (global && global.budgetTokens) || 128000;
  const layers = [];

  // 1. Голос + запреты (фикс, не режется)
  const voiceBlock = voicePromptBlock(voice, style.forbidden);
  if(voiceBlock) layers.push({ name:'voice', text:'=== ГОЛОС ===\n'+voiceBlock, fixed:true });

  // 1b. Правила автора (do/don't) — фикс, не режется. Профилактика: Прозаик не порождает.
  // effectiveRules() подмешивает сюда же настройку мата (style.profanity) —
  // единая точка сборки, см. её комментарий в state.js.
  const rules = effectiveRules(style);
  if(rules.length) layers.push({ name:'rules', text:'=== ПРАВИЛА АВТОРА (соблюдай неукоснительно) ===\n'+rules.map(r=>'— '+r).join('\n'), fixed:true });

  // 1c. Замеченные паттерны (мягкая память, не rules): категории клише, которые Оценщик
  // уже находил в других сценах этой книги (см. recordObservedPattern в state.js). Это
  // совет, не обязательство — потому не fixed, может быть обрезан при нехватке бюджета.
  // Цель — упредить претензию Оценщика в первом же черновике, а не ждать, пока она
  // снова всплывёт и придётся дорабатывать сцену по кругу.
  const observed = (style.observed||[]).filter(o=>!o.dismissed && o.count>=2).sort((a,b)=>b.count-a.count).slice(0,5);
  if(observed.length) layers.push({ name:'observed', text:'=== УЖЕ ЗАМЕЧАЛОСЬ В ЭТОЙ КНИГЕ (постарайся не повторять) ===\n'+observed.map(o=>'— '+o.category).join('\n') });

  // 1d. Открытые сюжетные линии (чеховские ружья без развязки) — копится в
  // closeChapter() (author-control.js) на каждой границе главы. Мягкий совет,
  // не fixed — цель предупредить, что линия стареет, не заставить закрыть её
  // именно в этой сцене (это иногда осознанный приём, см. промпт runChekhovCheck).
  const openThreads = (state.memory?.openThreads||[]).filter(t=>!t.dismissed && t.chaptersOpen>=2)
    .sort((a,b)=>b.chaptersOpen-a.chaptersOpen).slice(0,4);
  if(openThreads.length){
    const header = isNearBookEnd(state, scene)
      ? '=== ОТКРЫТЫЕ СЮЖЕТНЫЕ ЛИНИИ (книга близится к концу — реши: закрыть или это осознанный приём) ==='
      : '=== ОТКРЫТЫЕ СЮЖЕТНЫЕ ЛИНИИ (рассмотри развитие или закрытие) ===';
    layers.push({ name:'openThreads', text: header+'\n'+openThreads.map(t=>
      `— ${t.what} (введено: ${t.introducedIn || 'ранее'}; открыто ${t.chaptersOpen} ${t.chaptersOpen===1?'главу':'главы'})`).join('\n') });
  }

  // 2. Параметры проекта (жанр/тон) — короткий фикс
  const proj = state.project;
  const projBlock = [
    proj.genre && `Жанр: ${proj.genre}${proj.subgenre?', '+proj.subgenre:''}.`,
    proj.era && `Эпоха: ${proj.era}.`,
    style.refs && style.refs.length && `Ориентиры стиля: ${style.refs.join(', ')}.`,
  ].filter(Boolean).join(' ');
  if(projBlock) layers.push({ name:'project', text:'=== ПРОЕКТ ===\n'+projBlock, fixed:true });

  // 3a. Память серии: ручной синопсис (поле seriesSummary) + импортированные сводки
  const mem = state.memory || {};
  const seriesParts = [];
  if(proj.seriesSummary) seriesParts.push(proj.seriesSummary);
  if(state.series && state.series.length) seriesParts.push(...state.series.map(b=>b.summary).filter(Boolean));
  if(seriesParts.length) layers.push({ name:'series', text:'=== ПРОШЛЫЕ КНИГИ СЕРИИ ===\n'+seriesParts.join('\n\n') });

  // 3b. Бегущий синопсис книги: сюда свёрнуты старые сцены (ограничивает рост контекста)
  const synopsis = runningSynopsis(state);
  if(synopsis) layers.push({ name:'synopsis', text:'=== РАНЕЕ В КНИГЕ (СИНОПСИС) ===\n'+synopsis, fixed:true });

  // 3c. Сводки завершённых глав (в порядке structure, не случайном). entries,
  // не голая строка — как и у сцен ниже, чтобы applyBudget мог урезать САМЫЕ
  // старые по одной, а не сбрасывать весь слой разом на длинной книге (см. (б2)).
  const chapterSums = (state.structure||[]).filter(n=>n.type==='chapter')
    .map(n=>(mem.chapters||{})[n.id]?.current).filter(Boolean);
  if(chapterSums.length){
    layers.push({ name:'chapters', entries:chapterSums, header:'=== ГЛАВЫ (СВОДКИ) ===',
      get text(){ return this.header+'\n'+this.entries.join('\n\n'); } });
  }

  // 3d. Последние развёрнутые посценные сводки (окно, без свёрнутых; кроме текущей)
  const recent = activeSceneSummaries(state).filter(e=>e.id!==scene.id);
  if(recent.length){
    layers.push({ name:'scenes', entries:recent.map(e=>e.text), header:'=== ПРЕДЫДУЩИЕ СЦЕНЫ (СВОДКИ) ===',
      get text(){ return this.header+'\n'+this.entries.join('\n'); } });
  }

  // 3d. Состояния персонажей
  const chars = serializeCharacterStates(characters, scene.presentChars);
  if(chars) layers.push({ name:'characters', text:'=== ПЕРСОНАЖИ ===\n'+chars });

  // 4. Bible — топ-5 по брифу сцены. Закреплённые (pinned) факты вынесены в
  // ОТДЕЛЬНЫЙ fixed-слой: bibleMatches() гарантирует их присутствие в выдаче
  // независимо от релевантности (см. её комментарий в bible.js — pin нужен
  // именно для фактов, которые нельзя пропустить, даже если бриф сцены о них
  // не намекает). Но applyBudget ниже урезает слой 'bible' ЦЕЛИКОМ при нехватке
  // бюджета (см. dropOrder) — и раньше закреплённые факты сидели в ТОМ ЖЕ
  // слое, что и обычные top-K находки, поэтому на длинной книге с урезанным
  // бюджетом бюджетный урезатель мог выбросить их вместе с остальным каноном,
  // хотя весь смысл pin — «этот факт обязателен, даже если бюджет жмёт».
  const bibleHits = bibleMatches(bible, scene.brief || scene.title || '', 5);
  const pinnedHits = bibleHits.filter(b=>b.pinned);
  const restHits = bibleHits.filter(b=>!b.pinned);
  if(pinnedHits.length) layers.push({ name:'biblePinned', text:'=== КАНОН (ЗАКРЕПЛЁННЫЕ ФАКТЫ) ===\n'+formatBibleEntries(pinnedHits), fixed:true });
  if(restHits.length) layers.push({ name:'bible', text:'=== КАНОН (БИБЛИЯ) ===\n'+formatBibleEntries(restHits) });

  // 5. Живой контекст: текст предыдущей сцены (усекается через smartTrunc)
  if(opts.prevSceneText){
    layers.push({ name:'prevScene', text:'=== ПРЕДЫДУЩАЯ СЦЕНА ===\n'+opts.prevSceneText, live:true });
  }

  // 6. Выход Архитектора (якоря/запреты), если был
  if(opts.architectOutput){
    layers.push({ name:'architect', text:'=== ПЛАН СЦЕНЫ (АРХИТЕКТОР) ===\n'+opts.architectOutput, fixed:true });
  }

  // 7. Предыдущий черновик при доработке (петля): Прозаик видит, что правит, а не пишет с нуля
  if(opts.prevDraft){
    layers.push({ name:'prevDraft', text:'=== ТВОЙ ПРЕДЫДУЩИЙ ЧЕРНОВИК (доработай, сохрани удачные места) ===\n'+opts.prevDraft, fixed:true, live:false });
  }

  // Применяем бюджет: режем по приоритету (не трогаем fixed; live ужимаем последним)
  const trimmed = applyBudget(layers, BUDGET);

  const system = layers.map(l=>l.text).join(SEP);
  const scenesInOrder = (state.structure||[]).filter(n=>n.type==='scene');
  const curIdx = scenesInOrder.findIndex(n=>n.id===scene.id);
  const isFirstScene = curIdx === 0;
  const prevSceneNode = curIdx > 0 ? scenesInOrder[curIdx-1] : null;
  // chapter.arc (завязка/развитие/кульминация/развязка) — заполняется Книжным
  // архитектором на этапе Структуры и читается Оценщиком структуры (пропорции
  // актов, где должна быть кульминация), но нигде в самой генерации прозы не
  // использовался: Прозаик не знал, пишет ли он спокойную завязку или главу
  // кульминации книги — только сцена/секвель (более мелкая, посценная метка),
  // не положение ГЛАВЫ в общей дуге. Живой вопрос автора: «в написание
  // попадает только бриф?» — нет, но этот конкретный кусок структуры
  // действительно терялся между Структурой и Написанием.
  const chapterNode = (state.structure||[]).find(n=>n.type==='chapter' && n.id===scene.chapterId);
  const chapterArc = chapterNode?.arc || '';
  const user = buildTask(scene, proj, opts, isFirstScene, prevSceneNode, style, chapterArc);

  return {
    messages: [
      { role:'system', content: system },
      { role:'user',   content: user },
    ],
    layers: layers.map(l=>({ name:l.name, tokens: estimateTokens(l.text) })),
    // Что бюджет реально урезал. Пустой массив — всё влезло. Раньше этого
    // наружу не выходило вовсе, и предупреждение в pipeline.js гадало по
    // размеру входа («могла быть урезана»), а не знало факта.
    trimmed,
  };
}

// Секвель должен реагировать на КОНКРЕТНОЕ событие предыдущей сцены, не абстрактно —
// иначе Прозаик получает шаблон «реакция→дилемма→решение» без привязки к сюжету.
// Предпочитаем реальный текст (opts.prevSceneText), т.к. брифы иногда расходятся
// с тем, что фактически написано; бриф — запасной вариант, если прозы ещё нет.
function sequelConnectionNote(opts, prevSceneNode){
  if(opts.prevSceneText){
    const tail = opts.prevSceneText.trim().slice(-400);
    return `Секвель идёт СРАЗУ после сцены${prevSceneNode?` «${prevSceneNode.title}»`:''}, вот чем она закончилась:\n«…${tail}»\nРеакция героя должна отвечать ИМЕННО на это событие/потрясение — не на произвольное, а на то, что случилось только что.`;
  }
  if(prevSceneNode && prevSceneNode.brief){
    return `Секвель идёт СРАЗУ после сцены «${prevSceneNode.title}» — ${prevSceneNode.brief}\nРеакция героя должна отвечать ИМЕННО на это событие, не абстрактно.`;
  }
  return '';
}

// Тот же якорь, что и у секвеля выше, но для обычной СЦЕНЫ — раньше был только
// у секвелей (opts.prevSceneText передавался в контекст как справочный блок
// «ПРЕДЫДУЩАЯ СЦЕНА», но explicit-инструкции продолжать РОВНО с её конца не
// было). Живой пример на «Разломе»: сцена 2 заканчивалась тем, что герой уже
// встал, засмеялся и пошёл в лес на полном заряде — а сцена 3 заново сажала
// его на колени и заново поднимала на 94% заряда, будто конец сцены 2 не
// случился. Без явного «начни ровно с этой точки» модель вольна слегка
// отмотать назад к уже пройденному биту вместо чистого продолжения.
function sceneContinuityNote(opts, prevSceneNode){
  if(opts.prevSceneText){
    const tail = opts.prevSceneText.trim().slice(-400);
    return `Сцена идёт СРАЗУ после сцены${prevSceneNode?` «${prevSceneNode.title}»`:''}, вот чем она закончилась:\n«…${tail}»\nНачни РОВНО с этой точки — не повторяй и не отматывай назад уже случившееся действие (герой уже мог встать, пойти, договорить реплику и т.п.), продолжай вперёд оттуда, где предыдущая сцена его оставила.`;
  }
  return '';
}

const CHAPTER_ARC_NOTE = {
  завязка: 'Глава книги: ЗАВЯЗКА — устанавливай мир/героя/конфликт, держи напряжение умеренным, не разряжай интригу раньше времени.',
  развитие: 'Глава книги: РАЗВИТИЕ — наращивай ставки и осложнения, не давай герою лёгких побед.',
  кульминация: 'Глава книги: КУЛЬМИНАЦИЯ — это пик книги. Держи максимальное напряжение, не смягчай конфликт ради комфорта читателя, не разрешай его раньше времени.',
  развязка: 'Глава книги: РАЗВЯЗКА — конфликт уже разрешён или разрешается здесь; фокус на последствиях и эмоциональной точке, не заводи новый виток напряжения без явной причины.',
};
function buildTask(scene, proj, opts, isFirstScene, prevSceneNode, style, chapterArc){
  const lines = [];
  const revising = !!opts.prevDraft;
  // При доработке директива идёт первой — иначе тонет в контексте ниже брифа и объёма
  if(revising && opts.directive) lines.push('ЗАМЕЧАНИЯ ДЛЯ ДОРАБОТКИ:\n' + opts.directive);
  lines.push(revising
    ? 'ЗАДАЧА: доработай предыдущий черновик по замечаниям выше. Сохрани удачные образы и ритм, исправь указанное. НЕ переписывай с нуля.'
    : 'ЗАДАЧА: напиши прозу этой сцены.');
  lines.push('Бриф сцены: ' + (scene.brief || scene.title || '(нет)'));
  if(CHAPTER_ARC_NOTE[chapterArc]) lines.push(CHAPTER_ARC_NOTE[chapterArc]);
  // entryState — заполняется Архитектором книги на этапе структуры, если на входе
  // в сцену у героя уже есть предмет/знание/состояние, не самоочевидное из брифа
  // предыдущей сцены (живой инцидент: герой в тексте заявил цель «в гильдию
  // магов», хотя ни один более ранний бриф этого не устанавливал — Прозаик писал
  // ровно по брифу, но самого брифа для проверки этой цепочки было недостаточно).
  if(scene.entryState) lines.push('На входе в сцену уже установлено (не переоткрывай заново, просто исходи из этого): ' + scene.entryState);
  if(scene.emotion) lines.push('Эмоция читателя в финале: ' + scene.emotion + ' (передай через действие и деталь, не называй чувство прямо).');
  const target = scene.targetWords || 700;
  // «Примерно N слов» систематически недобиралось живыми прогонами (первый
  // черновик приходил на 40-45% цели — 605-650 слов при цели 1500 — до единой
  // правки, то есть проблема не в цикле оценщик⇄правки, который уже защищён
  // effectiveRules/tooShort, а в самом первом черновике). Явное разрешение
  // разворачивать сцену подробнее — не «пиши больше воды», а конкретные оси
  // (тело, окружение, паузы), которые не в ущерб плотности прозы.
  lines.push(`Объём: ${target} слов — это цель, а не мягкий ориентир. Если чувствуешь, что укладываешься заметно короче, разворачивай сцену подробнее (телесная реакция, конкретная деталь окружения, пауза перед репликой) вместо того, чтобы обрывать её раньше времени ради лаконичности.`);
  if(!revising && opts.directive) lines.push('Указание автора: ' + opts.directive);
  // Тип сцены по Дуайту Свейну (техника «сцена/секвель») — задаёт внутреннюю
  // структуру и держит ритм книги: не каждая сцена должна быть на пределе напряжения.
  lines.push(scene.sceneType==='sequel'
    ? 'Тип сцены: СЕКВЕЛЬ (передышка). Структура: реакция героя на произошедшее → дилемма (взвешивание вариантов) → решение, которое ставит новую цель. Меньше внешнего действия, больше внутренней обработки. НЕ заканчивай новым потрясением — заканчивай принятым решением или ясным намерением.'
    : 'Тип сцены: СЦЕНА (растущее напряжение). Структура: цель героя ясна в начале → конфликт/препятствие мешает её достичь → сцена кончается ХУЖЕ, чем начиналась (поражение, осложнение, неожиданность). Не разрешай конфликт слишком легко и не смягчай финал сцены.');
  if(!revising){
    const note = scene.sceneType==='sequel'
      ? sequelConnectionNote(opts, prevSceneNode)
      : sceneContinuityNote(opts, prevSceneNode);
    if(note) lines.push(note);
  }
  if(isFirstScene && !revising){
    // Живой прогон вскрыл противоречие между этой инструкцией и FIRST_SCENE_NOTE
    // у Книжного архитектора. Там бриф первой сцены ОБЯЗАН укоренить читателя
    // («кто герой — возраст, из какого мира/среды, в какой точке он находится и
    // КАК тут оказался»), а здесь стояло «никакой экспозиции» — и Прозаик
    // послушался того, что ближе к нему: сцена открылась строкой «Глеб ткнул
    // пальцем в «Нет»», и кто такой Глеб, что он идёт из школы через парк,
    // сколько ему лет — не сказано нигде, хотя в брифе всё это было.
    // Инструкция выполнена буквально, а первая страница книги — та самая, по
    // которой решают, читать ли дальше — осталась без ориентации.
    // In medias res остаётся, но перестаёт означать «скрывай, кто перед нами»:
    // укоренение вплетается в действие, а не выносится в преамбулу.
    lines.push('Это ПЕРВАЯ сцена книги — то, что читает литагент/редактор в первую очередь. Начни in medias res: первая строка — конкретное действие или голос персонажа, не описание места/погоды/предыстории.');
    lines.push('НО in medias res ≠ прятать, кто перед читателем. В пределах первых 2-3 абзацев он должен без усилия понять: кто герой (имя, примерный возраст, из какой среды), где он физически находится и откуда/куда движется. Это не экспозиция и не отступление — это вплетается в само действие: через то, что герой делает, замечает и как реагирует («после уроков», «рюкзак с учебниками», «до дома два квартала»). Запрещена преамбула ПЕРЕД действием, а не сама информация. Если бриф сцены называет возраст, занятие или обстоятельства героя — они обязаны быть узнаваемы из текста, а не остаться только в брифе.');
  }
  // Анти-ИИшность: направляем от гладкого нейтрала к живой прозе
  lines.push('Требования к прозе: конкретная чувственная деталь вместо абстракций; избегай эпитетов-ярлыков (зловещий, прекрасный, ужасный); «показывай, не рассказывай»; без морализаторского вывода в финале; варьируй длину предложений.');
  // Конкретные слова-маркеры ИИ-текста — абстрактный запрет «избегай клише» слабо
  // работает без примеров слов; это устойчивые тики генеративного текста (в т.ч. в русском).
  lines.push('Избегай слов-маркеров ИИ-текста: «является» как связка вместо глагола действия, «играет важную роль», «занимает особое место», «нельзя не отметить», «свидетельствует о», обороты «не только... но и». Не собирай тройки однородных эпитетов/фраз подряд для искусственной полноты. Не начинай абзац или реплику риторическим вопросом-связкой («Но что теперь?», «И что дальше?»).');
  lines.push('Пример разницы: плохо — «Она испугалась и почувствовала, как её сердце наполнилось ужасом»; хорошо — «Она попятилась, наткнулась на стул и замерла, вцепившись в его спинку». Пиши во втором ключе.');
  // Жанровый тон (не только структура у Архитектора) — что уместно/неуместно
  // на уровне конкретной сцены для жанров со своими конвенциями письма.
  const toneNote = genreToneNote(proj.genre);
  if(toneNote) lines.push(toneNote);
  // Явная авторская настройка иронии/юмора поверх жанрового умолчания — см.
  // её комментарий в genres.js. 'auto' ничего не добавляет (тон решает жанр).
  const humorNote = humorLevelNote(style?.humorLevel);
  if(humorNote) lines.push(humorNote);
  lines.push(opts.prevSceneText
    ? 'Финал сцены: посмотри, каким приёмом заканчивается «ПРЕДЫДУЩАЯ СЦЕНА» в контексте — если она уже завершается коротким зеркальным предложением и уходом в тишину/темноту, в этот раз закончи иначе (репликой, действием, конкретной деталью, вопросом без ответа).'
    : 'Финал сцены: не завершай сцену дежурным приёмом «короткое зеркальное предложение + тишина/темнота» — выбери другой способ поставить точку.');
  // Позитивная (не только анти-клише) инструкция на крючок — самый подтверждённый
  // приём пейс-мейкинга: не жёсткий клиффхэнгер каждый раз, а открытый вопрос/
  // нерешённое напряжение, которое тянет читателя к следующей сцене.
  lines.push('Крючок в конце: последний абзац сцены должен оставлять открытый вопрос, решение-на-грани или нерешённое напряжение — не всё разрешай. Это НЕ обязательно жёсткий клиффхэнгер (не злоупотребляй), достаточно, чтобы читателю хотелось узнать, что дальше.');
  lines.push('Факты из блоков «КАНОН (БИБЛИЯ)» и «КАНОН (ЗАКРЕПЛЁННЫЕ ФАКТЫ)» исторически зафиксированы — не изменяй их, не вводи деталей, противоречащих канону.');
  lines.push('Пиши только прозу, без заголовков и пояснений.');
  return lines.join('\n');
}

// Усечение по приоритету: серия → главы → сцены (в ПП2 этих слоёв ещё нет),
// затем живой контекст через smartTrunc. fixed-слои не режутся.
// Человекочитаемые имена слоёв — урезание контекста до сих пор происходило
// молча, а предупреждение в pipeline.js гадало («могла быть урезана») по
// размеру входа, не по факту. Автор не мог отличить «всё влезло» от «выпал
// весь канон книги», а именно канон уходит на длинной книге предпоследним.
export const LAYER_LABELS = {
  observed:'замеченные паттерны', openThreads:'открытые сюжетные линии',
  scenes:'сводки сцен', chapters:'сводки глав', series:'память серии',
  characters:'состояния персонажей', bible:'КАНОН (Библия)',
  biblePinned:'КАНОН (закреплённые факты)', prevScene:'текст предыдущей сцены',
};

// Возвращает отчёт о том, что реально урезано: [{слой, вид, сколько}].
// Пустой массив = ничего не резали.
function applyBudget(layers, BUDGET){
  const trimmed = [];
  const total = ()=>layers.reduce((s,l)=>s+estimateTokens(l.text), 0);
  if(total() <= BUDGET) return trimmed;

  // (а) Самые необязательные слои-советы (не обязательство, а мягкая подсказка)
  // уходят ПЕРВЫМИ и целиком, ДО того как трогаем что-либо ещё — раньше шаг «б»
  // (частичная обрезка scenes) выполнялся безусловно перед этим циклом, поэтому
  // scenes мог быть наполовину вырезан, пока observed/openThreads оставались
  // нетронутыми — заявленный приоритет на деле не соблюдался (найдено консилиумом
  // живым тестом на реальных числах бюджета).
  for(const nm of ['observed','openThreads']){
    const idx = layers.findIndex(l=>l.name===nm && !l.fixed);
    if(idx>=0){ layers.splice(idx,1); trimmed.push({ слой:nm, вид:'целиком' }); }
    if(total() <= BUDGET) return trimmed;
  }

  // (б) Слой сцен: выбрасываем СТАРЕЙШИЕ записи по одной (entries[0] = старейшая)
  const scenesLayer = layers.find(l=>l.name==='scenes' && l.entries);
  let сцен = 0;
  while(scenesLayer && scenesLayer.entries.length>1 && total() > BUDGET){
    scenesLayer.entries.shift(); сцен++;
  }
  if(сцен) trimmed.push({ слой:'scenes', вид:'частично', сколько:сцен });
  if(total() <= BUDGET) return trimmed;

  // (б2) Слой глав — та же логика: на длинной книге (или при уменьшенном
  // budgetTokens) сводок глав накапливается без ограничения, в отличие от
  // сцен (их сдерживает KEEP_SCENES + сворачивание в бегущий синопсис) —
  // без этого шага (в) сбросил бы весь слой глав разом, и Прозаик одномоментно
  // терял бы понимание всех ранних глав книги вместо постепенной деградации.
  const chaptersLayer = layers.find(l=>l.name==='chapters' && l.entries);
  let глав = 0;
  while(chaptersLayer && chaptersLayer.entries.length>1 && total() > BUDGET){
    chaptersLayer.entries.shift(); глав++;
  }
  if(глав) trimmed.push({ слой:'chapters', вид:'частично', сколько:глав });
  if(total() <= BUDGET) return trimmed;

  // (в) Дальше выбиваем целые слои «памяти» по приоритету (не fixed).
  const dropOrder = ['scenes','chapters','series','characters','bible'];
  for(const nm of dropOrder){
    while(total() > BUDGET){
      const idx = layers.findIndex(l=>l.name===nm && !l.fixed);
      if(idx<0) break;
      layers.splice(idx,1);
      trimmed.push({ слой:nm, вид:'целиком' });
    }
    if(total() <= BUDGET) return trimmed;
  }
  // (г) последний рубеж: ужать живой контекст (но не голос/синопсис — они fixed)
  const live = layers.find(l=>l.live);
  if(live && total() > BUDGET){
    const over = total() - BUDGET;
    const liveTokens = estimateTokens(live.text);
    live.text = trimToTokens(live.text, Math.max(200, liveTokens - over));
    trimmed.push({ слой:live.name || 'prevScene', вид:'ужат' });
  }
  return trimmed;
}
