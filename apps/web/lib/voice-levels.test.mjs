import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmsLevel, smoothLevel, speakingSide } from './voice-levels.mjs';

/*
 * Achieves: verifies level smoothing, RMS of silent/loud buffers, and speaking-side selection.
 * Fails when: smoothLevel ignores targets, silence RMS is non-zero, or side thresholds mis-fire.
 * Oracle: silence is all-128 PCM; louder user/agent levels win; both near-zero → idle.
 * Side effects / state checked: N/A.
 * Gaps: none for pure helpers; real AnalyserNode wiring is UI-only.
 */
test('voice levels follow the louder side', () => {
  assert.ok(smoothLevel(0, 1, 40) > 0.5);
  assert.ok(smoothLevel(1, 0, 40) > 0.7);
  assert.equal(rmsLevel(new Uint8Array(16).fill(128)), 0);
  const loud = new Uint8Array(16);
  loud.fill(128);
  loud[0] = 255;
  assert.ok(rmsLevel(loud) > 0.2);
  assert.equal(speakingSide(0.4, 0.05), 'user');
  assert.equal(speakingSide(0.1, 0.6), 'agent');
  assert.equal(speakingSide(0.02, 0.02), 'idle');
});
