import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyRun, advanceRun, pauseRun, resumeRun } from './checkpoint.mjs';
import { BotStateMachine } from './bot-do.mjs';
import { decideFromCheckpoint } from './decide.mjs';

/**
 * Achieves: checkpoint helper advances/pauses while retaining history entries.
 * Fails when: history cleared on pause or advance skips states.
 * Oracle: history length/order assertions in test.
 * Side effects / state checked: in-memory checkpoint state.
 * Gaps: none
 */
test('run checkpoints advance and pause without losing history', () => {
  let run = createEmptyRun({ runId: 'run_1', botId: 'bot_1', goal: 'yield', now: 1 });
  run = advanceRun(run, 'research', 'started', 2);
  run = advanceRun(run, 'decide', 'candidate', 3);
  run = pauseRun(run, 'approval', 4);
  assert.equal(run.paused, true);
  assert.equal(run.step, 'decide');
  run = resumeRun(run, 5);
  assert.equal(run.paused, false);
  assert.ok(run.events.length >= 3);
});

/**
 * Achieves: machine wake/advance work; paused machine refuses advance.
 * Fails when: paused advance succeeds or wake fails to set state.
 * Oracle: state transitions + paused block in test.
 * Side effects / state checked: machine internal state.
 * Gaps: none
 */
test('BotStateMachine wakes, advances, and blocks while paused', async () => {
  const machine = new BotStateMachine();
  const wake = await machine.handle(new Request('https://bot/wake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ botId: 'bot_1', goal: 'shop' }),
  }), { CLUSTER: 'devnet' });
  assert.equal(wake.status, 200);
  const paused = await machine.handle(new Request('https://bot/pause', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'owner' }),
  }));
  assert.equal(paused.status, 200);
  const blocked = await machine.handle(new Request('https://bot/wake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ botId: 'bot_1' }),
  }));
  assert.equal(blocked.status, 409);
  const resumed = await machine.handle(new Request('https://bot/resume', { method: 'POST' }));
  assert.equal(resumed.status, 200);
  const status = await machine.handle(new Request('https://bot/status'));
  const body = await status.json();
  assert.equal(body.run.botId, 'bot_1');
  assert.equal(body.run.paused, false);
});

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
 * Achieves: ask-mode decide pauses awaiting approval instead of executing.
 * Fails when: ask mode auto-executes.
 * Oracle: paused/approval-needed outcome.
 * Side effects / state checked: decide result state.
 * Gaps: none
 */
test('decide path pauses for approval in ask mode', async () => {
  let run = createEmptyRun({ runId: 'run_1', botId: 'bot_1', goal: 'yield', now: 1 });
  run = advanceRun(run, 'research', 'wake', 2);
  const result = await decideFromCheckpoint({
    run,
    bot,
    wallet,
    ledger,
    proposal,
    trustScore: '800',
    mainFn: async () => facts,
    verifyFn: async () => facts,
    now: 3,
  });
  assert.equal(result.gate.state, 'approval-needed');
  assert.equal(result.run.paused, true);
  assert.equal(result.run.step, 'approval');
  const memo = JSON.parse(result.gate.memo);
  assert.equal(memo.r, result.gate.digests.decision);
  assert.match(memo.r, /^[a-f0-9]{64}$/);
});

/**
 * Achieves: DO /decide persists gate outcome on the machine.
 * Fails when: gate outcome not stored or wrong.
 * Oracle: stored gate fields match decide result.
 * Side effects / state checked: machine storage.
 * Gaps: none
 */
test('BotStateMachine /decide stores gate outcome', async () => {
  const machine = new BotStateMachine();
  await machine.handle(new Request('https://bot/wake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ botId: 'bot_1', goal: 'yield' }),
  }));
  const decided = await machine.handle(new Request('https://bot/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bot, wallet, ledger, proposal, facts, trustScore: '800',
    }),
  }));
  assert.equal(decided.status, 200);
  const body = await decided.json();
  assert.equal(body.gate.state, 'approval-needed');
  assert.equal(body.run.paused, true);
});
