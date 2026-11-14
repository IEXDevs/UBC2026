import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDecisionGate } from './loop.mjs';
import { memoFromDecision } from '@ubc2026/verify-consensus';

function assertDecisionMemo(result) {
  const memo = JSON.parse(result.memo);
  assert.equal(result.memo, memoFromDecision(result.consensus.decisionRecord));
  assert.equal(memo.r, result.digests.decision);
  assert.equal(memo.d, result.digests.facts);
  assert.match(memo.r, /^[a-f0-9]{64}$/);
}

const wallet = {
  id: 'w_main',
  ownerId: 'user_1',
  kind: 'main',
  label: 'Main',
  address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  frozen: false,
  provider: 'privy',
};

const bot = {
  id: 'bot_1',
  ownerId: 'user_1',
  name: 'APY hunter',
  goal: 'yield',
  type: 'trading',
  enabled: true,
  frozen: false,
  walletId: 'w_main',
  policyVersion: 1,
  approvalMode: 'ask',
  cap: { mode: 'limited', asset: 'USDC', maxOutflow: '100000', maxPerTransaction: '50000' },
};

const ledger = { botId: 'bot_1', asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' };
const proposal = {
  id: 'p1',
  botId: 'bot_1',
  cluster: 'devnet',
  asset: 'USDC',
  recipient: 'Alex111111111111111111111111111111111111111',
  quoteId: 'q1',
  outflow: '1000',
  expectedReceive: '1000',
  expectedReceiveAsset: 'USDC',
  maxFee: '10',
  expiresAt: Date.now() + 60_000,
};

const facts = {
  asset: 'USDC',
  mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  cluster: 'devnet',
  price: '1000000',
  amount: '1000',
  trustScore: '800',
  reasonSummary: 'Transfer under cap',
};

test('ask mode requires approval after trust + verify pass', async () => {
  const result = await runDecisionGate({
    bot,
    wallet,
    ledger,
    proposal,
    trustScore: '800',
    mainFn: async () => facts,
    verifyFn: async () => facts,
    now: Date.now(),
  });
  assert.equal(result.state, 'approval-needed');
  assert.equal(result.trust.state, 'allowed');
  assert.equal(result.consensus.state, 'consensus');
  assertDecisionMemo(result);
});

test('fully automatic mode can become ready-to-execute', async () => {
  const result = await runDecisionGate({
    bot: { ...bot, approvalMode: 'fully-automatic' },
    wallet,
    ledger,
    proposal,
    trustScore: '800',
    mainFn: async () => facts,
    verifyFn: async () => facts,
    now: Date.now(),
  });
  assert.equal(result.state, 'ready-to-execute');
  assertDecisionMemo(result);
});

test('low trust score pauses before verify', async () => {
  const result = await runDecisionGate({
    bot,
    wallet,
    ledger,
    proposal,
    trustScore: '100',
    trustConfirmed: false,
    mainFn: async () => assert.fail('should not verify'),
    verifyFn: async () => assert.fail('should not verify'),
    now: Date.now(),
  });
  assert.equal(result.state, 'trust-confirmation-required');
});

test('verify mismatch does not attach a memo', async () => {
  const result = await runDecisionGate({
    bot,
    wallet,
    ledger,
    proposal,
    trustScore: '800',
    mainFn: async () => facts,
    verifyFn: async () => ({ ...facts, price: '1' }),
    now: Date.now(),
  });
  assert.equal(result.state, 'verify-mismatch');
  assert.equal(result.memo, undefined);
});

test('frozen wallet blocks the loop', async () => {
  const result = await runDecisionGate({
    bot,
    wallet: { ...wallet, frozen: true },
    ledger,
    proposal,
    trustScore: '800',
    mainFn: async () => facts,
    verifyFn: async () => facts,
    now: Date.now(),
  });
  assert.equal(result.state, 'blocked');
  assert.equal(result.reason, 'spend-frozen');
});
