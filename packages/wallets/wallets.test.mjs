import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMainWallet,
  createAdditionalWallet,
  assignBotWallet,
  listBotsForWallet,
  freezeWallet,
  freezeBot,
  assertSpendAllowed,
  WalletError,
} from './wallets.mjs';

const address = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const baseBot = {
  id: 'bot_1',
  ownerId: 'user_1',
  name: 'APY hunter',
  goal: 'Find yield',
  type: 'trading',
  approvalMode: 'ask',
  walletId: 'placeholder',
  enabled: true,
  frozen: false,
  policyVersion: 1,
  cap: { mode: 'limited', asset: 'USDC', maxOutflow: '100', maxPerTransaction: '50' },
};

test('creates main and additional Privy wallets', () => {
  const main = createMainWallet({ ownerId: 'user_1', address });
  assert.equal(main.kind, 'main');
  const extra = createAdditionalWallet({ ownerId: 'user_1', address, label: 'Trading' });
  assert.equal(extra.kind, 'additional');
  assert.equal(extra.label, 'Trading');
});

test('assigns wallets only within the same owner and unfrozen state', () => {
  const main = createMainWallet({ ownerId: 'user_1', address });
  const assigned = assignBotWallet({ ...baseBot, walletId: main.id }, main);
  assert.equal(assigned.walletId, main.id);
  assert.throws(
    () => assignBotWallet(baseBot, createMainWallet({ ownerId: 'other', address })),
    WalletError,
  );
  assert.throws(() => assignBotWallet(baseBot, freezeWallet(main)), WalletError);
});

test('lists bots per wallet and enforces freeze gates before spend', () => {
  const main = createMainWallet({ ownerId: 'user_1', address });
  const bot = assignBotWallet({ ...baseBot, walletId: main.id }, main);
  assert.equal(listBotsForWallet([bot], main.id).length, 1);
  assert.equal(assertSpendAllowed({ bot, wallet: main }).allowed, true);
  assert.throws(() => assertSpendAllowed({ bot: freezeBot(bot), wallet: main }), WalletError);
  assert.throws(() => assertSpendAllowed({ bot, wallet: freezeWallet(main) }), WalletError);
});
