// Сборка контекста сцены (спека 7.1). Сердце продукта.
// ПП2 — минимальная версия: голос + запреты + Bible топ-5 + живой контекст.
// Полная иерархическая память (серия/книги/главы/сцены) добавляется в ПП3.

import { estimateTokens, smartTrunc, trimToTokens } from './tokens.js';
import { bibleForPrompt } from './bible.js';
import { voicePromptBlock } from './voice.js';

const SEP = '\n\n';

// Сериализация состояний персонажей, присутствующих в сцене.
export function serializeCharacterStates(characters, presentNames){
  if(!characters || !characters.length) return '';
  const present = presentNames && presentNames.length
    ? characters.filter(c=>presentNames.includes(c.name))
    : characters;
  return present.filter(c=>c.stateNote).map(c=>`${c.name} — ${c.stateNote}`).join('\n');
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

  // 2. Параметры проекта (жанр/тон) — короткий фикс
  const proj = state.project;
  const projBlock = [
    proj.genre && `Жанр: ${proj.genre}${proj.subgenre?', '+proj.subgenre:''}.`,
    proj.era && `Эпоха: ${proj.era}.`,
    style.refs && style.refs.length && `Ориентиры стиля: ${style.refs.join(', ')}.`,
  ].filter(Boolean).join(' ');
  if(projBlock) layers.push({ name:'project', text:'=== ПРОЕКТ ===\n'+projBlock, fixed:true });

  // 3. Состояния персонажей
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
  lines.push('ЗАДАЧА: напиши прозу этой сцены.');
  lines.push('Бриф сцены: ' + (scene.brief || scene.title || '(нет)'));
  if(scene.emotion) lines.push('Эмоция читателя в финале: ' + scene.emotion);
  const target = scene.targetWords || 700;
  lines.push(`Объём: примерно ${target} слов.`);
  if(opts.directive) lines.push('Указание автора к переработке: ' + opts.directive);
  lines.push('Пиши только прозу, без заголовков и пояснений.');
  return lines.join('\n');
}

// Усечение по приоритету: серия → главы → сцены (в ПП2 этих слоёв ещё нет),
// затем живой контекст через smartTrunc. fixed-слои не режутся.
function applyBudget(layers, BUDGET){
  const total = ()=>layers.reduce((s,l)=>s+estimateTokens(l.text), 0);
  if(total() <= BUDGET) return;
  // порядок выбивания «памяти» (по name)
  const dropOrder = ['series','chapters','scenes','characters','bible'];
  for(const nm of dropOrder){
    while(total() > BUDGET){
      const idx = layers.findIndex(l=>l.name===nm && !l.fixed);
      if(idx<0) break;
      layers.splice(idx,1);
    }
    if(total() <= BUDGET) return;
  }
  // последний рубеж: ужать живой контекст
  const live = layers.find(l=>l.live);
  if(live && total() > BUDGET){
    const over = total() - BUDGET;
    const liveTokens = estimateTokens(live.text);
    live.text = trimToTokens(live.text, Math.max(200, liveTokens - over));
  }
}
