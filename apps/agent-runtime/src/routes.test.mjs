import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './owner-auth.fixture.mjs';
import { API_ROUTES, SECRET_NAMES } from '@ubc2026/contracts';

function fakeEnv(extra = {}) {
  return {
    PRODUCT: 'Maelstrom',
    SOLANA_CLUSTER: 'mainnet-beta',
    BOT: {
      idFromName: name => name,
      get: () => ({
        fetch: async request => Response.json({ forwarded: new URL(request.url).pathname, body: await request.text() }),
      }),
    },
    ...extra,
  };
}

/**
 * Achieves: catalog includes live data routes; ownerless data GETs are 401.
 * Fails when: routes missing or ownerless allowed.
 * Oracle: catalog membership + 401.
 * Side effects / state checked: N/A.
 * Gaps: none
 */
test('route catalog lists live data routes and ownerless data calls require auth', async () => {
  const env = fakeEnv();
  const catalog = await worker.fetch(new Request('https://runtime/api/routes'), env);
  const listed = await catalog.json();
  assert.deepEqual(listed.secretNames, [...SECRET_NAMES]);
  assert.equal(listed.routes.length, API_ROUTES.length);
  assert.ok(listed.routes.every(route => route.status !== 'stub'));

  const metrics = await worker.fetch(new Request('https://runtime/api/metrics'), env);
  assert.equal(metrics.status, 401);

  const sign = await worker.fetch(new Request('https://runtime/api/wallets/wal_1/sign', { method: 'POST' }), env);
  assert.equal(sign.status, 401);
});

/**
 * Achieves: localhost Origin receives ACAO on OPTIONS and /api/events.
 * Fails when: ACAO missing for localhost.
 * Oracle: ACAO header === localhost origin.
 * Side effects / state checked: N/A.
 * Gaps: denied Origin withCors covered in cors.test.mjs
 */
test('localhost Origin gets CORS on preflight and /api/events', async () => {
  const env = fakeEnv();
  const preflight = await worker.fetch(new Request('https://runtime/api/events?botId=bot_meteora', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:3000',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'x-owner-id',
    },
  }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'http://localhost:3000');
  assert.match(preflight.headers.get('Access-Control-Allow-Headers') || '', /x-owner-id/i);

  const events = await worker.fetch(new Request('https://runtime/api/events?botId=bot_meteora', {
    headers: { Origin: 'http://localhost:3000', 'x-owner-id': 'did:privy:user1' },
  }), env);
  assert.equal(events.headers.get('Access-Control-Allow-Origin'), 'http://localhost:3000');
});

/**
 * Achieves: browser routes forward to DO with bot id on object path.
 * Fails when: bot id dropped from path.
 * Oracle: forwarded pathname includes bot id.
 * Side effects / state checked: BOT stub fetch.
 * Gaps: none
 */
test('owner browser routes are forwarded with the bot id kept on the object path', async () => {
  const env = fakeEnv();
  const live = await worker.fetch(new Request('https://runtime/bots/bot_1/browser/sessions/rec_1/live-view', {
    method: 'POST',
    headers: { 'x-owner-id': 'user_1', 'content-type': 'application/json' },
    body: '{}',
  }), env);
  const body = await live.json();
  assert.equal(body.forwarded, '/id/bot_1/browser/sessions/rec_1/live-view');

  const open = await worker.fetch(new Request('https://runtime/bots/bot_1/browser/sessions', {
    method: 'GET',
    headers: { 'x-owner-id': 'user_1' },
  }), env);
  const opened = await open.json();
  assert.equal(opened.forwarded, '/id/bot_1/browser/sessions');
});

/**
 * Achieves: loop route is forwarded to the bot Durable Object.
 * Fails when: loop not forwarded.
 * Oracle: forwarded path assertion.
 * Side effects / state checked: BOT stub.
 * Gaps: none
 */
test('the loop route reaches the Durable Object', async () => {
  const env = fakeEnv();
  const loop = await worker.fetch(new Request('https://runtime/bots/bot_1/loop', {
    method: 'POST',
    headers: { 'x-owner-id': 'user_1', 'content-type': 'application/json' },
    body: '{}',
  }), env);
  const body = await loop.json();
  assert.equal(body.forwarded, '/loop');
});

/**
 * Achieves: start_task's loop post loads the bot, wallet, and ledger and keeps the goal.
 * Fails when: the Durable Object is forwarded an empty body and later returns no_run.
 * Oracle: forwarded JSON includes botId, goal, bot, wallet, and ledger.
 * Side effects / state checked: loadLoopContext mock.
 * Gaps: the Durable Object run itself is covered in loop-engine.test.mjs.
 */
test('the loop route attaches the assigned bot context for a goal-only start', async () => {
  let seen = null;
  const wallet = {
    id: 'w_main',
    ownerId: 'user_1',
    address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    frozen: false,
  };
  const bot = {
    id: 'bot_1',
    ownerId: 'user_1',
    goal: 'stored goal',
    type: 'trading',
    approvalMode: 'fully-automatic',
    walletId: 'w_main',
    cap: { asset: 'USDC' },
  };
  const ledger = { botId: 'bot_1', asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' };
  const env = fakeEnv({
    BOT: {
      idFromName: name => name,
      get: () => ({
        fetch: async request => {
          seen = JSON.parse(await request.text());
          return Response.json({ forwarded: new URL(request.url).pathname });
        },
      }),
    },
    loadLoopContext: async (wake) => {
      assert.equal(wake.botId, 'bot_1');
      assert.equal(wake.ownerId, 'user_1');
      return { bot, wallet, ledger };
    },
  });
  const goal = 'beat usd inflation in the long run with long term trading';
  const loop = await worker.fetch(new Request('https://runtime/bots/bot_1/loop', {
    method: 'POST',
    headers: { 'x-owner-id': 'user_1', 'content-type': 'application/json' },
    body: JSON.stringify({ goal, permission: 'full' }),
  }), env);
  assert.equal(loop.status, 200);
  assert.equal(seen.botId, 'bot_1');
  assert.equal(seen.goal, goal);
  assert.equal(seen.ownerPermission, 'full');
  assert.equal(seen.bot.id, 'bot_1');
  assert.equal(seen.bot.approvalMode, 'fully-automatic');
  assert.equal(seen.wallet.address, wallet.address);
  assert.equal(seen.ledger.botId, 'bot_1');
});

/**
 * Achieves: bot control routes forward to DO.
 * Fails when: routing miss/404.
 * Oracle: forwarded pathname.
 * Side effects / state checked: BOT stub.
 * Gaps: none
 */
test('bot routes still reach the Durable Object', async () => {
  const env = fakeEnv();
  const denied = await worker.fetch(new Request('https://runtime/bots/bot_1/wake', {
    method: 'POST',
    body: JSON.stringify({ goal: 'watch' }),
  }), env);
  assert.equal(denied.status, 401);

  const wake = await worker.fetch(new Request('https://runtime/bots/bot_1/wake', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ goal: 'watch', botId: 'bot_1' }),
  }), env);
  const body = await wake.json();
  assert.equal(body.forwarded, '/wake');
});

const wallet = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const now = 1_700_000_000_000;

function cronCtx() {
  const waited = [];
  return { waited, ctx: { waitUntil: promise => waited.push(promise) } };
}

async function posted(promise) {
  const response = await promise;
  const body = await response.json();
  return { path: body.forwarded, payload: JSON.parse(body.body) };
}

/**
 * Achieves: hourly cron records position check; empty fleet is a no-op.
 * Fails when: empty fleet still mutates or check not recorded.
 * Oracle: recorded check / no-op assertions.
 * Side effects / state checked: schedule mocks.
 * Gaps: none
 */
test('hourly cron records a position check and does nothing with an empty fleet', async () => {
  const empty = cronCtx();
  await worker.scheduled({}, fakeEnv(), empty.ctx);
  assert.equal(empty.waited.length, 0);

  const listed = cronCtx();
  await worker.scheduled({ cron: '0 * * * *', scheduledTime: now }, fakeEnv({
    listScheduledBots: async () => [{ id: 'bot_9', goal: 'hourly', type: 'trading' }],
  }), listed.ctx);
  assert.equal(listed.waited.length, 1);
  const check = await posted(listed.waited[0]);
  assert.equal(check.path, '/position-check');
  assert.equal(check.payload.reason, 'cron-hourly');
  assert.equal(check.payload.botId, 'bot_9');
  assert.equal(check.payload.balance, null);
});

/**
 * Achieves: fresh stream skips RPC; stale stream performs mainnet-beta balance read.
 * Fails when: fresh still RPCs or stale skips.
 * Oracle: RPC call counts per freshness.
 * Side effects / state checked: stream age + RPC mocks.
 * Gaps: none
 */
test('a fresh stream skips the RPC re-check, and a stale stream reads mainnet-beta balances', async () => {
  const calls = [];
  const fresh = cronCtx();
  await worker.scheduled({ cron: '0 * * * *', scheduledTime: now }, fakeEnv({
    listScheduledBots: async () => [{ id: 'bot_9', type: 'trading', address: wallet, goal: 'hold' }],
    readStreamHealth: async () => ({ lastEventAt: now - 60_000, status: 'up' }),
    readWalletBalance: async () => { throw new Error('rpc should not run'); },
    fetch: async () => { throw new Error('network should not run'); },
  }), fresh.ctx);
  assert.equal(fresh.waited.length, 1);
  assert.equal((await posted(fresh.waited[0])).payload.reason, 'cron-hourly');

  const stale = cronCtx();
  await worker.scheduled({ cron: '5,20,35,50 * * * *', scheduledTime: now }, fakeEnv({
    listScheduledBots: async () => [
      { id: 'bot_9', type: 'trading', address: wallet, goal: 'hold' },
      { id: 'shop', type: 'shopping', address: wallet, goal: 'buy' },
    ],
    readStreamHealth: async () => ({ lastEventAt: now - (61 * 60 * 1000), status: 'up' }),
    readWalletBalance: async ({ address }) => {
      calls.push(address);
      return { ok: true, cluster: 'mainnet-beta', address, amount: '42', mint: wallet, rpcUrl: 'https://example.invalid/quicknode-secret-path' };
    },
    fetch: async () => { throw new Error('network should not run'); },
  }), stale.ctx);
  assert.equal(calls.length, 1);
  assert.equal(stale.waited.length, 2);
  const reasons = [];
  for (const promise of stale.waited) {
    const item = await posted(promise);
    reasons.push(item.payload.reason);
    assert.equal(item.path, '/position-check');
    assert.equal(item.payload.balance.amount, '42');
    assert.equal(JSON.stringify(item.payload).includes('quicknode-secret-path'), false);
    assert.equal(JSON.stringify(item.payload).includes('rpcUrl'), false);
  }
  assert.deepEqual(reasons.sort(), ['stream-drop-recheck', 'stream-drop-recheck']);
});

/**
 * Achieves: shopping bots excluded from hourly position checks; unknown cron is no-op.
 * Fails when: shopping included or unknown cron mutates state.
 * Oracle: skip/no-op assertions.
 * Side effects / state checked: cron handler mocks.
 * Gaps: none
 */
test('shopping bots are not hourly position checks, and an unknown cron does no work', async () => {
  const shop = cronCtx();
  await worker.scheduled({ cron: '0 * * * *', scheduledTime: now }, fakeEnv({
    listScheduledBots: async () => [{ id: 'shop', type: 'shopping', goal: 'buy' }],
    readStreamHealth: async () => ({ lastEventAt: now, status: 'up' }),
  }), shop.ctx);
  assert.equal(shop.waited.length, 0);

  const other = cronCtx();
  await worker.scheduled({ cron: '1 2 3 4 5', scheduledTime: now }, fakeEnv({
    listScheduledBots: async () => [{ id: 'bot_9', type: 'trading', address: wallet }],
    readWalletBalance: async () => { throw new Error('rpc should not run'); },
  }), other.ctx);
  assert.equal(other.waited.length, 0);
});
