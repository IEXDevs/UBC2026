/**
 * Unit tests for BotStateMachine pure helpers / state machine paths that do not
 * require the Cloudflare Durable Object runtime.
 *
 * Gaps (documented — skip / not exercised here):
 * - BotDurableObject Cloudflare constructor + #machine DO storage adapter
 *   (needs workerd / miniflare). createDurableStore is tested against a Map-like
 *   storage double that mirrors DO list paging semantics.
 * - Full runBotLoop / OpenRouter model calls (loop-engine.test.mjs, openrouter.test.mjs).
 * - Live Browserbase provider (browser-routes.test.mjs uses an injected browsers double).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BotStateMachine, createDurableStore } from './bot-do.mjs';

/**
 * Achieves: createDurableStore pages list results and clones on get/put.
 * Fails when: start-exclusive paging drops keys, or get returns shared mutable refs.
 * Oracle: listed values; mutating get() result must not mutate store.
 * Side effects / state checked: in-memory storage double.
 * Gaps: real DO storage Map iteration order — approximated by array order here.
 */
test('createDurableStore lists with exclusive start paging and clones values', async () => {
  const rows = new Map();
  for (let i = 0; i < 5; i += 1) {
    rows.set(`sess:${i}`, { id: i });
  }
  const storage = {
    async get(key) { return rows.has(key) ? rows.get(key) : undefined; },
    async put(key, value) { rows.set(key, value); },
    async delete(key) { rows.delete(key); },
    async list({ prefix, start, limit }) {
      const keys = [...rows.keys()]
        .filter(key => key.startsWith(prefix))
        .filter(key => start == null || key > start)
        .sort()
        .slice(0, limit);
      return new Map(keys.map(key => [key, rows.get(key)]));
    },
  };
  const store = createDurableStore(storage);
  const listed = await store.list('sess:');
  assert.equal(listed.length, 5);
  const first = await store.get('sess:0');
  first.id = 99;
  assert.equal((await store.get('sess:0')).id, 0);
  await store.put('sess:0', { id: 7 });
  assert.equal((await store.get('sess:0')).id, 7);
  await store.delete('sess:1');
  assert.equal(await store.get('sess:1'), null);
});

/**
 * Achieves: status / wake / pause / resume / advance / decide / position-check
 *   state machine paths work on an in-memory Map without workerd.
 * Fails when: pause blocks resume incorrectly, or position-check drops botId.
 * Oracle: status codes + persisted run/positionCheck fields.
 * Side effects / state checked: machine storage keys.
 * Gaps: /loop with models — see loop-engine.test.mjs; browser leaf paths —
 *   browser-routes.test.mjs.
 */
test('BotStateMachine control plane works without Cloudflare DO runtime', async () => {
  const machine = new BotStateMachine();

  const empty = await machine.handle(new Request('https://bot/status'));
  assert.equal(empty.status, 200);
  const emptyBody = await empty.json();
  assert.equal(emptyBody.run, null);
  assert.equal(emptyBody.positionCheck, null);

  const wakeBad = await machine.handle(new Request('https://bot/wake', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }));
  assert.equal(wakeBad.status, 400);

  const wake = await machine.handle(new Request('https://bot/wake', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ botId: 'bot_1', goal: 'watch', ownerId: 'user_1' }),
  }), { CLUSTER: 'devnet' });
  assert.equal(wake.status, 200);

  const advanced = await machine.handle(new Request('https://bot/advance', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ step: 'research', summary: 'look' }),
  }));
  assert.equal(advanced.status, 200);

  const paused = await machine.handle(new Request('https://bot/pause', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'owner' }),
  }));
  assert.equal(paused.status, 200);
  assert.equal((await paused.json()).run.paused, true);

  const blockedWake = await machine.handle(new Request('https://bot/wake', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ botId: 'bot_1', ownerId: 'user_1' }),
  }));
  assert.equal(blockedWake.status, 409);

  const resumed = await machine.handle(new Request('https://bot/resume', { method: 'POST' }));
  assert.equal(resumed.status, 200);

  const check = await machine.handle(new Request('https://bot/position-check', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-owner-id': 'user_1',
      'x-maelstrom-internal': 'position-check',
    },
    body: JSON.stringify({
      botId: 'bot_1',
      ownerId: 'user_1',
      reason: 'unit',
      now: 1_700_000_000_000,
      positions: [],
      quotes: {},
      balance: null,
    }),
  }));
  assert.equal(check.status, 200);
  const checkBody = await check.json();
  assert.equal(checkBody.ok, true);
  assert.equal(checkBody.check.botId, 'bot_1');

  const deniedStatus = await machine.handle(new Request('https://bot/status'));
  assert.equal((await deniedStatus.json()).positionCheck, null);

  const status = await machine.handle(new Request('https://bot/status', {
    headers: { 'x-owner-id': 'user_1' },
  }));
  const body = await status.json();
  assert.equal(body.run.botId, 'bot_1');
  assert.equal(body.run.paused, false);
  assert.ok(body.positionCheck);
});

/**
 * Achieves: owner-bound alert routes reject missing/mismatched owners.
 * Fails when: alerts are readable without x-owner-id.
 * Oracle: 401 owner_required.
 * Side effects / state checked: none on deny path.
 * Gaps: rememberBotAlert persistence shape covered in bot-alerts.test.mjs.
 */
test('BotStateMachine alerts require x-owner-id', async () => {
  const machine = new BotStateMachine();
  const denied = await machine.handle(new Request('https://bot/alerts'));
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).error, 'owner_required');

  const postDenied = await machine.handle(new Request('https://bot/alert', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ownerId: 'u1', alert: 'max-loss', botId: 'b1' }),
  }));
  assert.equal(postDenied.status, 401);
});

/**
 * Achieves: /loop without owner is 401; unknown paths are 404.
 * Fails when: loop is open or unknown path returns 500.
 * Oracle: status + error codes.
 * Side effects / state checked: none.
 * Gaps: authorized loop execution — loop-engine.test.mjs.
 */
test('BotStateMachine loop requires owner and unknown paths 404', async () => {
  const machine = new BotStateMachine();
  await machine.handle(new Request('https://bot/wake', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ botId: 'bot_1', goal: 'x' }),
  }));

  const loop = await machine.handle(new Request('https://bot/loop', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }));
  assert.equal(loop.status, 401);
  assert.equal((await loop.json()).error, 'owner_required');

  const missing = await machine.handle(new Request('https://bot/nope'));
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'not_found');
});
