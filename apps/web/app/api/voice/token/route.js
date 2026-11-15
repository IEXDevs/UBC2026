import { readRootEnv } from '../../../../lib/root-env.mjs';
import { requestVoiceToken, VoiceTokenError } from '../../../../lib/voice-token.mjs';
import { voiceOverrides, voiceSession } from '../../../../lib/voice-settings.mjs';

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const session = voiceSession(body);
  try {
    const token = await requestVoiceToken({
      apiKey: readRootEnv('ELEVENLABS_API_KEY'),
      agentId: readRootEnv('ELEVENLABS_AGENT_ID'),
    });
    return Response.json(
      {
        token,
        voiceId: session.voiceId,
        speed: session.speed,
        language: session.language,
        overrides: voiceOverrides(session),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const code = error instanceof VoiceTokenError ? error.code : 'voice_failed';
    const status = code === 'voice_unconfigured' ? 503 : 502;
    return Response.json({ error: code }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
