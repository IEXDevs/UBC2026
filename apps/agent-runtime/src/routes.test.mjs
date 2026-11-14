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

test('route catalog and contract stubs answer without secrets', async () => {
  const env = fakeEnv();
  const catalog = await worker.fetch(new Request('https://runtime/api/routes'), env);
  const listed = await catalog.json();
  assert.deepEqual(listed.secretNames, [...SECRET_NAMES]);
  assert.equal(listed.routes.length, API_ROUTES.length);

  const metrics = await worker.fetch(new Request('https://runtime/api/metrics'), env);
  assert.equal(metrics.status, 200);
  const metricsBody = await metrics.json();
  assert.equal(metricsBody.stub, true);
  assert.equal(metricsBody.route, 'metrics.get');

  const sign = await worker.fetch(new Request('https://runtime/api/wallets/wal_1/sign', { method: 'POST' }), env);
  const signBody = await sign.json();
  assert.equal(signBody.stub, true);
  assert.equal(signBody.route, 'wallets.sign');
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

test('stub cron does nothing unless bots are listed', async () => {
  const waited = [];
  await worker.scheduled({}, fakeEnv(), { waitUntil: promise => waited.push(promise) });
  assert.equal(waited.length, 0);

  await worker.scheduled({}, fakeEnv({
    listScheduledBots: async () => [{ id: 'bot_9', goal: 'hourly' }],
  }), { waitUntil: promise => waited.push(promise) });
  assert.equal(waited.length, 1);
  const result = await waited[0];
  const body = await result.json();
  assert.equal(body.forwarded, '/wake');
});
