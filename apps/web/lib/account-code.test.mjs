import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accountCodeFromBytes,
  createAccountCode,
  ensureAccountCode,
  isAccountCode,
  readAccountCode,
} from './account-code.mjs';

test('an account id is 16 digits and stays on this owner', () => {
  assert.equal(accountCodeFromBytes(Uint8Array.from([0, 9, 250, 251, 15])), '095');
  const code = createAccountCode(() => Uint8Array.from({ length: 40 }, () => 3));
  assert.equal(isAccountCode(code), true);
  assert.equal(code.length, 16);
  const storage = new Map();
  const bag = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
  };
  const first = ensureAccountCode(bag, 'did:privy:1', () => '1234567890123456');
  const again = ensureAccountCode(bag, 'did:privy:1', () => '0000000000000000');
  assert.equal(first, '1234567890123456');
  assert.equal(again, first);
  assert.equal(readAccountCode(bag, 'did:privy:2'), '');
  assert.equal(isAccountCode('123456789012345'), false);
});
