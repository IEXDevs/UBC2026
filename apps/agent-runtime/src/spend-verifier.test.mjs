import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifierFacts } from './spend-verifier.mjs';

const mint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const facts = {
  asset: 'USDC',
  mint,
  cluster: 'devnet',
  price: '1000000',
  amount: '1000',
  trustScore: '800',
  reasonSummary: 'pay 1000 USDC on devnet',
};
const proposal = {
  cluster: 'devnet',
  asset: 'USDC',
  recipient: mint,
  outflow: '1000',
};

/**
 * Achieves: A matching proposal keeps the requested amount.
 * Fails when: The verifier changes a consistent spend.
 * Oracle: amount stays 1000.
 * Side effects: none.
 * Gaps: none.
 */
test('verifier agrees when the proposal matches the spend', () => {
  const verified = verifierFacts({
    facts,
    proposal,
    parsed: { amount: '1000', destination: mint, action: 'pay' },
    trustScore: '800',
    mint,
  });
  assert.equal(verified.amount, '1000');
  assert.equal(verified.cluster, 'devnet');
  assert.equal(verified.asset, 'USDC');
});

/**
 * Achieves: A different outflow is refused as amount 1.
 * Fails when: The client can force the verifier to echo a mismatched amount.
 * Oracle: amount === '1'.
 * Side effects: none.
 * Gaps: none.
 */
test('verifier refuses an outflow that is not the requested amount', () => {
  const verified = verifierFacts({
    facts,
    proposal: { ...proposal, outflow: '1001' },
    parsed: { amount: '1000', destination: mint },
    trustScore: '800',
    mint,
  });
  assert.equal(verified.amount, '1');
});

/**
 * Achieves: a missing Jupiter score stays off the verifier facts.
 * Fails when: the verifier fills 800 or any other score.
 * Oracle: trustUnavailable true and no trustScore field.
 * Side effects: none.
 * Gaps: the spend route covers the confirmation prompt.
 */
test('verifier does not invent a trust score when Jupiter is unavailable', () => {
  const verified = verifierFacts({
    facts: { ...facts, trustScore: undefined, trustUnavailable: true },
    proposal,
    parsed: { amount: '1000', destination: mint, action: 'buy' },
    trustUnavailable: true,
    mint,
  });
  assert.equal(verified.trustUnavailable, true);
  assert.equal(Object.hasOwn(verified, 'trustScore'), false);
  assert.equal(verified.amount, '1000');
});
