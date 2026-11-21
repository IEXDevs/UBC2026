import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentWalletChoices, mergeWalletDirectory, withAssignedWallet } from './wallet-assign.mjs';

test('Main fills empty assignments and preserves every explicit assignment', () => {
  const bots = [
    { id: 'bot_new', walletId: null },
    { id: 'bot_shop', walletId: 'wallet_shop' },
    { id: 'bot_old', walletId: 'wallet_unavailable' },
  ];
  assert.equal(withAssignedWallet(bots, null).bots, bots);
  const live = withAssignedWallet(bots, [
    { id: 'wallet_shop', kind: 'additional' },
    { id: 'w_main_owner', kind: 'main', frozen: true },
  ]);
  assert.deepEqual(live.bots.map(bot => bot.walletId), ['w_main_owner', 'wallet_shop', 'wallet_unavailable']);
});

test('the wallet picker offers spendable unfrozen wallets, with Main first', () => {
  const choices = agentWalletChoices([
    { id: 'wallet_shop', kind: 'additional', spendable: true },
    { id: 'w_frozen', kind: 'additional', frozen: true },
    { id: 'w_external', kind: 'main', spendable: false },
    { id: 'w_external_2', kind: 'additional', readOnly: true },
    { id: 'w_retired', kind: 'additional', deletedAt: '2026-11-21' },
    { id: 'linked_external', kind: 'additional' },
    { id: 'w_main', kind: 'main', spendable: true },
  ]);
  assert.deepEqual(choices.map(wallet => wallet.id), ['w_main', 'wallet_shop']);
});

test('an external or additional wallet does not take the default when Main is absent', () => {
  const bots = [{ id: 'bot_new', walletId: null }];
  const live = withAssignedWallet(bots, [
    { id: 'w_external', kind: 'main', spendable: false },
    { id: 'wallet_shop', kind: 'additional' },
  ]);
  assert.equal(live.bots[0].walletId, null);
});

test('the wallet directory preserves the server assignment ID and includes wallets from both lists', () => {
  const live = [{ id: 'client_main', address: 'main', label: 'Main' }, { id: 'linked_wallet', address: 'external' }];
  const persisted = [{ id: 'wallet_main', address: 'main', frozen: true }, { id: 'wallet_shop', address: 'shop' }];
  const directory = mergeWalletDirectory(live, persisted);
  assert.deepEqual(directory.map(wallet => wallet.id), ['wallet_main', 'linked_wallet', 'wallet_shop']);
  assert.deepEqual(directory[0], { id: 'wallet_main', address: 'main', label: 'Main', frozen: true });
});
