import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERMISSIONED_SPEND_STEPS,
  approvalRequirement,
  runDecisionGate,
  runPermissionedSpend,
} from './loop.mjs';
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

test('approval requirement follows the bot mode and still holds over-budget', () => {
  assert.equal(approvalRequirement(
    { approvalMode: 'capped-automatic', autoApproveCap: '5000' },
    { state: 'approval-needed', debit: '1000' },
  ), false);
  assert.equal(approvalRequirement(
    { approvalMode: 'fully-automatic' },
    { state: 'over-budget', debit: '1000' },
  ), true);
  assert.equal(approvalRequirement(
    { approvalMode: 'ask' },
    { state: 'approval-needed', debit: '1000' },
  ), true);
  assert.equal(approvalRequirement(
    { approvalMode: 'fully-automatic' },
    { state: 'ready-to-reserve', debit: '1000' },
    { ownerPermission: 'full' },
  ), false);
  assert.equal(approvalRequirement(
    { approvalMode: 'fully-automatic' },
    { state: 'over-budget', debit: '1000' },
    { ownerPermission: 'full' },
  ), true);
  assert.equal(approvalRequirement(
    { approvalMode: 'ask' },
    { state: 'ready-to-reserve', debit: '1000' },
    { ownerPermission: 'ask', confirmed: true },
  ), false);
  assert.equal(approvalRequirement(
    { approvalMode: 'fully-automatic' },
    { state: 'blocked', debit: '1000' },
    { ownerPermission: 'ask' },
  ), false);
});

test('full permissions manage funds and a mainnet quote never signs', async () => {
  const seen = [];
  const signed = await runPermissionedSpend({
    bot: { ...bot, approvalMode: 'ask' },
    wallet,
    ledger,
    proposal,
    trustScore: '800',
    ownerPermission: 'full',
    mainFn: async () => { seen.push('verify-consensus'); return facts; },
    verifyFn: async () => facts,
    now: Date.now(),
    signDevnet: async () => { seen.push('sign'); return { cluster: 'devnet', signature: 'sig_devnet_1' }; },
  });
  assert.equal(signed.state, 'signed');
  assert.deepEqual(signed.steps, [...PERMISSIONED_SPEND_STEPS]);
  assert.deepEqual(seen, ['verify-consensus', 'sign']);
  assert.equal(signed.signature, 'sig_devnet_1');

  const calls = [];
  const quoted = await runPermissionedSpend({
    bot: { ...bot, approvalMode: 'fully-automatic' },
    wallet,
    ledger,
    proposal,
    trustScore: '800',
    ownerPermission: 'full',
    quote: { pricingCluster: 'mainnet', paperPnl: true, authorizesTransaction: false },
    mainFn: async () => facts,
    verifyFn: async () => facts,
    now: Date.now(),
    signDevnet: async () => { calls.push('sign'); return { cluster: 'devnet', signature: 'nope' }; },
  });
  assert.equal(quoted.state, 'quote-not-authorization');
  assert.equal(quoted.signed, false);
  assert.equal(quoted.steps.includes('sign'), false);
  assert.equal(quoted.steps.at(-1), 'approval-mode');
  assert.deepEqual(calls, []);

  const asking = await runPermissionedSpend({
    bot,
    wallet,
    ledger,
    proposal,
    trustScore: '800',
    ownerPermission: 'ask',
    mainFn: async () => facts,
    verifyFn: async () => facts,
    now: Date.now(),
    signDevnet: async () => { throw new Error('should not sign'); },
  });
  assert.equal(asking.state, 'approval-needed');
  assert.equal(asking.steps.at(-1), 'approval-mode');
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
