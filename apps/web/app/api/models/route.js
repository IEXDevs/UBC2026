import { readRootEnv } from '../../../lib/root-env.mjs';
import { resolveTextChatProvider } from '../../../lib/text-chat.mjs';
import { fallbackThinkingCatalog } from '../../../lib/thinking-levels.mjs';
import { accountProviderModels, checkProviderModels, fallbackAccountModels, parseModelProvider } from '../../../lib/ai-provider.mjs';

const HEADERS = { 'Cache-Control': 'no-store' };

export async function GET() {
  const resolved = resolveTextChatProvider({
    metaModelApiKey: readRootEnv('META_MODEL_API_KEY'),
    openrouterApiKey: readRootEnv('OPENROUTER_API_KEY'),
  });
  const result = await checkProviderModels(resolved);
  // Account OpenRouter keys retain the existing free-only inference policy.
  const available = result.ok ? accountProviderModels(result.models, resolved.provider) : [];
  const models = result.ok ? available : (resolved.provider === 'openrouter' ? fallbackAccountModels('openrouter') : fallbackThinkingCatalog());
  return Response.json({ models, checked: result.ok, ...(!result.ok ? { error: result.error } : {}) }, { headers: HEADERS });
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'provider_required' }, { status: 400, headers: HEADERS }); }
  const provider = parseModelProvider(body);
  if (!provider) return Response.json({ error: 'provider_not_supported' }, { status: 400, headers: HEADERS });
  const result = await checkProviderModels(provider);
  return Response.json(result, { status: result.ok ? 200 : 502, headers: HEADERS });
}
