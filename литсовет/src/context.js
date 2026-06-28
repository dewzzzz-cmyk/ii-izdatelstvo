// Сборка контекста сцены (спека 7.1). Сердце продукта.
// ПП2 — минимальная версия: голос + запреты + Bible топ-5 + живой контекст.
// Полная иерархическая память (серия/книги/главы/сцены) добавляется в ПП3.

import { estimateTokens, smartTrunc, trimToTokens } from './tokens.js';
import { bibleForPrompt } from './bible.js';
import { voicePromptBlock } from './voice.js';
import { activeSceneSummaries, runningSynopsis } from './memory.js';

const SEP = '\n\n';

// Сериализация состояний персонажей, присутствующих в сцене.
export function serializeCharacterStates(characters, presentNames){
  if(!characters || !characters.length) return '';
  const present = presentNames && presentNames.length
    ? characters.filter(c=>presentNames.includes(c.name))
    : characters;
  return present.filter(c=>c.stateNote).map(c=>`${c.name} — ${c.stateNote}`).join('\n');
}

// Компактный контекст книги для Оценщика: чтобы его замечания учитывали
// сюжет, канон и состояния персонажей, а не висели в вакууме. Без блока голоса
// (это отдельная ось) и без полной памяти — только грунтовка для замечаний.
export function bookContextBlock(state, scene){
  const proj = state.project || {};
  const parts = [];
  const head = [proj.genre && `Жанр: ${proj.genre}.`, proj.era && `Эпоха: ${proj.era}.`].filter(Boolean).join(' ');
  if(head) parts.push(head);
  const synopsis = runningSynopsis(state) || proj.synopsis || proj.idea;
  if(synopsis) parts.push('Сюжет: ' + synopsis);
  const chars = serializeCharacterStates(state.characters, scene.presentChars);
  if(chars) parts.push('Персонажи в сцене:\n' + chars);
  const bible = bibleForPrompt(state.bible, (scene.brief||scene.title||'') + ' ' + (proj.synopsis||''), 5);
  if(bible) parts.push('Канон:\n' + bible);
  return parts.join('\n');
}

// Собрать сообщения для Прозаика на одну сцену.
// Возвращает {messages, layers} — layers для диагностики (что попало в промпт).
export function buildSceneContext(state, scene, opts={}){
  const { voice, style, bible, characters, global } = state;
  const BUDGET = (global && global.budgetTokens) || 12000;
  const layers = [];

  // 1. Голос + запреты (фикс, не режется)
  const voiceBlock = voicePromptBlock(voice, style.forbidden);
  if(voiceBlock) layers.push({ name:'voice', text:'=== ГОЛОС ===\n'+voiceBlock, fixed:true });

  // 1b. Правила автора (do/don't) — фикс, не режется. Профилактика: Прозаик не порождает.
  const rules = (style.rules||[]).filter(Boolean);
  if(rules.length) layers.push({ name:'rules', text:'=== ПРАВИЛА АВТОРА (соблюдай неукоснительно) ===\n'+rules.map(r=>'— '+r).join('\n'), fixed:true });

  // 2. Параметры проекта (жанр/тон) — короткий фикс
  const proj = state.project;
  const projBlock = [
    proj.genre && `Жанр: ${proj.genre}${proj.subgenre?', '+proj.subgenre:''}.`,
    proj.era && `Эпоха: ${proj.era}.`,
    style.refs && style.refs.length && `Ориентиры стиля: ${style.refs.join(', ')}.`,
  ].filter(Boolean).join(' ');
  if(projBlock) layers.push({ name:'project', text:'=== ПРОЕКТ ===\n'+projBlock, fixed:true });

  // 3a. Память серии: ручной синопсис (поле seriesSummary) + импортированные сводки
  const mem = state.memory || {};
  const seriesParts = [];
  if(proj.seriesSummary) seriesParts.push(proj.seriesSummary);
  if(state.series && state.series.length) seriesParts.push(...state.series.map(b=>b.summary).filter(Boolean));
  if(seriesParts.length) layers.push({ name:'series', text:'=== ПРОШЛЫЕ КНИГИ СЕРИИ ===\n'+seriesParts.join('\n\n') });

  // 3b. Бегущий синопсис книги: сюда свёрнуты старые сцены (ограничивает рост контекста)
  const synopsis = runningSynopsis(state);
  if(synopsis) layers.push({ name:'synopsis', text:'=== РАНЕЕ В КНИГЕ (СИНОПСИС) ===\n'+synopsis, fixed:true });

  // 3c. Сводки завершённых глав (в порядке structure, не случайном)
  const chapterSums = (state.structure||[]).filter(n=>n.type==='chapter')
    .map(n=>(mem.chapters||{})[n.id]?.current).filter(Boolean);
  if(chapterSums.length) layers.push({ name:'chapters', text:'=== ГЛАВЫ (СВОДКИ) ===\n'+chapterSums.join('\n\n') });

  // 3d. Последние развёрнутые посценные сводки (окно, без свёрнутых; кроме текущей)
  const recent = activeSceneSummaries(state).filter(e=>e.id!==scene.id);
  if(recent.length){
    layers.push({ name:'scenes', entries:recent.map(e=>e.text), header:'=== ПРЕДЫДУЩИЕ СЦЕНЫ (СВОДКИ) ===',
      get text(){ return this.header+'\n'+this.entries.join('\n'); } });
  }

  // 3d. Состояния персонажей
  const chars = serializeCharacterStates(characters, scene.presentChars);
  if(chars) layers.push({ name:'characters', text:'=== ПЕРСОНАЖИ ===\n'+chars });

  // 4. Bible — топ-5 по брифу сцены
  const bibleBlock = bibleForPrompt(bible, scene.brief || scene.title || '', 5);
  if(bibleBlock) layers.push({ name:'bible', text:'=== КАНОН (БИБЛИЯ) ===\n'+bibleBlock });

  // 5. Живой контекст: текст предыдущей сцены (усекается через smartTrunc)
  if(opts.prevSceneText){
    layers.push({ name:'prevScene', text:'=== ПРЕДЫДУЩАЯ СЦЕНА ===\n'+opts.prevSceneText, live:true });
  }

  // 6. Выход Архитектора (якоря/запреты), если был
  if(opts.architectOutput){
    layers.push({ name:'architect', text:'=== ПЛАН СЦЕНЫ (АРХИТЕКТОР) ===\n'+opts.architectOutput, fixed:true });
  }

  // 7. Предыдущий черновик при доработке (петля): Прозаик видит, что правит, а не пишет с нуля
  if(opts.prevDraft){
    layers.push({ name:'prevDraft', text:'=== ТВОЙ ПРЕДЫДУЩИЙ ЧЕРНОВИК (доработай, сохрани удачные места) ===\n'+opts.prevDraft, fixed:true, live:false });
  }

  // Применяем бюджет: режем по приоритету (не трогаем fixed; live ужимаем последним)
  applyBudget(layers, BUDGET);

  const system = layers.map(l=>l.text).join(SEP);
  const user = buildTask(scene, proj, opts);

  return {
    messages: [
      { role:'system', content: system },
      { role:'user',   content: user },
    ],
    layers: layers.map(l=>({ name:l.name, tokens: estimateTokens(l.text) })),
  };
}

function buildTask(scene, proj, opts){
  const lines = [];
  const revising = !!opts.prevDraft;
  lines.push(revising
    ? 'ЗАДАЧА: доработай предыдущий черновик по замечаниям. Сохрани удачные образы и ритм, исправь указанное. НЕ переписывай с нуля.'
    : 'ЗАДАЧА: напиши прозу этой сцены.');
  lines.push('Бриф сцены: ' + (scene.brief || scene.title || '(нет)'));
  if(scene.emotion) lines.push('Эмоция читателя в финале: ' + scene.emotion + ' (передай через действие и деталь, не называй чувство прямо).');
  const target = scene.targetWords || 700;
  lines.push(`Объём: примерно ${target} слов.`);
  if(opts.directive) lines.push((revising?'Замечания оценщика: ':'Указание автора: ') + opts.directive);
  // Анти-ИИшность: направляем от гладкого нейтрала к живой прозе
  lines.push('Требования к прозе: конкретная чувственная деталь вместо абстракций; избегай эпитетов-ярлыков (зловещий, прекрасный, ужасный); «показывай, не рассказывай»; без морализаторского вывода в финале; варьируй длину предложений.');
  lines.push('Факты из блока «КАНОН (БИБЛИЯ)» исторически зафиксированы — не изменяй их, не вводи деталей, противоречащих канону.');
  lines.push('Пиши только прозу, без заголовков и пояснений.');
  return lines.join('\n');
}

// Усечение по приоритету: серия → главы → сцены (в ПП2 этих слоёв ещё нет),
// затем живой контекст через smartTrunc. fixed-слои не режутся.
function applyBudget(layers, BUDGET){
  const total = ()=>layers.reduce((s,l)=>s+estimateTokens(l.text), 0);
  if(total() <= BUDGET) return;

  // (а) Слой сцен: выбрасываем СТАРЕЙШИЕ записи по одной (entries[0] = старейшая)
  const scenesLayer = layers.find(l=>l.name==='scenes' && l.entries);
  while(scenesLayer && scenesLayer.entries.length>1 && total() > BUDGET){
    scenesLayer.entries.shift();
  }
  if(total() <= BUDGET) return;

  // (б) Дальше выбиваем целые слои «памяти» по приоритету (не fixed)
  const dropOrder = ['scenes','chapters','series','characters','bible'];
  for(const nm of dropOrder){
    while(total() > BUDGET){
      const idx = layers.findIndex(l=>l.name===nm && !l.fixed);
      if(idx<0) break;
      layers.splice(idx,1);
    }
    if(total() <= BUDGET) return;
  }
  // (в) последний рубеж: ужать живой контекст (но не голос/синопсис — они fixed)
  const live = layers.find(l=>l.live);
  if(live && total() > BUDGET){
    const over = total() - BUDGET;
    const liveTokens = estimateTokens(live.text);
    live.text = trimToTokens(live.text, Math.max(200, liveTokens - over));
  }
}
