import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packHoldingBubbles } from './position-bubbles.mjs';

const width = 210;
const height = 92;

function row(asset, value) {
  return { id: asset, asset, amount: String(value), decimals: 6, notionalMicroUsdc: String(value) };
}

function previous(bubbles) {
  return { bubbles, bubbleWidth: width, bubbleHeight: height };
}

function assertPacked(bubbles) {
  for (const disk of bubbles) {
    assert.ok(disk.r > 0);
    assert.ok(disk.x - disk.r >= 4.99 && disk.x + disk.r <= width - 4.99);
    assert.ok(disk.y - disk.r >= 4.99 && disk.y + disk.r <= height - 4.99);
    for (const other of bubbles) {
      if (disk === other) continue;
      assert.ok(Math.hypot(disk.x - other.x, disk.y - other.y) >= disk.r + other.r + 3.99);
    }
  }
}

test('bubble areas and wallet shares use the same priced USD values', () => {
  const bubbles = packHoldingBubbles([row('SOL', 9000000), row('USDC', 1000000), row('Unknown', 0)], width, height);
  const [sol, usdc] = bubbles;
  assert.deepEqual(bubbles.map(bubble => bubble.shareLabel), ['90%', '10%']);
  assert.ok(Math.abs((sol.r / usdc.r) ** 2 - 9) < 1e-9);
  assertPacked(bubbles);
});

test('existing bubbles keep their centers and colors through price changes and new tokens', () => {
  const first = packHoldingBubbles([row('SOL', 6000000), row('USDC', 4000000)], width, height);
  const updated = packHoldingBubbles([row('SOL', 4000000), row('USDC', 6000000), row('JUP', 1000000)], width, height, previous(first));
  for (const original of first) {
    const next = updated.find(bubble => bubble.id === original.id);
    assert.equal(next.x, original.x);
    assert.equal(next.y, original.y);
    assert.equal(next.hue, original.hue);
    assert.notEqual(next.r, original.r);
  }
  assert.equal(updated.length, 3);
  assertPacked(updated);
});

test('crowded wallet keeps its visible tokens and updates the Other bucket', () => {
  const rows = Array.from({ length: 18 }, (_, index) => row('T' + index, (18 - index) * 1000000));
  const first = packHoldingBubbles(rows, width, height);
  const updated = packHoldingBubbles([...rows.slice(0, -1), row('T17', 60000000)], width, height, previous(first));
  assert.equal(first.length, 12);
  assert.deepEqual(new Set(updated.map(bubble => bubble.id)), new Set(first.map(bubble => bubble.id)));
  const other = updated.find(bubble => bubble.id === 'other');
  assert.equal(other.amountLabel, '7 assets');
  assert.equal(other.valueLabel, '$87');
  assertPacked(updated);
});
