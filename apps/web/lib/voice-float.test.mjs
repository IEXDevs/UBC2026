import assert from 'node:assert/strict';
import test from 'node:test';
import { clampFloat, withHeads } from './voice-float.mjs';

test('clampFloat keeps the box inside the viewport', () => {
  assert.deepEqual(clampFloat(-40, 900, { vw: 400, vh: 300 }), { x: 12, y: 212 });
  assert.deepEqual(clampFloat(80, 40, { vw: 400, vh: 300 }), { x: 80, y: 40 });
});

test('withHeads marks the first line of each speaker', () => {
  const rows = withHeads([
    { id: '1', role: 'agent', text: 'Hi' },
    { id: '2', role: 'agent', text: 'Still me' },
    { id: '3', role: 'user', text: 'Hello' },
  ]);
  assert.deepEqual(rows.map(row => row.head), [true, false, true]);
});
