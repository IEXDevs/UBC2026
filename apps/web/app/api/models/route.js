import { readRootEnv } from '../../../lib/root-env.mjs';
import { META_MODEL_BASE } from '../../../lib/text-chat.mjs';
import { fallbackThinkingCatalog, loadThinkingCatalog } from '../../../lib/thinking-levels.mjs';

export async function GET() {
  const apiKey = readRootEnv('META_MODEL_API_KEY');
  const loaded = await loadThinkingCatalog({ apiKey, baseUrl: META_MODEL_BASE });
  const models = loaded.length > 0 ? loaded : fallbackThinkingCatalog();
  return Response.json({ models }, { headers: { 'Cache-Control': 'no-store' } });
}
