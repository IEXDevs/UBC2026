import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planConnectedDeposit, planWalletMove, selectOwnedMoveWallet } from './wallet-move.mjs';

const env = {
  PRIVY_APP_ID: 'app',
  PRIVY_APP_SECRET: 'secret',
  SOLANA_RPC_URL: 'https://example.invalid/rpc',
};

function wallet(id, address, extra = {}) {
  return {
    id,
    ownerId: 'did:privy:abc',
    kind: id === 'w_main' ? 'main' : 'additional',
    label: id,
    address,
    frozen: false,
    provider: 'privy',
    ...extra,
  };
}

const from = wallet('w_main', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const to = wallet('w_shop', 'Hp6Qyx3K9McpE1w2V7LbNU1NpwjwpqRiiggrcveNrtHF');

test('wallet moves take signing identity and freeze state from stored wallets', () => {
  const stored = { ...from, frozen: true, spendable: true };
  const selection = { ...from, privyWalletId: 'another-wallet' };
  assert.deepEqual(selectOwnedMoveWallet([stored], selection), { ...stored, privyWalletId: from.id });
  assert.equal(selectOwnedMoveWallet([stored], { ...selection, address: to.address }), null);
  assert.equal(selectOwnedMoveWallet([{ ...stored, spendable: false }], selection), null);
});

/**
 * Achieves: a desk move plans both wallets, the amount, and the wallet.move memo.
 * Fails when: the plan drops a wallet, accepts zero, or uses another memo.
 * Oracle: memo wallet.move; amount 1000000; frozen and same-address plans error.
 * Side effects / state checked: N/A.
 * Gaps: does not sign or broadcast.
 */
test('a wallet move plans two different Privy wallets', () => {
  const plan = planWalletMove({ from, to, amount: '1000000', ownerId: from.ownerId, env });
  assert.equal(plan.memo, 'wallet.move');
  assert.equal(plan.amount, '1000000');
  assert.equal(plan.from.id, 'w_main');
  assert.equal(plan.to.address, to.address);
  assert.equal(planWalletMove({ from, to: { ...to, frozen: true }, amount: '1', ownerId: from.ownerId, env }).error, 'wallet_frozen');
  assert.equal(planWalletMove({ from, to: from, amount: '1', ownerId: from.ownerId, env }).error, 'invalid_destination');
  assert.equal(planWalletMove({ from, to, amount: '0', ownerId: from.ownerId, env }).error, 'invalid_amount');
  assert.equal(planWalletMove({ from, to, amount: '1', ownerId: 'did:privy:other', env }).error, 'owner_mismatch');
  const bare = planWalletMove({ from, to, amount: '1', ownerId: from.ownerId, env: {} });
  assert.equal(bare.error, 'missing_config');
  assert.ok(bare.missing.includes('SOLANA_RPC_URL'));
});

/**
 * Achieves: a connected wallet can fund the main wallet, and a spendable wallet cannot use that plan.
 * Fails when: a Privy wallet is treated as connected, or the destination is not the main wallet.
 * Oracle: memo deposit; not_connected for spendable sources; invalid_destination when the target is not main.
 * Side effects / state checked: N/A.
 * Gaps: does not sign in the browser or broadcast.
 */
test('a connected wallet deposit plans a transfer into the main wallet', () => {
  const connected = wallet('linked_phantom', 'Hp6Qyx3K9McpE1w2V7LbNU1NpwjwpqRiiggrcveNrtHF', { spendable: false, kind: 'additional' });
  const plan = planConnectedDeposit({ from: connected, to: from, amount: '2500000', ownerId: from.ownerId, env });
  assert.equal(plan.memo, 'deposit');
  assert.equal(plan.amount, '2500000');
  assert.equal(plan.to.kind, 'main');
  assert.equal(planConnectedDeposit({ from, to: connected, amount: '1', ownerId: from.ownerId, env }).error, 'not_connected');
  assert.equal(planConnectedDeposit({ from: connected, to, amount: '1', ownerId: from.ownerId, env }).error, 'invalid_destination');
});
