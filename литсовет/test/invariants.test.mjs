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
