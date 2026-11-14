import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VOICE_SETTINGS,
  SPEED_MAX,
  SPEED_MIN,
  VOICES,
  clampSpeed,
  parseVoiceSettings,
  voiceSession,
} from './voice-settings.mjs';

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

  const fallback = parseVoiceSettings(null);
  assert.deepEqual(fallback, { voiceId: DEFAULT_VOICE_SETTINGS.voiceId, speed: 0.9 });

  const adam = VOICES.find(voice => voice.name === 'Adam');
  const parsed = parseVoiceSettings({ voiceId: adam.id, speed: 1.17 });
  assert.equal(parsed.voiceId, adam.id);
  assert.equal(parsed.speed, 1.15);
  assert.deepEqual(voiceSession(parsed), { voiceId: adam.id, voiceName: 'Adam', speed: 1.15 });

  const dropped = parseVoiceSettings({ voiceId: 'not-a-voice', speed: 0.9 });
  assert.equal(dropped.voiceId, DEFAULT_VOICE_SETTINGS.voiceId);
  assert.equal(dropped.speed, 0.9);
});
