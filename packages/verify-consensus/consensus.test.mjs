import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFacts, compareFacts, factsDigest, reachConsensus, memoFromDecision } from './consensus.mjs';

const base = {
  asset: 'SOL',
  mint: 'So11111111111111111111111111111111111111112',
  cluster: 'devnet',
  price: '150000000',
  amount: '1000000',
  trustScore: '800',
  reasonSummary: 'Stable blue-chip allocation within hourly horizon',
};

test('facts require testnet/devnet and integer string amounts', () => {
  assert.equal(normalizeFacts(base).asset, 'SOL');
  assert.throws(() => normalizeFacts({ ...base, cluster: 'mainnet-beta' }));
  assert.throws(() => normalizeFacts({ ...base, price: '1.5' }));
  assert.throws(() => normalizeFacts({ ...base, trustScore: '1001' }));
});

test('digest binds the canonical fact set', () => {
  const a = factsDigest(base);
  const b = factsDigest({ ...base, reasonSummary: '  Stable blue-chip allocation within hourly horizon  ' });
  assert.equal(a, b);
  assert.notEqual(a, factsDigest({ ...base, amount: '1000001' }));
});

test('silent consensus on first independent match', async () => {
  const result = await reachConsensus({
    mainFn: async () => base,
    verifyFn: async ({ main }) => ({ ...main }),
  });
  assert.equal(result.state, 'consensus');
  assert.equal(result.attempts.length, 1);
  assert.equal(result.digest, factsDigest(base));
  assert.equal(result.decisionRecord.outcome, 'consensus');
  assert.match(memoFromDecision(result.decisionRecord), /"o":"c"/);
});

test('backend re-checks until main agent corrects itself', async () => {
  let mainAmount = '999';
  const result = await reachConsensus({
    mainFn: async ({ attempt }) => {
      if (attempt > 2) mainAmount = '1000000';
      return { ...base, amount: mainAmount };
    },
    verifyFn: async () => base,
  });
  assert.equal(result.state, 'consensus');
  assert.equal(result.attempts.length, 3);
  assert.deepEqual(result.attempts[0].mismatches, ['amount']);
  assert.equal(result.facts.amount, '1000000');
});

test('five exhausted mismatches surface manual review without a memo', async () => {
  const result = await reachConsensus({
    mainFn: async () => base,
    verifyFn: async () => ({ ...base, price: '1' }),
  });
  assert.equal(result.state, 'manual-review');
  assert.equal(result.attempts.length, 5);
  assert.equal(result.digest, null);
  assert.throws(() => memoFromDecision(result.decisionRecord));
  assert.ok(result.decisionRecord.mismatches.every(entry => entry.field === 'price'));
});

test('compareFacts reports every disagreeing field', () => {
  const comparison = compareFacts(base, { ...base, asset: 'USDC', trustScore: '10' });
  assert.equal(comparison.match, false);
  assert.deepEqual(comparison.mismatches, ['asset', 'trustScore']);
});
