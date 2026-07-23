// Структурные сигнатуры сцены — для кросс-сценовых проверок, которых не видят
// ни Оценщик, ни Стражи (они работают только с ОДНОЙ сценой за раз). Извлекаем
// не текст, а закрытые структурные категории — сравнение между сценами идёт
// группировкой кодом, а не похожестью слов (иначе "то же слово" путается с
// "тот же тип приёма", и наоборот — разные слова той же структуры не ловятся).
//
// Жанронезависимость — сознательное архитектурное решение: setup/style ниже —
// абстрактные категории структуры бита (не завязаны на конкретный жанр), а
// channel (кто/что подаёт бит) — СВОБОДНАЯ короткая метка, которую называет
// сама модель под конкретную книгу (тот же приём, что clicheCategory в
// agents.js — "не сами слова, а тип"), а не фиксированный список вроде
// "ИИ-спутник"/"говорящий кот" — такой список годился бы только для книг с
// именно этим тропом. Один и тот же код работает для книги с ИИ-очками, с
// говорящим котом, с дневником погибшего исследователя или вовсе без
// постоянного источника — потому что метка каждый раз своя, под книгу.

import { callLLM, extractJSON } from './llm.js';
import { tokensOf, tfvec, cosine } from './bible.js';

const SETUP_TYPES = ['серьёзный_вопрос', 'напряжённый_момент', 'бытовая_реплика', 'другое'];
const STYLE_TYPES = ['бюрократический_абсурд', 'буквализм', 'неожиданная_смена_темы', 'каламбур', 'ирония_положения', 'физическая_комедия', 'другое'];

export function craftSignatureMessages(sceneText){
  const sys = [
    'Ты — аналитик СТРУКТУРЫ комедийных/напряжённых битов сцены. Ты НЕ оцениваешь качество и НЕ пересказываешь сюжет — только классифицируешь структуру уже написанного.',
    `Для каждого юмористического/иронического бита классифицируй setup и style СТРОГО одной из категорий (не придумывай свои):`,
    `  setup: ${SETUP_TYPES.join(' | ')}`,
    `  style: ${STYLE_TYPES.join(' | ')}`,
    'channel — короткая (2-4 слова) метка ТИПА источника, который подаёт этот бит именно в этой книге (примеры формата, не значения: «ИИ-спутник», «второстепенный персонаж», «внутренний монолог героя», «рассказчик», «говорящий предмет» — назови то, что реально подходит под эту сцену, не заимствуй чужой пример).',
    'Отдельно (не по битам, а по сцене в целом) — каким типом источника сцена ПОДАЁТ ЧИТАТЕЛЮ информацию о мире/сюжете (экспозицию), если подаёт вообще: та же логика свободной метки; если сцена не несёт новой информации о мире/сюжете — верни "нет_экспозиции".',
  ].join('\n');
  const user = ['СЦЕНА:', sceneText, '',
    'Верни JSON: { "beats":[{"setup":"...","channel":"...","style":"...","quote":"фрагмент до 150 симв"}], "expositionChannel":"короткая метка или нет_экспозиции" }. До 3 битов (0, если в сцене нет юмора/иронии — не выдумывай). Только JSON.',
  ].join('\n');
  return [{role:'system',content:sys},{role:'user',content:user}];
}

function norm(v, list){ return list.includes(v) ? v : 'другое'; }

// Одна маленькая LLM-генерация на сцену (~500 ток., тот же порядок цены, что
// один обычный Страж) — вызывается один раз при завершении сцены, не при
// каждой итерации правки. Не блокирует основной пайплайн: вызывающий код
// (ui/stages.js) должен звать это с .catch(()=>null), как уже делается для
// необязательных проверок вроде driftCheck.
export async function extractCraftSignature(state, scene){
  const g = state.global;
  if(!g?.apiKey || !scene?.text) return null;
  const res = await callLLM({ baseURL:g.baseURL, apiKey:g.apiKey, model:g.model, temperature:0.2,
    messages: craftSignatureMessages(scene.text), maxTokens:500, retries:g.retries });
  const j = extractJSON(res.text);
  if(!j) return null;
  return {
    beats: Array.isArray(j.beats) ? j.beats.slice(0, 3).map(b => ({
      setup: norm(String(b?.setup||''), SETUP_TYPES),
      channel: String(b?.channel||'').slice(0, 40).trim() || 'другое',
      style: norm(String(b?.style||''), STYLE_TYPES),
      quote: String(b?.quote||'').slice(0, 150),
    })) : [],
    expositionChannel: String(j.expositionChannel||'').slice(0, 40).trim() || 'нет_экспозиции',
  };
}

// Группировка меток канала по смысловому сходству, не точному совпадению
// строки — модель может назвать один и тот же источник чуть по-разному между
// сценами ("ИИ-спутник" vs "спутник ИИ"). Порог — тот же принцип, что
// REJECT_SIM_THRESHOLD в pipeline.js для аналогичных решений «это по сути то
// же самое», но ниже (короткие 2-4-словные метки, не полные фразы — им нужен
// менее строгий порог, чтобы близкие переформулировки склеивались).
const CHANNEL_SIM_THRESHOLD = 0.5;
function sameChannel(a, b){
  if(!a || !b) return false;
  if(a.toLowerCase() === b.toLowerCase()) return true;
  return cosine(tfvec(tokensOf(a)), tfvec(tokensOf(b))) >= CHANNEL_SIM_THRESHOLD;
}

// Порог, с которого повтор структуры (setup+style+канал) — уже системный тик
// книги, а не совпадение между парой сцен.
const HUMOR_PATTERN_MIN_SCENES = 4;

// Чистый код, БЕЗ LLM — сравнение идёт по уже извлечённым категориям.
export function detectRepeatingHumorPattern(craftSignals, sceneTitleById){
  const buckets = [];
  Object.entries(craftSignals || {}).forEach(([sceneId, sig]) => {
    (sig?.beats || []).forEach(b => {
      let bucket = buckets.find(k => k.setup === b.setup && k.style === b.style && sameChannel(k.channelRep, b.channel));
      if(!bucket){ bucket = { setup: b.setup, style: b.style, channelRep: b.channel, occurrences: [] }; buckets.push(bucket); }
      bucket.occurrences.push({ sceneId, sceneTitle: sceneTitleById[sceneId] || sceneId, quote: b.quote });
    });
  });
  return buckets.filter(b => b.occurrences.length >= HUMOR_PATTERN_MIN_SCENES);
}

const CHANNEL_DOMINANCE_RATIO = 0.6;

// Тоже чистый код — не требует жанрового эталона, просто считает, не доминирует
// ли ОДИН тип источника (какой бы он ни был в этой конкретной книге) над
// подачей информации читателю сильнее, чем 60% сцен, где вообще есть экспозиция.
export function dominantExpositionChannel(craftSignals, sceneTitleById){
  const entries = Object.entries(craftSignals || {}).filter(([, sig]) => sig?.expositionChannel && sig.expositionChannel !== 'нет_экспозиции');
  if(entries.length < 4) return null;
  const groups = [];
  entries.forEach(([sceneId, sig]) => {
    let g = groups.find(x => sameChannel(x.rep, sig.expositionChannel));
    if(!g){ g = { rep: sig.expositionChannel, sceneIds: [] }; groups.push(g); }
    g.sceneIds.push(sceneId);
  });
  const biggest = groups.reduce((a, b) => (b.sceneIds.length > a.sceneIds.length ? b : a), groups[0]);
  const ratio = biggest.sceneIds.length / entries.length;
  return ratio >= CHANNEL_DOMINANCE_RATIO
    ? { channel: biggest.rep, ratio, count: biggest.sceneIds.length, total: entries.length, scenes: biggest.sceneIds.map(id=>sceneTitleById[id]||id) }
    : null;
}
