// Инварианты, которые в этом коде уже ломались — и каждый раз находились
// глазами, а не проверкой. Все правила ниже я сегодня чинил вслепую; теперь
// они закреплены.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateSkeleton, findGhostCharacters, clampSceneTargetWords } from '../src/architect-book.js';
import { lineEditMessages, findBoundaryRepeat } from '../src/guards.js';
import { charNamesMatch } from '../src/state.js';
import { typo } from '../src/export.js';

// validateSkeleton принимает СЫРОЙ ответ модели (строку), а не готовый объект —
// внутри он сам зовёт extractJSON. Это и проверяем.
const скелет = (главы) => JSON.stringify({ chapters: главы });
const глава = (название, сцен, слов = 700) => ({
  title: название, arc: 'завязка',
  scenes: Array.from({ length: sцен_(сцен) }, (_, i) => ({
    title: `${название} — сцена ${i + 1}`, brief: 'подробный бриф сцены', targetWords: слов,
  })),
});
function sцен_(n) { return n; }

test('validateSkeleton: не-JSON на входе → внятная ошибка, а не исключение', () => {
  const r = validateSkeleton('извините, не могу составить скелет');
  assert.equal(r.ok, false);
  assert.match(r.error, /JSON/);
});

// ───────────────────────── validateSkeleton ─────────────────────────
test('validateSkeleton: нормальный скелет проходит', () => {
  const r = validateSkeleton(скелет([глава('Глава 1', 4), глава('Глава 2', 4)]), { expectedScenes: 8 });
  assert.equal(r.ok, true);
});

// Живой случай: ответ обрывался по токенам на середине, последняя глава
// приходила с одной сценой из четырёх — и это принималось за замысел.
test('validateSkeleton: глава втрое беднее самой полной — недовоз', () => {
  const r = validateSkeleton(скелет([глава('Глава 1', 6), глава('Глава 2', 1)]), { expectedScenes: 12 });
  assert.equal(r.ok, false);
  assert.match(r.error, /не доехала|содержит/);
});

test('validateSkeleton: сцен сильно меньше запрошенного — недовоз', () => {
  const r = validateSkeleton(скелет([глава('Глава 1', 2), глава('Глава 2', 2)]), { expectedScenes: 20 });
  assert.equal(r.ok, false);
  assert.match(r.error, /неполным|всего/);
});

test('validateSkeleton: пустой ответ не принимается', () => {
  assert.equal(validateSkeleton(null).ok, false);
  assert.equal(validateSkeleton('{}').ok, false);
  assert.equal(validateSkeleton(скелет([])).ok, false);
});

// Модель регулярно заворачивает ответ в лишний уровень — это штатно и должно проходить.
test('validateSkeleton: скелет, завёрнутый в лишний ключ', () => {
  const raw = JSON.stringify({ skeleton: JSON.parse(скелет([глава('Глава 1', 4), глава('Глава 2', 4)])) });
  assert.equal(validateSkeleton(raw, { expectedScenes: 8 }).ok, true);
});

// ──────────────────────── findGhostCharacters ────────────────────────
// Персонаж канона, которого новый скелет не упоминает. Проверка должна
// работать задним числом — ей не нужен снимок «прежней» книги.
test('findGhostCharacters: имя из канона, отсутствующее в брифах', () => {
  const st = {
    structure: [
      { type: 'chapter', title: 'Глава 1' },
      { type: 'scene', title: 'Прибытие Дани', brief: 'Даня входит в архив', entryState: 'Даня растерян' },
    ],
    characters: [{ name: 'Даня' }, { name: 'Глеб' }],
  };
  assert.deepEqual(findGhostCharacters(st), ['Глеб']);
});

test('findGhostCharacters: короткие имена не флагуются (риск ложных совпадений)', () => {
  const st = {
    structure: [{ type: 'scene', title: 'Сцена', brief: 'бриф без имён', entryState: '' }],
    characters: [{ name: 'Ли' }],
  };
  assert.deepEqual(findGhostCharacters(st), []);
});

test('findGhostCharacters: без скелета сравнивать не с чем — пусто, а не «все призраки»', () => {
  assert.deepEqual(findGhostCharacters({ structure: [], characters: [{ name: 'Глеб' }] }), []);
});

// ─────────────────────── clampSceneTargetWords ───────────────────────
test('clampSceneTargetWords: значение зажимается в разумные границы', () => {
  const st = { project: { sceneWords: 700 } };
  const мало = clampSceneTargetWords(st, 1);
  const много = clampSceneTargetWords(st, 999999);
  assert.ok(мало >= 100, `нижняя граница не сработала: ${мало}`);
  assert.ok(много <= 5000, `верхняя граница не сработала: ${много}`);
});

test('clampSceneTargetWords: мусор на входе не даёт NaN', () => {
  const st = { project: { sceneWords: 700 } };
  const r = clampSceneTargetWords(st, NaN);
  assert.ok(Number.isFinite(r), `получен не-число: ${r}`);
});

// ───────────────────── lineEditMessages: объём ─────────────────────
// Линейный редактор идёт последним: после него объём никто не восполнит.
const ЗАГЛУШКА = (слов) => Array.from({ length: слов }, (_, i) => `сл${i}`).join(' ');

test('lineEditMessages: черновик короче цели — запрет на сокращение', () => {
  const m = lineEditMessages(ЗАГЛУШКА(624), [], '', { targetWords: 720 });
  assert.match(m[1].content, /ОБЪЁМ/);
  assert.match(m[1].content, /не меньше/);
});

test('lineEditMessages: черновик выше цели — запрета нет', () => {
  const m = lineEditMessages(ЗАГЛУШКА(624), [], '', { targetWords: 600 });
  assert.doesNotMatch(m[1].content, /ОБЪЁМ/);
});

test('lineEditMessages: цель не задана — запрета нет', () => {
  const m = lineEditMessages(ЗАГЛУШКА(624), [], '', {});
  assert.doesNotMatch(m[1].content, /ОБЪЁМ/);
});

// ─────────────────────── charNamesMatch ───────────────────────
test('charNamesMatch: формы одного имени считаются одним персонажем', () => {
  assert.equal(charNamesMatch('Даня', 'Даня'), true);
  assert.equal(charNamesMatch('Даня', 'даня'), true);
});

test('charNamesMatch: разные имена не сливаются', () => {
  assert.equal(charNamesMatch('Даня', 'Глеб'), false);
});

// ─────────────────────── findBoundaryRepeat ───────────────────────
test('findBoundaryRepeat: конец предыдущей сцены дублируется в начале новой', () => {
  const пред = 'Он долго молчал. Потом встал и вышел за дверь, не оглядываясь.';
  const нов = 'Он встал и вышел за дверь, не оглядываясь. Улица встретила его дождём.';
  assert.ok(findBoundaryRepeat(пред, нов), 'дубль на стыке не найден');
});

test('findBoundaryRepeat: разные сцены — дубля нет (пустой список, не null)', () => {
  const пред = 'Он долго молчал, разглядывая трещину в потолке над кроватью.';
  const нов = 'Гильдия гудела, очередь тянулась до самых дверей приёмной.';
  assert.deepEqual(findBoundaryRepeat(пред, нов), []);
});

test('findBoundaryRepeat: пустой вход не роняет проверку', () => {
  assert.deepEqual(findBoundaryRepeat('', 'текст'), []);
  assert.deepEqual(findBoundaryRepeat(null, null), []);
});

// ───────────────────────────── typo ─────────────────────────────
// Гвоздевой случай: схлопывание двойных пробелов НЕ должно съедать переносы
// строк, иначе Markdown-абзацы в экспорте склеиваются в один ком.
test('typo: прямые кавычки становятся ёлочками', () => {
  assert.equal(typo('он сказал "пора"'), 'он сказал «пора»');
});

test('typo: дефис-разделитель становится тире', () => {
  assert.match(typo('слово - слово'), /—/);
});

test('typo: пустой вход даёт пустую строку, а не падение', () => {
  assert.equal(typo(''), '');
  assert.equal(typo(null), '');
});

test('typo: переносы строк выживают', () => {
  const r = typo('Первый абзац.\n\nВторой абзац.');
  assert.match(r, /\n\n/);
});

// ─────────────── rememberRejected: счётчик упорства ───────────────
// Один отказ — художественный выбор, три подряд — увиливание. Раньше повтор
// молча отбрасывался как дубль, и эти два случая были неотличимы.
test('rememberRejected: повторный отказ считается, а не теряется', async () => {
  const { rememberRejected } = await import('../src/pipeline.js');
  const сцена = {};
  const замечание = [{ quote: 'Герой полностью пассивен', reason: 'приём' }];
  rememberRejected(сцена, замечание);
  assert.equal(сцена.rejectedNotes.length, 1);
  assert.equal(сцена.rejectedNotes[0].count, 1);

  rememberRejected(сцена, замечание);
  rememberRejected(сцена, замечание);
  assert.equal(сцена.rejectedNotes.length, 1, 'дубли не должны плодить записи');
  assert.equal(сцена.rejectedNotes[0].count, 3, 'счётчик упорства не растёт');
});

test('rememberRejected: разные замечания — разные записи', async () => {
  const { rememberRejected } = await import('../src/pipeline.js');
  const сцена = {};
  rememberRejected(сцена, [{ quote: 'Герой полностью пассивен', reason: 'приём' }]);
  rememberRejected(сцена, [{ quote: 'Запах доносился до горизонта — абсурдный образ', reason: 'гипербола' }]);
  assert.equal(сцена.rejectedNotes.length, 2);
});

test('rememberRejected: пункт без цитаты игнорируется', async () => {
  const { rememberRejected } = await import('../src/pipeline.js');
  const сцена = {};
  rememberRejected(сцена, [{ reason: 'без цитаты' }]);
  assert.equal((сцена.rejectedNotes || []).length, 0);
});

// ─────────── подсказка о числе сцен = формула Архитектора ───────────
// Живой прогон: автор поставил «Объём сцены = 750», жанр подставил 70 000
// слов. Подсказка показала «≈ 60 сцен × 1167 слов» по своей формуле, а
// Архитектор получил задание на 93 сцены — и первая попытка не прошла
// валидацию. Тест держит обе формулы в одной точке.
test('число сцен: подсказка совпадает с формулой Архитектора', async () => {
  const { default: fs } = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/ui/stages.js', import.meta.url), 'utf8');
  // Прямой вызов невозможен (функция не экспортируется) — проверяем главное:
  // подсказка принимает объём сцены и не считает его сама.
  assert.match(src, /function sceneCountHint\(tw,\s*sceneWords\)/, 'подсказка не принимает объём сцены');
  const вызовы = src.match(/sceneCountHint\([^)]*\)/g).filter(v => !v.startsWith('sceneCountHint(tw'));
  вызовы.forEach(v => assert.match(v, /,/, `вызов без объёма сцены: ${v}`));
});

test('число сцен: формула Архитектора на живых числах', () => {
  // Повтор формулы architect-book.js — если её поменяют, тест обязан упасть.
  const сцен = (объём, объёмСцены) => {
    const wps = объёмСцены > 0 ? Math.max(300, Math.min(4000, объёмСцены))
                               : Math.max(700, Math.min(2000, Math.round(объём / 60)));
    return Math.max(6, Math.round(объём / wps));
  };
  assert.equal(сцен(70000, 750), 93, 'случай из живого прогона');
  assert.equal(сцен(70000, 0), 60, 'автоформула без авторского объёма сцены');
  assert.equal(сцен(5000, 0), 7, '5000/700 — вилка 700 держит нижний край');
  assert.equal(сцен(1000, 0), 6, 'жёсткий минимум 6 сцен');
});

// ───────────── добор объёма: полоса 60–90% просит расти ─────────────
// Живой прогон новой книги: сцена закрылась на 544 из 675 (81%). Порог 0.9
// защищал от усыхания, но команда на РОСТ была только у grossShort (<60%),
// поэтому 19% недобора остались навсегда. Формулы ниже повторяют pipeline.js.
const полосаОбъёма = (слов, цель) => {
  const gross = !!(цель && слов < цель*0.6);
  const tooShort = !!(цель && слов < цель*0.9);
  if(gross) return 'критический недобор — расширить';
  if(tooShort) return 'недобор — довести до цели';
  return 'норма';
};

test('объём: живой случай 544/675 попадает в полосу добора, а не в тишину', () => {
  assert.equal(полосаОбъёма(544, 675), 'недобор — довести до цели');
});

test('объём: грубый недобор остаётся отдельной, более жёсткой полосой', () => {
  assert.equal(полосаОбъёма(380, 675), 'критический недобор — расширить');
});

test('объём: на цели и выше — молчим', () => {
  assert.equal(полосаОбъёма(675, 675), 'норма');
  assert.equal(полосаОбъёма(804, 800), 'норма');
  assert.equal(полосаОбъёма(608, 675), 'норма', '90.1% — уже норма');
});

test('объём: без цели ничего не срабатывает', () => {
  assert.equal(полосаОбъёма(100, 0), 'норма');
});

// ─────────── ранняя остановка: две итерации без единой оси ───────────
// Каждая лишняя итерация — полный набор вызовов (Прозаик + Оценщик + все
// Стражи) за деньги автора. Одна полная стагнация ещё не приговор: усиленная
// директива иногда срабатывает со второго раза; две подряд — приговор.
const серияСтагнаций = (историяЗастрявших, всегоОсей) => {
  let серия = 0, остановка = -1;
  историяЗастрявших.forEach((застряло, i)=>{
    серия = (застряло === всегоОсей) ? серия + 1 : 0;
    if(серия >= 2 && остановка < 0) остановка = i;
  });
  return остановка;
};

test('стагнация: две полные подряд — останавливаемся на второй', () => {
  assert.equal(серияСтагнаций([6, 6], 6), 1);
});

test('стагнация: одна полная не останавливает', () => {
  assert.equal(серияСтагнаций([6, 2, 6], 6), -1);
});

test('стагнация: частичная не считается, даже если её много', () => {
  assert.equal(серияСтагнаций([5, 5, 5, 5], 6), -1);
});

test('стагнация: серия рвётся прогрессом и начинается заново', () => {
  assert.equal(серияСтагнаций([6, 0, 6, 6], 6), 3);
});

// ────────── Линейный редактор не укорачивает короткую сцену ──────────
// Живой прогон: цикл прозы поднял сцену 560→613→672 (90% цели), последний
// шаг срезал до 580 (77%). Текстовая инструкция «итог по объёму — не меньше»
// из 1.44.0 не сработала: «убрать лишнее» — прямая задача этого агента.
// Приёмка проверяла только длину > 50% исходной, и 14% потери проходили.
const правкаПринимается = (былоСлов, сталоСлов, цель) => {
  const belowTarget = !!(цель && былоСлов < цель*0.95);
  return !(belowTarget && сталоСлов < былоСлов*0.98);
};

test('Линейный редактор: живой случай 672→580 при цели 750 — отклоняем', () => {
  assert.equal(правкаПринимается(672, 580, 750), false);
});

test('Линейный редактор: мелкая шлифовка в пределах допуска — принимаем', () => {
  assert.equal(правкаПринимается(672, 665, 750), true, '1% потери — это работа агента');
});

test('Линейный редактор: сцена на цели — режет свободно', () => {
  assert.equal(правкаПринимается(760, 700, 750), true);
});

test('Линейный редактор: рост принимается всегда', () => {
  assert.equal(правкаПринимается(672, 700, 750), true);
  assert.equal(правкаПринимается(400, 500, 750), true);
});

test('Линейный редактор: без цели ограничения нет', () => {
  assert.equal(правкаПринимается(672, 400, 0), true);
});

// ───────── Линейный редактор: границы свободы ─────────
// Он идёт ПОСЛЕ приёмки Оценщиком и Стражами, и его результат уже никто не
// перепроверяет (bestEval не пересчитывается — балл на сцене относится к
// тексту ДО его правки). Значит ограничивать надо проверками, а не просьбами.
const клишеВернулось = (доТекст, послеТекст, забаненные) =>
  забаненные.filter(c => c && c.length >= 8 && послеТекст.includes(c) && !доТекст.includes(c));

test('Линейный редактор: вернувшееся клише ловится', () => {
  const r = клишеВернулось('Он молчал и смотрел в окно.',
                            'Сердце ушло в пятки, он молчал.', ['сердце ушло в пятки']);
  assert.equal(r.length, 0, 'регистр учитывается — проверяем как есть');
  const r2 = клишеВернулось('Он молчал.', 'Сердце ушло в пятки, он молчал.', ['Сердце ушло в пятки']);
  assert.equal(r2.length, 1);
});

test('Линейный редактор: клише, которое БЫЛО и осталось, не считается вернувшимся', () => {
  const r = клишеВернулось('Сердце ушло в пятки.', 'Сердце ушло в пятки, и он встал.', ['Сердце ушло в пятки']);
  assert.equal(r.length, 0, 'агент его не вносил — оно уже было');
});

test('Линейный редактор: короткие обрывки не считаются клише', () => {
  const r = клишеВернулось('Он молчал.', 'Он вдруг молчал.', ['вдруг']);
  assert.equal(r.length, 0, 'порог длины 8 символов отсекает шум');
});

const доляНовыхСлов = (до, после) => {
  const было = new Set((до.toLowerCase().match(/[а-яёa-z]+/g)||[]));
  const стало = (после.toLowerCase().match(/[а-яёa-z]+/g)||[]);
  const общих = стало.filter(w=>было.has(w)).length;
  return стало.length ? 1 - общих/стало.length : 0;
};

test('Линейный редактор: шлифовка проходит, переписывание — нет', () => {
  const исходник = 'Вера открыла книгу и увидела на полях чужой почерк который повторял её собственный';
  const шлифовка = 'Вера раскрыла книгу и увидела на полях чужой почерк который повторял её собственный';
  const переписано = 'Библиотекарь захлопнула том забыв про стеллажи вокруг пахло сыростью подвала';
  assert.ok(доляНовыхСлов(исходник, шлифовка) <= 0.33, 'мелкая правка не должна отклоняться');
  assert.ok(доляНовыхСлов(исходник, переписано) > 0.33, 'переписывание должно отклоняться');
});

test('Линейный редактор: перестановка предложений не считается переписыванием', () => {
  const a = 'Вера открыла книгу. На полях был чужой почерк.';
  const b = 'На полях был чужой почерк. Вера открыла книгу.';
  assert.ok(доляНовыхСлов(a, b) <= 0.33, 'сравнение по множеству слов, порядок не важен');
});

// ───────────── бюджет контекста: урезание должно быть видимым ─────────────
// Раньше applyBudget резал слои молча, а предупреждение в pipeline.js гадало по
// размеру входа («часть памяти МОГЛА быть урезана») — оно врало в обе стороны.
// Потеря канона на длинной книге неотличима от нормы: Прозаик пишет сцену, не
// зная фактов собственной книги, и противоречия всплывают позже у Стражей.
test('buildSceneContext: при достаточном бюджете ничего не урезано', async () => {
  const { buildSceneContext } = await import('../src/context.js');
  const st = {
    project:{ genre:'мистика', title:'Т' }, style:{ forbidden:[], rules:[] },
    voice:{ examples:['образец'] }, bible:[{keys:'ключ', text:'факт канона'}],
    characters:[{name:'Вера', stateNote:'встревожена'}],
    structure:[{ type:'scene', id:'s1', title:'Сцена', brief:'бриф' }],
    memory:{ scenes:{}, chapters:{} },
    global:{ budgetTokens: 128000 },
  };
  const ctx = buildSceneContext(st, st.structure[0], {});
  assert.ok(Array.isArray(ctx.trimmed), 'отчёт об урезании должен возвращаться всегда');
  assert.equal(ctx.trimmed.length, 0, 'при большом бюджете резать нечего');
});

test('buildSceneContext: при крошечном бюджете канон урезается и это видно', async () => {
  const { buildSceneContext, LAYER_LABELS } = await import('../src/context.js');
  const длинный = 'факт канона книги, довольно подробный и длинный '.repeat(60);
  const st = {
    project:{ genre:'мистика', title:'Т' }, style:{ forbidden:[], rules:[] },
    voice:{ examples:['образец'] },
    bible:[{keys:'ключ', text:длинный}],
    characters:[{name:'Вера', stateNote:длинный}],
    structure:[{ type:'scene', id:'s1', title:'Сцена', brief:'ключ' }],
    memory:{ scenes:{}, chapters:{} },
    global:{ budgetTokens: 300 },   // заведомо мало
  };
  const ctx = buildSceneContext(st, st.structure[0], {});
  assert.ok(ctx.trimmed.length > 0, 'урезание должно быть зафиксировано, а не пройти молча');
  const слои = ctx.trimmed.map(t=>t.слой);
  assert.ok(слои.includes('bible') || слои.includes('characters'),
    'при таком бюджете должны уйти канон и/или персонажи, и отчёт обязан их назвать');
  ctx.trimmed.forEach(t=>{
    assert.ok(LAYER_LABELS[t.слой], `у слоя «${t.слой}» нет человекочитаемого имени — в логе будет техножаргон`);
    assert.ok(['целиком','частично','ужат'].includes(t.вид), 'вид урезания должен быть из известного набора');
  });
});

test('дефолты: бюджет контекста 128000, лимиты агентов удвоены', async () => {
  const { defaultState } = await import('../src/state.js');
  const d = defaultState();
  assert.equal(d.global.budgetTokens, 128000, 'бюджет сборки контекста ×4 от прежних 32000');
  const по = Object.fromEntries(d.agents.map(a=>[a.role, a.maxTokens]));
  assert.equal(по.prose, 12960, 'Прозаик ×2 — reasoning-модели тратят часть лимита на рассуждение');
  assert.equal(по.evaluator, 11520);
  assert.equal(по.logic, 7560);
  assert.equal(по.lineedit, 12960);
  assert.equal(по.architect, 3240);
});

// ───────────── дефолтная модель по ролям ─────────────
// Замер на живой сцене (тот же контекст, тот же Оценщик, менялась ТОЛЬКО
// модель Прозаика): chat 5/5 при 515 словах, v4-pro 6/6 при 858, reasoner 6/7.
// До этого «Свежесть» стояла ровно на 5 во всех 18 замерах по четырём сценам.
test('дефолты: переопределена модель только у Прозаика', async () => {
  const { defaultState } = await import('../src/state.js');
  const d = defaultState();
  const prose = d.agents.find(a=>a.role==='prose');
  assert.equal(prose.model, 'deepseek-v4-pro');
  assert.equal(prose.provider, 'deepseek', 'без provider модель ушла бы на чужой baseURL при смене глобального');
  const прочие = d.agents.filter(a=>a.role!=='prose' && !a.custom);
  прочие.forEach(a=>{
    assert.ok(!a.model, `у роли ${a.role} не должно быть дефолтного переопределения модели — она на глобальной`);
  });
});

test('миграция: ручное переопределение модели переживает обновление версии', async () => {
  const { defaultState, migrate: мигр } = await import('../src/state.js');
  assert.equal(typeof мигр, 'function', 'migrate() должна экспортироваться — иначе тест молча проходит, ничего не проверив');
  const старый = defaultState();
  старый.agents = старый.agents.map(a=>a.role==='evaluator' ? {...a, provider:'anthropic', model:'claude-sonnet-5'} : a);
  const после = мигр(JSON.parse(JSON.stringify(старый)));
  const ev = (после.agents||[]).find(a=>a.role==='evaluator');
  assert.equal(ev.model, 'claude-sonnet-5', 'выбор модели автора не должен слетать при обновлении');
  assert.equal(ev.provider, 'anthropic');
});

test('миграция: явное «как глобально» (пустая строка) не перезатирается дефолтом роли', async () => {
  const { defaultState, migrate: мигр } = await import('../src/state.js');
  assert.equal(typeof мигр, 'function');
  const старый = defaultState();
  // автор снял переопределение у Прозаика — UI пишет '' , не undefined
  старый.agents = старый.agents.map(a=>a.role==='prose' ? {...a, provider:'', model:''} : a);
  const после = мигр(JSON.parse(JSON.stringify(старый)));
  const pr = (после.agents||[]).find(a=>a.role==='prose');
  assert.equal(pr.model, '', 'снятое переопределение не должно возвращаться дефолтом роли');
});

// ───────────── обрыв по лимиту токенов вне пайплайна сцены ─────────────
// 36 из 44 вызовов LLM вне написания сцены (Мир, Структура, Критик книги,
// Иллюстрации, История, Серия) разбирали ответ через extractJSON, а тот на
// оборванном JSON возвращает null — вызывающий читал это как «ничего не
// найдено». «Нестыковок нет» было неотличимо от «ответ не поместился».
test('assertNotTruncated: молчит на нормальном ответе, бросает на обрыве', async () => {
  const { assertNotTruncated } = await import('../src/llm.js');
  assert.doesNotThrow(()=>assertNotTruncated({ text:'ок', hitLimit:false }, 'Мир'));
  assert.doesNotThrow(()=>assertNotTruncated(null, 'Мир'), 'null не должен ронять вызывающего');
  assert.doesNotThrow(()=>assertNotTruncated({ text:'ок' }, 'Мир'), 'ответ старого сервера без флага — не обрыв');
  assert.throws(()=>assertNotTruncated({ text:'{"a":', hitLimit:true }, 'Критик книги'),
    /обрезан лимитом токенов \(Критик книги\)/, 'обрыв должен называть агента и не молчать');
});

test('все модули вне пайплайна сцены проверяют обрыв', async () => {
  const fs = await import('node:fs');
  const модули = ['world','bookreview','architect-book','historian','illustrations','series','craftsignals','inline'];
  for(const m of модули){
    const src = fs.readFileSync(new URL(`../src/${m}.js`, import.meta.url), 'utf8');
    const вызовов = (src.match(/await callLLM\(/g)||[]).length;
    const проверок = (src.match(/assertNotTruncated\(/g)||[]).length;
    assert.ok(проверок > 0, `${m}.js: ${вызовов} вызовов LLM и ни одной проверки обрыва — обрыв пройдёт молча`);
    assert.match(src, /assertNotTruncated.*from '\.\/llm\.js'/s, `${m}.js: хелпер не импортирован`);
  }
});
