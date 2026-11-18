import { readRootEnv } from '../../../../lib/root-env.mjs';
import { requestVoiceSignedUrl, requestVoiceToken, VoiceTokenError } from '../../../../lib/voice-token.mjs';
import { voiceOverrides, voiceSession } from '../../../../lib/voice-settings.mjs';
import { fetchAgentRuntime } from '../../../../lib/runtime-fetch.mjs'; // apps/web/lib

async function bestEffortSyncAgent() {
  const runtime = readRootEnv('NEXT_PUBLIC_AGENT_RUNTIME_URL')
    || 'https://runtime.maelstrom.iexdevs.com';
  const webhookSecret = readRootEnv('ELEVENLABS_WEBHOOK_SECRET');
  const apiKey = readRootEnv('ELEVENLABS_API_KEY');
  const authSecret = webhookSecret || apiKey;
  if (!authSecret) return { ok: false, error: 'voice_sync_unconfigured' };
  let base;
  try {
    base = new URL(runtime.trim());
  } catch {
    return { ok: false, error: 'runtime_unconfigured' };
  }
  const work = (async () => {
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
    return {
      ok: payload.ok === true,
      error: payload.error || (response.ok ? undefined : 'voice_sync_failed'),
    };
  })();
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve({ ok: false, error: 'voice_sync_timeout' }), 4_000);
  });
  try {
    return await Promise.race([work, timeout]);
  } catch {
    return { ok: false, error: 'voice_sync_unreachable' };
  }
}

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const session = voiceSession(body);
  const apiKey = readRootEnv('ELEVENLABS_API_KEY');
  const agentId = readRootEnv('ELEVENLABS_AGENT_ID');
  try {
    // Refresh custom-LLM URL / webhook secret before minting so the first
    // LiveKit probe does not 401 and tear the room down.
    const sync = await bestEffortSyncAgent();
    const token = await requestVoiceToken({ apiKey, agentId });
    let signedUrl = '';
    try {
      signedUrl = await requestVoiceSignedUrl({ apiKey, agentId });
    } catch {
      signedUrl = '';
    }
    return Response.json(
      {
        token,
        ...(signedUrl ? { signedUrl } : {}),
        voiceId: session.voiceId,
        speed: session.speed,
        language: session.language,
        overrides: voiceOverrides(session),
        syncOk: sync.ok === true,
        syncError: sync.ok ? undefined : sync.error,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const code = error instanceof VoiceTokenError ? error.code : 'voice_failed';
    const status = code === 'voice_unconfigured' ? 503 : 502;
    return Response.json({ error: code }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
