import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  forgetRetiredWallet,
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
  const ids = rememberRetiredWallet(storage, 'user_1', 'w_shop', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  assert.deepEqual(ids, ['w_shop', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v']);
  assert.deepEqual(readRetiredWalletIds(storage, 'user_1'), ['w_shop', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v']);
  const shown = withoutRetiredWallets([
    { id: 'w_main', label: 'Main', address: '11111111111111111111111111111111' },
    { id: 'w_shop', label: 'Shop', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
    { id: 'w_client', label: 'Phantom', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
    { id: 'w_old', deletedAt: '2026-11-19T00:00:00.000Z' },
  ], ids);
  assert.deepEqual(shown.map(row => row.id), ['w_main']);
});

test('forgetting a retired wallet restores it to readRetiredWalletIds', () => {
  const storage = memory();
  rememberRetiredWallet(storage, 'user_1', 'w_shop', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  const remaining = forgetRetiredWallet(storage, 'user_1', 'w_shop');
  assert.deepEqual(remaining, ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v']);
  assert.deepEqual(readRetiredWalletIds(storage, 'user_1'), ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v']);
  const empty = forgetRetiredWallet(storage, 'user_1', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  assert.deepEqual(empty, []);
  assert.deepEqual(readRetiredWalletIds(storage, 'user_1'), []);
});
