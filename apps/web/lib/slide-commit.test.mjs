import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slideConfirmed, slideOffset } from '../components/bits/slide-gesture.mjs';

const drag = { id: 1, x: 120, origin: 0, max: 200, scale: 1 };
const release = { type: 'pointerup', pointerId: 1, clientX: 312 };

test('release near the right end confirms using its own position, even without a final move', () => {
  assert.equal(slideConfirmed(drag, release), true);
  assert.equal(slideConfirmed(drag, { ...release, clientX: 299 }), false);
  assert.equal(slideOffset(drag, 400), 200);
  assert.equal(slideOffset(drag, 100), 0);
});

test('a scaled track uses visual pointer distance while rendering in CSS pixels', () => {
  assert.equal(slideOffset({ ...drag, scale: 0.5 }, 220), 200);
  assert.equal(slideConfirmed({ ...drag, scale: 0.5 }, { ...release, clientX: 213 }), true);
});

test('cancel, lost capture, other pointers, and tracks without travel never confirm', () => {
  assert.equal(slideConfirmed(drag, { ...release, type: 'pointercancel' }), false);
  assert.equal(slideConfirmed(drag, { ...release, type: 'lostpointercapture' }), false);
  assert.equal(slideConfirmed(drag, { ...release, pointerId: 2 }), false);
  assert.equal(slideConfirmed({ ...drag, max: 0 }, release), false);
});
