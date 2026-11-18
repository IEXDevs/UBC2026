import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planWalletMove } from './wallet-move.mjs';

const env = {
  PRIVY_APP_ID: 'app',
  PRIVY_APP_SECRET: 'secret',
  QUICKNODE_DEVNET_RPC_URL: 'https://example.invalid/rpc',
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

const from = wallet('w_main', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const to = wallet('w_shop', 'Hp6Qyx3K9McpE1w2V7LbNU1NpwjwpqRiiggrcveNrtHF');

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
  assert.ok(bare.missing.includes('QUICKNODE_DEVNET_RPC_URL'));
});
