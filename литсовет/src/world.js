// Агент «Мир» — проактивный worldbuilding до Структуры (в отличие от
// «архивариуса», который вытаскивает факты РЕАКТИВНО из уже написанного
// текста, см. summarizer.js/series.js). Одобренные факты пишутся в обычную
// Библию (state.bible[]) с source:'world' — переиспользует существующую
// TF-IDF-систему канона, отдельного хранилища нет (спека §4).

import { callLLM, extractJSON } from './llm.js';
import { generateImage } from './imagegen.js';

// Жанры с придуманным сеттингом — авто-включают project.useWorld (см.
// ui/stages.js renderConcept) и добавляют категорию магии/технологии/системы.
// «альтернативн» — намеренно короче полного слова, матчит и «альтернативная
// история», и падежные формы; не пересекается по подстроке с «исторический
// роман» (проверено в Task 1).
export const WORLD_GENRES = ['фэнтези', 'фантастика', 'ромфант', 'литрпг', 'мистика', 'ужасы', 'альтернативн'];

export function genreWantsWorld(genre){
  const g = (genre||'').toLowerCase();
  return WORLD_GENRES.some(w=>g.includes(w));
}

const BASE_CATEGORIES = ['география', 'история', 'фракции', 'культура'];

// Genre-aware набор категорий (спека §5.2) — детерминированный список на
// стороне кода, не свободная генерация набора самим агентом.
export function categoriesFor(genre){
  const g = (genre||'').toLowerCase();
  const cats = [...BASE_CATEGORIES];
  if(g.includes('литрпг')){
    cats.splice(1, 0, 'система');
  } else if(genreWantsWorld(g)){
    cats.splice(1, 0, 'магия/технология');
  }
  return cats;
}

const CATEGORY_HINTS = {
  'география': 'места действия, расстояния, климат, что где находится',
  'история': 'ключевые прошлые события, формирующие настоящее',
  'магия/технология': 'как это работает — и ЯВНО, что оно НЕ может делать / чего стоит (ограничения не менее важны, чем возможности: без них автор потом придумывает deus ex machina, а стражи не могут это поймать, т.к. в каноне нет отрицательных фактов)',
  'система': 'правила прогрессии — уровни, статы, классы, есть ли пермасмерть',
  'фракции': 'силы в конфликте, их цели',
  'культура': 'повседневность, соц. нормы, статус/обращение, религия/мировоззрение — не только быт (еда/одежда)',
};

// Альт-история требует явной точки развилки в категории «история» — не
// хардблок (см. missingPOD ниже), но агент должен явно про это знать.
function altHistoryNote(genre){
  const g = (genre||'').toLowerCase();
  if(!g.includes('альтернативн')) return '';
  return 'ЭТОТ ЖАНР ТРЕБУЕТ явной точки развилки в категории «история»: конкретное историческое событие + год + что пошло иначе + 2-3 конкретных следствия (технологические/политические/культурные), логически из неё вытекающих. Без точки развилки жанр не работает — обязательно включи такой факт.';
}

export function worldSuggestMessages(state, hints={}){
  const p = state.project;
  const cats = categoriesFor(p.genre);
  const sys = [
    'Ты — соавтор по мироустройству (worldbuilding). Ты предлагаешь конкретные факты мира книги — НЕ пишешь прозу и не строишь сюжет.',
    'Каждый факт — конкретное, проверяемое утверждение (не «в этом мире есть магия», а «боевая магия истощает год жизни за каждое применение») — расплывчатые факты хуже работают с системой поиска канона и не помогают стражам ловить противоречия.',
    `Категории и что в них важно:\n${cats.map(c=>`— ${c}: ${CATEGORY_HINTS[c]||''}`).join('\n')}`,
    altHistoryNote(p.genre),
  ].filter(Boolean).join('\n');
  const user = [
    `Жанр: ${p.genre||'роман'}${p.subgenre?', '+p.subgenre:''}.`,
    p.era ? `Эпоха: ${p.era}.` : '',
    (p.synopsis||p.idea) ? `Синопсис: ${p.synopsis||p.idea}` : '',
    hints.ideaSeed ? `Идея мира от автора: ${hints.ideaSeed}` : '',
    hints.limitation ? `Что герой не может получить/сделать без магии/технологии: ${hints.limitation}` : '',
    hints.antagonistFaction ? `Фракция/сила, антагонистичная герою: ${hints.antagonistFaction}` : '',
    '',
    `Предложи 8-15 фактов мира, распределённых по категориям: ${cats.join(', ')}.`,
    'Верни JSON: { "facts": [ { "category": "одна из категорий выше", "keys": "2-4 ключевых слова через запятую", "text": "сам факт, 1-2 предложения" } ] }',
    'Только JSON.',
  ].filter(Boolean).join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

export async function suggestWorldFacts(state, hints={}){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ текстовой модели (⚙).');
  const msgs = worldSuggestMessages(state, hints);
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.8, messages:msgs, maxTokens:1800, retries:g.retries });
  const j = extractJSON(res.text);
  const arr = j && Array.isArray(j.facts) ? j.facts : null;
  if(!arr) throw new Error('Не удалось разобрать ответ агента «Мир».');
  const cats = categoriesFor(state.project.genre);
  return arr.slice(0, 20).map((f,i)=>({
    id: 'wf_'+Date.now().toString(36)+'_'+i,
    category: cats.includes(f.category) ? f.category : cats[0],
    keys: String(f.keys||'').slice(0,120),
    text: String(f.text||'').trim().slice(0,500),
  })).filter(f=>f.text);
}

// Мягкая проверка (не блокирует, спека §10) — для альт-истории нужен хотя бы
// один факт категории «история» в каноне. Не валидируем содержание.
export function missingPOD(state){
  const g = (state.project?.genre||'').toLowerCase();
  if(!g.includes('альтернативн')) return false;
  return !(state.bible||[]).some(b=>b.source==='world' && b.category==='история');
}
