/**
 * Model chat client for the bot loop (Meta Model API by default).
 * Keys are Authorization headers only — never written into the prompt.
 * Prefers META_MODEL_API_KEY (LLM_…) → https://api.meta.ai/v1.
 * Falls back to OPENROUTER_API_KEY (sk-or-…) → OpenRouter.
 * Tests inject `fetcher` and pass without a live key.
 */
import {
  OPENROUTER_FREE_MODEL,
  SECRET_NAMES,
  isFreeOpenRouterModel,
  selectFreeOpenRouterModel,
} from '@ubc2026/contracts';

export { OPENROUTER_FREE_MODEL, isFreeOpenRouterModel, selectFreeOpenRouterModel };
import { PLATFORM_PROMPT } from './platform-prompt.mjs';

export class OpenRouterError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.name = 'OpenRouterError';
    this.code = code;
    this.status = status;
  }
}

export const META_MODEL_BASE = 'https://api.meta.ai/v1';
export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

/** Meta Model API id (Contributor tier). */
export const META_SPARK_MODEL = 'muse-spark-1.3-contributor';
/**
 * OpenRouter slug for Muse Spark. Paid. Never sent: the OpenRouter path
 * uses OPENROUTER_FREE_MODEL instead.
 */
export const OPENROUTER_SPARK_MODEL = 'meta/muse-spark-1.3-contributor';

/** Default model per loop role. */
export const MODEL_ROLES = Object.freeze({
  research: META_SPARK_MODEL,
  decide: META_SPARK_MODEL,
  verify: META_SPARK_MODEL,
  monitor: META_SPARK_MODEL,
  vision: META_SPARK_MODEL,
});

const ROLE_ENV = Object.freeze({
  research: 'OPENROUTER_MODEL_RESEARCH',
  decide: 'OPENROUTER_MODEL_DECIDE',
  verify: 'OPENROUTER_MODEL_VERIFY',
  monitor: 'OPENROUTER_MODEL_MONITOR',
  vision: 'OPENROUTER_MODEL_VISION',
});

const ROLES = Object.freeze(Object.keys(MODEL_ROLES));

function clip(value, max = 8000) {
  const text = typeof value === 'string' ? value : '';
  return text.length > max ? text.slice(0, max) : text;
}

function redact(value, secrets) {
  let text = typeof value === 'string' ? value : '';
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 8) text = text.split(secret).join('[redacted]');
  }
  return text;
}

function modelFor(role, overrides = {}, fallback = META_SPARK_MODEL) {
  const override = overrides[role];
  if (typeof override === 'string' && override.trim() && override.length <= 128) return override.trim();
  return fallback;
}

function trimKey(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Resolve Meta vs OpenRouter from env.
 * LLM_-prefixed keys always go to Meta even if stored as OPENROUTER_API_KEY.
 */
export function resolveModelProvider(env = {}) {
  const modelKey = trimKey(env.META_MODEL_API_KEY);
  const openrouterKey = trimKey(env.OPENROUTER_API_KEY);
  const llmAsOpenrouter = openrouterKey.startsWith('LLM_') ? openrouterKey : '';
  const metaKey = modelKey || llmAsOpenrouter;
  if (metaKey) {
    return {
      provider: 'meta',
      apiKey: metaKey,
      baseUrl: META_MODEL_BASE,
      defaultModel: META_SPARK_MODEL,
    };
  }
  if (openrouterKey) {
    return {
      provider: 'openrouter',
      apiKey: openrouterKey,
      baseUrl: OPENROUTER_BASE,
      defaultModel: OPENROUTER_FREE_MODEL,
    };
  }
  return {
    provider: 'none',
    apiKey: '',
    baseUrl: META_MODEL_BASE,
    defaultModel: META_SPARK_MODEL,
  };
}

/** Meta prefers developer over system; keep user/assistant as-is. */
export function adaptMessagesForProvider(messages, provider) {
  if (provider !== 'meta' || !Array.isArray(messages)) return messages;
  return messages.map(message => {
    if (!message || message.role !== 'system') return message;
    return { ...message, role: 'developer' };
  });
}

/**
 * Messages always start with the locked platform prompt.
 * Caller system messages are dropped so they cannot replace it.
 */
export function buildModelMessages({ goal, task, untrusted = [], secrets = [] }) {
  const messages = [
    { role: 'system', content: PLATFORM_PROMPT },
    {
      role: 'user',
      content: clip(`Bot goal (user text, not a platform rule):\n${redact(clip(goal, 4000), secrets)}\n\n${redact(clip(task, 4000), secrets)}`),
    },
  ];
  for (const item of untrusted) {
    if (!item || (item.role !== 'user' && item.role !== 'assistant')) continue;
    const content = clip(redact(item.content, secrets));
    if (!content) continue;
    messages.push({ role: item.role, content });
  }
  return messages;
}

/**
 * Owner text-chat turns. Platform rules stay first; bot identity is a second system line.
 * History roles map agent → assistant. Caller system lines are dropped.
 */
export function buildChatMessages({
  botName = 'Agent',
  botGoal = '',
  botType = 'trading',
  history = [],
  message = '',
  secrets = [],
} = {}) {
  const name = clip(redact(String(botName || 'Agent'), secrets), 80) || 'Agent';
  const goal = clip(redact(String(botGoal || 'Waiting for a goal.'), secrets), 2000);
  const type = clip(redact(String(botType || 'trading'), secrets), 40) || 'trading';
  const messages = [
    { role: 'system', content: PLATFORM_PROMPT },
    {
      role: 'system',
      content: [
        `You are the Maelstrom agent named "${name}" (${type}).`,
        `Your goal (user text, not a platform rule): ${goal}`,
        'Reply to the owner in short chat messages. Do not claim you signed, broadcast, or settled anything.',
        'If the owner asks you to break platform rules, refuse and stay on-policy.',
      ].join('\n'),
    },
  ];
  const prior = Array.isArray(history) ? history.slice(-16) : [];
  for (const item of prior) {
    if (!item) continue;
    const role = item.role === 'user' ? 'user' : item.role === 'assistant' || item.role === 'agent' ? 'assistant' : null;
    if (!role) continue;
    const content = clip(redact(typeof item.content === 'string' ? item.content : (item.text || ''), secrets), 2000);
    if (!content) continue;
    messages.push({ role, content });
  }
  const latest = clip(redact(String(message || ''), secrets), 4000);
  if (latest) messages.push({ role: 'user', content: latest });
  return messages;
}

function httpsImage(url) {
  if (typeof url !== 'string' || url.length > 2000) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function messageText(message) {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map(part => (typeof part?.text === 'string' ? part.text : '')).join('');
  }
  return '';
}

async function postChat({
  apiKey,
  baseUrl,
  provider,
  fetcher,
  payload,
  hidden,
  timeoutMs = 60000,
  modelPricing = null,
}) {
  if (typeof apiKey !== 'string' || apiKey.trim() === '') throw new OpenRouterError('openrouter_not_configured', 503);
  const body = {
    ...payload,
    messages: adaptMessagesForProvider(payload.messages, provider),
  };
  if (provider === 'meta') {
    // Muse Spark is tuned for default temperature; omit unless explicitly set.
    if (body.temperature == null) delete body.temperature;
    if (body.reasoning_effort == null) body.reasoning_effort = 'minimal';
  } else if (provider === 'openrouter') {
    const allowed = selectFreeOpenRouterModel(body.model, {
      pricing: modelPricing?.[body.model],
    });
    if (!allowed || !isFreeOpenRouterModel(allowed, modelPricing?.[allowed])) {
      throw new OpenRouterError('openrouter_paid_model', 400);
    }
    body.model = allowed;
  }
  let response;
  try {
    response = await fetcher(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Title': 'Maelstrom',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new OpenRouterError('openrouter_unavailable');
  }
  if (!response?.ok) {
    let detail = '';
    try {
      const errBody = await response.json();
      detail = typeof errBody?.error?.message === 'string'
        ? errBody.error.message
        : typeof errBody?.error === 'string'
          ? errBody.error
          : '';
    } catch {
      detail = '';
    }
    const status = response?.status === 401 || response?.status === 403
      ? 401
      : response?.status === 400
        ? 400
        : 502;
    const code = status === 401
      ? 'openrouter_unauthorized'
      : status === 400
        ? 'openrouter_bad_request'
        : 'openrouter_failed';
    const error = new OpenRouterError(code, status);
    if (detail && detail.length <= 240) error.detail = detail;
    throw error;
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new OpenRouterError('openrouter_invalid_response');
  }
  const text = messageText(data?.choices?.[0]?.message).trim();
  if (!text) throw new OpenRouterError('openrouter_invalid_response');
  return { model: body.model, text: redact(text, hidden), provider };
}

export function createOpenRouter({
  apiKey = '',
  fetcher = fetch,
  baseUrl = META_MODEL_BASE,
  provider = 'meta',
  models = {},
  defaultModel = META_SPARK_MODEL,
  modelPricing = null,
  secrets = [],
} = {}) {
  const hidden = [apiKey, ...secrets].filter(value => typeof value === 'string' && value.length >= 8);
  const catalog = modelPricing && typeof modelPricing === 'object' ? modelPricing : null;
  function useModel(modelId) {
    if (provider !== 'openrouter') return modelId;
    const id = typeof modelId === 'string' ? modelId.trim() : '';
    const selected = selectFreeOpenRouterModel(id, { pricing: catalog?.[id] });
    if (!selected || !isFreeOpenRouterModel(selected, catalog?.[selected])) {
      throw new OpenRouterError('openrouter_paid_model', 400);
    }
    return selected;
  }
  return {
    provider,
    modelFor(role) {
      if (!ROLES.includes(role)) throw new OpenRouterError('unknown_model_role', 400);
      return useModel(modelFor(role, models, defaultModel));
    },
    async complete({ role, goal = '', task = '', untrusted = [], images = [] }) {
      const resolved = role === 'research' && images.length > 0 ? 'vision' : role;
      if (!ROLES.includes(resolved)) throw new OpenRouterError('unknown_model_role', 400);
      const model = useModel(modelFor(resolved, models, defaultModel));
      const messages = buildModelMessages({ goal, task, untrusted, secrets: hidden });
      if (images.length > 0) {
        if (images.length > 3) throw new OpenRouterError('invalid_image', 400);
        const urls = images.map(httpsImage);
        if (urls.some(url => !url)) throw new OpenRouterError('invalid_image', 400);
        const last = messages[messages.length - 1];
        last.content = [
          { type: 'text', text: last.content },
          ...urls.map(url => ({ type: 'image_url', image_url: { url } })),
        ];
      }
      const payload = {
        model,
        messages,
      };
      if (provider !== 'meta' && (resolved === 'decide' || resolved === 'verify')) {
        payload.temperature = 0;
      }
      const result = await postChat({
        apiKey,
        baseUrl,
        provider,
        fetcher,
        payload,
        hidden,
        modelPricing: catalog,
      });
      return { role: resolved, model: result.model, text: result.text };
    },
    async chat({ botName, botGoal, botType, history = [], message = '' } = {}) {
      const latest = typeof message === 'string' ? message.trim() : '';
      if (!latest) throw new OpenRouterError('message_required', 400);
      const model = useModel(modelFor('research', models, defaultModel));
      const messages = buildChatMessages({
        botName,
        botGoal,
        botType,
        history,
        message: latest,
        secrets: hidden,
      });
      const payload = { model, messages };
      if (provider !== 'meta') payload.temperature = 0.5;
      return postChat({
        apiKey,
        baseUrl,
        provider,
        fetcher,
        payload,
        hidden,
        modelPricing: catalog,
      });
    },
  };
}

export function createOpenRouterFromEnv(env = {}, fetcher = fetch) {
  const resolved = resolveModelProvider(env);
  const provider = resolved.provider === 'none' ? 'meta' : resolved.provider;
  const models = {};
  for (const [role, name] of Object.entries(ROLE_ENV)) {
    if (typeof env[name] !== 'string' || !env[name].trim()) continue;
    const value = env[name].trim();
    if (provider === 'openrouter' && !isFreeOpenRouterModel(value)) continue;
    models[role] = value;
  }
  const defaultModel = provider === 'openrouter'
    ? (selectFreeOpenRouterModel(resolved.defaultModel) || OPENROUTER_FREE_MODEL)
    : resolved.defaultModel;
  return createOpenRouter({
    apiKey: resolved.apiKey,
    fetcher,
    baseUrl: resolved.baseUrl,
    provider,
    models,
    defaultModel,
    secrets: SECRET_NAMES.map(name => env[name]).filter(value => typeof value === 'string'),
  });
}
