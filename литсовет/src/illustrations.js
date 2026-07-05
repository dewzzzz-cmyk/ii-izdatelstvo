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
// Стиль картинки собирается из трёх необязательных частей (все могут сочетаться):
// visualVoice (state.style.visualVoice, если тумблер включён), пресет ART_STYLES
// (state.style.artStyleId) и чёрно-белый режим (state.style.colorMode==='bw').
// Цвет по умолчанию — без доп. инструкции (большинство генераторов рисуют
// цветное по умолчанию), явная инструкция нужна только для ч/б.
export async function generateIllustrationFor(state, candidate){
  const ic = state.illustrations || {};
  if(!ic.apiKey) throw new Error('Не задан API-ключ для генерации картинок (⚙).');
  const parts = [];
  if(state.style?.visualVoiceOn && state.style?.visualVoice) parts.push(`Стиль: ${state.style.visualVoice}`);
  const artStyle = ART_STYLES.find(s=>s.id===state.style?.artStyleId);
  if(artStyle) parts.push(artStyle.promptFragment);
  if(state.style?.colorMode==='bw') parts.push('black and white, monochrome, no color');
  const prompt = parts.length ? `${candidate.prompt}\n\n${parts.join('. ')}` : candidate.prompt;
  const { dataUrl } = await generateImage({
    provider: ic.provider||'gemini',
    apiKey: ic.apiKey,
    model: ic.model,
    prompt,
    size: ic.size,
    quality: ic.quality,
    proxyToken: state.global?.proxyToken,
  });
  return dataUrl;
}

// Сохранить сгенерированную карту мира в общую галерею (единый источник
// правды — state.illustrations.items, спека §9). Вызывается из world.js
// напрямую, минуя suggestIllustrations()/doneScenesOrdered (на стадии «Мир»
// сцен ещё нет). Одна карта на проект — повторная генерация заменяет старую,
// не копит версии (в отличие от сцен/обложки).
export function saveMapItem(state, dataUrl){
  state.illustrations = state.illustrations || {};
  state.illustrations.items = (state.illustrations.items||[]).filter(it=>it.type!=='map');
  const item = { id:'map_'+Date.now().toString(36), type:'map', sceneId:null, sceneTitle:'', prompt:'', dataUrl, createdAt:Date.now() };
  state.illustrations.items.push(item);
  return item;
}
