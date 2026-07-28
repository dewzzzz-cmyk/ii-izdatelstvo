// Разборщики ответов модели — единственный слой, где поведение полностью
// детерминировано (на вход строка, на выход объект или null), и при этом
// именно он копит баги: неудача возвращается как null, а вызывающий трактует
// её как успех. Все случаи ниже — не выдуманные, а те формы ответа, на
// которых пайплайн ломался в проде (см. CHANGELOG 1.38–1.46).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractJSON } from '../src/llm.js';
import { looksTokenTruncated, parseDebateRevision } from '../src/guards.js';
import { parseSceneSummary } from '../src/summarizer.js';

// ─────────────────────────── extractJSON ───────────────────────────
test('extractJSON: чистый JSON', () => {
  assert.deepEqual(extractJSON('{"a":1}'), { a: 1 });
});

test('extractJSON: в ```json-заборе', () => {
  assert.deepEqual(extractJSON('Вот ответ:\n```json\n{"a":1}\n```\nГотово.'), { a: 1 });
});

test('extractJSON: в заборе без указания языка', () => {
  assert.deepEqual(extractJSON('```\n{"a":1}\n```'), { a: 1 });
});

test('extractJSON: JSON с болтовнёй до и после', () => {
  assert.deepEqual(extractJSON('Конечно! {"a":1} Надеюсь, помог.'), { a: 1 });
});

test('extractJSON: вложенные объекты', () => {
  assert.deepEqual(extractJSON('шум {"a":{"b":[1,2]}} шум'), { a: { b: [1, 2] } });
});

test('extractJSON: мусор → null, а не исключение', () => {
  assert.equal(extractJSON('никакого джейсона тут нет'), null);
  assert.equal(extractJSON(''), null);
  assert.equal(extractJSON(null), null);
});

test('extractJSON: обрезанный по токенам JSON → null', () => {
  assert.equal(extractJSON('{"summary":"Даня приходит в себя на пол'), null);
});

// Живой случай этой сессии: модель вернула валидный JSON, а следом — прозу,
// в которой есть фигурные скобки. Жадный /\{[\s\S]*\}/ захватывает всё до
// ПОСЛЕДНЕЙ скобки, и разбор валится на тексте, который начинался корректно.
test('extractJSON: валидный JSON, а следом проза со скобками', () => {
  const ответ = '{"summary":"ок"}\n\nПояснение: шаблон {название} подставляется автоматически.';
  assert.deepEqual(extractJSON(ответ), { summary: 'ок' });
});

// ────────────────────── looksTokenTruncated ──────────────────────
test('looksTokenTruncated: законченная фраза — не обрезана', () => {
  assert.equal(looksTokenTruncated('Он ушёл.'), false);
  assert.equal(looksTokenTruncated('— Спасибо, — сказал Даня и ускорил шаг.'), false);
  assert.equal(looksTokenTruncated('Он крикнул!'), false);
  assert.equal(looksTokenTruncated('Кто там?'), false);
});

test('looksTokenTruncated: закрывающая кавычка/скобка — не обрезана', () => {
  assert.equal(looksTokenTruncated('Он сказал: «пора».'), false);
  assert.equal(looksTokenTruncated('Она молчала (как всегда)'), false);
  assert.equal(looksTokenTruncated('Он прошептал: «пора»'), false);
});

test('looksTokenTruncated: обрыв на полуслове — обрезана', () => {
  assert.equal(looksTokenTruncated('Даня взял бланк и'), true);
  assert.equal(looksTokenTruncated('Очки показали уров'), true);
});

test('looksTokenTruncated: пустой текст не считается обрезанным', () => {
  assert.equal(looksTokenTruncated(''), false);
  assert.equal(looksTokenTruncated('   '), false);
  assert.equal(looksTokenTruncated(null), false);
});

test('looksTokenTruncated: многоточие — законченная мысль', () => {
  assert.equal(looksTokenTruncated('Он не договорил…'), false);
});

// ───────────────────── parseDebateRevision ─────────────────────
test('parseDebateRevision: канонический формат', () => {
  const r = parseDebateRevision('[РАЗБОР]\nвсё учёл\n[ТЕКСТ]\nДаня вошёл в зал и остановился у стойки, разглядывая очередь, которая тянулась до самых дверей.');
  assert.equal(r.prose, 'Даня вошёл в зал и остановился у стойки, разглядывая очередь, которая тянулась до самых дверей.');
  assert.equal(r.truncated, undefined);
  assert.match(r.debate, /всё учёл/);
});

// Модель регулярно отклоняется от буквального формата — markdown-обвязка,
// двоеточие, отсутствие переноса. Раньше ЛЮБОЕ из этих отклонений давало
// ложное «обрезан токенами» с откатом к прежнему черновику.
test('parseDebateRevision: markdown-обвязка тега', () => {
  const r = parseDebateRevision('**[РАЗБОР]**\nучёл\n**[ТЕКСТ]**\nДаня вошёл в зал и остановился у стойки, разглядывая очередь, которая тянулась до самых дверей.');
  assert.equal(r.prose, 'Даня вошёл в зал и остановился у стойки, разглядывая очередь, которая тянулась до самых дверей.');
  assert.notEqual(r.truncated, true);
});

test('parseDebateRevision: двоеточие после тега и пробелы внутри скобок', () => {
  const r = parseDebateRevision('[ РАЗБОР ]\nучёл\n[ ТЕКСТ ]: Даня вошёл в зал и остановился у стойки, разглядывая очередь, которая тянулась до самых дверей.');
  assert.equal(r.prose, 'Даня вошёл в зал и остановился у стойки, разглядывая очередь, которая тянулась до самых дверей.');
  assert.notEqual(r.truncated, true);
});

test('parseDebateRevision: обрыв внутри РАЗБОРа — truncated, проза не выдумывается', () => {
  const r = parseDebateRevision('[РАЗБОР]\nзамечание 1 — учёл, замечание 2 — час');
  assert.equal(r.truncated, true);
  assert.equal(r.prose, null);
});

test('parseDebateRevision: тег ТЕКСТ есть, но за ним обрыв — тоже truncated', () => {
  const r = parseDebateRevision('[РАЗБОР]\nучёл\n[ТЕКСТ]\nДаня в');
  assert.equal(r.truncated, true);
  assert.equal(r.prose, null);
});

test('parseDebateRevision: без тегов — весь ответ считается прозой', () => {
  const r = parseDebateRevision('Даня вошёл в зал и остановился у стойки, разглядывая очередь, которая тянулась до самых дверей.');
  assert.equal(r.prose, 'Даня вошёл в зал и остановился у стойки, разглядывая очередь, которая тянулась до самых дверей.');
  assert.equal(r.debate, '');
});

test('parseDebateRevision: артефакт хирургической правки «.,» вычищается', () => {
  const r = parseDebateRevision('[РАЗБОР]\nучёл\n[ТЕКСТ]\nОн замолчал., но не ушёл, потому что дверь за спиной уже закрылась наглухо.');
  assert.equal(r.prose, 'Он замолчал, но не ушёл, потому что дверь за спиной уже закрылась наглухо.');
});

// Отказы Прозаика. Ключевое: цитата может сама содержать цитату (модель
// цитирует фрагмент с прямой речью) — на трёх уровнях вложенности прежний
// регэксп терял пункт целиком, молча.
test('parseDebateRevision: отказ с простой цитатой', () => {
  const r = parseDebateRevision('[РАЗБОР]\n«Реплика в лоб» → ОТКЛОНЕНО: приём\n[ТЕКСТ]\nДаня вошёл в зал и остановился у стойки, разглядывая очередь, которая тянулась до самых дверей.');
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0].quote, 'Реплика в лоб');
  assert.equal(r.rejected[0].reason, 'приём');
});

test('parseDebateRevision: отказ с вложенной цитатой в три уровня', () => {
  const текст = '[РАЗБОР]\n«Страж пишет «герой сказал «пора»» — в лоб» → ОТКЛОНЕНО: осознанный приём\n[ТЕКСТ]\nДаня вошёл в зал и остановился у стойки, разглядывая очередь, которая тянулась до самых дверей.';
  const r = parseDebateRevision(текст);
  assert.equal(r.rejected.length, 1);
  assert.match(r.rejected[0].quote, /пора/);
});

test('parseDebateRevision: несколько отказов подряд', () => {
  const текст = '[РАЗБОР]\n«первое» → ОТКЛОНЕНО: причина 1\n«второе» → ОТКЛОНЕНО: причина 2\n[ТЕКСТ]\nДаня вошёл в зал и остановился у стойки, разглядывая очередь, которая тянулась до самых дверей.';
  const r = parseDebateRevision(текст);
  assert.equal(r.rejected.length, 2);
  assert.equal(r.rejected[1].reason, 'причина 2');
});

test('parseDebateRevision: маркер без цитаты не роняет разбор', () => {
  const r = parseDebateRevision('[РАЗБОР]\n→ ОТКЛОНЕНО: без цитаты\n[ТЕКСТ]\nДаня вошёл в зал и остановился у стойки, разглядывая очередь, которая тянулась до самых дверей.');
  assert.equal(r.rejected.length, 0);
  assert.equal(r.prose, 'Даня вошёл в зал и остановился у стойки, разглядывая очередь, которая тянулась до самых дверей.');
});

// ─────────────────────── parseSceneSummary ───────────────────────
test('parseSceneSummary: полный ответ', () => {
  const s = parseSceneSummary('{"summary":"Даня пришёл в Гильдию.","characters":[{"name":"Даня"}],"facts":[{"text":"Гильдия работает по формам"}]}');
  assert.equal(s.summary, 'Даня пришёл в Гильдию.');
  assert.equal(s.characters.length, 1);
  assert.equal(s.facts.length, 1);
});

test('parseSceneSummary: мусор → null (вызывающий обязан это проверить)', () => {
  assert.equal(parseSceneSummary('извините, не могу'), null);
});

test('parseSceneSummary: безымянные персонажи и пустые факты отсеиваются', () => {
  const s = parseSceneSummary('{"summary":"x","characters":[{"name":"Даня"},{"state":"без имени"}],"facts":[{"text":"ок"},{"text":""}]}');
  assert.equal(s.characters.length, 1);
  assert.equal(s.facts.length, 1);
});

test('parseSceneSummary: отсутствующие поля не роняют разбор', () => {
  const s = parseSceneSummary('{"summary":"только сводка"}');
  assert.deepEqual(s.characters, []);
  assert.deepEqual(s.facts, []);
});
