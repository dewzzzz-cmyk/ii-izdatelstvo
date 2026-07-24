// Известные OpenAI-совместимые текстовые провайдеры — общие данные для
// Настроек (ui/app.js), per-роль переопределения в панели агентов
// (ui/diagnostics.js) и резолва ключа/URL в llmFor() (state.js). Один
// источник вместо трёх копий одного и того же списка.

export const TEXT_PROVIDERS = [
  { v:'deepseek',  label:'DeepSeek',           baseURL:'https://api.deepseek.com', model:'deepseek-chat' },
  { v:'openai',    label:'OpenAI',             baseURL:'https://api.openai.com/v1', model:'gpt-5' },
  { v:'anthropic', label:'Claude (Anthropic)', baseURL:'https://api.anthropic.com', model:'claude-sonnet-5' },
  { v:'gemini',    label:'Google Gemini',      baseURL:'https://generativelanguage.googleapis.com/v1beta/openai/', model:'gemini-2.5-flash' },
  { v:'qwen',      label:'Qwen (Alibaba)',     baseURL:'https://dashscope.aliyuncs.com/compatible-mode/v1', model:'qwen-plus' },
  { v:'moonshot',  label:'Kimi (Moonshot AI)', baseURL:'https://api.moonshot.ai/v1', model:'kimi-k2.6' },
  { v:'zhipu',     label:'GLM (Zhipu / Z.ai)', baseURL:'https://api.z.ai/api/openai/v1', model:'glm-4.7' },
  { v:'custom',    label:'Другой…',            baseURL:'', model:'' },
];

// Подсказки моделей на провайдера — то же поле остаётся свободным текстом
// («✎ другая модель…» в Настройках/панели агентов), но список даёт видимый
// выбор вместо пустого текстового поля.
// deepseek-chat/deepseek-reasoner официально устаревают 2026-07-24 (замена —
// deepseek-v4-flash/deepseek-v4-pro), но старые имена пока работают ради
// совместимости — оставляем их в списке, чтобы уже сохранённый выбор не
// потерялся сам по себе.
export const TEXT_MODEL_OPTIONS = {
  deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
  // Требует платного API-ключа с console.anthropic.com (pay-as-you-go) —
  // подписка Claude.ai Pro/Max программного доступа НЕ даёт, ключ от нее
  // здесь не подойдёт (см. предупреждение у поля ключа в Настройках).
  anthropic: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
  // gemini-2.5-flash официально снимается с продажи 2026-10-16 — оставлен как
  // единственный проверенный вариант на момент добавления; обновите список,
  // когда решите переходить на 3.x.
  gemini: ['gemini-2.5-flash'],
  qwen: ['qwen-plus'],
  // kimi-k2/moonshot-v1 сняты с продажи 2026-05-25 (замена — k2.6/k3) — только
  // актуальные id.
  moonshot: ['kimi-k2.6', 'kimi-k3'],
  // glm-4.7-flash бесплатен для зарегистрированных аккаунтов Z.ai.
  zhipu: ['glm-4.7', 'glm-4.7-flash'],
};

// Цены за 1M токенов (вход/выход, $) — единый источник и для оценки расхода
// (state.js реэкспортирует это как PRICES), и для подсказки прямо в селекте
// модели (см. priceLabel ниже). Проверено веб-поиском на момент добавления
// каждой модели (не по памяти) — при расхождении с реальным прайсом
// провайдера ориентируйтесь на официальный сайт, эти числа обновляются
// только при явном ревью.
export const MODEL_PRICES = {
  'deepseek-chat':     { in:0.14,  out:0.28 },
  'deepseek-reasoner': { in:0.55,  out:2.19 },
  'deepseek-v4-flash': { in:0.14,  out:0.28 },
  'deepseek-v4-pro':   { in:0.435, out:0.87 },
  'gpt-4o':            { in:2.5,   out:10 },
  'gpt-4o-mini':       { in:0.15,  out:0.6 },
  // Anthropic (console.anthropic.com) — claude-opus-4-8 подтверждена по
  // официальному прайсу; sonnet-5/haiku-4-5 оценены по историческим тарифам
  // своих тиров, сверьте на anthropic.com/pricing после релиза этих моделей.
  'claude-opus-4-8':   { in:5,     out:25 },
  'claude-sonnet-5':   { in:3,     out:15 },
  'claude-haiku-4-5':  { in:1,     out:5 },
  'gemini-2.5-flash':  { in:0.3,   out:2.5 },
  'qwen-plus':         { in:0.26,  out:0.78 },
  'kimi-k2.6':         { in:0.95,  out:4 },
  'kimi-k3':           { in:3,     out:15 },
  'glm-4.7':           { in:0.6,   out:2.2 },
  'glm-4.7-flash':     { in:0,     out:0 },
};

// Короткая подсказка для option/label — «$0.60 / $2.20 за 1M ток.», или
// «бесплатно», или '' для неизвестной модели (свободный текст в «✎ другая…»).
export function priceLabel(model){
  const p = MODEL_PRICES[model];
  if(!p) return '';
  if(!p.in && !p.out) return 'бесплатно';
  const fmt = v => v.toFixed(3).replace(/0+$/,'').replace(/\.$/,'');
  return `$${fmt(p.in)}/$${fmt(p.out)} за 1M ток.`;
}

export function matchTextProvider(baseURL){
  const found = TEXT_PROVIDERS.find(p=>p.v!=='custom' && p.baseURL===baseURL);
  return found ? found.v : 'custom';
}

export function providerById(v){
  return TEXT_PROVIDERS.find(p=>p.v===v) || null;
}
