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

// ── 1) Кандидаты на иллюстрации (текстовый LLM) ──
export function illustrationSuggestMessages(state){
  const p = state.project;
  const sys = [
    'Ты — арт-директор книги. Ты НЕ рисуешь — ты предлагаешь кандидатов на иллюстрации и текстовые промпты для генератора изображений.',
    'Промпт для картинки должен быть самодостаточным визуальным описанием (место, персонажи, свет, композиция, настроение) — генератор изображений не читал книгу и не поймёт отсылок к именам без описания их внешности.',
    'Обложка — всегда первый кандидат: она должна работать как обложка жанра (не сцена дословно, а образ, который продаёт книгу на полке).',
  ].join('\n');
  const user = [
    `Жанр: ${p.genre||'роман'}. Аудитория: ${p.audience||'широкая'}.`,
    p.synopsis||p.idea ? `Синопсис: ${p.synopsis||p.idea}` : '',
    '',
    'ОБЗОР КНИГИ ПО ГЛАВАМ И СЦЕНАМ (сводки по порядку):',
    bookOverview(state),
    '',
    'Предложи кандидатов на иллюстрации: 1 обложка + до 7 сильных визуальных сцен (не каждую, только те, что реально дают яркую картинку — не диалоги и не размышления, а моменты с явным визуальным образом).',
    'Верни JSON: { "candidates": [ { "type":"cover|scene", "sceneTitle":"точное название сцены из обзора (пусто для обложки)", "prompt":"самодостаточный визуальный промпт для генератора изображений, на английском, 1-3 предложения", "reason":"почему эта сцена/образ — по-русски, коротко" } ] }',
    'Только JSON.',
  ].filter(Boolean).join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

export async function suggestIllustrations(state){
  const g = state.global;
  if(!g.apiKey) throw new Error('Не задан API-ключ текстовой модели (⚙).');
  const scenes = doneScenesOrdered(state);
  if(!scenes.length) throw new Error('Нужна хотя бы одна законченная сцена.');
  const msgs = illustrationSuggestMessages(state);
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.6, messages:msgs, maxTokens:1500, retries:g.retries });
  const j = extractJSON(res.text);
  const arr = j && Array.isArray(j.candidates) ? j.candidates : null;
  if(!arr) throw new Error('Не удалось разобрать ответ арт-директора.');
  const sceneByTitle = new Map(scenes.map(s=>[s.title.trim().toLowerCase(), s]));
  return arr.slice(0, 8).map((c,i)=>{
    const sceneTitle = String(c.sceneTitle||'').trim();
    const matched = sceneTitle ? sceneByTitle.get(sceneTitle.toLowerCase()) : null;
    return {
      id: 'ic_'+Date.now().toString(36)+'_'+i,
      type: c.type==='cover' ? 'cover' : 'scene',
      sceneId: matched ? matched.id : null,
      sceneTitle: matched ? matched.title : sceneTitle,
      prompt: String(c.prompt||'').slice(0,600),
      reason: String(c.reason||'').slice(0,300),
    };
  });
}

// ── 2) Генерация ОДНОЙ картинки (провайдер картинок, тратит деньги) ──
// visualVoice — текст стиля из Концепции (state.style.visualVoice), если тумблер включён.
export async function generateIllustrationFor(state, candidate){
  const ic = state.illustrations || {};
  if(!ic.apiKey) throw new Error('Не задан API-ключ для генерации картинок (⚙).');
  const voiceOn = state.style?.visualVoiceOn && state.style?.visualVoice;
  const prompt = voiceOn ? `${candidate.prompt}\n\nСтиль: ${state.style.visualVoice}` : candidate.prompt;
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
