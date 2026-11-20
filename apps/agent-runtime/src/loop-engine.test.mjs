import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BotStateMachine } from './bot-do.mjs';
import { LOOP_STEPS, decideTask, isTradingGoal } from './loop-engine.mjs';
import { PLATFORM_PROMPT } from './platform-prompt.mjs';
import { createOpenRouter } from './openrouter.mjs';
import { createMemoryLedger } from '@ubc2026/bot-policy/ledger';
import { createMainnetPriceProvider } from '@ubc2026/prices';
import { resolveTrustLookup } from './trust-lookup.mjs';

const API_KEY = 'test-openrouter-key-value';
const NOW = 1_700_000_000_000;
const DESTINATION = '11111111111111111111111111111111';

const wallet = {
  id: 'w_main',
  ownerId: 'user_1',
  kind: 'main',
  label: 'Main',
  address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
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
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  cluster: 'mainnet-beta',
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
  cluster: 'mainnet-beta',
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
    if (text.includes('Role: turn-verify')) content = '{"allow":true}';
    else if (text.includes('Role: decide')) {
      content = JSON.stringify({ summary: 'Solana USDC transfer under cap', facts, proposal });
    } else if (text.includes('Role: verify')) content = JSON.stringify(facts);
    else if (text.includes('Role: monitor')) content = 'watching the mainnet-beta position';
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
      async getSolanaBlockhash() {
        return { cluster: 'mainnet-beta', blockhash: DESTINATION };
      },
      async signAndBroadcastSolana(request) {
        calls.push(request);
        return { cluster: 'mainnet-beta', signature: 'sig_mainnet-beta_1' };
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
  const runtime = { ...(env || {}) };
  if (!Object.prototype.hasOwnProperty.call(env || {}, 'lookupPrice')) runtime.lookupPrice = null;
  if (!Object.prototype.hasOwnProperty.call(env || {}, 'trustLookup')) runtime.trustLookup = null;
  return machine.handle(new Request('https://bot/loop', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': owner },
    body: JSON.stringify(body),
  }), runtime);
}

function stepOrder(run) {
  const seen = [];
  for (const event of run.events) {
    if (!LOOP_STEPS.includes(event.to) || seen.at(-1) === event.to) continue;
    seen.push(event.to);
  }
  return seen;
}

/**
 * Achieves: when lookupPrice missing, loop fetches DexScreener rather than asking the model for a price.
 * Fails when: model asked for price or DexScreener not consulted.
 * Oracle: DexScreener fetch observed; model prompts exclude price invention duty as asserted.
 * Side effects / state checked: fetch + OpenRouter mocks.
 * Gaps: none
 */
test('a missing lookupPrice reads DexScreener instead of asking the model for a price', async () => {
  const machine = new BotStateMachine();
  await wake(machine);
  const models = scriptedOpenRouter();
  const transfer = transferDouble();
  const seen = [];
  const response = await machine.handle(new Request('https://bot/loop', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify(payload()),
  }), {
    OPENROUTER_API_KEY: API_KEY,
    openRouter: models.openRouter,
    transferClient: transfer.client,
    trustLookup: null,
    search: async () => [{ title: 'Pool', url: 'https://example.com/pool', snippet: 'mainnet-beta apy' }],
    fetch: async (url) => {
      seen.push(String(url));
      if (!String(url).includes('api.dexscreener.com')) throw new Error('unexpected price host');
      return Response.json([{
        baseToken: { address: facts.mint },
        priceUsd: '1.50',
        liquidity: { usd: 10 },
        pairAddress: 'pair111',
      }]);
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.done, true);
  assert.equal(seen.length, 2);
  assert.equal(seen.every(url => url.startsWith('https://api.dexscreener.com/')), true);
  const roles = models.calls.map(call => {
    const text = call.messages.map(message => message.content).join('\n');
    if (text.includes('Role: turn-verify')) return 'turn-verify';
    if (text.includes('Role: decide')) return 'decide';
    if (text.includes('Role: verify')) return 'verify';
    if (text.includes('Role: monitor')) return 'monitor';
    return 'research';
  });
  assert.deepEqual(roles, ['research', 'turn-verify', 'decide', 'turn-verify', 'monitor', 'turn-verify']);
  const quote = body.run.checkpoints.verify.priceQuote;
  assert.equal(quote.label, 'mainnet-beta execution, mainnet pricing');
  assert.equal(quote.pricingCluster, 'mainnet');
  assert.equal(quote.executionCluster, 'mainnet-beta');
  assert.equal(quote.quoteSource, 'dexscreener');
  assert.equal(quote.priceUsd, '1.50');
  assert.equal(quote.authorizesTransaction, false);
  assert.equal(quote.paperPnl, true);
  assert.equal(body.run.checkpoints.verify.decisionRecord.facts.price, '1500000');
  assert.equal(transfer.calls.length, 1);
  assert.equal(typeof transfer.calls[0].transaction, 'string');
  assert.equal(body.run.checkpoints.execute.signature, 'sig_mainnet-beta_1');
  assert.equal(JSON.stringify(transfer.calls).includes('authorizesTransaction'), false);
  assert.equal(JSON.stringify(quote).includes('signature'), false);
});

/**
 * Achieves: loop checkpoints each step using injected OpenRouter (no live key/network).
 * Fails when: steps skip checkpoints or live network called.
 * Oracle: checkpoint sequence; OpenRouter mock used.
 * Side effects / state checked: checkpoint store + mock chat.
 * Gaps: none
 */
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
      return [{ title: 'Pool', url: 'https://example.com/pool', snippet: 'mainnet-beta apy' }];
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
    if (text.includes('Role: turn-verify')) return 'turn-verify';
    if (text.includes('Role: decide')) return 'decide';
    if (text.includes('Role: verify')) return 'verify';
    if (text.includes('Role: monitor')) return 'monitor';
    return 'research';
  });
  assert.deepEqual(roles, ['research', 'turn-verify', 'decide', 'turn-verify', 'verify', 'monitor', 'turn-verify']);
  assert.deepEqual(models.calls.map(call => call.model), [
    'muse-spark-1.3-contributor',
    'muse-spark-1.3-contributor',
    'muse-spark-1.3-contributor',
    'muse-spark-1.3-contributor',
    'muse-spark-1.3-contributor',
    'muse-spark-1.3-contributor',
    'muse-spark-1.3-contributor',
  ]);
  const memo = JSON.parse(body.run.checkpoints.memo.memo);
  assert.equal(memo.r, body.run.checkpoints.memo.digest);
  assert.equal(body.run.checkpoints.execute.memo, body.run.checkpoints.memo.memo);
  assert.equal(body.run.checkpoints.execute.signature, 'sig_mainnet-beta_1');
  assert.equal(body.run.checkpoints.approval.automatic, true);

  const again = await postLoop(machine, env, payload());
  assert.equal(again.status, 200);
  assert.equal(transfer.calls.length, 1);
});

/**
 * Achieves: ask mode pauses for approval then executes a single time after approve.
 * Fails when: double execute or execute before approval.
 * Oracle: one execution after approval.
 * Side effects / state checked: approval + execute mocks.
 * Gaps: none
 */
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

/**
 * Achieves: low trust / frozen wallet abort before verify and before model calls.
 * Fails when: verify/model still invoked.
 * Oracle: no model calls; early stop reason.
 * Side effects / state checked: call counters.
 * Gaps: none
 */
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

/**
 * Achieves: missing OpenRouter key fails closed without network fetch.
 * Fails when: global fetch invoked.
 * Oracle: no network; expected error/stop.
 * Side effects / state checked: fetch guard.
 * Gaps: none
 */
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

/**
 * Achieves: post-crash execute retry reuses the same idempotency key.
 * Fails when: new key minted on retry.
 * Oracle: idempotency keys equal across attempts.
 * Side effects / state checked: execute call args.
 * Gaps: none
 */
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
      return { mode: 'executed', cluster: 'mainnet-beta', signature: 'sig_retry', memo };
    },
  };
  const first = await postLoop(machine, env, payload());
  assert.equal(first.status, 500);
  const saved = await machine.handle(new Request('https://bot/status', {
    headers: { 'x-owner-id': 'user_1' },
  }));
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

/**
 * Achieves: mainnet proposals and missing owners are refused before execute.
 * Fails when: execute still called.
 * Oracle: blocked outcomes; execute count 0.
 * Side effects / state checked: execute mock.
 * Gaps: none
 */
test('mainnet proposals and missing owners do not execute', async () => {
  const machine = new BotStateMachine();
  await wake(machine);
  const calls = [];
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    const text = JSON.stringify(body.messages);
    const content = text.includes('Role: turn-verify')
      ? '{"allow":true}'
      : text.includes('Role: decide')
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

/**
 * Achieves: fully-automatic over-budget still needs approve-once before spend.
 * Fails when: auto-executes over budget without approval.
 * Oracle: approval-needed then single execute after approve.
 * Side effects / state checked: ledger/approval mocks.
 * Gaps: none
 */
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

function jupiterToken(organicScore, isVerified) {
  return [{
    id: facts.mint,
    organicScore,
    isVerified,
    audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true },
  }];
}

/**
 * Achieves: decide calls Jupiter Tokens API v2, the trust gate uses that score,
 *   and full permission executes without an owner approval when the score passes.
 * Fails when: the model score is kept, the gate is skipped, or ask-mode still waits under full.
 * Oracle: organicScore 70 → 700; approval.automatic; one mainnet-beta signature.
 * Side effects / state checked: mocked Jupiter fetch and signer.
 * Gaps: live Jupiter is not called.
 */
test('decide requests Jupiter trust and full permission trades without asking', async () => {
  const machine = new BotStateMachine();
  await wake(machine);
  const models = scriptedOpenRouter();
  const transfer = transferDouble();
  const urls = [];
  const env = {
    OPENROUTER_API_KEY: API_KEY,
    openRouter: models.openRouter,
    transferClient: transfer.client,
    trustLookup: resolveTrustLookup({
      fetch: async (url) => {
        urls.push(String(url));
        return Response.json(jupiterToken(70, true));
      },
    }),
  };
  const response = await postLoop(machine, env, payload({
    bot: { ...bot, approvalMode: 'ask' },
    ownerPermission: 'full',
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.done, true);
  assert.equal(urls.length >= 1, true);
  assert.match(urls[0], /api\.jup\.ag\/tokens\/v2\/search\?query=/);
  assert.equal(body.run.checkpoints.decide.trust.score, '700');
  assert.equal(body.run.checkpoints.decide.trust.source, 'jupiter-tokens-v2');
  assert.equal(body.run.checkpoints.decide.facts.trustScore, '700');
  assert.equal(body.run.checkpoints['trust-gate'].trust.score, '700');
  assert.equal(body.run.checkpoints['trust-gate'].trust.state, 'allowed');
  assert.equal(body.run.checkpoints.approval.automatic, true);
  assert.equal(body.run.checkpoints.execute.signature, 'sig_mainnet-beta_1');
  assert.equal(transfer.calls.length, 1);

  const lowMachine = new BotStateMachine();
  await wake(lowMachine);
  const lowModels = scriptedOpenRouter();
  const lowTransfer = transferDouble();
  const low = await postLoop(lowMachine, {
    openRouter: lowModels.openRouter,
    transferClient: lowTransfer.client,
    trustLookup: resolveTrustLookup({
      fetch: async () => Response.json(jupiterToken(10, false)),
    }),
  }, payload({ bot: { ...bot, approvalMode: 'ask' }, ownerPermission: 'full' }));
  const lowBody = await low.json();
  assert.equal(lowBody.run.pauseReason, 'trust-confirmation');
  assert.equal(lowBody.run.checkpoints.decide.trust.score, '100');
  assert.equal(lowTransfer.calls.length, 0);
  assert.equal(lowBody.run.checkpoints.execute, undefined);

  const downMachine = new BotStateMachine();
  await wake(downMachine);
  const downModels = scriptedOpenRouter();
  const downTransfer = transferDouble();
  const down = await postLoop(downMachine, {
    openRouter: downModels.openRouter,
    transferClient: downTransfer.client,
    trustLookup: resolveTrustLookup({
      fetch: async () => { throw new Error('jupiter down'); },
    }),
  }, payload({ bot: { ...bot, approvalMode: 'ask' }, ownerPermission: 'full' }));
  const downBody = await down.json();
  assert.equal(downBody.run.pauseReason, 'trust-unavailable');
  assert.equal(downTransfer.calls.length, 0);
});

const TRADING_GOAL = 'beat usd inflation in the long run with long term trading';

/**
 * Achieves: a trading goal tells decide to propose one mainnet-beta trade and forbids a summary-only stop.
 * Fails when: the decide task omits the trade or a research goal is told to trade.
 * Oracle: task text includes the concrete-trade line only for a trading goal.
 * Side effects / state checked: none.
 * Gaps: the model still has to return JSON. The loop test covers that path.
 */
test('a trading goal tells decide to propose a concrete mainnet-beta trade', () => {
  const task = decideTask(TRADING_GOAL, { type: 'trading' });
  assert.match(task, /Role: decide/);
  assert.match(task, /Propose one concrete Solana mainnet-beta trade/);
  assert.match(task, /Do not stop after a summary/);
  assert.match(task, /Do not sign or broadcast/);
  assert.match(task, /meme coin/);
  assert.match(task, /day trade/);
  assert.match(task, /different cluster/);
  assert.equal(isTradingGoal(TRADING_GOAL, { type: 'research' }), true);
  const quiet = decideTask('compare prices', { type: 'research' });
  assert.equal(quiet.includes('Propose one concrete Solana mainnet-beta trade'), false);
});

/**
 * Achieves: a normal start with no checkpoint creates a run and pursues the trading goal
 *   through research, decide, Jupiter trust, and the gate. Fully-automatic does not ask.
 * Fails when: the route returns no_run, decide is not told to trade, or execution skips the gate.
 * Oracle: run.goal, Jupiter score 700, approval.automatic, one mainnet-beta signature.
 * Side effects / state checked: in-memory run, mocked search, Jupiter, and signer.
 * Gaps: live Jupiter and Privy are not called.
 */
test('start_task creates a run and a fully-automatic trading goal passes the gate', async () => {
  const machine = new BotStateMachine();
  const models = scriptedOpenRouter();
  const transfer = transferDouble();
  const searches = [];
  const urls = [];
  const response = await postLoop(machine, {
    openRouter: models.openRouter,
    transferClient: transfer.client,
    search: async query => {
      searches.push(query);
      return [{ title: 'CPI', url: 'https://example.com/cpi', snippet: 'long-run inflation' }];
    },
    trustLookup: resolveTrustLookup({
      fetch: async (url) => {
        urls.push(String(url));
        return Response.json(jupiterToken(70, true));
      },
    }),
  }, payload({ goal: TRADING_GOAL }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.error, undefined);
  assert.equal(body.done, true);
  assert.equal(body.run.goal, TRADING_GOAL);
  assert.equal(body.run.botId, 'bot_1');
  assert.equal(searches[0], TRADING_GOAL);
  assert.equal(body.run.checkpoints.research.status, 'done');
  const decideCall = models.calls.find(call => call.messages.some(message => (
    typeof message.content === 'string' && message.content.includes('Role: decide')
  )));
  const decideText = decideCall.messages.map(message => message.content).join('\n');
  assert.match(decideText, /Propose one concrete Solana mainnet-beta trade/);
  assert.match(decideText, /Do not stop after a summary/);
  assert.match(urls[0], /api\.jup\.ag\/tokens\/v2\/search\?query=/);
  assert.equal(body.run.checkpoints.decide.trust.score, '700');
  assert.equal(body.run.checkpoints['trust-gate'].trust.state, 'allowed');
  assert.equal(body.run.checkpoints.approval.automatic, true);
  assert.equal(body.run.checkpoints.execute.signature, 'sig_mainnet-beta_1');
  assert.equal(body.run.checkpoints.execute.cluster, 'mainnet-beta');
  assert.equal(transfer.calls.length, 1);
  assert.equal(typeof transfer.calls[0].transaction, 'string');
  assert.equal(transfer.calls[0].wallet.address, wallet.address);

  const asking = new BotStateMachine();
  const askModels = scriptedOpenRouter();
  const askTransfer = transferDouble();
  const full = await postLoop(asking, {
    openRouter: askModels.openRouter,
    transferClient: askTransfer.client,
    trustLookup: resolveTrustLookup({
      fetch: async () => Response.json(jupiterToken(70, true)),
    }),
    loadLoopContext: async ({ botId, ownerId }) => {
      assert.equal(botId, 'bot_1');
      assert.equal(ownerId, 'user_1');
      return {
        bot: { ...bot, approvalMode: 'ask', goal: TRADING_GOAL },
        wallet,
        ledger,
      };
    },
  }, { goal: TRADING_GOAL, botId: 'bot_1', now: NOW, ownerPermission: 'full' });
  const fullBody = await full.json();
  assert.equal(full.status, 200);
  assert.equal(fullBody.run.goal, TRADING_GOAL);
  assert.equal(fullBody.run.checkpoints.approval.automatic, true);
  assert.equal(fullBody.run.checkpoints.execute.signature, 'sig_mainnet-beta_1');
  assert.equal(askTransfer.calls.length, 1);

  const blocked = new BotStateMachine();
  const blockedModels = scriptedOpenRouter();
  const blockedTransfer = transferDouble();
  const low = await postLoop(blocked, {
    openRouter: blockedModels.openRouter,
    transferClient: blockedTransfer.client,
    trustLookup: resolveTrustLookup({
      fetch: async () => Response.json(jupiterToken(10, false)),
    }),
  }, payload({
    goal: TRADING_GOAL,
    bot: { ...bot, approvalMode: 'fully-automatic' },
    ownerPermission: 'full',
  }));
  const lowBody = await low.json();
  assert.equal(lowBody.run.pauseReason, 'trust-confirmation');
  assert.equal(lowBody.run.checkpoints.execute, undefined);
  assert.equal(blockedTransfer.calls.length, 0);
});

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/**
 * Achieves: one SOL-to-USDC trade quotes Jupiter and marks a paper position without moving funds.
 * Fails when: a paper swap calls a signer, executor, or spend reservation.
 * Oracle: paper checkpoint, absent signature, and no signing calls.
 * Side effects: in-memory run, position book, and mocked quote/signer.
 * Gaps: live Jupiter and Privy are not called.
 */
test('a trading swap follows the gate and marks paper without signing or reserving funds', async () => {
  const machine = new BotStateMachine();
  const models = scriptedOpenRouter();
  const decide = models.openRouter;
  const original = decide.complete.bind(decide);
  decide.complete = async (input) => {
    const task = typeof input?.task === 'string' ? input.task : '';
    if (task.includes('Role: decide')) {
      return {
        model: 'test',
        text: JSON.stringify({
          summary: 'Move a slice of SOL into USDC',
          facts: { ...facts, mint: SOL_MINT, price: '74730000', reasonSummary: 'Move SOL into USDC' },
          proposal: {
            ...proposal,
            swap: { inputMint: SOL_MINT, outputMint: USDC_MINT, inAmount: '10000000' },
          },
        }),
      };
    }
    return original(input);
  };
  const transfer = transferDouble();
  let quoted = 0;
  const executionDeps = {
    openRouter: decide,
    transferClient: transfer.client,
    search: async () => [{ title: 'CPI', url: 'https://example.com/cpi', snippet: 'long-run inflation' }],
    swapQuote: async (swap) => {
      quoted += 1;
      assert.equal(swap.inputMint, SOL_MINT);
      assert.equal(swap.outputMint, USDC_MINT);
      assert.equal(swap.inAmount, '10000000');
      return {
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        inAmount: '10000000',
        outAmount: '747000',
        quoteSource: 'jupiter-swap-v1',
        pricingCluster: 'mainnet',
        executionCluster: 'mainnet-beta',
        label: 'mainnet-beta execution, mainnet pricing',
        broadcast: false,
        authorizesTransaction: false,
      };
    },
    lookupPrice: async (mint) => ({
      mint,
      priceUsd: mint === USDC_MINT ? '1.00' : '74.73',
      quoteSource: 'dexscreener',
      pricingCluster: 'mainnet',
      executionCluster: 'mainnet-beta',
      label: 'mainnet-beta execution, mainnet pricing',
      fetchedAt: new Date(NOW).toISOString(),
    }),
  };
  const response = await postLoop(machine, executionDeps, payload({ goal: TRADING_GOAL }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.error, undefined);
  assert.equal(body.done, true);
  assert.equal(quoted, 1);
  const execute = body.run.checkpoints.execute;
  assert.equal(execute.cluster, 'mainnet-beta');
  assert.equal(execute.signature, undefined);
  assert.equal(execute.executed, false);
  assert.equal(execute.broadcast, false);
  assert.equal(execute.reserved, false);
  assert.equal(execute.swapQuote.quoteSource, 'jupiter-swap-v1');
  assert.equal(execute.swapQuote.inputMint, SOL_MINT);
  assert.equal(execute.swapQuote.outAmount, '747000');
  assert.equal(execute.swapQuote.broadcast, false);
  assert.equal(execute.swapQuote.authorizesTransaction, false);
  assert.equal(execute.swapQuote.executionCluster, 'mainnet-beta');
  assert.equal(execute.swapQuote.label, 'mainnet-beta execution, mainnet pricing');
  assert.equal(Object.hasOwn(execute.swapQuote, 'swapTransaction'), false);
  assert.equal(execute.paper.mode, 'paper');
  assert.equal(execute.paper.broadcast, false);
  assert.equal(execute.paper.mint, USDC_MINT);
  assert.equal(execute.paper.quantity, '747000');
  assert.equal(execute.paper.label, 'mainnet-beta execution, mainnet pricing');
  assert.equal(execute.paper.cluster, 'mainnet-beta');
  assert.equal(transfer.calls.length, 0);
  const stored = await machine.get('positions');
  assert.equal(stored[0].mint, USDC_MINT);
  assert.equal(stored[0].amount, '747000');
  assert.equal(stored[0].mode, 'paper');
  assert.equal(stored[0].label, 'mainnet-beta execution, mainnet pricing');

  for (const execute of [undefined, async () => assert.fail('paper must not execute a payment')]) {
    const paperOnly = await postLoop(new BotStateMachine(), {
      ...executionDeps,
      transferClient: null,
      execute,
      ledgerApi: { reserveBudget: async () => assert.fail('paper must not reserve funds') },
    }, payload({ goal: TRADING_GOAL }));
    const paperBody = await paperOnly.json();
    assert.equal(paperBody.done, true);
    assert.equal(paperBody.run.checkpoints.execute.mode, 'paper');
    assert.equal(paperBody.run.checkpoints.execute.signature, undefined);
  }

  const downMachine = new BotStateMachine();
  const downModels = scriptedOpenRouter();
  const downDecide = downModels.openRouter;
  const downOriginal = downDecide.complete.bind(downDecide);
  downDecide.complete = async (input) => {
    const task = typeof input?.task === 'string' ? input.task : '';
    if (task.includes('Role: decide')) {
      return {
        model: 'test',
        text: JSON.stringify({
          summary: 'Move a slice of SOL into USDC',
          facts: { ...facts, mint: SOL_MINT, price: '74730000', reasonSummary: 'Move SOL into USDC' },
          proposal: {
            ...proposal,
            swap: { inputMint: SOL_MINT, outputMint: USDC_MINT, inAmount: '10000000' },
          },
        }),
      };
    }
    return downOriginal(input);
  };
  const downTransfer = transferDouble();
  const down = await postLoop(downMachine, {
    openRouter: downDecide,
    transferClient: downTransfer.client,
    swapQuote: async () => {
      const error = new Error('provider_failed');
      error.code = 'provider_failed';
      throw error;
    },
    lookupPrice: async (mint) => ({
      mint,
      priceUsd: '74.73',
      quoteSource: 'dexscreener',
      pricingCluster: 'mainnet',
      executionCluster: 'mainnet-beta',
      label: 'mainnet-beta execution, mainnet pricing',
      fetchedAt: new Date(NOW).toISOString(),
    }),
  }, payload({ goal: TRADING_GOAL }));
  const downBody = await down.json();
  assert.equal(downBody.run.pauseReason, 'provider_failed');
  assert.equal(downBody.run.checkpoints.execute?.status, 'waiting');
  assert.equal(downBody.run.checkpoints.execute?.signature, undefined);
  assert.equal(downTransfer.calls.length, 0);
  const alerts = await downMachine.get('alerts');
  assert.equal(Array.isArray(alerts) && alerts.some(event => event.kind === 'run.checkpoint' && event.summary.includes('Price provider is down')), true);
});

function solDecide(models) {
  const decide = models.openRouter;
  const original = decide.complete.bind(decide);
  decide.complete = async (input) => {
    const task = typeof input?.task === 'string' ? input.task : '';
    if (task.includes('Role: decide')) {
      return {
        model: 'test',
        text: JSON.stringify({
          summary: 'Move a slice of SOL into USDC',
          facts: {
            asset: 'USDC',
            mint: SOL_MINT,
            cluster: 'mainnet-beta',
            price: '74730000',
            amount: '1000000',
            trustScore: '100',
            reasonSummary: 'Move SOL into USDC',
          },
          proposal: {
            asset: 'USDC',
            recipient: DESTINATION,
            outflow: '1000000',
            expectedReceive: '1000000',
            expectedReceiveAsset: 'USDC',
            maxFee: '0',
            expiresAt: NOW + 60_000,
            cluster: 'mainnet-beta',
            swap: { inputMint: SOL_MINT, outputMint: USDC_MINT, inAmount: '10000000' },
          },
        }),
      };
    }
    return original(input);
  };
  return decide;
}

/**
 * Achieves: an owner ask wakes the bot and one fully-automatic SOL to USDC trade
 *   finishes research, decide, trust, verify, reserve, approval, mainnet-beta sign, memo, and notify.
 * Fails when: paper is missing, broadcast is true, the memo or timeline is missing,
 *   low trust signs, five verifier mismatches execute, or max loss signs with approval.
 * Oracle: paper quantity 1000000, broadcast false, memo digest, verify.settled,
 *   trust-confirmation, manual-review after 5, max-loss-reached.
 * Side effects: in-memory run, ledger reservation, and injected price, trust, and swap fetchers.
 * Gaps: live Jupiter, Privy, and Supabase are not called.
 */
test('an owner ask runs one fully-automatic SOL to USDC trade through memo and notify', async () => {
  const wide = {
    ...bot,
    goal: TRADING_GOAL,
    approvalMode: 'fully-automatic',
    cap: { mode: 'limited', asset: 'USDC', maxOutflow: '50000000', maxPerTransaction: '5000000' },
  };
  const machine = new BotStateMachine();
  await machine.put('positions', [{
    mint: USDC_MINT,
    amount: '1',
    decimals: 6,
    entryPriceUsd: '1.00',
  }]);
  const woke = await machine.handle(new Request('https://bot/wake', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ botId: 'bot_1', goal: TRADING_GOAL, reason: 'owner-ask', ownerId: 'user_1' }),
  }));
  assert.equal(woke.status, 200);
  const hosts = [];
  const lookupPrice = createMainnetPriceProvider({
    fetcher: async (url) => {
      const href = String(url);
      hosts.push(new URL(href).host);
      if (href.includes('dexscreener')) return new Response('down', { status: 503 });
      const mint = new URL(href).searchParams.get('ids');
      const usdPrice = mint === USDC_MINT ? 1 : 74.73;
      return Response.json({ [mint]: { usdPrice, liquidity: 9, blockId: 1 } });
    },
  });
  let trustCalls = 0;
  const trustLookup = resolveTrustLookup({
    fetch: async (url) => {
      trustCalls += 1;
      const mint = new URL(String(url)).searchParams.get('query');
      return Response.json([{
        id: mint,
        organicScore: 80,
        isVerified: true,
        audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true },
      }]);
    },
  });
  const ledgerApi = createMemoryLedger();
  await ledgerApi.reset({
    users: [{ id: 'user_1', privyUserId: 'did:privy:user_1' }],
    wallets: [wallet],
    bots: [wide],
    ledgers: [{ botId: 'bot_1', asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' }],
  });
  const models = scriptedOpenRouter();
  const transfer = transferDouble();
  let swaps = 0;
  const response = await postLoop(machine, {
    openRouter: solDecide(models),
    transferClient: transfer.client,
    search: async () => [{ title: 'SOL', url: 'https://example.com/sol', snippet: 'blue chip' }],
    lookupPrice,
    trustLookup,
    ledgerApi,
    fetch: async (url) => {
      swaps += 1;
      const href = String(url);
      assert.match(href, /lite-api\.jup\.ag\/swap\/v1\/quote/);
      const params = new URL(href).searchParams;
      assert.equal(params.get('inputMint'), SOL_MINT);
      assert.equal(params.get('outputMint'), USDC_MINT);
      assert.equal(params.get('amount'), '10000000');
      return Response.json({ outAmount: '1000000' });
    },
  }, payload({ goal: TRADING_GOAL, bot: wide }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.done, true);
  assert.equal(body.run.events.some(event => event.summary === 'owner-ask'), true);
  assert.equal(body.run.events.some(event => String(event.summary).includes('stream-drop')), false);
  assert.equal(body.run.checkpoints.research.read.positionCount, 1);
  assert.equal(body.run.checkpoints.research.read.type, 'trading');
  assert.equal(body.run.checkpoints.research.read.walletId, wallet.id);
  assert.equal(body.run.checkpoints.research.read.approvalMode, 'fully-automatic');
  assert.equal(body.run.checkpoints.research.read.cap.maxPerTransaction, '5000000');
  assert.equal(hosts[0].includes('dexscreener'), true);
  assert.equal(hosts[1].includes('jup.ag'), true);
  assert.equal(trustCalls > 0, true);
  assert.equal(body.run.checkpoints.decide.trust.score, '800');
  assert.equal(body.run.checkpoints['trust-gate'].trust.state, 'allowed');
  assert.equal(body.run.checkpoints.verify.decisionRecord.outcome, 'consensus');
  assert.equal(body.run.checkpoints.approval.automatic, true);
  assert.equal(swaps, 1);
  const execute = body.run.checkpoints.execute;
  assert.equal(execute.cluster, 'mainnet-beta');
  assert.equal(execute.signature, undefined);
  assert.equal(execute.reserved, false);
  assert.equal(execute.paper.broadcast, false);
  assert.equal(execute.paper.mode, 'paper');
  assert.equal(execute.paper.quantity, '1000000');
  assert.equal(execute.paper.mint, USDC_MINT);
  assert.equal(execute.paper.label, 'mainnet-beta execution, mainnet pricing');
  assert.equal(execute.swapQuote.broadcast, false);
  assert.equal(execute.swapQuote.label, 'mainnet-beta execution, mainnet pricing');
  const memo = JSON.parse(body.run.checkpoints.memo.memo);
  assert.equal(memo.r, body.run.checkpoints.memo.digest);
  assert.equal(body.run.checkpoints.memo.attached, true);
  const timeline = await machine.get('timeline');
  assert.equal(timeline[0].kind, 'verify.settled');
  assert.match(timeline[0].summary, /Trust 800/);
  assert.match(timeline[0].summary, /mainnet-beta execution, mainnet pricing/);
  const snap = await ledgerApi.snapshot();
  assert.equal(snap.ledgers[0].reserved, '0');
  assert.equal(snap.reservations.length, 0);
  const again = await postLoop(machine, {
    openRouter: models.openRouter,
    transferClient: transfer.client,
    lookupPrice,
    trustLookup,
    ledgerApi,
  }, payload({ goal: TRADING_GOAL, bot: wide }));
  assert.equal(again.status, 200);
  assert.equal(transfer.calls.length, 0);
  assert.equal((await ledgerApi.snapshot()).ledgers[0].reserved, '0');

  const lowMachine = new BotStateMachine();
  const lowModels = scriptedOpenRouter();
  const lowTransfer = transferDouble();
  const low = await postLoop(lowMachine, {
    openRouter: solDecide(lowModels),
    transferClient: lowTransfer.client,
    trustLookup: resolveTrustLookup({
      fetch: async (url) => {
        const mint = new URL(String(url)).searchParams.get('query');
        return Response.json([{ id: mint, organicScore: 10, isVerified: false }]);
      },
    }),
  }, payload({
    goal: TRADING_GOAL,
    bot: wide,
    ownerPermission: 'full',
  }));
  const lowBody = await low.json();
  assert.equal(lowBody.run.pauseReason, 'trust-confirmation');
  assert.equal(lowBody.run.checkpoints.execute, undefined);
  assert.equal(lowTransfer.calls.length, 0);

  const mismatchMachine = new BotStateMachine();
  const mismatchModels = scriptedOpenRouter();
  const mismatchTransfer = transferDouble();
  let mismatches = 0;
  const mismatched = await postLoop(mismatchMachine, {
    openRouter: mismatchModels.openRouter,
    transferClient: mismatchTransfer.client,
    verifyFn: async () => {
      mismatches += 1;
      return { ...facts, price: '1' };
    },
  }, payload({ goal: TRADING_GOAL, bot: wide, ownerPermission: 'full' }));
  const mismatchBody = await mismatched.json();
  assert.equal(mismatches, 5);
  assert.equal(mismatchBody.run.pauseReason, 'verify-mismatch');
  assert.equal(mismatchBody.run.checkpoints.verify.outcome, 'manual-review');
  assert.equal(mismatchBody.run.checkpoints.verify.attemptCount, 5);
  assert.equal(mismatchBody.run.checkpoints.execute, undefined);
  assert.equal(mismatchTransfer.calls.length, 0);
  const mismatchAlerts = await mismatchMachine.get('alerts');
  assert.equal(mismatchAlerts.some(event => event.kind === 'verify.mismatch'), true);

  const lossMachine = new BotStateMachine();
  const lossModels = scriptedOpenRouter();
  const lossTransfer = transferDouble();
  const lossBot = {
    ...wide,
    cap: { ...wide.cap, maxLoss: '10' },
  };
  const loss = await postLoop(lossMachine, {
    openRouter: lossModels.openRouter,
    transferClient: lossTransfer.client,
  }, payload({
    goal: TRADING_GOAL,
    bot: lossBot,
    ledger: { ...ledger, realizedLoss: '10' },
    ownerPermission: 'full',
    approval: { action: 'approve', ownerId: 'user_1' },
  }));
  const lossBody = await loss.json();
  assert.equal(lossBody.run.pauseReason, 'max-loss-reached');
  assert.equal(lossBody.run.checkpoints.execute, undefined);
  assert.equal(lossTransfer.calls.length, 0);
  const lossAlerts = await lossMachine.get('alerts');
  assert.equal(lossAlerts.some(event => event.kind === 'bot.paused' && event.summary.includes('Max loss')), true);
});

function usdcBuyDecide(models, inAmount) {
  const decide = models.openRouter;
  const original = decide.complete.bind(decide);
  decide.complete = async (input) => {
    const task = typeof input?.task === 'string' ? input.task : '';
    if (task.includes('Role: decide')) {
      return {
        model: 'test',
        text: JSON.stringify({
          summary: 'Buy wrapped SOL with USDC',
          facts: {
            asset: 'SOL',
            mint: SOL_MINT,
            cluster: 'mainnet-beta',
            price: '72980000',
            amount: '1000000000',
            trustScore: '100',
            reasonSummary: 'Buy wrapped SOL with the USDC cap',
          },
          proposal: {
            asset: 'SOL',
            recipient: DESTINATION,
            outflow: '1000000000',
            expectedReceive: '13700000',
            expectedReceiveAsset: 'SOL',
            maxFee: '0',
            expiresAt: NOW + 60_000,
            cluster: 'mainnet-beta',
            ...(inAmount ? { swap: { inputMint: USDC_MINT, outputMint: SOL_MINT, inAmount } } : {}),
          },
        }),
      };
    }
    return original(input);
  };
  return decide;
}

/**
 * Achieves: a SOL quote whose spend is USDC inside the per-transaction cap
 *   passes accounting, trust, verify, reserve, and permission. An over-cap
 *   spend stops at the cap. A different asset with no cap-asset spend still mismatches.
 * Fails when: decide pauses on accounting-asset-mismatch for a USDC input,
 *   the cap is skipped, or the paper quote signs a mainnet trade.
 * Oracle: outflow 1000000 USDC, paper label, reserved 1000000; 72860000 is per-transaction.
 * Side effects: in-memory run and ledger. Jupiter, price, and the signer are injected.
 * Gaps: live Jupiter and Privy are not called.
 */
test('a within-cap USDC buy of wrapped SOL clears the gates and an over-cap buy stops at the cap', async () => {
  const capped = {
    ...bot,
    goal: TRADING_GOAL,
    approvalMode: 'fully-automatic',
    cap: { mode: 'limited', asset: 'USDC', maxOutflow: '20000000', maxPerTransaction: '1000000' },
  };
  const task = decideTask(TRADING_GOAL, capped);
  assert.match(task, /inputMint is that asset/);
  assert.match(task, /1000000/);
  assert.match(task, /paper only/);

  const ledgerApi = createMemoryLedger();
  await ledgerApi.reset({
    users: [{ id: 'user_1', privyUserId: 'did:privy:user_1' }],
    wallets: [wallet],
    bots: [capped],
    ledgers: [{ botId: 'bot_1', asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' }],
  });
  const machine = new BotStateMachine();
  const models = scriptedOpenRouter();
  const transfer = transferDouble();
  const quote = async (mint) => ({
    mint,
    priceUsd: mint === USDC_MINT ? '1.00' : '72.98',
    quoteSource: 'dexscreener',
    pricingCluster: 'mainnet',
    executionCluster: 'mainnet-beta',
    label: 'mainnet-beta execution, mainnet pricing',
    fetchedAt: new Date(NOW).toISOString(),
  });
  const response = await postLoop(machine, {
    openRouter: usdcBuyDecide(models, '1000000'),
    transferClient: transfer.client,
    lookupPrice: quote,
    trustLookup: async () => ({ score: '800', source: 'jupiter-tokens-v2' }),
    ledgerApi,
    swapQuote: async (swap) => ({
      inputMint: swap.inputMint,
      outputMint: swap.outputMint,
      inAmount: swap.inAmount,
      outAmount: '13700000',
      quoteSource: 'jupiter-swap-v1',
      pricingCluster: 'mainnet',
      executionCluster: 'mainnet-beta',
      label: 'mainnet-beta execution, mainnet pricing',
      broadcast: false,
      authorizesTransaction: false,
    }),
  }, payload({ goal: TRADING_GOAL, bot: capped }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.done, true);
  assert.equal(body.run.pauseReason, undefined);
  const decided = body.run.checkpoints.decide;
  assert.equal(decided.proposal.asset, 'USDC');
  assert.equal(decided.proposal.outflow, '1000000');
  assert.equal(decided.proposal.expectedReceiveAsset, 'SOL');
  assert.equal(decided.proposal.swap.inputMint, USDC_MINT);
  assert.equal(decided.proposal.swap.outputMint, SOL_MINT);
  assert.equal(decided.proposal.swap.inAmount, '1000000');
  assert.equal(decided.facts.asset, 'USDC');
  assert.equal(decided.facts.amount, '1000000');
  assert.equal(decided.facts.mint, SOL_MINT);
  assert.equal(body.run.checkpoints['trust-gate'].trust.state, 'allowed');
  assert.equal(body.run.checkpoints.verify.decisionRecord.outcome, 'consensus');
  assert.equal(body.run.checkpoints.verify.priceQuote.label, 'mainnet-beta execution, mainnet pricing');
  assert.equal(body.run.checkpoints.verify.priceQuote.authorizesTransaction, false);
  assert.equal(body.run.checkpoints.policy.policy.state, 'approval-needed');
  assert.equal(body.run.checkpoints.approval.automatic, true);
  const execute = body.run.checkpoints.execute;
  assert.equal(execute.cluster, 'mainnet-beta');
  assert.equal(execute.signature, undefined);
  assert.equal(execute.reserved, false);
  assert.equal(execute.paper.mint, SOL_MINT);
  assert.equal(execute.paper.broadcast, false);
  assert.equal(execute.paper.label, 'mainnet-beta execution, mainnet pricing');
  assert.equal(execute.swapQuote.inputMint, USDC_MINT);
  assert.equal(execute.swapQuote.broadcast, false);
  assert.equal(transfer.calls.length, 0);
  assert.equal((await ledgerApi.snapshot()).ledgers[0].reserved, '0');

  const overMachine = new BotStateMachine();
  const overModels = scriptedOpenRouter();
  const overTransfer = transferDouble();
  const over = await postLoop(overMachine, {
    openRouter: usdcBuyDecide(overModels, '72860000'),
    transferClient: overTransfer.client,
    lookupPrice: quote,
    trustLookup: async () => ({ score: '800', source: 'jupiter-tokens-v2' }),
  }, payload({ goal: TRADING_GOAL, bot: capped, ownerPermission: 'full' }));
  const overBody = await over.json();
  assert.equal(overBody.run.pauseReason, 'approval-needed');
  assert.notEqual(overBody.run.pauseReason, 'accounting-asset-mismatch');
  assert.equal(overBody.run.checkpoints.decide.proposal.asset, 'USDC');
  assert.equal(overBody.run.checkpoints.decide.proposal.outflow, '72860000');
  assert.equal(overBody.run.checkpoints['trust-gate'].trust.state, 'allowed');
  assert.equal(overBody.run.checkpoints.verify.decisionRecord.outcome, 'consensus');
  assert.equal(overBody.run.checkpoints.policy.policy.state, 'over-budget');
  assert.equal(overBody.run.checkpoints.policy.policy.violations.includes('per-transaction'), true);
  assert.equal(overBody.run.checkpoints.execute, undefined);
  assert.equal(overTransfer.calls.length, 0);

  const mismatchMachine = new BotStateMachine();
  const mismatchModels = scriptedOpenRouter();
  const mismatchTransfer = transferDouble();
  const mismatch = await postLoop(mismatchMachine, {
    openRouter: usdcBuyDecide(mismatchModels, null),
    transferClient: mismatchTransfer.client,
  }, payload({ goal: TRADING_GOAL, bot: capped }));
  const mismatchBody = await mismatch.json();
  assert.equal(mismatchBody.run.pauseReason, 'accounting-asset-mismatch');
  assert.equal(mismatchBody.run.checkpoints['trust-gate'], undefined);
  assert.equal(mismatchTransfer.calls.length, 0);
});

function liveSwapDouble() {
  const calls = { prepared: [], signed: [], orders: [] };
  const client = {
    async prepareSolanaTransfer({ transaction }) {
      calls.prepared.push(transaction);
      return Object.freeze({ transaction, feeLamports: '5000' });
    },
    async signPreparedSolanaTransfer(request) {
      calls.signed.push(request);
      return { cluster: 'mainnet-beta', signature: 'sig_swap_1' };
    },
  };
  const swapOrder = async (intent) => {
    calls.orders.push(intent);
    return {
      inputMint: intent.inputMint, outputMint: intent.outputMint, inAmount: intent.amount,
      outAmount: '747000', minOutAmount: '743000', transaction: 'AQAAswapTx',
    };
  };
  const ledgerApi = {
    async reserveBudget(request) {
      calls.reserved = [...(calls.reserved ?? []), request];
      return { state: 'reserved', replay: false };
    },
  };
  return { calls, client, swapOrder, ledgerApi };
}

function swapDecider(models) {
  const decide = models.openRouter;
  const original = decide.complete.bind(decide);
  decide.complete = async (input) => {
    const task = typeof input?.task === 'string' ? input.task : '';
    if (task.includes('Role: decide')) {
      return {
        model: 'test',
        text: JSON.stringify({
          summary: 'Buy a slice of SOL with USDC',
          facts: { ...facts, mint: SOL_MINT, price: '74730000', reasonSummary: 'Buy SOL with USDC' },
          proposal: { ...proposal, swap: { inputMint: USDC_MINT, outputMint: SOL_MINT, inAmount: '1000' } },
        }),
      };
    }
    return original(input);
  };
  return decide;
}

const swapPrice = async (mint) => ({
  mint,
  priceUsd: mint === USDC_MINT ? '1.00' : '74.73',
  quoteSource: 'dexscreener',
  pricingCluster: 'mainnet',
  executionCluster: 'mainnet-beta',
  label: 'mainnet-beta execution, mainnet pricing',
  fetchedAt: new Date(NOW).toISOString(),
});

/**
 * Achieves: an agent swap under the cap with a Jupiter-trusted token signs the exact simulated Jupiter transaction.
 * Fails when: the order is not simulated before signing, or another transaction is signed.
 * Oracle: one order for the proposal, one simulation, one prepared signature, executed swap checkpoint.
 * Side effects: in-memory run; Jupiter and Privy are doubles.
 * Gaps: live Jupiter and Privy are not called.
 */
test('a trusted agent swap under the cap signs the simulated Jupiter transaction', async () => {
  const machine = new BotStateMachine();
  const live = liveSwapDouble();
  const response = await postLoop(machine, {
    openRouter: swapDecider(scriptedOpenRouter()),
    transferClient: live.client,
    swapOrder: live.swapOrder,
    ledgerApi: live.ledgerApi,
    search: async () => [],
    lookupPrice: swapPrice,
  }, payload({ goal: TRADING_GOAL }));
  const body = await response.json();
  assert.equal(body.error, undefined);
  assert.equal(body.done, true);
  assert.equal(body.run.checkpoints['trust-gate'].trust.state, 'allowed');
  assert.equal(body.run.checkpoints.approval.automatic, true);
  assert.deepEqual(live.calls.orders, [{ inputMint: USDC_MINT, outputMint: SOL_MINT, amount: '1000', userPublicKey: wallet.address }]);
  assert.deepEqual(live.calls.prepared, ['AQAAswapTx']);
  assert.equal(live.calls.signed.length, 1);
  assert.equal(live.calls.signed[0].prepared.transaction, 'AQAAswapTx');
  const execute = body.run.checkpoints.execute;
  assert.equal(execute.mode, 'swap');
  assert.equal(execute.executed, true);
  assert.equal(execute.signature, 'sig_swap_1');
  assert.equal(execute.swapQuote.outAmount, '747000');
});

/**
 * Achieves: a low-trust agent swap waits for a person even after trust confirmation and within the cap.
 * Fails when: a confirmed low-trust swap signs without an approval.
 * Oracle: approval-needed pause and no order, simulation, or signature.
 * Side effects: in-memory run; doubles only.
 * Gaps: the approval record path is covered by the transfer tests.
 */
test('a low-trust agent swap needs approval before any order or signature', async () => {
  const machine = new BotStateMachine();
  const live = liveSwapDouble();
  const response = await postLoop(machine, {
    openRouter: swapDecider(scriptedOpenRouter()),
    transferClient: live.client,
    swapOrder: live.swapOrder,
    ledgerApi: live.ledgerApi,
    search: async () => [],
    lookupPrice: swapPrice,
  }, payload({ goal: TRADING_GOAL, trustScore: '100', trustConfirmed: true }));
  const body = await response.json();
  assert.equal(body.run.paused, true);
  assert.equal(body.run.pauseReason, 'approval-needed');
  assert.equal(body.run.step, 'approval');
  assert.equal(live.calls.orders.length + live.calls.prepared.length + live.calls.signed.length, 0);
});

/**
 * Achieves: AGENT_SWAPS=paper keeps agent swaps as paper fills even with a live signer.
 * Fails when: paper mode orders, simulates, or signs.
 * Oracle: paper execute checkpoint and no live calls.
 * Side effects: in-memory run; doubles only.
 * Gaps: none beyond the paper test above.
 */
test('AGENT_SWAPS=paper keeps agent swaps on paper', async () => {
  const machine = new BotStateMachine();
  const live = liveSwapDouble();
  const response = await postLoop(machine, {
    openRouter: swapDecider(scriptedOpenRouter()),
    transferClient: live.client,
    swapOrder: live.swapOrder,
    ledgerApi: live.ledgerApi,
    AGENT_SWAPS: 'paper',
    search: async () => [],
    lookupPrice: swapPrice,
    swapQuote: async (swap) => ({
      ...swap, outAmount: '747000', quoteSource: 'jupiter-swap-v1', pricingCluster: 'mainnet',
      executionCluster: 'mainnet-beta', label: 'mainnet-beta execution, mainnet pricing', broadcast: false, authorizesTransaction: false,
    }),
  }, payload({ goal: TRADING_GOAL }));
  const body = await response.json();
  assert.equal(body.done, true);
  assert.equal(body.run.checkpoints.execute.mode, 'paper');
  assert.equal(live.calls.orders.length + live.calls.signed.length, 0);
});

/**
 * Achieves: an owner-approved low-trust swap saves the approval row and reserves with its id.
 * Fails when: the reservation omits the approval id Postgres requires.
 * Oracle: saved approval digest and the reserveBudget approvalId.
 * Side effects: in-memory run; doubles only.
 * Gaps: the SQL reserve function is covered by the ledger cases.
 */
test('an approved low-trust agent swap reserves with a saved approval', async () => {
  const machine = new BotStateMachine();
  const live = liveSwapDouble();
  const saved = [];
  const response = await postLoop(machine, {
    openRouter: swapDecider(scriptedOpenRouter()),
    transferClient: live.client,
    swapOrder: live.swapOrder,
    ledgerApi: live.ledgerApi,
    saveApproval: async (record) => { saved.push(record); return true; },
    search: async () => [],
    lookupPrice: swapPrice,
  }, payload({ goal: TRADING_GOAL, trustScore: '100', trustConfirmed: true, approval: { action: 'approve', ownerId: 'user_1' } }));
  const body = await response.json();
  assert.equal(body.done, true);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].action, 'approve');
  assert.equal(live.calls.reserved[0].approvalId, saved[0].id);
  assert.equal(live.calls.signed.length, 1);
});

/**
 * Achieves: a live swap never signs without the Postgres reservation, and never re-signs after signing began.
 * Fails when: a missing ledger signs, or a retry after signing builds a second swap.
 * Oracle: reserve-unavailable and execute-unconfirmed pauses with no extra signature.
 * Side effects: in-memory run; doubles only.
 * Gaps: none.
 */
test('a live swap needs the ledger and does not re-sign after signing began', async () => {
  const machine = new BotStateMachine();
  const live = liveSwapDouble();
  const noLedger = await postLoop(machine, {
    openRouter: swapDecider(scriptedOpenRouter()),
    transferClient: live.client,
    swapOrder: live.swapOrder,
    search: async () => [],
    lookupPrice: swapPrice,
  }, payload({ goal: TRADING_GOAL }));
  const blocked = await noLedger.json();
  assert.equal(blocked.run.pauseReason, 'reserve-unavailable');
  assert.equal(live.calls.signed.length, 0);

  const again = new BotStateMachine();
  const failing = liveSwapDouble();
  failing.client.signPreparedSolanaTransfer = async (request) => {
    failing.calls.signed.push(request);
    throw Object.assign(new Error('timeout'), { code: 'rpc_failed' });
  };
  const deps = {
    openRouter: swapDecider(scriptedOpenRouter()),
    transferClient: failing.client,
    swapOrder: failing.swapOrder,
    ledgerApi: failing.ledgerApi,
    search: async () => [],
    lookupPrice: swapPrice,
  };
  const first = await (await postLoop(again, deps, payload({ goal: TRADING_GOAL }))).json();
  assert.equal(first.run.pauseReason, 'rpc_failed');
  assert.equal(first.run.checkpoints.execute.signing, true);
  failing.client.signPreparedSolanaTransfer = async (request) => {
    failing.calls.signed.push(request);
    return { cluster: 'mainnet-beta', signature: 'sig_second' };
  };
  const run = { ...first.run, paused: false, pauseReason: null, checkpoints: { ...first.run.checkpoints, execute: { ...first.run.checkpoints.execute, status: 'started' } } };
  await again.put('run', run);
  const second = await (await postLoop(again, deps, payload({ goal: TRADING_GOAL }))).json();
  assert.equal(second.run.pauseReason, 'execute-unconfirmed');
  assert.equal(failing.calls.signed.length, 1);
});

/**
 * Achieves: a live swap whose input is not the reserved cap-asset debit never orders or signs.
 * Fails when: a SOL-input swap signs against a USDC reservation.
 * Oracle: swap-mismatch pause and no live calls.
 * Side effects: in-memory run; doubles only.
 * Gaps: none.
 */
test('a live swap must spend the reserved cap asset and amount', async () => {
  const machine = new BotStateMachine();
  const live = liveSwapDouble();
  const models = scriptedOpenRouter();
  const decide = models.openRouter;
  const original = decide.complete.bind(decide);
  decide.complete = async (input) => {
    if (String(input?.task ?? '').includes('Role: decide')) {
      return {
        model: 'test',
        text: JSON.stringify({
          summary: 'Move SOL into USDC',
          facts: { ...facts, mint: SOL_MINT, price: '74730000', reasonSummary: 'Move SOL into USDC' },
          proposal: { ...proposal, swap: { inputMint: SOL_MINT, outputMint: USDC_MINT, inAmount: '10000000' } },
        }),
      };
    }
    return original(input);
  };
  const body = await (await postLoop(machine, {
    openRouter: decide, transferClient: live.client, swapOrder: live.swapOrder, ledgerApi: live.ledgerApi,
    search: async () => [], lookupPrice: swapPrice,
  }, payload({ goal: TRADING_GOAL }))).json();
  assert.equal(body.run.pauseReason, 'swap-mismatch');
  assert.equal(live.calls.orders.length + live.calls.signed.length, 0);
});

/**
 * Achieves: an approved swap that fails before signing keeps its saved approval id for the retry.
 * Fails when: a retry inserts the approval again or reserves without it.
 * Oracle: one saved approval, and both reservations carry its id.
 * Side effects: in-memory run; doubles only.
 * Gaps: none.
 */
test('an approved swap retry reuses its saved approval', async () => {
  const machine = new BotStateMachine();
  const live = liveSwapDouble();
  const saved = [];
  let failOrder = true;
  const order = live.swapOrder;
  const deps = {
    openRouter: swapDecider(scriptedOpenRouter()),
    transferClient: live.client,
    swapOrder: async (intent) => {
      if (failOrder) throw Object.assign(new Error('down'), { code: 'provider_unavailable' });
      return order(intent);
    },
    ledgerApi: live.ledgerApi,
    saveApproval: async (record) => { saved.push(record); return true; },
    search: async () => [],
    lookupPrice: swapPrice,
  };
  const body = payload({ goal: TRADING_GOAL, trustScore: '100', trustConfirmed: true, approval: { action: 'approve', ownerId: 'user_1' } });
  const first = await (await postLoop(machine, deps, body)).json();
  assert.equal(first.run.pauseReason, 'provider_unavailable');
  assert.equal(first.run.checkpoints.execute.approvalId, saved[0].id);
  failOrder = false;
  await machine.put('run', { ...first.run, paused: false, pauseReason: null });
  const second = await (await postLoop(machine, deps, body)).json();
  assert.equal(second.done, true);
  assert.equal(saved.length, 1);
  assert.deepEqual(live.calls.reserved.map(r => r.approvalId), [saved[0].id, saved[0].id]);
});
