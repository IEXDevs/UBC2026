import assert from 'node:assert/strict';
import test from 'node:test';
import { clampFloat, withHeads } from './voice-float.mjs';

/*
 * Achieves: verifies the floating voice box is clamped inside the viewport margins.
 * Fails when: negative coords stay negative, or in-bounds coords are rewritten.
 * Oracle: vw=400/vh=300 → out-of-bounds (-40,900) clamps to (12,184); (80,40) unchanged.
 * Side effects / state checked: N/A.
 * Gaps: none for clamp math.
 */
test('clampFloat keeps the box inside the viewport', () => {
  assert.deepEqual(clampFloat(-40, 900, { vw: 400, vh: 300 }), { x: 12, y: 184 });
  assert.deepEqual(clampFloat(80, 40, { vw: 400, vh: 300 }), { x: 80, y: 40 });
});

/*
 * Achieves: verifies avatar heads appear only on the first line of each speaker run.
 * Fails when: consecutive same-role lines both get head:true, or role changes miss a head.
 * Oracle: agent/agent/user → [true, false, true].
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('withHeads marks the first line of each speaker', () => {
  const rows = withHeads([
    { id: '1', role: 'agent', text: 'Hi' },
    { id: '2', role: 'agent', text: 'Still me' },
    { id: '3', role: 'user', text: 'Hello' },
  ]);
  assert.deepEqual(rows.map(row => row.head), [true, false, true]);
});
