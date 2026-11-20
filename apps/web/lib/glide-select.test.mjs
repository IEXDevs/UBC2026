import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glideRowAt } from './glide-select.mjs';

test('a scrolled model menu picks the visible row, not an earlier unscrolled row', () => {
  const list = { top: 100, scrollTop: 310, step: 31, count: 40 };
  assert.equal(glideRowAt(110, list), 10);
  assert.equal(glideRowAt(141, list), 11);
  assert.equal(glideRowAt(110, { ...list, scrollTop: 620 }), 20);
  assert.equal(glideRowAt(110, { ...list, scrollTop: 0 }), 0);
  assert.equal(glideRowAt(99, { ...list, scrollTop: 0 }), null);
  assert.equal(glideRowAt(110, { ...list, scrollTop: 1240 }), null);
});
