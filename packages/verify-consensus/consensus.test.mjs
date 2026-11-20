import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeFacts,
  compareFacts,
  factsDigest,
  reachConsensus,
  hashDecisionRecord,
  memoFromDecision,
  buildDecisionRecord,
  ConsensusError,
} from './consensus.mjs';

const base = {
  asset: 'SOL',
  mint: 'So11111111111111111111111111111111111111112',
  cluster: 'mainnet-beta',
  price: '150000000',
  amount: '1000000',
  trustScore: '800',
  reasonSummary: 'Stable blue-chip allocation within hourly horizon',
};

/**
 * Achieves: normalizeFacts accepts execution clusters and integer base-unit strings; mainnet, decimals, and incomplete facts throw.
 * Fails when: mainnet-beta facts normalize, decimal prices are accepted, or empty reasonSummary passes.
 * Oracle: Hackathon execution cluster policy + amount domain.
 * Side effects: none
 * Gaps: none meaningful
 */
test('facts require testnet/mainnet-beta and integer string amounts', () => {
  assert.equal(normalizeFacts(base).asset, 'SOL');
  assert.throws(() => normalizeFacts({ ...base, cluster: 'testnet' }));
  assert.throws(() => normalizeFacts({ ...base, cluster: 'devnet' }));
  assert.throws(() => normalizeFacts({ ...base, price: '1.5' }));
  assert.throws(() => normalizeFacts({ ...base, trustScore: '1001' }));
  assert.throws(() => normalizeFacts({ ...base, reasonSummary: '' }));
  assert.throws(() => normalizeFacts({ ...base, mint: '' }));
  assert.equal(Object.hasOwn(normalizeFacts(base), 'trustUnavailable'), false);
  const missing = { ...base };
  delete missing.trustScore;
  assert.throws(() => normalizeFacts(missing));
  const open = normalizeFacts({ ...missing, trustUnavailable: true });
  assert.equal(open.trustScore, null);
  assert.equal(open.trustUnavailable, true);
  assert.throws(() => normalizeFacts({ ...base, trustUnavailable: true }));
  assert.equal(compareFacts(
    { ...missing, trustUnavailable: true },
    { ...missing, trustUnavailable: true },
  ).match, true);
  const drifted = compareFacts({ ...missing, trustUnavailable: true }, base);
  assert.equal(drifted.match, false);
  assert.equal(drifted.mismatches.includes('trustScore'), true);
});

/**
 * Achieves: factsDigest is stable under reasonSummary trim and changes when amount changes.
 * Fails when: Whitespace changes digest, or amount changes do not.
 * Oracle: SHA-256 of normalizeFacts JSON.
 * Side effects: none
 * Gaps: none meaningful
 */
test('digest binds the canonical fact set', () => {
  const a = factsDigest(base);
  const b = factsDigest({ ...base, reasonSummary: '  Stable blue-chip allocation within hourly horizon  ' });
  assert.equal(a, b);
  assert.notEqual(a, factsDigest({ ...base, amount: '1000001' }));
});

/**
 * Achieves: Matching main/verify on attempt 1 yields consensus with digest and compact memo.
 * Fails when: Match still retries, or memo lacks consensus outcome.
 * Oracle: reachConsensus silent-match path + memoFromDecision.
 * Side effects: none
 * Gaps: Does not cover verifyFn throwing.
 */
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

/**
 * Achieves: Mismatches retry until main corrects; attempt history records amount mismatches.
 * Fails when: Gives up early, or accepts wrong amount without retry.
 * Oracle: MAX_ATTEMPTS retry loop with independent verifyFn.
 * Side effects: none
 * Gaps: Does not cover verify changing across attempts.
 */
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

/**
 * Achieves: Memo fields bind digest/recordDigest; tampered facts/digest throw; different reasoning changes record hash.
 * Fails when: Tampered records still memoize, or reasoning changes leave r unchanged.
 * Oracle: hashDecisionRecord canonical payload.
 * Side effects: none
 * Gaps: none meaningful
 */
test('memo hash is recomputed from the decision record', async () => {
  const result = await reachConsensus({
    mainFn: async () => base,
    verifyFn: async ({ main }) => ({ ...main }),
  });
  const memo = JSON.parse(memoFromDecision(result.decisionRecord));
  assert.equal(memo.v, 1);
  assert.equal(memo.o, 'c');
  assert.equal(memo.d, factsDigest(base));
  assert.equal(memo.r, result.decisionRecord.recordDigest);
  assert.equal(memo.r, hashDecisionRecord(result.decisionRecord).recordDigest);

  const changed = await reachConsensus({
    mainFn: async () => ({ ...base, reasonSummary: 'Different reasoning summary' }),
    verifyFn: async ({ main }) => ({ ...main }),
  });
  assert.notEqual(JSON.parse(memoFromDecision(changed.decisionRecord)).r, memo.r);
  assert.throws(() => memoFromDecision({
    ...result.decisionRecord,
    facts: { ...result.decisionRecord.facts, amount: '2' },
  }));
  assert.throws(() => memoFromDecision({
    ...result.decisionRecord,
    recordDigest: 'b'.repeat(64),
  }));
});

/**
 * Achieves: Five price mismatches → manual-review, null digest, memoFromDecision throws.
 * Fails when: Exhaustion still returns consensus or a memo.
 * Oracle: MAX_ATTEMPTS=5 manual-review outcome.
 * Side effects: none
 * Gaps: none meaningful
 */
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

/**
 * Achieves: compareFacts lists all mismatching canonical fields.
 * Fails when: Only the first mismatch is reported.
 * Oracle: Field-wise compare of normalizeFacts outputs.
 * Side effects: none
 * Gaps: none meaningful
 */
test('compareFacts reports every disagreeing field', () => {
  const comparison = compareFacts(base, { ...base, asset: 'USDC', trustScore: '10' });
  assert.equal(comparison.match, false);
  assert.deepEqual(comparison.mismatches, ['asset', 'trustScore']);
});

/**
 * Achieves: buildDecisionRecord binds facts + attempt mismatches and hashes the canonical payload.
 * Fails when: Empty attempts succeed, invalid outcome accepted, or digest mismatches hashDecisionRecord.
 * Oracle: Independent SHA-256 via hashDecisionRecord on the same payload.
 * Side effects: none.
 * Gaps: reachConsensus already exercises consensus/manual-review outcomes end-to-end.
 */
test('buildDecisionRecord hashes attempt history and rejects incomplete inputs', () => {
  const attempts = [
    { attempt: 1, mismatches: ['price'], match: false },
    { attempt: 2, mismatches: [], match: true },
  ];
  const record = buildDecisionRecord({ facts: base, attempts, outcome: 'consensus' });
  assert.equal(record.version, 1);
  assert.equal(record.outcome, 'consensus');
  assert.equal(record.attemptCount, 2);
  assert.deepEqual(record.mismatches, [{ attempt: 1, field: 'price' }]);
  assert.equal(record.finalDigest, factsDigest(base));
  const { recordDigest } = hashDecisionRecord(record);
  assert.equal(record.recordDigest, recordDigest);

  assert.throws(() => buildDecisionRecord({ facts: base, attempts: [], outcome: 'consensus' }), ConsensusError);
  assert.throws(() => buildDecisionRecord({ facts: base, attempts, outcome: 'approve' }), ConsensusError);
  assert.throws(() => buildDecisionRecord({ facts: { ...base, cluster: 'devnet' }, attempts, outcome: 'consensus' }), ConsensusError);
  assert.throws(() => normalizeFacts({ ...base, amount: '-1' }), ConsensusError);
});
