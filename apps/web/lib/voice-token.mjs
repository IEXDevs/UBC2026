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

/** Conversation token for live ElevenLabs agent (WebRTC / LiveKit). */
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

/**
 * Signed WebSocket URL for ConvAI voice. Prefer this when LiveKit/WebRTC drops
 * rooms shortly after connect; same agent, different transport.
 */
export async function requestVoiceSignedUrl({ apiKey, agentId, fetcher = fetch } = {}) {
  if (typeof apiKey !== 'string' || apiKey.trim() === '' || typeof agentId !== 'string' || agentId.trim() === '') {
    throw new VoiceTokenError('voice_unconfigured');
  }
  const url = new URL('https://api.elevenlabs.io/v1/convai/conversation/get-signed-url');
  url.searchParams.set('agent_id', agentId.trim());
  let response;
  try {
    response = await fetcher(url, { headers: { 'xi-api-key': apiKey.trim() } });
  } catch {
    throw new VoiceTokenError('voice_unreachable');
  }
  if (!response?.ok) throw new VoiceTokenError('voice_rejected');
  const body = await response.json().catch(() => null);
  const signed = typeof body?.signed_url === 'string' ? body.signed_url.trim()
    : (typeof body?.signedUrl === 'string' ? body.signedUrl.trim() : '');
  if (!signed.startsWith('wss://') && !signed.startsWith('ws://')) {
    throw new VoiceTokenError('voice_rejected');
  }
  return signed;
}

const SPEECH_SPEED_MIN = 0.7;
const SPEECH_SPEED_MAX = 1.2;

/** ElevenLabs flash speech accepts speed from 0.7 to 1.2. */
export function speechSpeed(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.min(SPEECH_SPEED_MAX, Math.max(SPEECH_SPEED_MIN, number));
}

/**
 * Stream spoken audio for a desk reply. The API key stays on the server.
 * Returns the ElevenLabs response so the caller can pipe the audio body.
 */
export async function requestSpeech({
  apiKey,
  voiceId,
  text,
  speed = 1,
  fetcher = fetch,
} = {}) {
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new VoiceTokenError('voice_unconfigured');
  }
  const spoken = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (!spoken || spoken.length > 2000) throw new VoiceTokenError('voice_rejected');
  if (typeof voiceId !== 'string' || !/^[A-Za-z0-9]{10,40}$/.test(voiceId)) {
    throw new VoiceTokenError('voice_rejected');
  }
  let response;
  try {
    response = await fetcher(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey.trim(),
          'content-type': 'application/json',
          accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: spoken,
          model_id: 'eleven_flash_v2_5',
          voice_settings: {
            stability: 0.4,
            similarity_boost: 0.75,
            speed: speechSpeed(speed),
          },
        }),
      },
    );
  } catch {
    throw new VoiceTokenError('voice_unreachable');
  }
  if (!response?.ok || !response.body) throw new VoiceTokenError('voice_rejected');
  return response;
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
