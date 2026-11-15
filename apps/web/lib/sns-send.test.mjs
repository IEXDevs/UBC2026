import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSnsSend } from './sns-send.mjs';

const ADDRESS = 'Hp6Qyx3K9McpE1w2V7LbNU1NpwjwpqRiiggrcveNrtHF';
const OTHER = 'So11111111111111111111111111111111111111112';
const wallet = {
  id: 'w_main',
  ownerId: 'did:privy:abc',
  kind: 'main',
  label: 'Main',
  address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  frozen: false,
  provider: 'privy',
};
const env = {
  PRIVY_APP_ID: 'app',
  PRIVY_APP_SECRET: 'secret',
  QUICKNODE_DEVNET_RPC_URL: 'https://example.invalid/rpc',
};

test('a send uses the owner passed in from SNS, not a fixed domain', () => {
  const rich = planSnsSend({ domain: 'richclub.sol', address: ADDRESS, amount: '1000000', wallet, env });
  assert.equal(rich.address, ADDRESS);
  const other = planSnsSend({ domain: 'other.sol', address: OTHER, amount: '1000000', wallet, env });
  assert.equal(other.address, OTHER);
  assert.equal(planSnsSend({ domain: 'richclub.sol', amount: '1', wallet, env }).error, 'sns_not_found');
});

test('a missing devnet RPC names the secret and still returns the resolved address', () => {
  const plan = planSnsSend({
    domain: '@richclub.sol',
    address: ADDRESS,
    amount: '1',
    wallet,
    env: { PRIVY_APP_ID: 'app', PRIVY_APP_SECRET: 'secret' },
  });
  assert.equal(plan.error, 'missing_config');
  assert.deepEqual(plan.missing, ['QUICKNODE_DEVNET_RPC_URL']);
  assert.equal(plan.address, ADDRESS);
});
