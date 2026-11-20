import { META_SPARK_MODEL, META_SPARK_NAME, thinkingLevelsForModel } from './thinking-levels.mjs';
import { reportedContextWindow } from './context-usage.mjs';
import { OPENROUTER_FREE_MODEL, selectFreeOpenRouterModel } from '@ubc2026/contracts';

// Only these exact API roots may receive browser-supplied credentials server-side.
// Never follow redirects or use an arbitrary URL as an inference proxy.
export const AI_PROVIDERS = [
  { name: 'Meta', baseUrl: 'https://api.meta.ai/v1', provider: 'meta' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', provider: 'openai' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', provider: 'openrouter' },
];
export const MODEL_ID = /^[A-Za-z0-9_.:/-]{1,80}$/;

export function accountProviderModels(models, provider) {
  // Only advertise choices that account inference will actually run unchanged.
  if (provider === 'meta') return models.filter(model => model.id === META_SPARK_MODEL);
  return models.filter(model => provider !== 'openrouter' || selectFreeOpenRouterModel(model.id) === model.id);
}

export function fallbackAccountModels(provider) {
  return provider === 'openrouter'
    ? [{ id: OPENROUTER_FREE_MODEL, name: 'Llama 3.3 70B (free)', levels: [], contextWindow: 0 }]
    : [];
}

export function aiProvider(baseUrl) {
  if (typeof baseUrl !== 'string') return null;
  return AI_PROVIDERS.find(item => item.baseUrl === baseUrl.trim().replace(/\/$/, '')) || null;
}

export function parseModelProvider(value) {
  const endpoint = aiProvider(value?.baseUrl);
  const token = typeof value?.token === 'string' ? value.token.trim() : '';
  if (!endpoint || !/^[^\s]{8,4096}$/.test(token)) return null;
  return { ...endpoint, apiKey: token };
}

export function parseProviderModels(payload, provider = 'meta') {
  const rows = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload) ? payload : []);
  const seen = new Set();
  return rows.flatMap(row => {
    const id = typeof row?.id === 'string' ? row.id.trim() : '';
    if (!MODEL_ID.test(id) || seen.has(id)) return [];
    if (provider === 'meta' && id !== META_SPARK_MODEL) return [];
    // These APIs also advertise image/audio/embedding models, which cannot chat.
    if (provider === 'openai' && (!/^(gpt-|chatgpt-|o[1-9](?:-|$))/.test(id)
      || /audio|realtime|transcrib|tts|image|search/.test(id))) return [];
    if (Array.isArray(row.architecture?.output_modalities) && !row.architecture.output_modalities.includes('text')) return [];
    if (Array.isArray(row.supported_parameters) && !row.supported_parameters.includes('tools')) return [];
    seen.add(id);
    return [{
      id,
      name: provider === 'meta' ? META_SPARK_NAME
        : typeof row.name === 'string' && row.name.trim() ? row.name.trim().slice(0, 80) : id,
      levels: thinkingLevelsForModel(row),
      contextWindow: reportedContextWindow(row) || 0,
    }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export async function checkProviderModels({ baseUrl, apiKey, fetcher = fetch }) {
  const endpoint = aiProvider(baseUrl);
  if (!endpoint || !apiKey) return { ok: false, error: 'provider_not_supported' };
  try {
    const response = await fetcher(`${endpoint.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      // Workers rejects redirect 'error'; a 3xx is !ok and fails below.
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return { ok: false, error: [401, 403].includes(response.status) ? 'provider_unauthorized' : 'provider_unavailable' };
    const payload = await response.json();
    if (!Array.isArray(payload?.data) && !Array.isArray(payload)) return { ok: false, error: 'provider_invalid_catalog' };
    return { ok: true, models: parseProviderModels(payload, endpoint.provider) };
  } catch {
    // Raw provider/network errors can contain keys. Only return our own codes.
    return { ok: false, error: 'provider_unavailable' };
  }
}
