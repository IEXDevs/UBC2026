import { readRootEnv } from '../../../../lib/root-env.mjs';
import { requestScribeToken, VoiceTokenError } from '../../../../lib/voice-token.mjs';

/** Mint a single-use ElevenLabs Scribe token for browser dictation. */
export async function POST() {
  try {
    const token = await requestScribeToken({
      apiKey: readRootEnv('ELEVENLABS_API_KEY'),
    });
    return Response.json({ token }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = error instanceof VoiceTokenError ? error.code : 'voice_failed';
    const status = code === 'voice_unconfigured' ? 503 : 502;
    return Response.json({ error: code }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
