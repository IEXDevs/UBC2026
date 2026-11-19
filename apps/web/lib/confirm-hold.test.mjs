import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIRM_HOLD_MS,
  EMAIL_ACCEPTED_HOLD_MS,
  SEED_CONFIRM_HOLD_MS,
  confirmHoldMs,
  toastDurationMs,
} from './confirm-hold.mjs';

test('seed and email acceptance holds are at least 3 seconds', () => {
  assert.equal(SEED_CONFIRM_HOLD_MS, 3000);
  assert.equal(EMAIL_ACCEPTED_HOLD_MS, 3000);
  assert.equal(confirmHoldMs('seed'), 3000);
  assert.equal(confirmHoldMs('email'), 3000);
});

test('default confirmation hold is at least 2 seconds', () => {
  assert.equal(CONFIRM_HOLD_MS, 2000);
  assert.equal(confirmHoldMs(), 2000);
  assert.equal(confirmHoldMs('default'), 2000);
});

test('toast durations enforce confirm minimum and sticky errors', () => {
  assert.equal(toastDurationMs(1000), 2000);
  assert.equal(toastDurationMs(7000), 7000);
  assert.equal(toastDurationMs(undefined), 4000);
  assert.equal(toastDurationMs(4000, { error: true }), Number.POSITIVE_INFINITY);
});
