// Суммаризатор — сжатие завершённого после одобрения (спека 7).
// Сцена → ~60 слов + обновления состояний персонажей.
// Глава → ~200 слов + новые факты в Bible.
// Книга → ~300 слов.
// Промпты + парсеры; вызовы — в memory.js / pipeline.js.

import { extractJSON } from './llm.js';

export function sceneSummaryMessages(scene, sceneText, knownNames){
  const sys = 'Ты — архивариус. Сжимаешь сцену в краткую сводку для памяти книги. Пиши плотно, только факты и сдвиги состояния.';
  const namesNote = knownNames && knownNames.length
    ? `УЖЕ ИЗВЕСТНЫЕ ПЕРСОНАЖИ (используй ТОЧНО эти формы имени, если пишешь про них — не сокращай и не меняй форму, иначе один человек разделится на две разные карточки): ${knownNames.join(', ')}.`
    : '';
  const user = [
    'Бриф сцены: ' + (scene.brief || scene.title || ''),
    namesNote,
    '',
    'ТЕКСТ СЦЕНЫ:',
    sceneText,
    '',
    'Верни JSON: { "summary": "сводка сцены, до 60 слов — что произошло, что изменилось", "characters": [{"name":"имя","state":"состояние/знание персонажа на конец сцены"}], "facts": [{"keys":"ключи через запятую","text":"новый канонический факт о мире/персонаже"}] }',
    'summary — сухо и по делу. characters — только те, чьё состояние реально изменилось. facts — только действительно новые факты (0-3).',
    'Только JSON.',
  ].filter(Boolean).join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

export function parseSceneSummary(text){
  const j = extractJSON(text);
  if(!j) return null;
  return {
    summary: typeof j.summary==='string' ? j.summary.trim() : '',
    characters: Array.isArray(j.characters) ? j.characters.filter(c=>c&&c.name) : [],
    facts: Array.isArray(j.facts) ? j.facts.filter(f=>f&&f.text) : [],
  };
}

export function chapterSummaryMessages(chapterTitle, sceneSummaries){
  const sys = 'Ты — архивариус. Сжимаешь главу в сводку для долгой памяти книги.';
  const user = [
    'Глава: ' + (chapterTitle||''),
    '',
    'Сводки сцен главы:',
    sceneSummaries.map((s,i)=>`${i+1}. ${s}`).join('\n'),
    '',
    'Верни JSON: { "summary": "сводка главы, до 200 слов — ключевые события и сдвиги" }',
    'Только JSON.',
  ].join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

export function bookSummaryMessages(bookTitle, chapterSummaries){
  const sys = 'Ты — архивариус. Сжимаешь книгу в сводку для памяти серии.';
  const user = [
    'Книга: ' + (bookTitle||''),
    '',
    'Сводки глав:',
    chapterSummaries.map((s,i)=>`${i+1}. ${s}`).join('\n'),
    '',
    'Верни JSON: { "summary": "сводка книги, до 300 слов — сюжетная дуга, судьбы персонажей, итоги" }',
    'Только JSON.',
  ].join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

export function parseSummary(text){
  const j = extractJSON(text);
  return j && typeof j.summary==='string' ? j.summary.trim() : '';
}
