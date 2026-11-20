import { readRootEnv } from '../../../../lib/root-env.mjs';
import { fetchAgentRuntime } from '../../../../lib/runtime-fetch.mjs';

/**
 * Push Worker custom-LLM URL + webhook secret into the ElevenLabs agent.
 * Auth to the runtime with the webhook secret when the web Worker has it, else
 * the ElevenLabs API key (already required for /api/voice/token).
 */
export async function POST() {
  // Public URL optional when AGENT_RUNTIME service binding is present.
  const runtime = readRootEnv('NEXT_PUBLIC_AGENT_RUNTIME_URL')
    || 'https://runtime.maelstrom.iexdevs.com';
  const webhookSecret = readRootEnv('ELEVENLABS_WEBHOOK_SECRET');
  const apiKey = readRootEnv('ELEVENLABS_API_KEY');
  const authSecret = webhookSecret || apiKey;
  if (!authSecret) {
    return Response.json(
      {
        error: 'voice_sync_unconfigured',
        missing: ['ELEVENLABS_WEBHOOK_SECRET|ELEVENLABS_API_KEY'],
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  let base;
  try {
    base = new URL(runtime.trim());
  } catch {
    return Response.json({ error: 'runtime_unconfigured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const response = await fetchAgentRuntime(new URL('/voice/agent/sync', base), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(webhookSecret
          ? { 'x-elevenlabs-webhook-secret': webhookSecret }
          : { authorization: `Bearer ${apiKey}` }),
      },
      body: '{}',
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    return Response.json(
      {
        ok: payload.ok === true,
        error: payload.error || (response.ok ? undefined : 'voice_sync_failed'),
        agentId: typeof payload.agentId === 'string' ? payload.agentId : undefined,
        customLlmUrl: typeof payload.customLlmUrl === 'string' ? payload.customLlmUrl : undefined,
      },
      { status: response.ok ? 200 : (response.status === 401 ? 401 : 502), headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json({ error: 'voice_sync_unreachable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
