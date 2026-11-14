import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BotStateMachine } from './bot-do.mjs';
import { LOOP_STEPS } from './loop-engine.mjs';
import { PLATFORM_PROMPT } from './platform-prompt.mjs';
import { createOpenRouter } from './openrouter.mjs';

const API_KEY = 'test-openrouter-key-value';
const NOW = 1_700_000_000_000;
const DESTINATION = '11111111111111111111111111111111';

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
  approvalMode: 'fully-automatic',
  cap: { mode: 'limited', asset: 'USDC', maxOutflow: '100000', maxPerTransaction: '50000' },
};
const ledger = { botId: 'bot_1', asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' };
const facts = {
  asset: 'USDC',
  mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  cluster: 'devnet',
  price: '1000000',
  amount: '1000',
  trustScore: '800',
  reasonSummary: 'Transfer under cap',
};
const proposal = {
  asset: 'USDC',
  recipient: DESTINATION,
  outflow: '1000',
  expectedReceive: '1000',
  expectedReceiveAsset: 'USDC',
  maxFee: '10',
  expiresAt: NOW + 60_000,
  cluster: 'devnet',
};

function scriptedOpenRouter() {
  const calls = [];
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    assert.equal(options.headers.Authorization, `Bearer ${API_KEY}`);
    assert.equal(body.messages[0].content, PLATFORM_PROMPT);
    assert.equal(body.messages.slice(1).some(message => message.role === 'system'), false);
    const encoded = JSON.stringify(body);
    assert.equal(encoded.includes(API_KEY), false);
    const text = body.messages.map(message => (
      typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
    )).join('\n');
    let content = 'research summary for yield';
    if (text.includes('Role: decide')) {
      content = JSON.stringify({ summary: 'Devnet USDC transfer under cap', facts, proposal });
    } else if (text.includes('Role: verify')) content = JSON.stringify(facts);
    else if (text.includes('Role: monitor')) content = 'watching the devnet position';
    return Response.json({ choices: [{ message: { content } }] });
  };
  return {
    calls,
    openRouter: createOpenRouter({ apiKey: API_KEY, fetcher, secrets: [API_KEY] }),
  };
}

function transferDouble() {
  const calls = [];
  return {
    calls,
    client: {
      async getDevnetBlockhash() {
        return { cluster: 'devnet', blockhash: DESTINATION };
      },
      async signAndBroadcastDevnet(request) {
        calls.push(request);
        return { cluster: 'devnet', signature: 'sig_devnet_1' };
      },
    },
  };
}

function payload(extra = {}) {
  return { bot, wallet, ledger, trustScore: '800', now: NOW, ...extra };
}

async function wake(machine) {
  const response = await machine.handle(new Request('https://bot/wake', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ botId: 'bot_1', goal: `yield ${API_KEY}` }),
  }));
  assert.equal(response.status, 200);
}

async function postLoop(machine, env, body, owner = 'user_1') {
  return machine.handle(new Request('https://bot/loop', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': owner },
    body: JSON.stringify(body),
  }), env);
}

function stepOrder(run) {
  const seen = [];
  for (const event of run.events) {
    if (!LOOP_STEPS.includes(event.to) || seen.at(-1) === event.to) continue;
    seen.push(event.to);
  }
  return seen;
}

test('the bot loop checkpoints every step and calls OpenRouter without a live key', async () => {
  const machine = new BotStateMachine();
  const snapshots = [];
  const originalPut = machine.put.bind(machine);
  machine.put = async (key, value) => {
    if (key === 'run' && value?.checkpoints?.execute) {
      snapshots.push(value.checkpoints.execute.status);
    }
    return originalPut(key, value);
  };
  await wake(machine);
  const models = scriptedOpenRouter();
  const transfer = transferDouble();
  const searches = [];
  const env = {
    OPENROUTER_API_KEY: API_KEY,
    openRouter: models.openRouter,
    transferClient: transfer.client,
    search: async query => {
      searches.push(query);
      return [{ title: 'Pool', url: 'https://example.com/pool', snippet: 'devnet apy' }];
    },
  };
  const response = await postLoop(machine, env, payload());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.done, true);
  assert.equal(body.waiting, false);
  assert.equal(body.run.step, 'monitor');
  assert.equal(body.run.paused, false);
  assert.deepEqual(stepOrder(body.run), [...LOOP_STEPS]);
  for (const step of LOOP_STEPS) assert.equal(body.run.checkpoints[step].status, 'done', step);
  assert.equal(snapshots.includes('started'), true);
  assert.equal(snapshots.at(-1), 'done');
  assert.equal(transfer.calls.length, 1);
  assert.equal(searches.length, 1);
  assert.equal(searches[0].includes(API_KEY), false);
  const roles = models.calls.map(call => {
    const text = call.messages.map(message => message.content).join('\n');
    if (text.includes('Role: decide')) return 'decide';
    if (text.includes('Role: verify')) return 'verify';
    if (text.includes('Role: monitor')) return 'monitor';
    return 'research';
  });
  assert.deepEqual(roles, ['research', 'decide', 'verify', 'monitor']);
  assert.deepEqual(models.calls.map(call => call.model), [
    'muse-spark-1.3-contributor',
    'muse-spark-1.3-contributor',
    'muse-spark-1.3-contributor',
    'muse-spark-1.3-contributor',
  ]);
  const memo = JSON.parse(body.run.checkpoints.memo.memo);
  assert.equal(memo.r, body.run.checkpoints.memo.digest);
  assert.equal(body.run.checkpoints.execute.memo, body.run.checkpoints.memo.memo);
  assert.equal(body.run.checkpoints.execute.signature, 'sig_devnet_1');
  assert.equal(body.run.checkpoints.approval.automatic, true);

  const again = await postLoop(machine, env, payload());
  assert.equal(again.status, 200);
  assert.equal(transfer.calls.length, 1);
});

test('ask mode waits for the owner and then executes once', async () => {
  const machine = new BotStateMachine();
  await wake(machine);
  const models = scriptedOpenRouter();
  const transfer = transferDouble();
  const env = {
    OPENROUTER_API_KEY: API_KEY,
    openRouter: models.openRouter,
    transferClient: transfer.client,
  };
  const asking = { ...bot, approvalMode: 'ask' };
  const waiting = await postLoop(machine, env, payload({ bot: asking }));
  assert.equal(waiting.status, 200);
  const paused = await waiting.json();
  assert.equal(paused.waiting, true);
  assert.equal(paused.run.step, 'approval');
  assert.equal(paused.run.pauseReason, 'approval-needed');
  assert.equal(transfer.calls.length, 0);
  assert.equal(models.calls.some(call => JSON.stringify(call).includes('Role: monitor')), false);

  const approved = await postLoop(machine, env, payload({
    bot: asking,
    approval: { action: 'approve', ownerId: 'user_1' },
  }));
  assert.equal(approved.status, 200);
  const done = await approved.json();
  assert.equal(done.done, true);
  assert.equal(done.run.checkpoints.approval.action, 'approve');
  assert.equal(done.run.checkpoints.approval.automatic, false);
  assert.equal(transfer.calls.length, 1);
});

test('low trust and a frozen wallet stop before verify and before any model call', async () => {
  const machine = new BotStateMachine();
  await wake(machine);
  const models = scriptedOpenRouter();
  const env = { OPENROUTER_API_KEY: API_KEY, openRouter: models.openRouter, transferClient: transferDouble().client };
  const low = await postLoop(machine, env, payload({ trustScore: '100' }));
  const lowBody = await low.json();
  assert.equal(lowBody.run.pauseReason, 'trust-confirmation');
  assert.equal(lowBody.run.step, 'trust-gate');
  assert.equal(models.calls.some(call => JSON.stringify(call).includes('Role: verify')), false);

  const frozenMachine = new BotStateMachine();
  await wake(frozenMachine);
  const frozenModels = scriptedOpenRouter();
  const frozen = await postLoop(frozenMachine, {
    openRouter: frozenModels.openRouter,
    transferClient: transferDouble().client,
  }, payload({ wallet: { ...wallet, frozen: true } }));
  const frozenBody = await frozen.json();
  assert.equal(frozenBody.run.pauseReason, 'spend-frozen');
  assert.equal(frozenModels.calls.length, 0);
});

test('a missing OpenRouter key does not call the network', async () => {
  const machine = new BotStateMachine();
  await wake(machine);
  let called = false;
  const response = await postLoop(machine, {
    fetch: () => { called = true; throw new Error('network'); },
  }, payload());
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, 'openrouter_not_configured');
  assert.equal(called, false);
  assert.equal(body.run.checkpoints.research, undefined);
});

test('execute retries with the same idempotency key after a crash', async () => {
  const machine = new BotStateMachine();
  await wake(machine);
  const models = scriptedOpenRouter();
  const keys = [];
  let crashes = 0;
  const env = {
    openRouter: models.openRouter,
    execute: async ({ idempotencyKey, memo }) => {
      keys.push(idempotencyKey);
      crashes += 1;
      if (crashes === 1) throw new Error(`crash ${memo}`);
      return { mode: 'executed', cluster: 'devnet', signature: 'sig_retry', memo };
    },
  };
  const first = await postLoop(machine, env, payload());
  assert.equal(first.status, 500);
  const saved = await machine.handle(new Request('https://bot/status'));
  const mid = await saved.json();
  assert.equal(mid.run.checkpoints.execute.status, 'started');
  assert.equal(mid.run.checkpoints.memo, undefined);

  const second = await postLoop(machine, env, payload());
  assert.equal(second.status, 200);
  const done = await second.json();
  assert.equal(done.done, true);
  assert.deepEqual(keys, [mid.run.runId, mid.run.runId]);
  assert.equal(done.run.checkpoints.execute.signature, 'sig_retry');
  assert.equal(done.run.checkpoints.execute.idempotencyKey, mid.run.runId);
});

test('mainnet proposals and missing owners do not execute', async () => {
  const machine = new BotStateMachine();
  await wake(machine);
  const calls = [];
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    const text = JSON.stringify(body.messages);
    const content = text.includes('Role: decide')
      ? JSON.stringify({ summary: 'no', facts, proposal: { ...proposal, cluster: 'mainnet' } })
      : 'research summary';
    return Response.json({ choices: [{ message: { content } }] });
  };
  const response = await postLoop(machine, {
    openRouter: createOpenRouter({ apiKey: API_KEY, fetcher }),
    transferClient: transferDouble().client,
  }, payload());
  const body = await response.json();
  assert.equal(body.run.pauseReason, 'cluster-rejected');
  assert.equal(body.run.checkpoints.execute, undefined);

  const missing = await postLoop(machine, { openRouter: createOpenRouter({ apiKey: API_KEY, fetcher }) }, payload(), '');
  assert.equal(missing.status, 401);
});

test('over-budget automatic mode still requires approve-once', async () => {
  const machine = new BotStateMachine();
  await wake(machine);
  const models = scriptedOpenRouter();
  const transfer = transferDouble();
  const env = { openRouter: models.openRouter, transferClient: transfer.client };
  const tight = {
    ...bot,
    cap: { mode: 'limited', asset: 'USDC', maxOutflow: '100', maxPerTransaction: '50' },
  };
  const waiting = await postLoop(machine, env, payload({ bot: tight }));
  const paused = await waiting.json();
  assert.equal(paused.run.pauseReason, 'approval-needed');
  const wrong = await postLoop(machine, env, payload({
    bot: tight,
    approval: { action: 'approve', ownerId: 'user_1' },
  }));
  const rejected = await wrong.json();
  assert.equal(rejected.run.pauseReason, 'budget-override-required');
  assert.equal(transfer.calls.length, 0);
  const allowed = await postLoop(machine, env, payload({
    bot: tight,
    approval: { action: 'approve-once', ownerId: 'user_1' },
  }));
  const done = await allowed.json();
  assert.equal(done.done, true);
  assert.equal(done.run.checkpoints.approval.action, 'approve-once');
  assert.equal(transfer.calls.length, 1);
});
