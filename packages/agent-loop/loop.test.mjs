import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERMISSIONED_SPEND_STEPS,
  approvalRequirement,
  mainnetQuoteBlocksSpend,
  runDecisionGate,
  runPermissionedSpend,
  LoopError,
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

/**
 * Achieves: Ask-mode bots that pass trust + verify still stop at approval-needed with a decision memo.
 * Fails when: State skips to ready-to-execute, or memo digests diverge from consensus record.
 * Oracle: Independent memoFromDecision(@ubc2026/verify-consensus) recomputed from decisionRecord.
 * Side effects: none (injected mainFn/verifyFn; no signing).
 * Gaps: Does not cover capped-automatic ask-above-cap (covered separately).
 */
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

/**
 * Achieves: Fully-automatic mode can reach ready-to-execute when trust/verify/policy agree.
 * Fails when: Automatic bots still demand approval without an ownerPermission override.
 * Oracle: Same independent memo oracle as ask-mode; state must be ready-to-execute.
 * Side effects: none.
 * Gaps: Does not assert policy.debit arithmetic (bot-policy owns that).
 */
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

/**
 * Achieves: Low trust pauses before any verify call when unconfirmed.
 * Fails when: mainFn/verifyFn run, or state is not trust-confirmation-required.
 * Oracle: Injected assert.fail callbacks prove verify was not reached (call-order oracle).
 * Side effects: none.
 * Gaps: Confirmed-low-trust path covered in a dedicated test.
 */
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

/**
 * Achieves: Owner-confirmed low trust proceeds into verify instead of pausing.
 * Fails when: Confirmed trust still returns trust-confirmation-required.
 * Oracle: Call-order — mainFn must run once after confirmation.
 * Side effects: none.
 * Gaps: none for this gate.
 */
test('confirmed low trust proceeds past the trust gate', async () => {
  let mainCalls = 0;
  const result = await runDecisionGate({
    bot,
    wallet,
    ledger,
    proposal,
    trustScore: '100',
    trustConfirmed: true,
    mainFn: async () => { mainCalls += 1; return facts; },
    verifyFn: async () => facts,
    now: Date.now(),
  });
  assert.equal(mainCalls, 1);
  assert.equal(result.state, 'approval-needed');
});

/**
 * Achieves: Verify mismatch stops without attaching a spend memo.
 * Fails when: memo is present on verify-mismatch, or state is wrong.
 * Oracle: Divergent price facts from independent main/verify producers.
 * Side effects: none.
 * Gaps: none.
 */
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

/**
 * Achieves: approvalRequirement follows bot mode, over-budget, and ownerPermission+confirmed.
 * Fails when: Over-budget skips humans, or unconfirmed full permission auto-approves.
 * Oracle: Explicit truth table of (mode, state, permission, confirmed) → boolean.
 * Side effects: none.
 * Gaps: Unknown permission throws — covered below.
 */
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
    { ownerPermission: 'full', confirmed: true },
  ), false);
  assert.equal(approvalRequirement(
    { approvalMode: 'fully-automatic' },
    { state: 'ready-to-reserve', debit: '1000' },
    { ownerPermission: 'full' },
  ), true);
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
  assert.throws(
    () => approvalRequirement(
      { approvalMode: 'ask' },
      { state: 'ready-to-reserve', debit: '1' },
      { ownerPermission: 'sudo' },
    ),
    LoopError,
  );
});

/**
 * Achieves: Mainnet/paper quotes and authorizesTransaction flags never authorize a spend.
 * Fails when: mainnet pricingCluster or paperPnl returns false (would allow signing).
 * Oracle: Documented rule — pricingCluster/cluster mainnet, paperPnl, authorizesTransaction all block.
 * Side effects: none.
 * Gaps: null quote is allowed (no quote ≠ mainnet quote).
 */
test('mainnetQuoteBlocksSpend blocks mainnet, paper, and authorize flags', () => {
  assert.equal(mainnetQuoteBlocksSpend(null), false);
  assert.equal(mainnetQuoteBlocksSpend({ pricingCluster: 'devnet' }), false);
  assert.equal(mainnetQuoteBlocksSpend({ pricingCluster: 'mainnet' }), true);
  assert.equal(mainnetQuoteBlocksSpend({ cluster: 'mainnet' }), true);
  assert.equal(mainnetQuoteBlocksSpend({ paperPnl: true }), true);
  assert.equal(mainnetQuoteBlocksSpend({ authorizesTransaction: true }), true);
  assert.equal(mainnetQuoteBlocksSpend('mainnet'), true);
});

/**
 * Achieves: Full permissions sign on-chain only after the ordered gate; mainnet quotes never sign.
 * Fails when: Sign runs before verify, or mainnet quote still invokes signDevnet.
 * Oracle: Call-order spy + PERMISSIONED_SPEND_STEPS constant; empty sign calls for quote path.
 * Side effects: none (signDevnet injected).
 * Gaps: sign-rejected and wrong-cluster covered separately.
 */
test('full permissions manage funds and a mainnet quote never signs', async () => {
  const seen = [];
  const signed = await runPermissionedSpend({
    bot: { ...bot, approvalMode: 'ask' },
    wallet,
    ledger,
    proposal,
    trustScore: '800',
    ownerPermission: 'full',
    confirmed: true,
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
    confirmed: true,
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

/**
 * Achieves: Frozen wallet blocks the decision gate with spend-frozen reason.
 * Fails when: Frozen wallet reaches approval-needed or ready-to-execute.
 * Oracle: wallets.assertSpendAllowed freeze contract via frozen: true fixture.
 * Side effects: none.
 * Gaps: Bot-frozen path is policy-owned; wallet freeze is the loop concern here.
 */
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

/**
 * Achieves: Capped-automatic asks when debit exceeds autoApproveCap and auto-passes at/under cap.
 * Fails when: Over-cap becomes ready-to-execute, or under-cap still asks.
 * Oracle: debit from proposal outflow+fee vs autoApproveCap BigInt comparison.
 * Side effects: none.
 * Gaps: Exact equality at cap is the intended auto-approve boundary.
 */
test('capped-automatic asks above autoApproveCap and executes at the boundary', async () => {
  const atCap = await runDecisionGate({
    bot: { ...bot, approvalMode: 'capped-automatic', autoApproveCap: '1010' },
    wallet,
    ledger,
    proposal,
    trustScore: '800',
    mainFn: async () => facts,
    verifyFn: async () => facts,
    now: Date.now(),
  });
  // outflow 1000 + maxFee 10 = 1010 debit
  assert.equal(atCap.policy.debit, '1010');
  assert.equal(atCap.state, 'ready-to-execute');

  const above = await runDecisionGate({
    bot: { ...bot, approvalMode: 'capped-automatic', autoApproveCap: '1009' },
    wallet,
    ledger,
    proposal,
    trustScore: '800',
    mainFn: async () => facts,
    verifyFn: async () => facts,
    now: Date.now(),
  });
  assert.equal(above.state, 'approval-needed');
});

/**
 * Achieves: Signer throw / bad signature / missing signer never report signed=true.
 * Fails when: Failed sign returns state signed, or steps include sign after rejection without signed flag.
 * Oracle: Injected signDevnet outcomes; signed flag must stay false.
 * Side effects: none.
 * Gaps: Does not cover network broadcast failures (signing is injected; no broadcast here).
 */
test('permissioned spend rejects missing, throwing, or invalid signers', async () => {
  const base = {
    bot: { ...bot, approvalMode: 'fully-automatic' },
    wallet,
    ledger,
    proposal,
    trustScore: '800',
    ownerPermission: 'full',
    confirmed: true,
    mainFn: async () => facts,
    verifyFn: async () => facts,
    now: Date.now(),
  };
  const missing = await runPermissionedSpend(base);
  assert.equal(missing.state, 'signer-not-configured');
  assert.equal(missing.signed, false);

  const threw = await runPermissionedSpend({
    ...base,
    signDevnet: async () => { throw new Error('hardware denied'); },
  });
  assert.equal(threw.state, 'sign-rejected');
  assert.equal(threw.signed, false);
  assert.ok(threw.steps.includes('sign'));

  const badCluster = await runPermissionedSpend({
    ...base,
    signDevnet: async () => ({ cluster: 'mainnet', signature: 'sig' }),
  });
  assert.equal(badCluster.state, 'sign-rejected');
  assert.equal(badCluster.signed, false);

  const emptySig = await runPermissionedSpend({
    ...base,
    signDevnet: async () => ({ cluster: 'devnet', signature: '' }),
  });
  assert.equal(emptySig.state, 'sign-rejected');
});

/**
 * Achieves: Non-devnet proposals never reach the signer even with full confirmed permission.
 * Fails when: testnet/mainnet proposals invoke signDevnet.
 * Oracle: Call-order spy must stay empty; state wrong-cluster.
 * Side effects: none.
 * Gaps: Policy may also reject mainnet earlier — either stop is acceptable; this asserts sign never runs.
 */
test('non-devnet proposals stop before signing', async () => {
  const calls = [];
  const result = await runPermissionedSpend({
    bot: { ...bot, approvalMode: 'fully-automatic' },
    wallet,
    ledger,
    proposal: { ...proposal, cluster: 'testnet' },
    trustScore: '800',
    ownerPermission: 'full',
    confirmed: true,
    mainFn: async () => facts,
    verifyFn: async () => facts,
    now: Date.now(),
    signDevnet: async () => { calls.push('sign'); return { cluster: 'devnet', signature: 'x' }; },
  });
  // Policy may block mainnet/testnet before we get here; if it passes, loop must still refuse to sign.
  assert.notEqual(result.state, 'signed');
  assert.deepEqual(calls, []);
  if (result.state === 'wrong-cluster') {
    assert.equal(result.signed, false);
    assert.equal(result.steps.includes('sign'), false);
  }
});

/**
 * Achieves: Review by AI signs at or under reviewCap without a slide, and waits above it.
 * Fails when: Under-cap still asks, or over-cap signs.
 * Oracle: debit 1010 vs reviewCap; confirmed stays false.
 * Side effects: none.
 * Gaps: The verifier still has to match before this step.
 */
test('review permission auto-continues only inside the owner threshold', async () => {
  const under = await runPermissionedSpend({
    bot,
    wallet,
    ledger,
    proposal,
    trustScore: '800',
    ownerPermission: 'review',
    confirmed: false,
    reviewCap: '1010',
    mainFn: async () => facts,
    verifyFn: async () => facts,
    now: Date.now(),
    signDevnet: async () => ({ cluster: 'devnet', signature: 'sig_review' }),
  });
  assert.equal(under.state, 'signed');
  assert.equal(under.signature, 'sig_review');

  const over = await runPermissionedSpend({
    bot,
    wallet,
    ledger,
    proposal,
    trustScore: '800',
    ownerPermission: 'review',
    confirmed: false,
    reviewCap: '1009',
    mainFn: async () => facts,
    verifyFn: async () => facts,
    now: Date.now(),
    signDevnet: async () => ({ cluster: 'devnet', signature: 'sig_should_not' }),
  });
  assert.equal(over.state, 'approval-needed');
  assert.equal(over.signed, false);
});
