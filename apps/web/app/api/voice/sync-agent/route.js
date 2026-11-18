import { readRootEnv } from '../../../../lib/root-env.mjs';
import { fetchAgentRuntime } from '../../../../lib/runtime-fetch.mjs';

/**
 * Push Worker custom-LLM URL + webhook secret into the ElevenLabs agent.
 * Uses server-side secrets only — never returns secret values.
 */
export async function POST() {
  const runtime = readRootEnv('NEXT_PUBLIC_AGENT_RUNTIME_URL');
  const secret = readRootEnv('ELEVENLABS_WEBHOOK_SECRET');
  if (!runtime || !secret) {
    return Response.json({ error: 'voice_sync_unconfigured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
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
        'x-elevenlabs-webhook-secret': secret,
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
