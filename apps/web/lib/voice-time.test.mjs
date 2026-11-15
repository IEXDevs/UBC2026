import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addVoiceMs, readVoiceMs, voiceTimeKey } from './voice-time.mjs';

test('voice time keeps real spans and drops blips', () => {
  assert.equal(readVoiceMs('nope'), 0);
  assert.equal(readVoiceMs(-4), 0);
  assert.equal(addVoiceMs(0, 100), 0);
  assert.equal(addVoiceMs(1000, 250), 1250);
  assert.equal(voiceTimeKey('own_1'), 'maelstrom.voiceTime.own_1');
  assert.equal(voiceTimeKey(''), 'maelstrom.voiceTime');
});
