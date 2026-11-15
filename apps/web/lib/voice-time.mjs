/** Owner voice time, stored on the device. Presentation only. */
export const VOICE_TIME_KEY = 'maelstrom.voiceTime';

export function voiceTimeKey(ownerId) {
  return ownerId ? `${VOICE_TIME_KEY}.${ownerId}` : VOICE_TIME_KEY;
}

export function readVoiceMs(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 1_000_000_000_000);
}

/** Ignore blips shorter than a quarter second. */
export function addVoiceMs(current, delta) {
  const extra = readVoiceMs(delta);
  if (extra < 250) return readVoiceMs(current);
  return readVoiceMs(current) + extra;
}
