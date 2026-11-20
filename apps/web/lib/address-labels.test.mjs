import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressForLabel, addressTextParts } from './address-labels.mjs';

const address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const other = 'EPjFW111111111111111111111111111111111TDt1v';
const short = 'EPjFW...TDt1v';

test('copy targets use the full address behind an exact shortened label', () => {
  assert.equal(addressForLabel(short, [address, address]), address);
  assert.deepEqual(addressTextParts(`Send to (${short}), then ${short}.`, [address]), [
    { text: 'Send to (' }, { text: short, address, punctuation: '),' }, { text: ' then ' },
    { text: short, address, punctuation: '.' },
  ]);
});

test('trailing punctuation stays with the label without changing the copy target or surrounding text', () => {
  for (const punctuation of ['.', ',', '!?', ');', '”', '…', '\"']) {
    assert.deepEqual(addressTextParts(`Wallet ${short}${punctuation} Next`, [address]), [
      { text: 'Wallet ' }, { text: short, address, punctuation }, { text: ' Next' },
    ]);
  }
  assert.deepEqual(addressTextParts(`${short} .`, [address]), [
    { text: short, address }, { text: ' .' },
  ]);
  assert.deepEqual(addressTextParts(`${short},${short}.`, [address]), [
    { text: short, address, punctuation: ',' }, { text: short, address, punctuation: '.' },
  ]);
});

test('unknown, malformed, and colliding addresses are never guessed', () => {
  for (const addresses of [[], ['not-an-address'], [address, other]]) {
    assert.equal(addressForLabel(short, addresses), null);
    assert.deepEqual(addressTextParts(short, addresses), [{ text: short }]);
  }
  assert.deepEqual(addressTextParts(`x${short}x`, [address]), [{ text: `x${short}x` }]);
  assert.deepEqual(addressTextParts('@alice and ordinary text', [address]), [{ text: '@alice and ordinary text' }]);
});
