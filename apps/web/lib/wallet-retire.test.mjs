import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readRetiredWalletIds,
  rememberRetiredWallet,
  retireTarget,
  withoutRetiredWallets,
} from './wallet-retire.mjs';

function memory() {
  const bag = new Map();
  return {
    getItem: key => (bag.has(key) ? bag.get(key) : null),
    setItem: (key, value) => { bag.set(key, String(value)); },
  };
}

test('retire targets an owner and an id, and rejects a blank owner', () => {
  assert.deepEqual(retireTarget({ id: 'w_shop', ownerId: 'user_1' }), { id: 'w_shop', ownerId: 'user_1' });
  assert.equal(retireTarget({ id: 'w_shop', ownerId: '' }).error, 'owner_required');
  assert.equal(retireTarget({ id: 'bad id', ownerId: 'user_1' }).error, 'invalid_wallet');
});

test('a retired wallet stays out of the desk list and the row id is remembered', () => {
  const storage = memory();
  const ids = rememberRetiredWallet(storage, 'user_1', 'w_shop');
  assert.deepEqual(ids, ['w_shop']);
  assert.deepEqual(readRetiredWalletIds(storage, 'user_1'), ['w_shop']);
  const shown = withoutRetiredWallets([
    { id: 'w_main', label: 'Main' },
    { id: 'w_shop', label: 'Shop' },
    { id: 'w_old', deletedAt: '2026-11-19T00:00:00.000Z' },
  ], ids);
  assert.deepEqual(shown.map(row => row.id), ['w_main']);
});
