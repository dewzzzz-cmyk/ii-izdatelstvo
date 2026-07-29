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

// ───────────── промпт мира: связный набор, а не альтернативы ─────────────
// Живой прогон: в одной выдаче про героиню пришли «бессмертная сущность»,
// «шрам от старой травмы», «альтер-эго Тень» и «предотвращает своё убийство» —
// четыре разные книги, и кнопка предлагала сохранить их все разом.
test('worldSuggestMessages: требует одновременной истинности фактов', async () => {
  const { worldSuggestMessages } = await import('../src/world.js');
  const st = { project:{ genre:'мистика', idea:'библиотекарь и книга с пометками' }, bible:[] };
  const m = worldSuggestMessages(st, 'персонажи');
  const sys = m[0].content;
  assert.match(sys, /ОДНОВРЕМЕННО/, 'нет требования одновременной истинности');
  assert.match(sys, /не список альтернатив|альтернатив/, 'не сказано, что это не список вариантов');
});

test('worldSuggestMessages: категория и жанр доходят до промпта', async () => {
  const { worldSuggestMessages } = await import('../src/world.js');
  const st = { project:{ genre:'мистика', idea:'x' }, bible:[] };
  const m = worldSuggestMessages(st, 'география');
  assert.match(m[0].content, /география/);
  assert.match(m[1].content, /мистика/);
});

// ───────────── бюджет и фазы директивы Прозаику ─────────────
// Живой замер сцены «Чужая смерть»: директива третьей итерации весила 9984
// символа против 6297 символов прозы (25 требований на 900 слов), и только
// 14% этого объёма приходилось на замечания Оценщика — то есть на то, за что
// вообще выставляется балл. Оси при этом стояли три итерации подряд.
test('axisOfNote: метка оси читается в обоих написаниях', async () => {
  const { axisOfNote } = await import('../src/agents.js');
  assert.equal(axisOfNote('[Свежесть образа] клише в описании страха'), 'freshness');
  assert.equal(axisOfNote('Свежесть образа: клише в описании страха'), 'freshness');
  assert.equal(axisOfNote('Ритм — имя персонажа три раза подряд'), 'rhythm');
  assert.equal(axisOfNote('[Соответствие брифу] пропала мать героя'), 'brief');
  assert.equal(axisOfNote('Герой — пассивен, ничего не решает'), null, 'не-ось не должна опознаваться');
  assert.equal(axisOfNote(''), null);
});

test('buildUnifiedDirective: бюджет соблюдён, приоритет — низшим осям', async () => {
  const { buildUnifiedDirective } = await import('../src/pipeline.js');
  const verdict = {
    anchors: [],
    scores: { freshness:4, rhythm:5, concrete:5, voice:8, pace:8, brief:9 },
    // Восемь замечаний при квоте 6 — два должны отсеяться, и отсеяться должны
    // именно те, что относятся к самым благополучным осям.
    notes: [
      '[Соответствие брифу] мелочь-бриф',
      '[Голос] мелочь-голос',
      '[Темп] мелочь-темп',
      '[Свежесть образа] главная проблема — тут балл 4',
      '[Ритм] вторая по важности',
      '[Конкретность] третья по важности',
      '[Свежесть образа] вторая проблема той же провальной оси',
      '[Ритм] вторая проблема ритма',
    ],
  };
  const отложено = [];
  const d = buildUnifiedDirective(verdict, [], [], [], [], false,
    { phase:'prose', scores:verdict.scores, onDefer:l=>отложено.push(...l) });
  const pos = s => d.indexOf(s);
  assert.ok(pos('главная проблема') >= 0, 'замечание по самой низкой оси должно попасть в директиву');
  assert.ok(pos('главная проблема') < pos('мелочь-голос'),
    'ось с баллом 4 должна идти раньше оси с баллом 8');
  assert.ok(!d.includes('мелочь-бриф'), 'ось с баллом 9 должна отсеяться первой');
  assert.ok(!d.includes('мелочь-темп'), 'вторая ось с баллом 8 должна отсеяться следом');
  assert.deepEqual(отложено, ['2 замеч. Оценщика'], 'автор должен узнать, сколько отложено');
});

test('buildUnifiedDirective: фаза прозы откладывает замечания Стражей', async () => {
  const { buildUnifiedDirective } = await import('../src/pipeline.js');
  const verdict = { anchors: [], scores:{ freshness:4 }, notes:['[Свежесть образа] клише'] };
  const factual = ['[Логика] откуда часы в кармане'];
  const literary = ['[Диалог] реплики взаимозаменяемы'];
  const отложено = [];
  const prose = buildUnifiedDirective(verdict, [], [], factual, literary, false,
    { phase:'prose', scores:verdict.scores, onDefer:l=>отложено.push(...l) });
  assert.ok(!prose.includes('откуда часы'), 'вопрос Стража не должен идти в фазе прозы');
  assert.ok(!prose.includes('взаимозаменяемы'), 'совет лит. стража не должен идти в фазе прозы');
  assert.ok(prose.includes('клише'), 'замечание Оценщика должно остаться');
  assert.equal(отложено.length, 2, 'об отложенном должен узнать автор');

  const guards = buildUnifiedDirective(verdict, [], [], factual, literary, false,
    { phase:'guards', scores:verdict.scores });
  assert.ok(guards.includes('откуда часы'), 'в фазе стражей вопрос должен появиться');
  assert.ok(guards.includes('взаимозаменяемы'), 'в фазе стражей совет должен появиться');
});

test('buildUnifiedDirective: критические замечания идут в обеих фазах', async () => {
  const { buildUnifiedDirective } = await import('../src/pipeline.js');
  const verdict = { anchors: [], scores:{}, notes:[] };
  const crit = ['[Логика] герой знает то, чего знать не может'];
  for(const phase of ['prose','guards']){
    const d = buildUnifiedDirective(verdict, [], crit, [], [], false, { phase });
    assert.ok(d.includes('знать не может'), `критическое замечание пропало в фазе ${phase}`);
  }
});

test('buildUnifiedDirective: клише — урезанный список плюс запрет на класс', async () => {
  const { buildUnifiedDirective } = await import('../src/pipeline.js');
  const verdict = { anchors: [], scores:{}, notes:[] };
  const banned = Array.from({length:40}, (_,i)=>`клише${i}`);
  const d = buildUnifiedDirective(verdict, banned, [], [], [], false, { phase:'prose' });
  assert.ok(!d.includes('клише0'), 'старые клише не должны тащиться целиком');
  assert.ok(d.includes('клише39'), 'последние клише должны остаться');
  assert.match(d, /последние 12 из 40/, 'автор должен видеть, что список урезан');
  assert.match(d, /НЕ синоним/, 'нет запрета на замену синонимом — клише вернутся другими словами');
});

// ───────────── ось без эталона не должна давать балл ─────────────
// Живой случай книги «Поля для заметок»: state.voice.examples пуст, блок
// «Образец голоса автора» в промпте исчезает — а ось «Голос» остаётся в схеме,
// и модель ставила по ней 7, 7, 6, 7 на четырёх сценах подряд. Сравнивать было
// не с чем: это заполнение поля, а не оценка, и при весе 1 из 7 оно тянуло
// вверх ~16% итогового балла.
test('parseEvaluator: skipAxes убирает ось из scores, weighted и minAxis', async () => {
  const { parseEvaluator } = await import('../src/agents.js');
  const raw = JSON.stringify({ scores:{ freshness:5, rhythm:5, concrete:6, voice:7, pace:6, brief:8 }, notes:[] });

  const полный = parseEvaluator(raw, 7.5);
  assert.equal(полный.scores.voice, 7);
  assert.equal(полный.weighted, 6.4, '(5+5+6+7+6+8*2)/7 = 6.43');

  const безГолоса = parseEvaluator(raw, 7.5, { skipAxes:['voice'] });
  assert.equal(безГолоса.scores.voice, undefined, 'ось не должна попасть в scores — UI покажет «—»');
  assert.equal(безГолоса.weighted, 6.3, '(5+5+6+6+8*2)/6 = 6.33 — без выдуманной оси');
  assert.equal(безГолоса.minAxis, 5, 'minAxis считается по оставшимся осям');
});

test('parseEvaluator: пустой skipAxes и пропуск всех осей не ломают балл', async () => {
  const { parseEvaluator, RUBRIC_AXES } = await import('../src/agents.js');
  const raw = JSON.stringify({ scores:{ freshness:5, rhythm:5, concrete:6, voice:7, pace:6, brief:8 }, notes:[] });
  assert.equal(parseEvaluator(raw, 7.5, { skipAxes:[] }).weighted, 6.4, 'пустой список — как раньше');
  const все = parseEvaluator(raw, 7.5, { skipAxes: RUBRIC_AXES.map(a=>a.key) });
  assert.equal(все.weighted, 6.4, 'пропустить ВСЕ оси нельзя — страховка возвращает полную рубрику');
  assert.ok(Number.isFinite(все.weighted), 'балл не должен стать NaN');
});

test('evaluatorMessages: без образцов голоса прямо сказано, что ось не оценивается', async () => {
  const { evaluatorMessages } = await import('../src/agents.js');
  const scene = { title:'Тест', brief:'бриф' };
  const без = evaluatorMessages(scene, 'текст черновика достаточной длины для проверки', [], '', []);
  assert.match(без[1].content, /ОБРАЗЦОВ ГОЛОСА АВТОРА НЕТ/, 'модель должна знать, что эталона нет');
  assert.match(без[1].content, /НЕ ОЦЕНИВАЕТСЯ/);
  const с = evaluatorMessages(scene, 'текст черновика достаточной длины для проверки', ['образец прозы автора'], '', []);
  assert.match(с[1].content, /Образец голоса автора/);
  assert.ok(!/ОБРАЗЦОВ ГОЛОСА АВТОРА НЕТ/.test(с[1].content), 'с образцами предупреждения быть не должно');
});

// ── Инородная письменность ─────────────────────────────────────────────────
// Живой прогон: DeepSeek выдал «За十年的 работы» во втором предложении сцены, и
// это пережило три черновика, 126 замечаний Стражей, Оценщика и Линейного
// редактора — ни одна проверка не смотрела на алфавит.
test('findForeignScript: ловит реальный инцидент и показывает слово целиком', async () => {
  const { findForeignScript } = await import('../src/llm.js');
  const r = findForeignScript('Тяжесть грузов легла на плечи. За十年的 работы он мог на ощупь.');
  assert.equal(r.length, 1, 'иероглифы обязаны быть найдены');
  assert.equal(r[0].quote, 'За十年的', 'показываем слово целиком — одинокий символ автору ничего не говорит');
});

test('findForeignScript: латиница и пунктуация — не находка', async () => {
  const { findForeignScript } = await import('../src/llm.js');
  // Имена, названия судов и эпиграфы на европейских языках в русской книге
  // легитимны: ложное срабатывание тут дороже пропуска.
  ['Судно «Sturm und Drang» ушло в 1927 году.',
   'Он сказал: — Nihil novi... и замолчал — 25 % пути.',
   'Обычный русский текст без всякой экзотики.'].forEach(t=>{
    assert.deepEqual(findForeignScript(t), [], 'ложное срабатывание на: ' + t);
  });
});

test('findForeignScript: японский, корейский, иврит, арабский', async () => {
  const { findForeignScript } = await import('../src/llm.js');
  ['он сказал アニメ тихо', 'слово 한국어 внутри', 'фраза שלום здесь', 'текст مرحبا тут']
    .forEach(t=>assert.ok(findForeignScript(t).length, 'не поймано: ' + t));
});

test('findForeignScript: пустой и нестроковый вход не роняют проверку', async () => {
  const { findForeignScript } = await import('../src/llm.js');
  [null, undefined, '', 0].forEach(v=>assert.deepEqual(findForeignScript(v), []));
});

// ── Якоря Линейного редактора ──────────────────────────────────────────────
// Живой прогон: правка редактора отклонена в 3 сценах из 3 с сообщением «потерял
// закреплённый якорь». Корень — не редактор: best обновляется только при СТРОГОМ
// росте оценки, а prevIterAnchors перезаписывается каждой итерацией. При
// застывшей оценке best остаётся черновиком 1, а якоря приходят из черновика 3 —
// это цитаты из текста, которого редактор в глаза не видел.
test('anchorsLostBy: якорь, которого не было во входе, не считается потерянным', async () => {
  const { anchorsLostBy } = await import('../src/pipeline.js');
  const до = 'Он провёл большим пальцем по холодному металлу и потянул за ремень.';
  // Редактор не изменил РОВНО НИЧЕГО — потерять при этом нельзя ничего.
  assert.deepEqual(anchorsLostBy(до, до, ['Большой палец нашарил у левого виска глубокую зазубрину']), [],
    'якорь из чужого черновика не должен обвинять редактора');
});

test('anchorsLostBy: якорь, который был и пропал, — настоящая потеря', async () => {
  const { anchorsLostBy } = await import('../src/pipeline.js');
  const до = 'Слишком аккуратный. Слишком новый. На «Смелом» такого быть не должно.';
  const после = 'Ящик выглядел неуместно новым.';
  assert.deepEqual(anchorsLostBy(до, после, ['Слишком аккуратный. Слишком новый.']),
    ['Слишком аккуратный. Слишком новый.'], 'настоящая потеря обязана ловиться по-прежнему');
});

test('anchorsLostBy: нормализация кавычек и регистра не создаёт ложных потерь', async () => {
  const { anchorsLostBy } = await import('../src/pipeline.js');
  const до = 'На «Смелом» не должно было быть такого.';
  const после = 'На "Смелом"  не  должно было быть такого.';
  assert.deepEqual(anchorsLostBy(до, после, ['на «смелом» не должно было быть такого']), []);
});

test('anchorsLostBy: пустой список якорей и пустые строки не роняют проверку', async () => {
  const { anchorsLostBy } = await import('../src/pipeline.js');
  assert.deepEqual(anchorsLostBy('текст', 'текст', []), []);
  assert.deepEqual(anchorsLostBy('текст', 'текст', ['', null, undefined]), []);
});

// ── Выбор лучшего черновика ────────────────────────────────────────────────
// Живые прогоны: балл стоит намертво (6.3 → 6.3 → 6.3), а правило требует
// СТРОГО большего балла — значит best навсегда остаётся черновиком 1, и все
// последующие итерации выбрасываются, чем бы они ни были лучше. Данные сцены
// «Последний спуск»: ит.1 = 6.3/1 крит./4 вопр., ит.2 = 6.3/1/1, ит.3 = 6.3/3/0.
// По меркам самой системы лучший — второй, а выигрывал первый.
const чрн = (o={}) => ({ literaryChecked:false, clean:false, scored:true,
  weighted:6.3, criticals:1, questions:0, ...o });

test('draftBeatsBest: первый черновик берётся всегда', async () => {
  const { draftBeatsBest } = await import('../src/pipeline.js');
  assert.equal(draftBeatsBest(чрн(), null), true);
});

test('draftBeatsBest: литературно проверенный бьёт непроверенного даже с худшим баллом', async () => {
  const { draftBeatsBest } = await import('../src/pipeline.js');
  assert.equal(draftBeatsBest(чрн({literaryChecked:true, weighted:5.0}), чрн({weighted:8.0})), true);
});

test('draftBeatsBest: чистый бьёт нечистого при равной проверенности', async () => {
  const { draftBeatsBest } = await import('../src/pipeline.js');
  assert.equal(draftBeatsBest(чрн({clean:true}), чрн({clean:false})), true);
});

test('draftBeatsBest: строго больший балл по-прежнему выигрывает', async () => {
  const { draftBeatsBest } = await import('../src/pipeline.js');
  assert.equal(draftBeatsBest(чрн({weighted:6.8}), чрн({weighted:6.3})), true);
  assert.equal(draftBeatsBest(чрн({weighted:6.0}), чрн({weighted:6.3})), false);
});

test('draftBeatsBest: равный балл — выигрывает тот, у кого меньше критических', async () => {
  const { draftBeatsBest } = await import('../src/pipeline.js');
  assert.equal(draftBeatsBest(чрн({criticals:1}), чрн({criticals:3})), true, 'меньше критических — лучше');
  assert.equal(draftBeatsBest(чрн({criticals:3}), чрн({criticals:1})), false, 'ит.3 (3 крит.) не должна побеждать ит.2 (1 крит.)');
});

test('draftBeatsBest: равный балл и критические — выигрывает тот, у кого меньше вопросов', async () => {
  const { draftBeatsBest } = await import('../src/pipeline.js');
  // Ровно случай из прогона: ит.2 (6.3/1/1) против ит.1 (6.3/1/4).
  assert.equal(draftBeatsBest(чрн({criticals:1, questions:1}), чрн({criticals:1, questions:4})), true);
});

test('draftBeatsBest: при полном равенстве остаётся РАННИЙ черновик', async () => {
  const { draftBeatsBest } = await import('../src/pipeline.js');
  assert.equal(draftBeatsBest(чрн(), чрн()), false, 'без выигрыша не меняем — иначе поздние итерации вытесняют равные ранние');
});

test('draftBeatsBest: меньше критических НЕ спасает при худшем балле', async () => {
  const { draftBeatsBest } = await import('../src/pipeline.js');
  assert.equal(draftBeatsBest(чрн({weighted:5.0, criticals:0}), чрн({weighted:6.3, criticals:5})), false);
});

test('draftBeatsBest: без Оценщика сохраняется прежнее правило «побеждает последний»', async () => {
  const { draftBeatsBest } = await import('../src/pipeline.js');
  // Балла не существует — сравнивать нечем. Менять это поведение заодно с
  // тай-брейком было бы тихой подменой логики там, где её не просили менять.
  assert.equal(draftBeatsBest(чрн({noScore:true, scored:false}), чрн({noScore:true, scored:false})), true);
  // Но приоритеты выше балла продолжают работать и без Оценщика.
  assert.equal(draftBeatsBest(чрн({noScore:true, clean:false}), чрн({noScore:true, clean:true})), false);
});

test('draftBeatsBest: неразобранная оценка не побеждает разобранную', async () => {
  const { draftBeatsBest } = await import('../src/pipeline.js');
  assert.equal(draftBeatsBest(чрн({scored:false}), чрн({scored:true, weighted:6.3})), false);
});

// Порог «баллы различаются» обязан стоять ВЫШЕ собственного шума Оценщика.
// Замер: 6.3 / 6.7 / 6.5 на одном тексте = разброс 0.4. Пока в промпт
// подставлялся якорь с прошлыми баллами, оценка держалась искусственно
// неподвижной и порог 0.05 был безопасен. Якорь убран — шум вернулся.
test('draftBeatsBest: разница в пределах шума Оценщика не считается улучшением', async () => {
  const { draftBeatsBest, EVAL_NOISE } = await import('../src/pipeline.js');
  assert.ok(EVAL_NOISE >= 0.4, 'порог ниже измеренного шума 0.4 — подбрасывание монеты будет принято за рост');
  // 6.6 против 6.3 — это шум, а не улучшение: решать должны критические находки.
  assert.equal(draftBeatsBest(чрн({weighted:6.6, criticals:3}), чрн({weighted:6.3, criticals:1})), false,
    'черновик с ХУДШИМИ критическими не должен выигрывать на шумовой разнице балла');
  assert.equal(draftBeatsBest(чрн({weighted:6.6, criticals:0}), чрн({weighted:6.3, criticals:2})), true,
    'при шумовой разнице балла решают критические — здесь их меньше');
});

test('draftBeatsBest: рост выше шума по-прежнему решает сам', async () => {
  const { draftBeatsBest } = await import('../src/pipeline.js');
  assert.equal(draftBeatsBest(чрн({weighted:7.5, criticals:3}), чрн({weighted:6.3, criticals:0})), true,
    'разница 1.2 — настоящий рост, он важнее счёта критических');
});
