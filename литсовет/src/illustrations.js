// Иллюстрации книги. Два разных API, не путать:
//   1) Подсказка промптов и настроек — обычный текстовый LLM (тот же, что уже
//      настроен для прозы, напр. deepseek) — читает книгу и предлагает
//      кандидатов на иллюстрации. Ничего не стоит сверх обычного текстового вызова.
//   2) Сама генерация картинки — отдельный провайдер и отдельный ключ
//      (state.illustrations.provider/apiKey), см. imagegen.js. Стоит реальных
//      денег за каждую картинку — вызывается ТОЛЬКО по явному клику автора,
//      никогда не автоматически.

import { callLLM, extractJSON } from './llm.js';
import { bookOverview, doneScenesOrdered } from './bookreview.js';
import { generateImage } from './imagegen.js';
import { ART_STYLES } from './artStyles.js';

// ── 1) Кандидаты на иллюстрации (текстовый LLM) ──
// Обложке не нужны готовые сцены (промпт для неё строится только из
// жанра/синопсиса/идеи) — поэтому функция работает и без единой законченной
// сцены, просто просит у арт-директора только обложку в этом случае.
export function illustrationSuggestMessages(state){
  const p = state.project;
  const count = state.illustrations?.suggestCount || 7;
  const scenes = doneScenesOrdered(state);
  const hasScenes = scenes.length > 0;
  const sys = [
    'Ты — арт-директор книги. Ты НЕ рисуешь — ты предлагаешь кандидатов на иллюстрации и текстовые промпты для генератора изображений.',
    'Промпт для картинки должен быть самодостаточным визуальным описанием (место, персонажи, свет, композиция, настроение) — генератор изображений не читал книгу и не поймёт отсылок к именам без описания их внешности.',
    'Сквозные персонажи должны выглядеть одинаково во всех картинках: если персонаж встречается в нескольких кандидатах, реши ОДИН РАЗ его внешность (вид/порода, окрас, размер, характерные детали — не общие слова вроде «милый», а то, что реально отличает его от похожих) и повторяй это описание СЛОВО В СЛОВО на английском в промпте каждой картинки с этим персонажем. Генератор не помнит предыдущие картинки — без дословного повтора он каждый раз рисует другого персонажа.',
    'Обложка — всегда первый кандидат: она должна работать как обложка жанра (не сцена дословно, а образ, который продаёт книгу на полке).',
  ].join('\n');
  const knownChars = (state.characters||[]).filter(c=>c.desc).map(c=>`${c.name}: ${c.desc}`);
  const user = [
    `Жанр: ${p.genre||'роман'}. Аудитория: ${p.audience||'широкая'}.`,
    p.synopsis||p.idea ? `Синопсис: ${p.synopsis||p.idea}` : '',
    '',
    hasScenes ? 'ОБЗОР КНИГИ ПО ГЛАВАМ И СЦЕНАМ (сводки по порядку):' : '',
    hasScenes ? bookOverview(state) : '',
    '',
    knownChars.length ? `ИЗВЕСТНАЯ ВНЕШНОСТЬ ПЕРСОНАЖЕЙ (используй дословно вместо того, чтобы придумывать заново):\n${knownChars.join('\n')}\n` : '',
    hasScenes
      ? `Предложи кандидатов на иллюстрации: 1 обложка + до ${Math.max(0, count-1)} сильных визуальных сцен (не каждую, только те, что реально дают яркую картинку — не диалоги и не размышления, а моменты с явным визуальным образом).`
      : 'Готовых сцен ещё нет — предложи только ОБЛОЖКУ (1 кандидат), по жанру, аудитории и синопсису/идее выше.',
    'Верни JSON: { "candidates": [ { "type":"cover|scene", "sceneTitle":"точное название сцены из обзора (пусто для обложки)", "prompt":"самодостаточный визуальный промпт для генератора изображений, на английском, 1-3 предложения", "reason":"почему эта сцена/образ — по-русски, коротко", "importance":"число 1-10, насколько сильна эта картинка для книги — 10 = ключевой визуальный момент, 1 = проходной" } ] }',
    'Только JSON.',
  ].filter(Boolean).join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

export async function suggestIllustrations(state){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ текстовой модели (⚙).');
  const scenes = doneScenesOrdered(state);
  const msgs = illustrationSuggestMessages(state);
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.6, messages:msgs, maxTokens:1500, retries:g.retries });
  const j = extractJSON(res.text);
  const arr = j && Array.isArray(j.candidates) ? j.candidates : null;
  if(!arr) throw new Error('Не удалось разобрать ответ арт-директора.');
  const sceneByTitle = new Map(scenes.map(s=>[s.title.trim().toLowerCase(), s]));
  const cap = state.illustrations?.suggestCount || 7;
  // Без единой законченной сцены брать в расчёт только обложку — сцену-кандидата
  // без реального текста подставить всё равно не к чему (модель могла
  // ослушаться инструкции и предложить сцену тоже).
  const usable = scenes.length ? arr : arr.filter(c=>c.type==='cover');
  return usable.slice(0, cap).map((c,i)=>{
    const sceneTitle = String(c.sceneTitle||'').trim();
    const matched = sceneTitle ? sceneByTitle.get(sceneTitle.toLowerCase()) : null;
    return {
      id: 'ic_'+Date.now().toString(36)+'_'+i,
      type: c.type==='cover' ? 'cover' : 'scene',
      sceneId: matched ? matched.id : null,
      sceneTitle: matched ? matched.title : sceneTitle,
      prompt: String(c.prompt||'').slice(0,600),
      reason: String(c.reason||'').slice(0,300),
      importance: (n=>Math.max(1, Math.min(10, Math.round(Number.isFinite(n)?n:5))))(Number(c.importance)),
    };
  });
}

// ── 2) Генерация ОДНОЙ картинки (провайдер картинок, тратит деньги) ──
// Стиль картинки собирается из необязательных частей (все могут сочетаться):
// visualVoice (state.style.visualVoice, если тумблер включён), пресет ART_STYLES
// (state.style.artStyleId), чёрно-белый режим (state.style.colorMode==='bw'),
// язык надписей/запрет текста и портретная обложка (все три — state.illustrations).
// Цвет по умолчанию — без доп. инструкции (большинство генераторов рисуют
// цветное по умолчанию), явная инструкция нужна только для ч/б.
//
// noText/ruText/portraitCover проверяются здесь, а не в illustrationSuggestMessages,
// по той же причине, что и стиль/цвет выше: это единственная точка, через которую
// проходит ЛЮБая генерация картинки (пакетный подбор арт-директора, точечный
// suggestOneIllustration, перегенерация промпта, перегенерация только картинки) —
// вставлять инструкцию в промпт LLM-подсказчика пришлось бы дублировать в
// нескольких местах и она бы не действовала на промпт, отредактированный автором вручную.
export function textInstruction(ic){
  if(ic?.noText) return 'Do not include any readable text, letters, numbers or writing anywhere in the image.';
  if(ic?.ruText) return 'If the image contains any readable text or lettering (book title, map labels, signs), it must be written in Russian (Cyrillic script), not English.';
  return '';
}
// Портретные пропорции обложки (для площадок вроде ЛитРес/Author.Today) — часть
// провайдеров (OpenAI/Qwen) реально уважает size, часть (Gemini/Recraft, см.
// server.js handleGenerateImage) size игнорирует и рисует по промпту — поэтому
// инструкция дублируется и текстом, и через size, чтобы сработать там, где возможно.
const PORTRAIT_SIZE = '1024x1536';
function portraitInstruction(ic, type){
  if(type!=='cover' || !ic?.portraitCover) return '';
  return 'Vertical portrait book-cover orientation, taller than wide (2:3 aspect ratio), not square, not landscape.';
}
export async function generateIllustrationFor(state, candidate){
  const ic = state.illustrations || {};
  if(!ic.apiKey) throw new Error('Не задан API-ключ для генерации картинок (⚙).');
  const parts = [];
  if(state.style?.visualVoiceOn && state.style?.visualVoice) parts.push(`Стиль: ${state.style.visualVoice}`);
  const artStyle = ART_STYLES.find(s=>s.id===state.style?.artStyleId);
  if(artStyle) parts.push(artStyle.promptFragment);
  if(state.style?.colorMode==='bw') parts.push('black and white, monochrome, no color');
  const txtInstr = textInstruction(ic); if(txtInstr) parts.push(txtInstr);
  const portraitInstr = portraitInstruction(ic, candidate.type); if(portraitInstr) parts.push(portraitInstr);
  const prompt = parts.length ? `${candidate.prompt}\n\n${parts.join('. ')}` : candidate.prompt;
  const size = (candidate.type==='cover' && ic.portraitCover) ? PORTRAIT_SIZE : ic.size;
  const { dataUrl } = await generateImage({
    provider: ic.provider||'gemini',
    apiKey: ic.apiKey,
    model: ic.model,
    prompt,
    size,
    quality: ic.quality,
    proxyToken: state.global?.proxyToken,
  });
  return dataUrl;
}

// ── 1b) Ручной режим: точечное предложение промпта для ОДНОЙ выбранной цели ──
// В отличие от suggestIllustrations() (просит арт-директора самому набрать
// список кандидатов по своему усмотрению) — здесь автор уже решил, ЧТО именно
// иллюстрировать (обложка или конкретная глава), и нужен только промпт под неё.
// Для главы — просим арт-директора самого выбрать внутри неё самую визуальную
// сцену (не всякая сцена в главе одинаково рисуема), поэтому возвращаем
// sceneTitle и резолвим его в sceneId так же, как suggestIllustrations().
// Используется и для первой генерации промпта, и для «перегенерировать промпт»
// у уже существующей картинки (тот же вызов, старый прompt просто отбрасывается).
function singleTargetMessages(state, target){
  const p = state.project;
  const knownChars = (state.characters||[]).filter(c=>c.desc).map(c=>`${c.name}: ${c.desc}`);
  const sys = [
    'Ты — арт-директор книги. Ты НЕ рисуешь — ты предлагаешь ОДИН текстовый промпт для генератора изображений под конкретную, уже выбранную автором цель.',
    'Промпт должен быть самодостаточным визуальным описанием (место, персонажи, свет, композиция, настроение) на английском — генератор изображений не читал книгу и не поймёт отсылок к именам без описания их внешности.',
  ].join('\n');
  const userParts = [
    `Жанр: ${p.genre||'роман'}. Аудитория: ${p.audience||'широкая'}.`,
    knownChars.length ? `ИЗВЕСТНАЯ ВНЕШНОСТЬ ПЕРСОНАЖЕЙ (используй дословно):\n${knownChars.join('\n')}` : '',
  ];
  if(target.type==='cover'){
    userParts.push(
      p.synopsis||p.idea ? `Синопсис: ${p.synopsis||p.idea}` : '',
      'Нужен промпт ТОЛЬКО для ОБЛОЖКИ книги — образ, который продаёт жанр на полке, не дословная сцена.',
    );
  } else {
    const chScenes = doneScenesOrdered(state).filter(sc=>sc.chapterId===target.chapterId);
    const mem = state.memory||{};
    userParts.push(
      `ГЛАВА «${target.chapterTitle}» — СЦЕНЫ ПО ПОРЯДКУ:`,
      chScenes.map(sc=>`«${sc.title}»: ${mem.scenes?.[sc.id]?.current || sc.brief || ''}`).join('\n') || '(нет написанных сцен)',
      'Выбери ОДНУ самую визуально сильную сцену этой главы (яркий образ, не диалог и не размышление) и предложи промпт под неё.',
    );
  }
  userParts.push(
    'Верни JSON: { "sceneTitle": "точное название выбранной сцены — пусто для обложки", "prompt": "визуальный промпт на английском, 1-3 предложения", "reason": "почему этот образ — по-русски, коротко" }',
    'Только JSON.',
  );
  return [{role:'system',content:sys},{role:'user',content:userParts.filter(Boolean).join('\n')}];
}

export async function suggestOneIllustration(state, target){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ текстовой модели (⚙).');
  const msgs = singleTargetMessages(state, target);
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.6, messages:msgs, maxTokens:500, retries:g.retries });
  const j = extractJSON(res.text);
  if(!j || !j.prompt) throw new Error('Не удалось разобрать ответ арт-директора.');
  let sceneId = null, sceneTitle = '';
  if(target.type==='scene'){
    const wanted = String(j.sceneTitle||'').trim().toLowerCase();
    const match = wanted ? doneScenesOrdered(state).find(sc=>sc.chapterId===target.chapterId && sc.title.trim().toLowerCase()===wanted) : null;
    sceneId = match ? match.id : null;
    sceneTitle = match ? match.title : String(j.sceneTitle||target.chapterTitle||'').trim();
  }
  return {
    id: 'ic_'+Date.now().toString(36),
    type: target.type,
    sceneId,
    sceneTitle,
    prompt: String(j.prompt).slice(0,600),
    reason: String(j.reason||'').slice(0,300),
    importance: 5,
  };
}

// Глава, к которой относится сцена — по позиции в structure (та же логика,
// что buildBook() в export.js), null для обложки/несцены или сцены без главы.
export function chapterTitleForScene(state, sceneId){
  if(!sceneId) return null;
  const nodes = state.structure||[];
  let cur = null;
  for(const n of nodes){
    if(n.type==='chapter') cur = n.title;
    else if(n.type==='scene' && n.id===sceneId) return cur||null;
  }
  return null;
}

// Сохранить сгенерированную карту мира в общую галерею (единый источник
// правды — state.illustrations.items, спека §9). Вызывается из world.js
// напрямую, минуя suggestIllustrations()/doneScenesOrdered (на стадии «Мир»
// сцен ещё нет). Одна карта на проект — повторная генерация заменяет старую,
// не копит версии (в отличие от сцен/обложки).
export function saveMapItem(state, dataUrl, prompt=''){
  state.illustrations = state.illustrations || {};
  state.illustrations.items = (state.illustrations.items||[]).filter(it=>it.type!=='map');
  const item = { id:'map_'+Date.now().toString(36), type:'map', sceneId:null, sceneTitle:'', prompt, dataUrl, createdAt:Date.now() };
  state.illustrations.items.push(item);
  return item;
}

// Своя картинка автора (не через провайдера) — вместо генерации. uploaded:true
// отличает такие элементы в галерее: у них нет промпта, поэтому «другой
// промпт»/«перегенерировать картинку» для них не показываются (см. ui/illustrations.js).
// Карта и обложка — как saveMapItem: одна на проект, повторная загрузка заменяет старую,
// не копит версии (иначе в галерее остаются осиротевшие обложки, которые никуда не попадают).
export function saveUploadedItem(state, dataUrl, { type, sceneId=null, sceneTitle='' }){
  state.illustrations = state.illustrations || {};
  state.illustrations.items = state.illustrations.items || [];
  if(type==='map' || type==='cover') state.illustrations.items = state.illustrations.items.filter(it=>it.type!==type);
  const item = { id:'up_'+Date.now().toString(36), type, sceneId, sceneTitle, prompt:'', dataUrl, createdAt:Date.now(), uploaded:true };
  state.illustrations.items.push(item);
  if(type==='cover') state.project.coverDataUrl = dataUrl;
  return item;
}

// Убрать обложку целиком — используется и стадией «Концепция» (ручная загрузка/
// удаление), и разделом «Иллюстрации», чтобы обе вкладки видели одно и то же:
// раньше «✕ Убрать обложку» в Концепции чистила только project.coverDataUrl, не
// трогая illustrations.items — в галерее оставалась картинка, которая больше
// никуда не попадала (не в экспорт, не в чтение), выглядя как рассинхрон.
export function removeCover(state){
  state.illustrations = state.illustrations || {};
  state.illustrations.items = (state.illustrations.items||[]).filter(it=>it.type!=='cover');
  state.project.coverDataUrl = '';
}
