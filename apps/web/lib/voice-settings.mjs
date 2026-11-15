/**
 * Owner voice and speed for the talk session.
 * Speed is a playback multiplier. Voice ids are ElevenLabs premade voices.
 * The browser preview can honor speed. The named voice is what the session uses.
 */

export const VOICE_STORAGE_KEY = 'maelstrom.voiceSettings';

export const SPEED_MIN = 0.5;
export const SPEED_MAX = 2;
export const SPEED_STEP = 0.05;
export const VOLUME_MIN = 0;
export const VOLUME_MAX = 100;

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

export const LANGUAGES = Object.freeze([
  Object.freeze({ id: 'auto', name: 'Auto-detect' }),
  Object.freeze({ id: 'en', name: 'English' }),
  Object.freeze({ id: 'es', name: 'Spanish' }),
  Object.freeze({ id: 'fr', name: 'French' }),
  Object.freeze({ id: 'de', name: 'German' }),
  Object.freeze({ id: 'pt', name: 'Portuguese' }),
  Object.freeze({ id: 'ja', name: 'Japanese' }),
  Object.freeze({ id: 'zh', name: 'Chinese' }),
]);

export const DEFAULT_VOICE_SETTINGS = Object.freeze({
  voiceId: VOICES[0].id,
  speed: 0.9,
  volume: 100,
  language: 'auto',
});

export function clampSpeed(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_VOICE_SETTINGS.speed;
  const clamped = Math.min(SPEED_MAX, Math.max(SPEED_MIN, number));
  const steps = Math.round((clamped - SPEED_MIN) / SPEED_STEP);
  return Math.round((SPEED_MIN + steps * SPEED_STEP) * 100) / 100;
}

export function clampVolume(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_VOICE_SETTINGS.volume;
  return Math.round(Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, number)));
}

export function parseVoiceSettings(raw) {
  const voiceId = VOICES.some(voice => voice.id === raw?.voiceId)
    ? raw.voiceId
    : DEFAULT_VOICE_SETTINGS.voiceId;
  const language = LANGUAGES.some(item => item.id === raw?.language)
    ? raw.language
    : DEFAULT_VOICE_SETTINGS.language;
  return {
    voiceId,
    speed: clampSpeed(raw?.speed ?? DEFAULT_VOICE_SETTINGS.speed),
    volume: clampVolume(raw?.volume ?? DEFAULT_VOICE_SETTINGS.volume),
    language,
  };
}

export function voiceSession(settings) {
  const parsed = parseVoiceSettings(settings);
  const voice = VOICES.find(item => item.id === parsed.voiceId);
  return { voiceId: parsed.voiceId, voiceName: voice.name, speed: parsed.speed };
}
