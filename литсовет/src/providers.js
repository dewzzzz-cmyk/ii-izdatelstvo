// Известные OpenAI-совместимые текстовые провайдеры — общие данные для
// Настроек (ui/app.js), per-роль переопределения в панели агентов
// (ui/diagnostics.js) и резолва ключа/URL в llmFor() (state.js). Один
// источник вместо трёх копий одного и того же списка.

export const TEXT_PROVIDERS = [
  { v:'deepseek', label:'DeepSeek',       baseURL:'https://api.deepseek.com', model:'deepseek-chat' },
  { v:'openai',   label:'OpenAI',         baseURL:'https://api.openai.com/v1', model:'gpt-5' },
  { v:'gemini',   label:'Google Gemini',  baseURL:'https://generativelanguage.googleapis.com/v1beta/openai/', model:'gemini-2.5-flash' },
  { v:'qwen',     label:'Qwen (Alibaba)', baseURL:'https://dashscope.aliyuncs.com/compatible-mode/v1', model:'qwen-plus' },
  { v:'custom',   label:'Другой…',        baseURL:'', model:'' },
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
  gemini: ['gemini-2.5-flash'],
  qwen: ['qwen-plus'],
};

export function matchTextProvider(baseURL){
  const found = TEXT_PROVIDERS.find(p=>p.v!=='custom' && p.baseURL===baseURL);
  return found ? found.v : 'custom';
}

export function providerById(v){
  return TEXT_PROVIDERS.find(p=>p.v===v) || null;
}
