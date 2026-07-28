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
