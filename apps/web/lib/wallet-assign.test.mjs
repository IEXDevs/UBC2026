import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickWalletList, withAssignedWallet } from './wallet-assign.mjs';

test('a live main wallet replaces the assignment on every bot', () => {
  const bots = [
    { id: 'bot_meteora', walletId: 'wallet_main' },
    { id: 'bot_shop', walletId: 'wallet_shop' },
  ];
  const untouched = withAssignedWallet(bots, null);
  assert.equal(untouched.wallets, null);
  assert.equal(untouched.bots[1].walletId, 'wallet_shop');

  const live = withAssignedWallet(bots, [
    { id: 'wallet_extra', kind: 'additional' },
    { id: 'w_main_owner', kind: 'main', address: 'Addr' },
  ]);
  assert.equal(live.wallets.length, 2);
  assert.deepEqual(live.bots.map(bot => bot.walletId), ['w_main_owner', 'w_main_owner']);
});

test('pickWalletList skips empty arrays so later sources can win', () => {
  assert.deepEqual(pickWalletList([], null, [{ id: 'w1' }]), [{ id: 'w1' }]);
  assert.deepEqual(pickWalletList([{ id: 'live' }], [{ id: 'remote' }]), [{ id: 'live' }]);
  assert.deepEqual(pickWalletList([], []), []);
});
