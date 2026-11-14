import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.mjs';
import { API_ROUTES, SECRET_NAMES } from '@ubc2026/contracts';

function fakeEnv(extra = {}) {
  return {
    PRODUCT: 'Maelstrom',
    CLUSTER: 'devnet',
    BOT: {
      idFromName: name => name,
      get: () => ({
        fetch: async request => Response.json({ forwarded: new URL(request.url).pathname, body: await request.text() }),
      }),
    },
    ...extra,
  };
}

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

test('owner browser routes are forwarded with the bot id kept on the object path', async () => {
  const env = fakeEnv();
  const live = await worker.fetch(new Request('https://runtime/bots/bot_1/browser/sessions/rec_1/live-view', {
    method: 'POST',
    headers: { 'x-owner-id': 'user_1', 'content-type': 'application/json' },
    body: '{}',
  }), env);
  const body = await live.json();
  assert.equal(body.forwarded, '/id/bot_1/browser/sessions/rec_1/live-view');

  const open = await worker.fetch(new Request('https://runtime/bots/bot_1/browser/sessions', { method: 'GET' }), env);
  const opened = await open.json();
  assert.equal(opened.forwarded, '/id/bot_1/browser/sessions');
});

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

test('bot routes still reach the Durable Object', async () => {
  const env = fakeEnv();
  const wake = await worker.fetch(new Request('https://runtime/bots/bot_1/wake', {
    method: 'POST',
    body: JSON.stringify({ goal: 'watch' }),
  }), env);
  const body = await wake.json();
  assert.equal(body.forwarded, '/wake');
});

const wallet = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
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

test('a fresh stream skips the RPC re-check, and a stale stream reads devnet balances', async () => {
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
      return { ok: true, cluster: 'devnet', address, amount: '42', mint: wallet, rpcUrl: 'https://example.invalid/quicknode-secret-path' };
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
