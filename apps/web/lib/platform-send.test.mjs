import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlatformSend, platformBalance } from './platform-send.mjs';

/*
 * Achieves: verifies send command parsing into handle + micro-USDC amount + idempotency key.
 * Fails when: non-send text parses, casing not normalized, 0 amount accepted, or decimals wrong.
 * Oracle: "send 5 USDC to @Bob" → handle bob, amount 5000000, key send_bob_5000000; "send 0" → null.
 * Side effects / state checked: N/A.
 * Gaps: none for parser.
 */
test('a send command names a handle and six-decimal USDC', () => {
  assert.equal(parsePlatformSend('hello @bob'), null);
  assert.deepEqual(parsePlatformSend('send 5 USDC to @Bob'), {
    handle: 'bob',
    amount: '5000000',
    idempotencyKey: 'send_bob_5000000',
  });
  assert.equal(parsePlatformSend('send 1.5 to @alex').amount, '1500000');
  assert.equal(parsePlatformSend('send 0 to @alex'), null);
});

/*
 * Achieves: verifies platform balance is credits minus sends in micro-USDC.
 * Fails when: outs are added, ins ignored, or asset filtering is wrong for the demo ledger.
 * Oracle: +5e6 − 1e6 = 4e6.
 * Side effects / state checked: N/A.
 * Gaps: none for the reducer; multi-asset filtering not asserted here.
 */
test('wallet balance adds credits and subtracts sends', () => {
  assert.equal(platformBalance([
    { asset: 'USDC', amount: '5000000', direction: 'in' },
    { asset: 'USDC', amount: '1000000', direction: 'out' },
  ]), '4000000');
  assert.equal(platformBalance([]), '0');
});
