import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addVoiceMs, readVoiceMs, voiceTimeKey } from './voice-time.mjs';

/**
 * Achieves: verifies voice duration parsing, blip filtering, accumulation, and storage keys.
 * Fails when: invalid/negative ms become non-zero, blips (<250ms) accumulate, or keys drift.
 * Oracle: blip threshold is 250ms; invalid reads are 0; keys are `maelstrom.voiceTime[.id]`.
 * Side effects / state checked: N/A (pure helpers).
 * Gaps: none for helpers; persistence against real localStorage is not exercised here.
 */
test('voice time keeps real spans and drops blips', () => {
  assert.equal(readVoiceMs('nope'), 0);
  assert.equal(readVoiceMs(-4), 0);
  assert.equal(addVoiceMs(0, 100), 0);
  assert.equal(addVoiceMs(1000, 250), 1250);
  assert.equal(addVoiceMs(1000, 249), 1000);
  assert.equal(voiceTimeKey('own_1'), 'maelstrom.voiceTime.own_1');
  assert.equal(voiceTimeKey(''), 'maelstrom.voiceTime');
});
