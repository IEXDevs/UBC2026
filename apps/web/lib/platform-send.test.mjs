import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlatformSend, platformBalance } from './platform-send.mjs';

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

test('wallet balance adds credits and subtracts sends', () => {
  assert.equal(platformBalance([
    { asset: 'USDC', amount: '5000000', direction: 'in' },
    { asset: 'USDC', amount: '1000000', direction: 'out' },
  ]), '4000000');
});
