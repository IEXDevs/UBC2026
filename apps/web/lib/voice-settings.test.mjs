import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VOICE_SETTINGS,
  SPEED_MAX,
  SPEED_MIN,
  VOICES,
  clampSpeed,
  clampVolume,
  parseVoiceSettings,
  speechPlaybackRate,
  speechSpeed,
  voiceOverrides,
  voiceSession,
} from './voice-settings.mjs';

/**
 * Achieves: verifies voice catalog bounds, clamping, parse fallbacks, session/overrides, and invalid language drop.
 * Fails when: speed/volume clamps drift, unknown voiceId sticks, language 'nope' kept, or overrides omit tts.
 * Oracle: SPEED 0.5–2; clampSpeed(0.73)=0.75; null parse→defaults; Adam session; es→agent.language; unknown voice→default.
 * Side effects / state checked: N/A.
 * Gaps: none for settings helpers.
 */
test('voice settings keep a known voice and a stepped speed', () => {
  assert.equal(VOICES.length, 10);
  assert.equal(SPEED_MIN, 0.5);
  assert.equal(SPEED_MAX, 2);
  assert.equal(clampSpeed('nope'), 0.9);
  assert.equal(clampSpeed(0.2), 0.5);
  assert.equal(clampSpeed(0.5), 0.5);
  assert.equal(clampSpeed(2), 2);
  assert.equal(clampSpeed(4), 2);
  assert.equal(clampSpeed(0.73), 0.75);

  assert.equal(clampVolume('nope'), 100);
  assert.equal(clampVolume(-4), 0);
  assert.equal(clampVolume(40.4), 40);
  assert.equal(clampVolume(140), 100);

  const fallback = parseVoiceSettings(null);
  assert.deepEqual(fallback, { voiceId: DEFAULT_VOICE_SETTINGS.voiceId, speed: 0.9, volume: 100, language: 'auto' });

  const adam = VOICES.find(voice => voice.name === 'Adam');
  const parsed = parseVoiceSettings({ voiceId: adam.id, speed: 1.17 });
  assert.equal(parsed.voiceId, adam.id);
  assert.equal(parsed.speed, 1.15);
  assert.deepEqual(voiceSession(parsed), { voiceId: adam.id, voiceName: 'Adam', speed: 1.15, language: null });
  assert.deepEqual(voiceOverrides(parsed), { tts: { voiceId: adam.id, speed: 1.15 } });
  assert.deepEqual(voiceOverrides({ ...parsed, language: 'es' }), {
    tts: { voiceId: adam.id, speed: 1.15 },
    agent: { language: 'es' },
  });

  assert.equal(speechSpeed(0.5), 0.7);
  assert.equal(speechSpeed(2), 1.2);
  assert.equal(speechPlaybackRate(0.9), 1);
  assert.equal(speechPlaybackRate(1.8), 1.5);
  assert.equal(speechPlaybackRate(0.5), 0.714);
  assert.deepEqual(voiceOverrides({ ...parsed, speed: 2 }), { tts: { voiceId: adam.id, speed: 1.2 } });

  const dropped = parseVoiceSettings({ voiceId: 'not-a-voice', speed: 0.9 });
  assert.equal(dropped.voiceId, DEFAULT_VOICE_SETTINGS.voiceId);
  assert.equal(dropped.speed, 0.9);
  assert.equal(dropped.volume, 100);
  assert.equal(parseVoiceSettings({ volume: 37 }).volume, 37);
  assert.equal(parseVoiceSettings({ language: 'es' }).language, 'es');
  assert.equal(parseVoiceSettings({ language: 'nope' }).language, 'auto');
});
