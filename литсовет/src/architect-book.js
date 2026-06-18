// Книжный архитектор (спека 5.3) — один запуск на стадии Структура.
// Возвращает скелет: главы → сцены (название, бриф, эмоция, объём, арка).
// Temp 0.6. Выход валидируется по схеме с ретраем (спека 11).

import { callLLM, extractJSON } from './llm.js';

const ARCS = ['завязка','развитие','кульминация','развязка'];

export function bookArchitectMessages(state, opts={}){
  const p = state.project;
  const sys = [
    'Ты — книжный архитектор. Ты проектируешь скелет книги: главы и сцены. Ты НЕ пишешь прозу.',
    'Каждая сцена — это единица письма (~700 слов). Думай о нарративной арке: завязка → развитие → кульминация → развязка.',
  ].join('\n');
  const targetScenes = Math.max(3, Math.round((p.targetWords||80000)/800));
  const user = [
    `Жанр: ${p.genre||'роман'}${p.subgenre?', '+p.subgenre:''}.`,
    p.era ? `Эпоха: ${p.era}.` : '',
    p.audience ? `Аудитория: ${p.audience}.` : '',
    `Идея/синопсис: ${p.synopsis || p.idea || '(не задан)'}`,
    `Целевой объём: ${p.targetWords||80000} слов (~${targetScenes} сцен).`,
    opts.chapters ? `Желаемое число глав: ${opts.chapters}.` : '',
    '',
    'Спроектируй скелет. Верни JSON:',
    '{ "chapters": [ { "title": "название главы", "arc": "завязка|развитие|кульминация|развязка", "scenes": [ { "title": "название сцены", "brief": "что происходит, тон, чем заканчивается — 1-2 предложения", "emotion": "эмоция читателя в финале сцены", "targetWords": число } ] } ] }',
    'Сделай 3-6 глав, в каждой 2-6 сцен. Брифы конкретные. Только JSON.',
  ].filter(Boolean).join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

// Валидация + нормализация скелета. Возвращает {ok, skeleton|error}.
export function validateSkeleton(raw){
  const j = extractJSON(raw);
  if(!j || !Array.isArray(j.chapters) || !j.chapters.length){
    return { ok:false, error:'нет массива chapters' };
  }
  const chapters = [];
  for(const ch of j.chapters){
    if(!ch || typeof ch.title!=='string') continue;
    const scenes = Array.isArray(ch.scenes) ? ch.scenes.filter(s=>s && typeof s.brief==='string') : [];
    if(!scenes.length) continue;
    chapters.push({
      title: ch.title.trim(),
      arc: ARCS.includes(ch.arc) ? ch.arc : 'развитие',
      scenes: scenes.map(s=>({
        title: (s.title||'Без названия').trim(),
        brief: s.brief.trim(),
        emotion: (s.emotion||'').trim(),
        targetWords: Number(s.targetWords)>0 ? Math.round(Number(s.targetWords)) : 700,
      })),
    });
  }
  if(!chapters.length) return { ok:false, error:'ни одной валидной главы со сценами' };
  return { ok:true, skeleton:{ chapters } };
}

// Запуск с ретраем при невалидном JSON (спека 11: кривой JSON ломает пайплайн).
export async function runBookArchitect(state, opts={}){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ.');
  const msgs = bookArchitectMessages(state, opts);
  let lastErr = '';
  for(let attempt=0; attempt<=(g.retries??2); attempt++){
    const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.6, messages:msgs, maxTokens:2500 });
    const v = validateSkeleton(res.text);
    if(v.ok) return v.skeleton;
    lastErr = v.error;
    // подсказка модели на ретрае
    msgs.push({ role:'user', content:`Ответ невалиден (${v.error}). Верни СТРОГО JSON по схеме, только объект.` });
  }
  throw new Error('Книжный архитектор вернул невалидный скелет: '+lastErr);
}

// Перегенерация ОДНОЙ сцены скелета с подсказкой автора о направлении.
// Видит соседние сцены и главу — чтобы вписаться в дугу. Возвращает поля сцены.
export async function regenerateScene(state, scene, hint){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ.');
  const nodes = state.structure||[];
  const ch = nodes.find(n=>n.type==='chapter' && n.id===scene.chapterId);
  const scenes = nodes.filter(n=>n.type==='scene');
  const idx = scenes.findIndex(n=>n.id===scene.id);
  const prev = scenes[idx-1], next = scenes[idx+1];
  const p = state.project;
  const sys = 'Ты — книжный архитектор. Перепроектируй ОДНУ сцену по подсказке автора, сохраняя её место в нарративной арке книги. Не пишешь прозу.';
  const user = [
    `Жанр: ${p.genre||'роман'}. Синопсис: ${p.synopsis||p.idea||''}`,
    ch?`Глава: «${ch.title}» (${ch.arc||''}).`:'',
    prev?`Предыдущая сцена: «${prev.title}» — ${prev.brief}`:'',
    next?`Следующая сцена: «${next.title}» — ${next.brief}`:'',
    `Текущая сцена: «${scene.title}» — ${scene.brief}`,
    '',
    'ПОДСКАЗКА АВТОРА (в каком направлении переделать): ' + (hint||'сделай сильнее и конкретнее'),
    '',
    'Верни JSON одной сцены: { "title":"…", "brief":"что происходит, тон, чем заканчивается", "emotion":"эмоция читателя", "targetWords":число }. Только JSON.',
  ].filter(Boolean).join('\n');
  let lastErr='';
  for(let attempt=0; attempt<=(g.retries??2); attempt++){
    const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.7, messages:[{role:'system',content:sys},{role:'user',content:user}], maxTokens:500 });
    const j = extractJSON(res.text);
    if(j && typeof j.brief==='string'){
      return {
        title:(j.title||scene.title).trim(),
        brief:j.brief.trim(),
        emotion:(j.emotion||scene.emotion||'').trim(),
        targetWords: Number(j.targetWords)>0?Math.round(Number(j.targetWords)):(scene.targetWords||700),
      };
    }
    lastErr='невалидный JSON';
  }
  throw new Error('Не удалось перегенерировать: '+lastErr);
}

// История версий сцены-скелета: сохранить текущие поля перед заменой / откатить.
const SCENE_FIELDS = ['title','brief','emotion','targetWords'];
export function pushSceneVersion(scene){
  scene.briefVersions = scene.briefVersions || [];
  scene.briefVersions.unshift(Object.fromEntries(SCENE_FIELDS.map(f=>[f, scene[f]])));
  if(scene.briefVersions.length>10) scene.briefVersions.length=10;
}
export function revertScene(scene){
  if(!scene.briefVersions || !scene.briefVersions.length) return false;
  const v = scene.briefVersions.shift();
  SCENE_FIELDS.forEach(f=>{ if(v[f]!==undefined) scene[f]=v[f]; });
  return true;
}

// Применить скелет к плоскому state.structure[] (chapter|scene узлы).
export function applySkeleton(state, skeleton, uid){
  const nodes = [];
  for(const ch of skeleton.chapters){
    const chId = uid('ch');
    nodes.push({ id:chId, type:'chapter', title:ch.title, arc:ch.arc });
    for(const sc of ch.scenes){
      nodes.push({ id:uid('sc'), type:'scene', chapterId:chId, title:sc.title, brief:sc.brief,
        emotion:sc.emotion, targetWords:sc.targetWords, text:'', words:0, status:'todo' });
    }
  }
  state.structure = nodes;
}
