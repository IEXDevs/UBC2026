import test from 'node:test';
import assert from 'node:assert/strict';
import { walletPickLabel, walletPickTag } from './wallet-pick.mjs';
import { formatAmount, formatAmountSafe } from './money-views.mjs';

const address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

test('only the main wallet shows the account handle', () => {
  assert.equal(walletPickLabel({ kind: 'main', label: 'Main', address }, 'sid'), 'Main · @sid · EPjFW...TDt1v');
  assert.equal(walletPickLabel({ kind: 'additional', label: 'Phantom', address }, 'sid'), 'Phantom · EPjFW...TDt1v');
});

test('linked wallets are tagged Linked, not Added', () => {
  assert.equal(walletPickTag({ kind: 'main' }, { spendable: false }), 'Main');
  assert.equal(walletPickTag({ kind: 'additional' }, { spendable: false }), 'Linked');
  assert.equal(walletPickTag({ kind: 'connected' }), 'Linked');
  assert.equal(walletPickTag({ kind: 'additional' }, { spendable: true }), 'Added');
});

test('formatAmount groups thousands for display', () => {
  assert.equal(formatAmount('100000000000', 5), '1,000,000');
  assert.equal(formatAmount('1234567891', 9), '1.234567891');
  assert.equal(formatAmount('123456789012345', 6), '123,456,789.012345');
  assert.equal(formatAmount('-1000000', 0), '-1,000,000');
});

test('formatAmountSafe never throws on missing or invalid balances', () => {
  assert.equal(formatAmountSafe('100000000000', 5), '1,000,000');
  assert.equal(formatAmountSafe(null, 6), null);
  assert.equal(formatAmountSafe(undefined, 6), null);
  assert.equal(formatAmountSafe('', 6), null);
  assert.equal(formatAmountSafe('abc', 6), null);
  assert.equal(formatAmountSafe('-5', 6), null);
});
