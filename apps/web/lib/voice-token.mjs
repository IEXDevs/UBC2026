/**
 * Asks ElevenLabs for a short-lived conversation token.
 * The API key stays on the server. Callers pass a fetcher in tests.
 */

export class VoiceTokenError extends Error {
  constructor(code) {
    super(code);
    this.name = 'VoiceTokenError';
    this.code = code;
  }
}

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
  if (!response?.ok) throw new VoiceTokenError('voice_rejected');
  const body = await response.json().catch(() => null);
  if (!body || typeof body.token !== 'string' || body.token.trim() === '') {
    throw new VoiceTokenError('voice_rejected');
  }
  return body.token;
}
