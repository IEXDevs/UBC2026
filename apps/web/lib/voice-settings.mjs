/**
 * Owner voice and speed for the talk session.
 * Speed is a playback multiplier. Voice ids are ElevenLabs premade voices.
 * The browser preview can honor speed. The named voice is what the session uses.
 */

export const VOICE_STORAGE_KEY = 'maelstrom.voiceSettings';

export const SPEED_MIN = 0.5;
export const SPEED_MAX = 2;
export const SPEED_STEP = 0.05;

export const VOICES = Object.freeze([
  Object.freeze({ id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel' }),
  Object.freeze({ id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah' }),
  Object.freeze({ id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel' }),
  Object.freeze({ id: 'nPczCjzI2devNBz1zQrb', name: 'Brian' }),
  Object.freeze({ id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam' }),
  Object.freeze({ id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh' }),
  Object.freeze({ id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum' }),
  Object.freeze({ id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli' }),
  Object.freeze({ id: 'ErXwobaYiN019PkySvjV', name: 'Antoni' }),
  Object.freeze({ id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi' }),
]);

export const DEFAULT_VOICE_SETTINGS = Object.freeze({
  voiceId: VOICES[0].id,
  speed: 0.9,
});

export function clampSpeed(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_VOICE_SETTINGS.speed;
  const clamped = Math.min(SPEED_MAX, Math.max(SPEED_MIN, number));
  const steps = Math.round((clamped - SPEED_MIN) / SPEED_STEP);
  return Math.round((SPEED_MIN + steps * SPEED_STEP) * 100) / 100;
}

export function parseVoiceSettings(raw) {
  const voiceId = VOICES.some(voice => voice.id === raw?.voiceId)
    ? raw.voiceId
    : DEFAULT_VOICE_SETTINGS.voiceId;
  return { voiceId, speed: clampSpeed(raw?.speed ?? DEFAULT_VOICE_SETTINGS.speed) };
}

export function voiceSession(settings) {
  const parsed = parseVoiceSettings(settings);
  const voice = VOICES.find(item => item.id === parsed.voiceId);
  return { voiceId: parsed.voiceId, voiceName: voice.name, speed: parsed.speed };
}
