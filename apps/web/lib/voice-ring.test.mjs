import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RING_START,
  RING_SWEEP,
  angleDelta,
  bandEnergy,
  hoverLift,
  pointerAngle,
  sweepPosition,
  tickAlpha,
  tickAngle,
  tickScale,
} from './voice-ring.mjs';

test('volume runs across the top of the ring', () => {
  assert.equal(sweepPosition(RING_START), 0);
  assert.equal(sweepPosition(0), 50);
  assert.equal(sweepPosition(RING_START + RING_SWEEP), 100);
  assert.equal(sweepPosition(180), null);
  assert.equal(pointerAngle(0, -10), 0);
  assert.equal(pointerAngle(10, 0), 90);
  assert.equal(tickAngle(0), RING_START);
  assert.equal(tickAngle(99), RING_START + RING_SWEEP);
});

test('nearby ticks stretch and distant ticks stay still', () => {
  assert.equal(hoverLift(10, 10), 1);
  assert.equal(hoverLift(10, 10, { near: false }), 0);
  assert.equal(hoverLift(40, 10, { reach: 28 }), 0);
  assert.ok(hoverLift(18, 10) > 0.4);
  assert.ok(hoverLift(18, 10) < 1);
  assert.equal(angleDelta(10, 350), 20);
});

test('tick length follows voice, hover, and the volume comet', () => {
  const quiet = tickScale({});
  const speaking = tickScale({ energy: 1 });
  const hovered = tickScale({ hover: 1 });
  const marked = tickScale({ filled: 1, head: 1, trail: 1 });
  assert.ok(speaking > quiet);
  assert.ok(hovered > speaking);
  assert.ok(marked > quiet);
  assert.ok(tickAlpha({ filled: 1 }) > tickAlpha({}));
  assert.ok(tickAlpha({ energy: 4 }) <= 1);
});

test('frequency bands spread around the ring', () => {
  const bins = new Uint8Array(8);
  bins[0] = 255;
  bins[7] = 128;
  assert.equal(bandEnergy(bins, 0), 1);
  assert.ok(bandEnergy(bins, 99) > 0.4);
  assert.ok(bandEnergy(bins, 99) < 0.6);
  assert.equal(bandEnergy(null, 4), 0);
});
