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

/**
 * Achieves: verifies volume sweep maps ring angles to 0–100 and pointer/tick angles stay on the arc.
 * Fails when: RING_START→0 / mid→50 / end→100 drift, 180 returns a position, or tickAngle(99) leaves the sweep.
 * Oracle: sweepPosition(RING_START)=0; (0)=50; end=100; 180=null; pointerAngle axes 0/90.
 * Side effects / state checked: N/A.
 * Gaps: none for angle helpers.
 */
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

/**
 * Achieves: verifies hover lift peaks at the active tick and falls off with distance / near=false.
 * Fails when: exact hover lift ≠ 1, distant ticks lift, or wraparound angleDelta wrong.
 * Oracle: hoverLift(10,10)=1; near:false→0; far reach→0; mid distance (0.4,1); angleDelta(10,350)=20.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('nearby ticks stretch and distant ticks stay still', () => {
  assert.equal(hoverLift(10, 10), 1);
  assert.equal(hoverLift(10, 10, { near: false }), 0);
  assert.equal(hoverLift(40, 10, { reach: 28 }), 0);
  assert.ok(hoverLift(18, 10) > 0.4);
  assert.ok(hoverLift(18, 10) < 1);
  assert.equal(angleDelta(10, 350), 20);
});

/**
 * Achieves: verifies tick scale/alpha grow with energy, hover, and volume comet fill.
 * Fails when: speaking ≤ quiet, hover ≤ speaking, or alpha exceeds 1 under high energy.
 * Oracle: speaking>quiet; hovered>speaking; marked>quiet; filled alpha > empty; energy alpha ≤ 1.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
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

/**
 * Achieves: verifies frequency band energy samples bins around the ring.
 * Fails when: peak bin ≠ 1, far band energy outside (0.4,0.6), or null bins non-zero.
 * Oracle: bins[0]=255 → band 0 energy 1; band 99 mid; null→0.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('frequency bands spread around the ring', () => {
  const bins = new Uint8Array(8);
  bins[0] = 255;
  bins[7] = 128;
  assert.equal(bandEnergy(bins, 0), 1);
  assert.ok(bandEnergy(bins, 99) > 0.4);
  assert.ok(bandEnergy(bins, 99) < 0.6);
  assert.equal(bandEnergy(null, 4), 0);
});
