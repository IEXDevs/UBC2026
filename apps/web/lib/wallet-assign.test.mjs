import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentWalletChoices, mainAgentWallet, mergeWalletDirectory, withAssignedWallet } from './wallet-assign.mjs';
import { mergeObservedWallets } from './wallet-provision.mjs';

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

test('a reissued wallet becomes the agent main after the old one is archived', () => {
  const archived = {
    id: 'w_old', kind: 'main', label: 'Main', address: '11111111111111111111111111111111',
    frozen: false, provider: 'privy', spendable: true, deleted_at: '2026-11-19T00:00:00.000Z',
  };
  const fresh = {
    id: 'w_fresh', kind: 'additional', label: 'Additional 1',
    address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    frozen: false, provider: 'privy', spendable: true,
  };
  // Archived wallets are not offered to agents; the reissue is.
  const choices = agentWalletChoices([archived, fresh]);
  assert.deepEqual(choices.map(wallet => wallet.id), ['w_fresh']);
  // The desk promotes the first spendable Maelstrom wallet to main.
  const merged = mergeObservedWallets([fresh], { linkedAccounts: [] }, 'did:privy:u1');
  const promoted = merged.find(wallet => wallet.id === 'w_fresh');
  assert.equal(promoted?.kind, 'main');
  assert.equal(mainAgentWallet(merged)?.id, 'w_fresh');
  // Unassigned agents regain asset access through the reissued wallet.
  const assigned = withAssignedWallet([{ id: 'bot_1', walletId: null }], merged);
  assert.equal(assigned.bots[0].walletId, 'w_fresh');
});
