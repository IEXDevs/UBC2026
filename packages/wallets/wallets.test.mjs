import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMainWallet,
  createAdditionalWallet,
  assignBotWallet,
  listBotsForWallet,
  freezeWallet,
  unfreezeWallet,
  freezeBot,
  assertSpendAllowed,
  accountWriteBodies,
  WalletError,
} from './wallets.mjs';

const address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
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

/**
 * Rigor audit — wallet record factories
 * Achieves: main vs additional kinds and required label for additional.
 * Fails when: kinds swapped or empty label accepted for additional.
 * Oracle: contracts.validateWallet kind/label rules.
 * Side effects: none.
 * Gaps: none — closed: rejects blank additional label.
 */
test('creates main and additional Privy wallets', () => {
  const main = createMainWallet({ ownerId: 'user_1', address });
  assert.equal(main.kind, 'main');
  const extra = createAdditionalWallet({ ownerId: 'user_1', address, label: 'Trading' });
  assert.equal(extra.kind, 'additional');
  assert.equal(extra.label, 'Trading');
  assert.throws(() => createAdditionalWallet({ ownerId: 'user_1', address, label: '  ' }), WalletError);
});

/**
 * Rigor audit — bot↔wallet assignment invariants
 * Achieves: same-owner unfrozen assignment succeeds; cross-owner and frozen wallet fail.
 * Fails when: foreign wallets assignable or frozen wallets still assignable.
 * Oracle: ownership + freeze gates before desk spend.
 * Side effects: none (pure records).
 * Gaps: none for assign gates.
 */
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

/**
 * Rigor audit — list + spend freeze gates
 * Achieves: bots listed per wallet; spend blocked when bot or wallet frozen.
 * Fails when: freezeBot/freezeWallet still allows spend, or list returns wrong wallet's bots.
 * Oracle: Stop All / freeze must prevent outflow.
 * Side effects: none.
 * Gaps: none for freeze enforcement on assertSpendAllowed.
 */
test('lists bots per wallet and enforces freeze gates before spend', () => {
  const main = createMainWallet({ ownerId: 'user_1', address });
  const bot = assignBotWallet({ ...baseBot, walletId: main.id }, main);
  assert.equal(listBotsForWallet([bot], main.id).length, 1);
  assert.equal(listBotsForWallet([bot], 'other_wallet').length, 0);
  assert.equal(assertSpendAllowed({ bot, wallet: main }).allowed, true);
  assert.throws(() => assertSpendAllowed({ bot: freezeBot(bot), wallet: main }), WalletError);
  assert.throws(() => assertSpendAllowed({ bot, wallet: freezeWallet(main) }), WalletError);
});

/**
 * Achieves: unfreezeWallet clears frozen; spend is allowed again after unfreeze.
 * Fails when: frozen stays true, or assertSpendAllowed still throws after unfreeze.
 * Oracle: freeze → unfreeze → assertSpendAllowed.allowed === true.
 * Side effects: none (pure records).
 * Gaps: persistence of freeze state is ledger/DB-owned.
 */
test('unfreezeWallet restores spend after freeze', () => {
  const main = createMainWallet({ ownerId: 'user_1', address });
  const bot = assignBotWallet({ ...baseBot, walletId: main.id }, main);
  const frozen = freezeWallet(main);
  assert.equal(frozen.frozen, true);
  assert.throws(() => assertSpendAllowed({ bot, wallet: frozen }), WalletError);
  const thawed = unfreezeWallet(frozen);
  assert.equal(thawed.frozen, false);
  assert.equal(assertSpendAllowed({ bot, wallet: thawed }).allowed, true);
  assert.throws(() => unfreezeWallet({ ...main, address: 'not-a-key' }), Error);
});

/**
 * Achieves: accountWriteBodies maps login main+additional into user/wallets rows; null on missing owner/main.
 * Fails when: wrong owner_id, login_methods dropped, or incomplete login returns rows.
 * Oracle: Independent login fixture → expected PostgREST-shaped bodies.
 * Side effects: none.
 * Gaps: does not hit Supabase upsert.
 */
test('accountWriteBodies maps login wallets and rejects incomplete login', () => {
  const main = createMainWallet({ ownerId: 'user_1', address });
  const extra = createAdditionalWallet({ ownerId: 'user_1', address, label: 'Sleeve' });
  const login = {
    privyUserId: 'did:privy:user1',
    loginMethods: [{ type: 'email', address: 'a@b.co' }],
    main: { ...main, privyUserId: 'did:privy:user1' },
    additional: [extra],
  };
  const bodies = accountWriteBodies(login, 'user_1');
  assert.equal(bodies.user.id, 'user_1');
  assert.equal(bodies.user.privy_user_id, 'did:privy:user1');
  assert.deepEqual(bodies.user.login_methods, login.loginMethods);
  assert.equal(bodies.wallets.length, 2);
  assert.equal(bodies.wallets[0].owner_id, 'user_1');
  assert.equal(bodies.wallets[0].provider, 'privy');
  assert.equal(bodies.wallets[1].label, 'Sleeve');
  assert.equal(accountWriteBodies(null, 'user_1'), null);
  assert.equal(accountWriteBodies({ additional: [] }, 'user_1'), null);
  assert.equal(accountWriteBodies({ main: { ...main, ownerId: '' } }, null), null);
  const inferred = accountWriteBodies({ main }, null);
  assert.equal(inferred.user.id, 'user_1');
});
