/**
 * OpenRouter chat client for the bot loop.
 * The API key is sent only as an Authorization header. It is never written into the prompt.
 * Tests inject `fetcher` and pass without a live key.
 */
import { SECRET_NAMES } from '@ubc2026/contracts';
import { PLATFORM_PROMPT } from './platform-prompt.mjs';

export class OpenRouterError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.name = 'OpenRouterError';
    this.code = code;
    this.status = status;
  }
}

/** OpenRouter slugs. Fast model for research and monitor; strong model for decide and verify. */
export const MODEL_ROLES = Object.freeze({
  research: 'x-ai/grok-4-fast',
  decide: 'x-ai/grok-4.7',
  verify: 'x-ai/grok-4.7',
  monitor: 'x-ai/grok-4-fast',
  vision: 'x-ai/grok-4',
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

function modelFor(role, overrides = {}) {
  const override = overrides[role];
  if (typeof override === 'string' && override.trim() && override.length <= 128) return override.trim();
  return MODEL_ROLES[role];
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

export function createOpenRouter({
  apiKey = '',
  fetcher = fetch,
  baseUrl = 'https://openrouter.ai/api/v1',
  models = {},
  secrets = [],
} = {}) {
  const hidden = [apiKey, ...secrets].filter(value => typeof value === 'string' && value.length >= 8);
  return {
    modelFor(role) {
      if (!ROLES.includes(role)) throw new OpenRouterError('unknown_model_role', 400);
      return modelFor(role, models);
    },
    async complete({ role, goal = '', task = '', untrusted = [], images = [] }) {
      if (typeof apiKey !== 'string' || apiKey.trim() === '') throw new OpenRouterError('openrouter_not_configured', 503);
      const resolved = role === 'research' && images.length > 0 ? 'vision' : role;
      if (!ROLES.includes(resolved)) throw new OpenRouterError('unknown_model_role', 400);
      const model = modelFor(resolved, models);
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
        temperature: resolved === 'decide' || resolved === 'verify' ? 0 : undefined,
        messages,
      };
      if (payload.temperature == null) delete payload.temperature;
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
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30000),
        });
      } catch {
        throw new OpenRouterError('openrouter_unavailable');
      }
      if (!response?.ok) {
        const status = response?.status === 401 ? 401 : 502;
        throw new OpenRouterError(response?.status === 401 ? 'openrouter_unauthorized' : 'openrouter_failed', status);
      }
      let data;
      try {
        data = await response.json();
      } catch {
        throw new OpenRouterError('openrouter_invalid_response');
      }
      const text = messageText(data?.choices?.[0]?.message).trim();
      if (!text) throw new OpenRouterError('openrouter_invalid_response');
      return { role: resolved, model, text: redact(text, hidden) };
    },
  };
}

export function createOpenRouterFromEnv(env = {}, fetcher = fetch) {
  const models = {};
  for (const [role, name] of Object.entries(ROLE_ENV)) {
    if (typeof env[name] === 'string' && env[name].trim()) models[role] = env[name].trim();
  }
  return createOpenRouter({
    apiKey: typeof env.OPENROUTER_API_KEY === 'string' ? env.OPENROUTER_API_KEY : '',
    fetcher,
    models,
    secrets: SECRET_NAMES.map(name => env[name]).filter(value => typeof value === 'string'),
  });
}
