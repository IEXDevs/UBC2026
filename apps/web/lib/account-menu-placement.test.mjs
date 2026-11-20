import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountMenuPlacement } from './account-menu-placement.mjs';

test('desktop footer menu opens above with viewport-bounded scrolling', () => {
  assert.deepEqual(accountMenuPlacement({ top: 540, bottom: 580 }, 600), {
    top: 'auto', bottom: 'calc(100% + 8px)', maxHeight: 524,
  });
});

test('mobile sidebar menu opens below when there is more room there', () => {
  assert.deepEqual(accountMenuPlacement({ top: 110, bottom: 150 }, 754), {
    top: 'calc(100% + 8px)', bottom: 'auto', maxHeight: 588,
  });
});

test('very short viewports never produce a negative menu height', () => {
  assert.equal(accountMenuPlacement({ top: 0, bottom: 40 }, 40).maxHeight, 0);
});
