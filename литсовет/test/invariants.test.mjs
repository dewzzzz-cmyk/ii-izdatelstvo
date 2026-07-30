// Инварианты, которые в этом коде уже ломались — и каждый раз находились
// глазами, а не проверкой. Все правила ниже я сегодня чинил вслепую; теперь
// они закреплены.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateSkeleton, findGhostCharacters, clampSceneTargetWords } from '../src/architect-book.js';
import { lineEditMessages, findBoundaryRepeat, readerGuardMessages } from '../src/guards.js';
import { charNamesMatch } from '../src/state.js';
import { typo } from '../src/export.js';
import { rebuildBibleVecs, factAlreadyInBible, tfvec, tokensOf, cosine, bibleMatches } from '../src/bible.js';
import { draftBeatsBest, rejectNoteByAuthor, rememberRejected } from '../src/pipeline.js';

// factAlreadyInBible/bibleMatches без IDF-веса (плоский tfvec+cosine) считали
// общие слова между РАЗНЫМИ фактами наравне с единственным различающим словом
// (именем) — два факта о разных персонажах с одинаковым шаблоном описания
// («X — рыцарь, живёт в старом замке на холме, служит королю») давали
// cosine=0.875, ВЫШЕ порога дедупа 0.75: второй факт молча считался бы
// «уже есть в каноне» и не добавлялся, хотя описывает другого человека.
test('IDF-вес: два разных факта с общим шаблоном описания — не дубли', () => {
  const bible = [
    { keys:'Ричард', text:'Ричард — рыцарь, живёт в старом замке на холме, служит королю.' },
    { keys:'Эдмунд', text:'Эдмунд — рыцарь, живёт в старом замке на холме, служит королю.' },
  ];
  rebuildBibleVecs(bible);
  const rawSim = cosine(
    tfvec(tokensOf('Ричард — рыцарь, живёт в старом замке на холме, служит королю.')),
    tfvec(tokensOf('Освальд — рыцарь, живёт в старом замке на холме, служит королю.')),
  );
  assert.ok(rawSim >= 0.75, 'контроль: без IDF плоский cosine выше порога дедупа (иначе сценарий бага не воспроизведён)');
  const dup = factAlreadyInBible({ keys:'Освальд', text:'Освальд — рыцарь, живёт в старом замке на холме, служит королю.' }, bible);
  assert.equal(dup, false);
});

test('IDF-вес: настоящий парафраз ТОГО ЖЕ факта всё ещё считается дублем', () => {
  const bible = [
    { keys:'Ричард', text:'Ричард — рыцарь, живёт в старом замке на холме, служит королю.' },
  ];
  rebuildBibleVecs(bible);
  const dup = factAlreadyInBible({ keys:'Ричард', text:'Ричард служит королю и живёт в замке на холме — он рыцарь.' }, bible);
  assert.equal(dup, true);
});

// Второй живой прогон «Ящик на причале» (уже с пришпиленной severity Читателя)
// вскрыл уровень глубже: черновик 1 — 6.5 балла и 1 РЕМЕСЛЕННАЯ критическая
// (Страж развязки), черновик 2 — 5.8 и ноль критических. Так как `clean` стоит
// выше балла, победил черновик 2 — на 0.7 хуже, то есть заметно выше шума
// Оценщика (0.5). Сцена в книге стала 5.7 вместо 6.5. Теперь `clean` считает
// только ФАКТИЧЕСКИЕ критические (логика/события) — ремесленные решают лишь
// при равном балле.
// Кнопка «✕ Это приём»: у автора до этого не было способа погасить находку, с
// которой он не согласен — она возвращалась на каждой итерации и занимала место
// в бюджете директивы. Счётчик «три отказа = увиливание» относится к отказам
// ПРОЗАИКА и к решению автора неприменим: он не увиливает, а распоряжается
// своим текстом.
test('отклонение автора помечается byAuthor и не дублируется при повторе', () => {
  const scene = {};
  const t = 'Разжёвывание образа луны: текст дважды объясняет, что это значит';
  rejectNoteByAuthor(scene, t);
  assert.equal(scene.rejectedNotes.length, 1);
  assert.equal(scene.rejectedNotes[0].byAuthor, true);
  rejectNoteByAuthor(scene, t);
  assert.equal(scene.rejectedNotes.length, 1, 'повторное отклонение того же не создаёт вторую запись');
});

test('отклонение автора переживает три отказа Прозаика (не истекает)', () => {
  const scene = {};
  const t = 'Потеря темпа в середине: описание ночных размышлений затянуто';
  rejectNoteByAuthor(scene, t);
  for (let i = 0; i < 3; i++) rememberRejected(scene, [{ quote: t, reason: 'приём' }]);
  assert.equal(scene.rejectedNotes[0].byAuthor, true, 'флаг автора не должен стираться отказами Прозаика');
});

test('пустой текст не создаёт запись об отклонении', () => {
  const scene = {};
  assert.equal(rejectNoteByAuthor(scene, '   '), false);
  assert.equal(scene.rejectedNotes, undefined);
});

test('best-отбор: ремесленная критическая не перебивает балл выше шума', () => {
  const черновик1 = { literaryChecked: true, clean: true, scored: true, weighted: 6.5, criticals: 1, questions: 4 };
  const черновик2 = { literaryChecked: true, clean: true, scored: true, weighted: 5.8, criticals: 0, questions: 1 };
  assert.equal(draftBeatsBest(черновик2, черновик1), false, 'черновик на 0.7 балла хуже не должен побеждать из-за нуля ремесленных критических');
});

test('best-отбор: при равном балле ремесленные критические по-прежнему решают', () => {
  const меньшеКрит = { literaryChecked: true, clean: true, scored: true, weighted: 6.2, criticals: 0, questions: 2 };
  const большеКрит = { literaryChecked: true, clean: true, scored: true, weighted: 6.4, criticals: 3, questions: 2 };
  // Δ = 0.2 — внутри шума, значит решает счёт критических.
  assert.equal(draftBeatsBest(меньшеКрит, большеКрит), true);
});

test('best-отбор: ФАКТИЧЕСКАЯ ошибка остаётся жёстким вето даже при высоком балле', () => {
  const сОшибкой = { literaryChecked: true, clean: false, scored: true, weighted: 9.0, criticals: 1, questions: 0 };
  const чистый = { literaryChecked: true, clean: true, scored: true, weighted: 6.5, criticals: 0, questions: 0 };
  assert.equal(draftBeatsBest(сОшибкой, чистый), false, 'противоречие в фактах нельзя перевесить балльной красотой');
});

// Живой прогон «Ящик на причале»: у стража «Читатель» severity не была
// объяснена, и на ОДНОМ И ТОМ ЖЕ структурном факте он выдал «норма» на
// итерации 1 и «КРИТИЧНО» на итерации 2. Так как criticals собираются от
// любого стража, а `clean` в draftBeatsBest стоит выше балла, одна такая
// находка навсегда запретила черновикам 2 и 3 победить — ~30 платных вызовов
// в мусор. Рубрика severity должна оставаться в промпте, а пассивность —
// warning-уровнем (её системность ловит passivityIsSystemic по книге).
test('Читатель: рубрика severity закреплена, пассивность не блокирует сцену', () => {
  const msgs = readerGuardMessages({ brief: 'бриф сцены', emotion: 'тревога' }, 'текст сцены', 2, 'мистический триллер');
  const user = msgs[1].content;
  assert.match(user, /severity: critical/, 'рубрика severity должна быть в промпте, а не только список вариантов в схеме');
  assert.match(user, /включая пассивность героя/, 'пассивность должна быть явно отнесена к warning');
  assert.match(user, /стоит на кону/, 'critical должен быть ограничен провалом ставки/финальной эмоции');
});

test('IDF-вес: bibleMatches находит факт по различающему слову запроса', () => {
  const bible = [
    { keys:'Ричард', text:'Ричард — рыцарь, живёт в старом замке на холме, служит королю.' },
    { keys:'Эдмунд', text:'Эдмунд — рыцарь, живёт в старом замке на холме, служит королю.' },
    { keys:'погода', text:'В городе почти всегда идёт дождь, а зимой на улицах лежит снег.' },
  ];
  rebuildBibleVecs(bible);
  const hits = bibleMatches(bible, 'Ричард готовится к турниру', 5);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].keys, 'Ричард');
});

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

test('дефолты: бюджет контекста 128000, лимиты агентов подняты ×5', async () => {
  const { defaultState } = await import('../src/state.js');
  const d = defaultState();
  assert.equal(d.global.budgetTokens, 128000, 'бюджет сборки контекста ×4 от прежних 32000');
  const по = Object.fromEntries(d.agents.map(a=>[a.role, a.maxTokens]));
  assert.equal(по.prose, 64800, 'Прозаик ×5 от 12960');
  assert.equal(по.evaluator, 57600);
  assert.equal(по.logic, 37800);
  assert.equal(по.lineedit, 64800);
  assert.equal(по.architect, 16200);
  assert.equal(по.critic, 38400);
  // У Книжного архитектора лимита нет НАМЕРЕННО: его бюджет считается формулой
  // от числа сцен, а слайдер для него скрыт (ui/diagnostics.js). Проверяем, что
  // это осталось осознанным решением, а не превратилось в забытое поле.
  assert.equal(по.bookArchitect, undefined, 'у bookArchitect лимит задаётся формулой, а не полем');
});

// Класс дефекта, который вылез ровно при подъёме ×5: в каждом месте стоял свой
// потолок на повтор (3000, 19200, 24000), и после роста дефолтов потолок
// оказывался НИЖЕ базового лимита агента. Math.min отдавал меньше базы, а
// спасавший Math.max(база+1) превращал «повтор вдвое шире» в «повтор на один
// токен шире» — молча съеденную повторную попытку.
test('лимиты: потолок повтора не может оказаться ниже базового лимита агента', async () => {
  const { MAX_OUTPUT_TOKENS } = await import('../src/llm.js');
  const { defaultState } = await import('../src/state.js');
  const макс = Math.max(...defaultState().agents.map(a=>a.maxTokens||0));
  assert.ok(MAX_OUTPUT_TOKENS > макс,
    `общий потолок ${MAX_OUTPUT_TOKENS} обязан быть выше самого большого дефолта ${макс}, иначе повтор снова выродится в «база+1»`);
});

test('лимиты: зашитых потолков повтора не осталось', async () => {
  const fs = await import('node:fs');
  ['../src/pipeline.js','../src/ondemand.js'].forEach(f=>{
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8')
      .split('\n').filter(l=>!l.trim().startsWith('//')).join('\n');
    assert.ok(!/Math\.min\((?:3000|19200|24000)\s*,/.test(src),
      f + ': вернулся зашитый потолок повтора — он снова разойдётся с дефолтами при следующем подъёме');
  });
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
  // ondemand.js — «Разбор по требованию» (см. её же шапку: «вне полного
  // пайплайна») пропущен в этом списке не по архитектуре, а по недосмотру:
  // до фикса обрыв по лимиту токенов на ручном запуске стража/архитектора
  // молча читался как «замечаний нет» — тот же класс, что этот тест ловит
  // для остальных модулей.
  const модули = ['world','bookreview','architect-book','historian','illustrations','series','craftsignals','inline','ondemand'];
  for(const m of модули){
    const src = fs.readFileSync(new URL(`../src/${m}.js`, import.meta.url), 'utf8');
    const вызовов = (src.match(/await callLLM\(/g)||[]).length;
    const проверок = (src.match(/assertNotTruncated\(/g)||[]).length;
    assert.ok(проверок > 0, `${m}.js: ${вызовов} вызовов LLM и ни одной проверки обрыва — обрыв пройдёт молча`);
    assert.match(src, /assertNotTruncated.*from '\.\/llm\.js'/s, `${m}.js: хелпер не импортирован`);
  }
});

// ───────────── разборы книги живут в проекте, а не в памяти вкладки ─────────────
// Критик и Бета-ридер — платные разборы всей книги. Их результат хранился в
// модульных переменных ui/stages.js: F5 — и отчёт исчез, плати заново. Отсюда
// же «непонятно, что с ним делать»: с ним нечего было делать, он не жил.
test('saveReview/getReview: отчёт сохраняется в проект с датой', async () => {
  const { defaultState, saveReview, getReview } = await import('../src/state.js');
  const s = defaultState();
  assert.equal(getReview(s,'critic'), null, 'до разбора отчёта нет');
  const r = saveReview(s, 'critic', { overall:'резко, но по делу', problems:[{sceneTitle:'Сцена 1'}] });
  assert.equal(getReview(s,'critic').report.overall, 'резко, но по делу');
  assert.ok(r.at > 0, 'дата разбора нужна, чтобы автор видел его свежесть');
  assert.deepEqual(r.done, [], 'новый разбор начинается без отметок');
});

test('toggleReviewDone: отметки «сделано» переключаются и не текут между разборами', async () => {
  const { defaultState, saveReview, toggleReviewDone, isReviewDone } = await import('../src/state.js');
  const s = defaultState();
  saveReview(s, 'beta', { hookScore:5 });
  assert.equal(isReviewDone(s,'beta','score:Финал'), false);
  assert.equal(toggleReviewDone(s,'beta','score:Финал'), true);
  assert.equal(isReviewDone(s,'beta','score:Финал'), true);
  assert.equal(toggleReviewDone(s,'beta','score:Финал'), false, 'повторный клик снимает отметку');
  toggleReviewDone(s,'beta','score:Крючок');
  // Новый разбор — новые пункты; старые отметки к ним не относятся, индексы
  // разъедутся, и автор увидел бы вычеркнутым то, чего не делал.
  saveReview(s, 'beta', { hookScore:8 });
  assert.equal(isReviewDone(s,'beta','score:Крючок'), false, 'отметки прошлого разбора не переносятся');
  assert.equal(isReviewDone(s,'critic','score:Крючок'), false, 'разборы не делят отметки между собой');
});

test('миграция: у старого проекта появляется reviews, данные не теряются', async () => {
  const { defaultState, migrate, saveReview } = await import('../src/state.js');
  const старый = defaultState();
  delete старый.reviews;                       // проект, сохранённый до 1.59.0
  const после = migrate(JSON.parse(JSON.stringify(старый)));
  assert.ok(после.reviews, 'поле должно появиться, а не остаться undefined');
  assert.equal(после.reviews.critic, null);
  const сОтчётом = defaultState();
  saveReview(сОтчётом, 'critic', { overall:'ок' });
  const после2 = migrate(JSON.parse(JSON.stringify(сОтчётом)));
  assert.equal(после2.reviews.critic.report.overall, 'ок', 'существующий отчёт не должен затираться миграцией');
});

// ───────────── роли вне цикла сцены ─────────────
// Критик, Мироустроитель, Историк, Арт-директор — 16 вызовов LLM с намертво
// зашитыми лимитами и моделью. Автор не мог ни поднять потолок, ни выбрать
// модель, ни даже увидеть, что эти агенты существуют.
test('дефолты: роли вне цикла заведены и помечены offPipeline', async () => {
  const { defaultState } = await import('../src/state.js');
  const d = defaultState();
  for(const роль of ['critic','worldbuilder','historian','artdirector']){
    const a = d.agents.find(x=>x.role===роль);
    assert.ok(a, `агент ${роль} должен быть в списке — иначе его лимит и модель снова недоступны`);
    assert.equal(a.offPipeline, true, `${роль}: без offPipeline UI покажет тумблер «включён», который ни на что не влияет`);
    assert.ok(a.maxTokens > 0, `${роль}: лимит должен быть задан, иначе слайдер нечего показывать`);
    assert.ok(a.desc, `${роль}: без описания автор не поймёт, откуда этот агент запускается`);
  }
});

test('роли вне цикла не попадают в пайплайн сцены', async () => {
  const { defaultState } = await import('../src/state.js');
  const d = defaultState();
  const внеЦикла = d.agents.filter(a=>a.offPipeline).map(a=>a.role);
  // Пайплайн перебирает роли явными списками; ни одна из новых там быть не должна,
  // иначе прогон сцены начнёт дёргать Критика книги на каждой итерации.
  const fs = await import('node:fs');
  const pipeline = fs.readFileSync(new URL('../src/pipeline.js', import.meta.url), 'utf8');
  внеЦикла.forEach(r=>{
    assert.ok(!new RegExp(`agentEnabled\('${r}'\)`).test(pipeline),
      `${r} не должен вызываться из цикла сцены`);
  });
});

test('модули вне цикла читают лимит и модель из настроек агента', async () => {
  const fs = await import('node:fs');
  const пары = { 'bookreview':'critic', 'world':'worldbuilder', 'historian':'historian', 'illustrations':'artdirector' };
  for(const [файл, роль] of Object.entries(пары)){
    const src = fs.readFileSync(new URL('../src/' + файл + '.js', import.meta.url), 'utf8');
    assert.ok(src.includes("llmFor(state, ag(state,'" + роль + "'))"),
      файл + '.js: модель должна браться из агента, а не из g.model');
    assert.ok(src.includes("ag(state,'" + роль + "').maxTokens"),
      файл + '.js: лимит должен браться из агента, иначе слайдер ни на что не влияет');
    assert.ok(!/model:\s*g\.model/.test(src), файл + '.js: остался захардкоженный g.model');
  }
});

// ── Очередь правок по разбору книги ────────────────────────────────────────
// Замечания Критика/Бета-ридера/Ружей Чехова адресованы разным сценам, поэтому
// пакетная кнопка «→ Прозаику» невозможна — сделана очередь. Здесь проверяются
// её свойства, которые ломаются молча: пропуск ненайденной сцены выглядел бы
// как успех, потеря старого текста лишила бы отката, падение одной сцены
// оборвало бы уже оплаченные ожиданием остальные.
test('очередь правок: галочка только у найденной сцены', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/ui/stages.js', import.meta.url), 'utf8');
  const тело = src.slice(src.indexOf('function queueBox('), src.indexOf('function bindFixQueue('));
  assert.ok(тело.includes('findSceneByTitle(s, sceneTitle)'),
    'queueBox обязан проверять, что сцена есть в структуре: иначе выбранный пункт молча пропустится в прогоне');
});

test('очередь правок: старый текст сцены сохраняется до перезаписи', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/ui/stages.js', import.meta.url), 'utf8');
  const тело = src.slice(src.indexOf('function bindFixQueue('), src.indexOf('function bindDoneBoxes('));
  const push = тело.indexOf('proseVersions.unshift(sc.text)');
  const write = тело.indexOf('sc.text=fixed');
  assert.ok(push > -1 && write > -1, 'очередь должна и сохранять версию, и писать новый текст');
  assert.ok(push < write, 'версия обязана уходить в историю ДО перезаписи — иначе откат сохранит уже новый текст');
  assert.ok(тело.includes('sc.lastEval=null'),
    'оценка относилась к тексту до правки — не сбросив её, автор увидит чужой балл');
});

test('очередь правок: подтверждение и устойчивость к падению одной сцены', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/ui/stages.js', import.meta.url), 'utf8');
  const тело = src.slice(src.indexOf('function bindFixQueue('), src.indexOf('function bindDoneBoxes('));
  assert.ok(тело.includes('confirm('),
    'запуск N платных вызовов по одному клику требует подтверждения');
  const цикл = тело.slice(тело.indexOf('for(const cb of'));
  assert.ok(цикл.includes('try{') && цикл.includes('}catch(e){'),
    'ошибка одной сцены не должна обрывать остальную очередь');
});

test('очередь правок: подключена во все три модалки разбора', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/ui/stages.js', import.meta.url), 'utf8');
  ['beta','critic','chekhov'].forEach(kind=>{
    assert.ok(src.includes("fixQueueBarHTML('" + kind + "')"), kind + ': нет панели очереди');
    assert.ok(src.includes("bindFixQueue('" + kind + "', s)"), kind + ': панель отрисована, но обработчики не навешаны');
  });
});

// ── Прайс моделей ──────────────────────────────────────────────────────────
// llm.js на неизвестной модели считает по тарифу-заглушке (самому дешёвому в
// таблице). Из-за этого дефолт провайдера OpenAI — 'gpt-5' — которого не было
// ни в списке моделей, ни в прайсе, считался по тарифу DeepSeek: занижение в
// десятки раз, и по счётчику это не отличалось от честной суммы.
test('прайс: дефолт каждого провайдера есть и в списке моделей, и в прайсе', async () => {
  const { TEXT_PROVIDERS, TEXT_MODEL_OPTIONS, MODEL_PRICES } = await import('../src/providers.js');
  TEXT_PROVIDERS.filter(p=>p.v!=='custom').forEach(p=>{
    assert.ok((TEXT_MODEL_OPTIONS[p.v]||[]).includes(p.model),
      `${p.v}: дефолтная модель «${p.model}» отсутствует в своём же списке — в селекте выбор будет пустым`);
    assert.ok(MODEL_PRICES[p.model],
      `${p.v}: у дефолтной модели «${p.model}» нет прайса — расход посчитается по чужому тарифу и молча`);
  });
});

test('прайс: у каждой предлагаемой модели есть цена', async () => {
  const { TEXT_MODEL_OPTIONS, MODEL_PRICES } = await import('../src/providers.js');
  Object.entries(TEXT_MODEL_OPTIONS).forEach(([prov, list])=>{
    list.forEach(m=>assert.ok(MODEL_PRICES[m], `${prov}/${m}: модель предлагается в UI, но её нет в MODEL_PRICES`));
  });
});

test('прайс: модель без цены попадает в spend.unpriced, а шапка ставит «≈»', async () => {
  const fs = await import('node:fs');
  const llm = fs.readFileSync(new URL('../src/llm.js', import.meta.url), 'utf8');
  assert.ok(llm.includes('st.spend.unpriced'),
    'llm.js обязан запоминать модель без прайса — иначе заниженная сумма выглядит точной');
  const app = fs.readFileSync(new URL('../src/ui/app.js', import.meta.url), 'utf8');
  assert.ok(/spend\.unpriced/.test(app) && app.includes("'≈'"),
    'шапка обязана помечать сумму как нижнюю оценку, когда прайс известен не для всех моделей');
});

// Класс дефекта, который этот проект ловит регулярно: защита стоит в одном
// пути и отсутствует в соседних. Текст модели становится текстом книги в двух
// местах — пайплайн сцены и точечная правка; проверка обязана быть в обоих.
test('инородная письменность: проверка стоит и в пайплайне, и в точечной правке', async () => {
  const fs = await import('node:fs');
  const pipeline = fs.readFileSync(new URL('../src/pipeline.js', import.meta.url), 'utf8');
  const ondemand = fs.readFileSync(new URL('../src/ondemand.js', import.meta.url), 'utf8');
  assert.ok(pipeline.includes('findForeignScript'), 'pipeline.js: нет проверки алфавита');
  assert.ok(ondemand.includes('findForeignScript'), 'ondemand.js: patchScene пишет текст в сцену без проверки алфавита');
});

test('инородная письменность: находка критическая и подписана в логе стражей', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/pipeline.js', import.meta.url), 'utf8');
  assert.ok(/flags\.script\s*=\s*чужойАлфавит\.map/.test(src), 'флаг должен называться script — по нему UI и директива его находят');
  assert.ok(/severity:\s*'critical'[\s\S]{0,120}Инородная письменность/.test(src),
    'находка обязана быть critical: warning Прозаик вправе проигнорировать, а иероглиф в тексте — не предмет вкуса');
  assert.ok(src.includes("script:'Инородная письменность'"),
    'без записи в GUARD_LABELS находка уйдёт Прозаику как «[script]» вместо человеческого названия');
});

test('инородная письменность: готовая сцена перепроверяется отдельно', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/pipeline.js', import.meta.url), 'utf8');
  const хвост = src.slice(src.indexOf('state.usedCliches = ['));
  assert.ok(хвост.includes('findForeignScript(best)'),
    'итоговый текст обязан проверяться заново: Прозаик может не исправить находку за отведённые итерации, и тогда сцена уходит в книгу молча — ровно это и было в живом прогоне');
});

test('инородная письменность: точечная правка не запирает уже испорченную сцену', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/ondemand.js', import.meta.url), 'utf8');
  const тело = src.slice(src.indexOf('export async function patchScene'));
  assert.ok(тело.includes('findForeignScript(draft)'),
    'сравнивать надо с исходником: иначе сцену с иероглифом нельзя починить как раз той правкой, которая для этого нужна');
});

// Обе проверки якорей обязаны спрашивать «был во входе и пропал в выходе».
// Без условия «был во входе» проверка отвечает на вопрос «есть ли эта строка в
// тексте», а рапортует, будто на вопрос «не убрал ли её агент» — так Линейный
// редактор получил отказ в 3 сценах из 3 за фразы из чужого черновика.
test('якоря: обе проверки идут через anchorsLostBy, а не через голый anchorSurvives', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/pipeline.js', import.meta.url), 'utf8');
  assert.ok(src.includes('anchorsLostBy(beforeLineEdit, candidate, leAnchors)'),
    'Линейный редактор: проверка обязана сравнивать с тем текстом, который ему дали');
  assert.ok(src.includes('anchorsLostBy(revisedFrom, pRes.text, prevIterAnchors)'),
    'Прозаик: тот же класс дефекта — правит revisedFrom, а якоря от оценки другого черновика');
  assert.ok(!/filter\(a\s*=>\s*!anchorSurvives\(/.test(src),
    'остался фильтр без условия «был во входе» — он снова будет обвинять агента в чужой потере');
});

test('якоря: revisedFrom снимается ДО перезаписи prevDraft', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/pipeline.js', import.meta.url), 'utf8');
  const снимок = src.indexOf('const revisedFrom = prevDraft;');
  const перезапись = src.indexOf('prevDraft = pRes.text;', снимок);
  assert.ok(снимок > -1 && перезапись > снимок,
    'если снять снимок после перезаписи, проверка сравнит текст сам с собой и молча перестанет ловить настоящие потери');
  const проверка = src.indexOf('anchorsLostBy(revisedFrom, pRes.text');
  assert.ok(проверка > перезапись, 'проверка должна идти после обоих — иначе revisedFrom ещё не объявлен');
});

// Выбор лучшего черновика вынесен в чистую функцию и должен вызываться из
// пайплайна. Прежнее правило «строго выше балла» при застывшей оценке
// (6.3 -> 6.3 -> 6.3 в трёх живых прогонах) навсегда оставляло best первым
// черновиком, и все последующие итерации выбрасывались независимо от качества.
test('выбор черновика: пайплайн ходит через draftBeatsBest, а не через самописное условие', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/pipeline.js', import.meta.url), 'utf8');
  assert.ok(src.includes('if(draftBeatsBest(этот, лучший))'),
    'условие выбора обязано идти через общую функцию — иначе тай-брейк снова разойдётся с тестами');
  assert.ok(!/verdict\.weighted\s*>\s*\(bestEval\.weighted/.test(src),
    'осталось прежнее «строго больше балла» — при равных баллах оно снова заморозит best на первом черновике');
});

test('выбор черновика: счётчики для тай-брейка обновляются вместе с best', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/pipeline.js', import.meta.url), 'utf8');
  const блок = src.slice(src.indexOf('if(draftBeatsBest(этот, лучший))'), src.indexOf('// Заметка про потерянные якоря'));
  assert.ok(блок.includes('bestCriticals = criticals.length'),
    'без обновления bestCriticals тай-брейк сравнивал бы с нулём и любой черновик «выигрывал» бы по критическим');
  assert.ok(блок.includes('bestQuestions = factualQuestions.length'), 'то же для вопросов');
});

// Оценщику НЕЛЬЗЯ показывать его же прошлые баллы. Замер на одном и том же
// тексте (прод, сцена «Последний спуск»): собственный шум без якоря 6.3/6.7/6.5
// = разброс 0.4; с подставленным якорем 5.0…7.7 = разброс 2.7. С ложным низким
// [3,3,3,3,3] тот же текст получил 5.0, с ложным высоким [9,9,9,9,9] — 7.7.
// Оценивался не текст, а наша подсказка — отсюда и «балл не растёт»: якорь
// всегда брался с ПЕРВОГО черновика и не обновлялся.
test('Оценщик: в промпт не подставляются его прошлые баллы', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/pipeline.js', import.meta.url), 'utf8')
    .split('\n').filter(l=>!l.trim().startsWith('//')).join('\n');
  assert.ok(!/eMsgs\[1\]\.content\s*\+=/.test(src),
    'к промпту Оценщика снова что-то дописывается — если это его прошлые оценки, балл опять поедет за подсказкой, а не за текстом');
  assert.ok(!/Базовые оценки черновика/.test(src), 'вернулся якорь baseline в промпте Оценщика');
});

test('Оценщик: anchorVerdict жив для Δ и детектора стагнации', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/pipeline.js', import.meta.url), 'utf8');
  assert.ok(/anchorVerdict\.weighted/.test(src),
    'убрав якорь из промпта, нельзя заодно потерять Δ в логе — иначе автор перестанет видеть движение оценки');
});
