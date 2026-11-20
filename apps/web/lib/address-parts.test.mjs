import test from 'node:test';
import assert from 'node:assert/strict';
import { addressParts, isWalletAddress } from './address-parts.mjs';
import { shortAddress } from './money-views.mjs';

const ADDRESS = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const OTHER = 'So11111111111111111111111111111111111111112';

test('wallet addresses in chat and confirmation prose retain full copy payloads', () => {
  assert.deepEqual(addressParts(`Send 1 SOL to @hi (${ADDRESS}), from ${OTHER}.`), [
    { text: 'Send 1 SOL to @hi (' }, { address: ADDRESS },
    { text: '), from ' }, { address: OTHER }, { text: '.' },
  ]);
  assert.equal(shortAddress(ADDRESS), '4zMMC...DncDU');
});

test('signatures, URLs, hashes, invalid keys, and shortened text are not copy payloads', () => {
  for (const text of [
    ADDRESS + ADDRESS,
    `https://solscan.io/account/${ADDRESS}?cluster=devnet`,
    'a'.repeat(64), '0'.repeat(44), '1'.repeat(33), 'z'.repeat(44),
    shortAddress(ADDRESS),
  ]) {
    assert.deepEqual(addressParts(text), [{ text }]);
  }
  assert.equal(isWalletAddress(ADDRESS), true);
  assert.equal(isWalletAddress('1'.repeat(32)), true);
  assert.deepEqual(addressParts(null), []);
});

test('known clipped addresses are copyable only when their full value is unambiguous', () => {
  assert.deepEqual(addressParts(`@hi (${shortAddress(ADDRESS)})`, [ADDRESS, ADDRESS]), [
    { text: '@hi (' }, { address: ADDRESS }, { text: ')' },
  ]);
  assert.deepEqual(addressParts(shortAddress(ADDRESS).replace('...', '…'), [ADDRESS]), [{ address: ADDRESS }]);
  const collision = ADDRESS.slice(0, 14) + '2' + ADDRESS.slice(15);
  assert.equal(isWalletAddress(collision), true);
  assert.equal(shortAddress(ADDRESS), shortAddress(collision));
  assert.deepEqual(addressParts(shortAddress(ADDRESS), [ADDRESS, collision]), [{ text: shortAddress(ADDRESS) }]);
});
