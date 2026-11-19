import { readRootEnv } from '../../../../lib/root-env.mjs';
import { requestSpeech, VoiceTokenError } from '../../../../lib/voice-token.mjs';
import { voiceSession } from '../../../../lib/voice-settings.mjs';

/** Speak one desk reply. ElevenLabs only renders audio. */
export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const session = voiceSession(body);
  const text = typeof body.text === 'string' ? body.text : '';
  try {
    const upstream = await requestSpeech({
      apiKey: readRootEnv('ELEVENLABS_API_KEY'),
      voiceId: session.voiceId,
      text,
      speed: session.speed,
    });
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'content-type': 'audio/mpeg',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    const code = error instanceof VoiceTokenError ? error.code : 'voice_failed';
    const status = code === 'voice_unconfigured' ? 503 : 502;
    return Response.json({ error: code }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
