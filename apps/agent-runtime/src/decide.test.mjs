/**
 * Unit tests for decideFromCheckpoint — every gate outcome that mutates the run.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyRun, advanceRun, pauseRun } from './checkpoint.mjs';
import { decideFromCheckpoint } from './decide.mjs';

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

function liveRun(now = 1) {
  let run = createEmptyRun({ runId: 'run_1', botId: 'bot_1', goal: 'yield', now });
  return advanceRun(run, 'research', 'wake', now + 1);
}

/**
 * Achieves: missing/paused runs throw before the gate runs.
 * Fails when: gate is invoked without a live run, or pause is ignored.
 * Oracle: thrown message codes no_run / run_paused.
 * Side effects / state checked: none.
 * Gaps: none.
 */
test('decideFromCheckpoint rejects missing and paused runs', async () => {
  await assert.rejects(
    () => decideFromCheckpoint({
      run: null,
      bot,
      wallet,
      ledger,
      proposal,
      trustScore: '800',
      mainFn: async () => assert.fail('no gate'),
      verifyFn: async () => assert.fail('no gate'),
    }),
    /no_run/,
  );

  const paused = pauseRun(liveRun(), 'owner', 3);
  await assert.rejects(
    () => decideFromCheckpoint({
      run: paused,
      bot,
      wallet,
      ledger,
      proposal,
      trustScore: '800',
      mainFn: async () => assert.fail('no gate'),
      verifyFn: async () => assert.fail('no gate'),
    }),
    /run_paused/,
  );
});

/**
 * Achieves: low trust without confirmation pauses at trust-confirmation.
 * Fails when: verify runs or pause reason differs.
 * Oracle: gate.state + run.pauseReason; mainFn must not run.
 * Side effects / state checked: run.paused.
 * Gaps: confirmed-low-trust covered below via approval path.
 */
test('decideFromCheckpoint pauses for trust-confirmation-required', async () => {
  const result = await decideFromCheckpoint({
    run: liveRun(),
    bot,
    wallet,
    ledger,
    proposal,
    trustScore: '100',
    trustConfirmed: false,
    mainFn: async () => assert.fail('should not verify'),
    verifyFn: async () => assert.fail('should not verify'),
    now: 10,
  });
  assert.equal(result.gate.state, 'trust-confirmation-required');
  assert.equal(result.run.paused, true);
  assert.equal(result.run.pauseReason, 'trust-confirmation');
});

/**
 * Achieves: divergent main/verify facts pause at verify-mismatch.
 * Fails when: mismatch still advances to approval/execute.
 * Oracle: gate.state === verify-mismatch; run paused.
 * Side effects / state checked: run.paused.
 * Gaps: none.
 */
test('decideFromCheckpoint pauses on verify-mismatch', async () => {
  const result = await decideFromCheckpoint({
    run: liveRun(),
    bot,
    wallet,
    ledger,
    proposal,
    trustScore: '800',
    mainFn: async () => facts,
    verifyFn: async () => ({ ...facts, price: '1' }),
    now: 10,
  });
  assert.equal(result.gate.state, 'verify-mismatch');
  assert.equal(result.run.paused, true);
  assert.equal(result.run.pauseReason, 'verify-mismatch');
});

/**
 * Achieves: frozen wallet blocks and pauses the run.
 * Fails when: blocked gate still reaches approval or execute.
 * Oracle: gate.state === blocked; run.paused.
 * Side effects / state checked: run.paused / pauseReason.
 * Gaps: policy over-cap blocked is owned by agent-loop tests.
 */
test('decideFromCheckpoint pauses when gate is blocked', async () => {
  const result = await decideFromCheckpoint({
    run: liveRun(),
    bot,
    wallet: { ...wallet, frozen: true },
    ledger,
    proposal,
    trustScore: '800',
    mainFn: async () => facts,
    verifyFn: async () => facts,
    now: 10,
  });
  assert.equal(result.gate.state, 'blocked');
  assert.equal(result.run.paused, true);
  assert.ok(result.run.pauseReason);
});

/**
 * Achieves: ask-mode approval-needed advances to approval then pauses.
 * Fails when: ask mode auto-executes or skips approval step.
 * Oracle: gate.state + run.step === approval + paused.
 * Side effects / state checked: checkpoint step/events.
 * Gaps: none.
 */
test('decideFromCheckpoint pauses for approval-needed in ask mode', async () => {
  const result = await decideFromCheckpoint({
    run: liveRun(),
    bot,
    wallet,
    ledger,
    proposal,
    trustScore: '800',
    mainFn: async () => facts,
    verifyFn: async () => facts,
    now: 10,
  });
  assert.equal(result.gate.state, 'approval-needed');
  assert.equal(result.run.paused, true);
  assert.equal(result.run.step, 'approval');
  assert.equal(result.run.pauseReason, 'approval-needed');
});

/**
 * Achieves: fully-automatic mode reaches execute without pausing.
 * Fails when: automatic bots still pause for approval.
 * Oracle: gate.state === ready-to-execute; run.paused === false; step === execute.
 * Side effects / state checked: checkpoint step.
 * Gaps: does not sign — decide never signs.
 */
test('decideFromCheckpoint advances to execute when gate is ready', async () => {
  const result = await decideFromCheckpoint({
    run: liveRun(),
    bot: { ...bot, approvalMode: 'fully-automatic' },
    wallet,
    ledger,
    proposal,
    trustScore: '800',
    mainFn: async () => facts,
    verifyFn: async () => facts,
    now: 10,
  });
  assert.equal(result.gate.state, 'ready-to-execute');
  assert.equal(result.run.paused, false);
  assert.equal(result.run.step, 'execute');
});
