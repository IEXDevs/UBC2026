import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBot, evaluateProposal, validateApproval, proposalDigest, raiseLimits } from './policy.mjs';

const bot = {
  id: 'b',
  ownerId: 'u',
  name: 'Shop',
  goal: 'Compare products',
  type: 'shopping',
  enabled: true,
  policyVersion: 1,
  cap: { mode: 'limited', asset: 'USDC', maxOutflow: '100', maxPerTransaction: '50' },
};
const p = {
  id: 'p',
  botId: 'b',
  cluster: 'devnet',
  asset: 'USDC',
  recipient: 'merchant',
  quoteId: 'q',
  outflow: '40',
  maxFee: '2',
  expectedReceive: '1',
  expectedReceiveAsset: 'gift-card',
  expiresAt: 2000,
};
const ledger = { asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' };
const approval = {
  ownerId: 'u',
  botId: 'b',
  policyVersion: 1,
  digest: proposalDigest(p),
  action: 'approve',
  expiresAt: 1500,
};
const check = (overrides = {}) => validateApproval({ bot, proposal: p, ledger, approval, now: 1000, ...overrides });

/**
 * Achieves: Bots require an explicit type and a string-valued cap decision (no numeric maxOutflow).
 * Fails when: Missing type/cap validates, or maxOutflow number coerces through.
 * Oracle: validateBot throws on undefined type/cap and numeric maxOutflow (amounts are decimal strings).
 * Side effects: none.
 * Gaps: Full bot record validation overlaps contracts package.
 */
test('bot requires type and explicit cap decision', () => {
  assert.throws(() => validateBot({ ...bot, type: undefined }));
  assert.throws(() => validateBot({ ...bot, cap: undefined }));
  assert.throws(() => validateBot({ ...bot, cap: { ...bot.cap, maxOutflow: 100 } }));
});

/**
 * Achieves: Limited and unlimited budgets still require manual approval in default ask-like evaluate path.
 * Fails when: Unlimited auto-approves without an approval mode change, or missing approval validates.
 * Oracle: evaluateProposal state approval-needed; invalid-approval when approval undefined.
 * Side effects: none.
 * Gaps: fully-automatic evaluate path is covered via ledger integration cases.
 */
test('normal and unlimited budgets still require manual approval', () => {
  assert.equal(evaluateProposal(bot, p, ledger, 1000).state, 'approval-needed');
  assert.equal(evaluateProposal({ ...bot, cap: { mode: 'unlimited', asset: 'USDC' } }, p, ledger, 1000).state, 'approval-needed');
  assert.equal(check({ approval: undefined }).reason, 'invalid-approval');
});

/**
 * Achieves: Debit = outflow+fee with exact integer strings; spent+reserved count toward both caps.
 * Fails when: Float math appears, or violations miss per-transaction/total-outflow.
 * Oracle: Hand-computed 49+2=51 debit; spent 50 + reserved 1 leave no room under maxOutflow 100 / maxPerTx 50.
 * Side effects: none.
 * Gaps: BigInt overflow extremes not probed.
 */
test('fees and reservations count toward limits with exact integer arithmetic', () => {
  const decision = evaluateProposal(bot, { ...p, outflow: '49' }, { ...ledger, spent: '50', reserved: '1' }, 1000);
  assert.deepEqual(decision.violations, ['per-transaction', 'total-outflow']);
  assert.equal(decision.debit, '51');
});

/**
 * Achieves: Mainnet cluster, wrong botId, and malformed amounts throw before a decision state.
 * Fails when: mainnet-beta evaluates, or decimal/negative amounts are accepted.
 * Oracle: Independent change matrix; throws (not soft blocked) for illegal proposals.
 * Side effects: none.
 * Gaps: testnet acceptance is allowed by policy (hackathon) — not rejected here.
 */
test('mainnet, wrong bot and malformed amounts are rejected', () => {
  for (const change of [{ cluster: 'mainnet-beta' }, { botId: 'other' }, { outflow: '1.2' }, { maxFee: '-1' }]) {
    assert.throws(() => evaluateProposal(bot, { ...p, ...change }, ledger, 1000));
  }
});

/**
 * Achieves: Disabled bots and expired quotes block approval with stable reasons.
 * Fails when: Disabled bot reaches ready-to-reserve, or now==expiresAt still approves.
 * Oracle: reason codes bot-disabled / quote-expired; expiresAt boundary at now=2000.
 * Side effects: none.
 * Gaps: Clock skew / server time injection is caller's responsibility.
 */
test('kill switch and quote expiry block approval', () => {
  assert.equal(check({ bot: { ...bot, enabled: false } }).reason, 'bot-disabled');
  assert.equal(check({ now: 2000 }).reason, 'quote-expired');
});

/**
 * Achieves: Approval digests bind owner, policyVersion, quote fields, and expiry; mutations invalidate.
 * Fails when: Recipient/outflow/quoteId changes still validate, or ready-to-reserve on mutated approval.
 * Oracle: proposalDigest(p) independent recompute; change matrix → blocked / invalid-approval.
 * Side effects: none.
 * Gaps: Digest algorithm collision resistance not tested (crypto primitive assumption).
 */
test('approval binds owner, version, quote, amounts, recipient and expiry', () => {
  assert.equal(check().state, 'ready-to-reserve');
  assert.equal(approval.digest, proposalDigest(p));
  for (const change of [{ ownerId: 'other' }, { policyVersion: 2 }, { usedAt: 900 }, { expiresAt: 1000 }, { expiresAt: 3000 }]) {
    assert.equal(check({ approval: { ...approval, ...change } }).state, 'blocked');
  }
  for (const change of [{ recipient: 'attacker' }, { outflow: '41' }, { expectedReceive: '2' }, { quoteId: 'new' }]) {
    assert.equal(check({ proposal: { ...p, ...change } }).reason, 'invalid-approval');
  }
});

/**
 * Achieves: Over-budget requires explicit approve-once; normal approve cannot raise the bot cap.
 * Fails when: Regular approve bypasses budget, or approve-once mutates bot.cap.maxOutflow.
 * Oracle: bot.cap.maxOutflow remains '100' after approve-once; budget-override-required reason.
 * Side effects: none (bot object must remain unchanged).
 * Gaps: approve-once consumption is ledger-owned.
 */
test('budget override is explicit and applies only to the approved proposal', () => {
  const full = { ...ledger, spent: '80' };
  assert.equal(check({ ledger: full }).reason, 'budget-override-required');
  assert.equal(check({ ledger: full, approval: { ...approval, action: 'approve-once' } }).state, 'ready-to-reserve');
  assert.equal(bot.cap.maxOutflow, '100');
});

/**
 * Achieves: raiseLimits bumps policyVersion and invalidates prior approvals; decreases throw.
 * Fails when: Version stays 1, old approval still validates, or lowering maxOutflow succeeds.
 * Oracle: next.policyVersion === 2; check({bot:next}) → invalid-approval; throws on decrease.
 * Side effects: none (returns new bot; input bot unchanged).
 * Gaps: Concurrent raiseLimits races are store-owned.
 */
test('raising limits invalidates earlier approvals', () => {
  const next = raiseLimits(bot, { ...bot.cap, maxOutflow: '200' });
  assert.equal(next.policyVersion, 2);
  assert.equal(bot.policyVersion, 1);
  assert.equal(check({ bot: next }).reason, 'invalid-approval');
  assert.throws(() => raiseLimits(bot, { ...bot.cap, maxOutflow: '99' }));
});

/**
 * Achieves: Position managers stop at maxLoss; accounting asset must match the ledger asset.
 * Fails when: At-loss position still approval-needed, or SOL proposal against USDC ledger proceeds.
 * Oracle: reason max-loss-reached / accounting-asset-mismatch.
 * Side effects: none.
 * Gaps: Partial loss under maxLoss still spending is covered in ledger cases.
 */
test('position manager stops at max loss and accounting asset must match', () => {
  const manager = { ...bot, type: 'position-management', cap: { mode: 'limited', asset: 'USDC', maxLoss: '10' } };
  assert.equal(evaluateProposal(manager, p, { ...ledger, realizedLoss: '10' }, 1000).reason, 'max-loss-reached');
  assert.equal(evaluateProposal(bot, { ...p, asset: 'SOL' }, ledger, 1000).reason, 'accounting-asset-mismatch');
});

/**
 * Achieves: proposalDigest is stable for the same proposal and changes when binding fields change.
 * Fails when: Digest flips on identical input, or recipient change keeps the same digest.
 * Oracle: Pure function equality / inequality on controlled fixtures (independent of validateApproval).
 * Side effects: none.
 * Gaps: Does not assert canonicalization of key order beyond implementation.
 */
test('proposalDigest is deterministic and binds critical fields', () => {
  assert.equal(proposalDigest(p), proposalDigest({ ...p }));
  assert.notEqual(proposalDigest(p), proposalDigest({ ...p, recipient: 'attacker' }));
  assert.notEqual(proposalDigest(p), proposalDigest({ ...p, outflow: '41' }));
  assert.match(proposalDigest(p), /^[a-f0-9]{64}$/);
});
