import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickWalletList, withAssignedWallet } from './wallet-assign.mjs';

/**
 * Achieves: verifies a live spendable main wallet is assigned to every bot.
 * Fails when: null wallets mutate bot ids, or main wallet is not applied to all bots.
 * Oracle: null → bots unchanged; main w_main_owner replaces every bot.walletId.
 * Side effects / state checked: returned bots/wallets only.
 * Gaps: none for assignment happy path.
 */
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

/**
 * Achieves: verifies non-spendable connected wallets cannot become the agent spend wallet.
 * Fails when: spendable:false main overwrites bot walletId, or spendable additional is ignored.
 * Oracle: phantom spendable:false keeps wallet_shop; spendable additional becomes assigned id.
 * Side effects / state checked: returned bots only.
 * Gaps: none.
 */
test('a connected wallet cannot become the agent spend wallet', () => {
  const bots = [{ id: 'bot_shop', walletId: 'wallet_shop' }];
  const live = withAssignedWallet(bots, [
    { id: 'phantom', kind: 'main', spendable: false, address: 'So11111111111111111111111111111111111111112' },
  ]);
  assert.equal(live.wallets.length, 1);
  assert.equal(live.bots[0].walletId, 'wallet_shop');

  const mixed = withAssignedWallet(bots, [
    { id: 'phantom', kind: 'main', spendable: false },
    { id: 'w_main_owner', kind: 'additional', spendable: true },
  ]);
  assert.equal(mixed.bots[0].walletId, 'w_main_owner');
});

/**
 * Achieves: verifies pickWalletList skips empty arrays so later non-empty sources win.
 * Fails when: empty first source blocks later wallets, or first non-empty is skipped.
 * Oracle: [], null, [{id:w1}] → [{id:w1}]; live beats remote; all empty → [].
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('pickWalletList skips empty arrays so later sources can win', () => {
  assert.deepEqual(pickWalletList([], null, [{ id: 'w1' }]), [{ id: 'w1' }]);
  assert.deepEqual(pickWalletList([{ id: 'live' }], [{ id: 'remote' }]), [{ id: 'live' }]);
  assert.deepEqual(pickWalletList([], []), []);
});
