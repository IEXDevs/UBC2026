/**
 * Asks ElevenLabs for short-lived client tokens.
 * The API key stays on the server. Callers pass a fetcher in tests.
 */

export class VoiceTokenError extends Error {
  constructor(code) {
    super(code);
    this.name = 'VoiceTokenError';
    this.code = code;
  }
}

async function readToken(response) {
  if (!response?.ok) throw new VoiceTokenError('voice_rejected');
  const body = await response.json().catch(() => null);
  if (!body || typeof body.token !== 'string' || body.token.trim() === '') {
    throw new VoiceTokenError('voice_rejected');
  }
  return body.token.trim();
}

/** Conversation token for live ElevenLabs agent (voice mode). */
export async function requestVoiceToken({ apiKey, agentId, fetcher = fetch } = {}) {
  if (typeof apiKey !== 'string' || apiKey.trim() === '' || typeof agentId !== 'string' || agentId.trim() === '') {
    throw new VoiceTokenError('voice_unconfigured');
  }
  const url = new URL('https://api.elevenlabs.io/v1/convai/conversation/token');
  url.searchParams.set('agent_id', agentId.trim());
  let response;
  try {
    response = await fetcher(url, { headers: { 'xi-api-key': apiKey.trim() } });
  } catch {
    throw new VoiceTokenError('voice_unreachable');
  }
  return readToken(response);
}

/** Single-use Scribe token for prompt-bar dictation (speech → text draft). */
export async function requestScribeToken({ apiKey, fetcher = fetch } = {}) {
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new VoiceTokenError('voice_unconfigured');
  }
  let response;
  try {
    response = await fetcher('https://api.elevenlabs.io/v1/single-use-token/realtime_scribe', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey.trim() },
    });
  } catch {
    throw new VoiceTokenError('voice_unreachable');
  }
  return readToken(response);
}
