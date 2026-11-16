import { readRootEnv } from '../../../../lib/root-env.mjs';
import { fetchAgentRuntime } from '../../../../lib/runtime-fetch.mjs';

const OWNER = /^[a-zA-Z0-9:_.-]{1,256}$/;
const CONVERSATION = /^[a-zA-Z0-9:_-]{1,128}$/;

/**
 * Bind an ElevenLabs conversation id to the signed-in Privy owner so voice
 * webhook tools can resolve x-owner-id when {{owner_id}} is not substituted.
 */
export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : '';
  const ownerId = typeof body.ownerId === 'string' ? body.ownerId.trim() : '';
  if (!CONVERSATION.test(conversationId) || !OWNER.test(ownerId)) {
    return Response.json({ error: 'invalid_body' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const runtime = readRootEnv('NEXT_PUBLIC_AGENT_RUNTIME_URL');
  const secret = readRootEnv('ELEVENLABS_WEBHOOK_SECRET');
  if (!runtime || !secret) {
    return Response.json({ error: 'voice_bind_unconfigured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  let base;
  try {
    base = new URL(runtime.trim());
  } catch {
    return Response.json({ error: 'runtime_unconfigured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') {
    return Response.json({ error: 'runtime_unconfigured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const target = new URL('/voice/session-owner', base);
  try {
    const response = await fetchAgentRuntime(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-elevenlabs-webhook-secret': secret,
      },
      body: JSON.stringify({ conversationId, ownerId }),
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return Response.json(
        { error: payload.error || 'voice_bind_failed' },
        { status: response.status === 401 ? 401 : 502, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'voice_bind_unreachable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
