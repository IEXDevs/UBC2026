/**
 * Exhaustive live-route smoke suite.
 *
 * Rigor: every API_ROUTES entry with status=live is exercised through worker.fetch
 * (HTTP) or worker.scheduled (CRON). Auth expectations are checked without headers
 * so missing auth cannot silently succeed. A live path must be dispatched — never
 * the generic worker `{ error: 'not_found' }` 404. Handlers may return business
 * 4xx; they must not crash into the catch-all `{ error: 'internal' }` 500.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_ROUTES } from '@ubc2026/contracts';
import worker from './index.mjs';
import { BotStateMachine } from './bot-do.mjs';

const SAMPLES = Object.freeze({
  walletId: 'fmfdj6yqly31huorjqzq38zc',
  botId: 'bot_1',
  sessionRecordId: 'rec_1',
  signalId: 'sig_1',
  name: 'list_bots',
});

function samplePath(routePath) {
  return routePath.replace(/:([A-Za-z]+)/g, (_, name) => {
    assert.ok(SAMPLES[name], `missing sample for :${name}`);
    return SAMPLES[name];
  });
}

/**
 * BOT stub backed by BotStateMachine so owner-auth DO routes return real 401s
 * instead of a blindly-accepting forwarder.
 */
function fakeEnv(extra = {}) {
  const env = {
    PRODUCT: 'Maelstrom',
    SOLANA_CLUSTER: 'mainnet-beta',
    ...extra,
  };
  if (!env.BOT) {
    const machines = new Map();
    env.BOT = {
      idFromName: name => name,
      get: id => {
        const key = String(id);
        if (!machines.has(key)) machines.set(key, new BotStateMachine());
        const machine = machines.get(key);
        return {
          fetch: async request => machine.handle(request, env),
        };
      },
    };
  }
  return env;
}

function expectedStatuses(route) {
  switch (route.auth) {
    case 'privy':
    case 'owner':
      // Without x-owner-id / bearer: handlers must reject.
      return new Set([401]);
    case 'webhook':
      // Missing/misconfigured webhook secret → 401 unauthorized or 503 not configured.
      // (QuickNode / ElevenLabs never treat an unauthenticated call as success.)
      return new Set([401, 403, 503]);
    case 'none':
      // Business success or client error — never auth-crash, never missing-handler 500.
      return new Set([200, 201, 202, 204, 400, 402, 404, 405, 409, 422]);
    case 'platform':
      return new Set([200, 204]);
    default:
      return new Set([200, 201, 204, 400, 401, 402, 403, 404, 405, 409, 422, 503]);
  }
}

function buildRequest(route) {
  const pathname = samplePath(route.path);
  const init = { method: route.method };
  if (route.method !== 'GET' && route.method !== 'HEAD') {
    init.headers = { 'content-type': 'application/json' };
    init.body = '{}';
  }
  return { pathname, request: new Request(`https://runtime${pathname}`, init) };
}

/**
 * Rigor audit — exhaustive live HTTP route dispatch
 * Achieves: every live non-CRON API_ROUTES id is hit via worker.fetch with a concrete
 *   sample path; auth class predicts status; live paths are not generic 404s; no
 *   unhandled internal 500 from a missing handler.
 * Fails when: a new live route is undeclared in the worker, auth is skipped, or a
 *   handler throws into `{ error: 'internal' }`.
 * Oracle: API_ROUTES is the product contract; statuses follow auth metadata without
 *   credentials; body.error!=='not_found' when status===404 (DO business 404s ok).
 * Side effects / state checked: in-memory BotStateMachine only; no network.
 * Gaps: Does not assert happy-path payloads with real Privy/Supabase secrets —
 *   those live in api-data / spend / commerce suites. HMAC-valid webhook bodies
 *   are covered in quicknode-webhook.test.mjs / voice.test.mjs.
 */
test('every live HTTP API route is dispatched with auth-appropriate status', async () => {
  const env = fakeEnv();
  const httpLive = API_ROUTES.filter(route => route.status === 'live' && route.method !== 'CRON');
  assert.ok(httpLive.length >= 40, `expected a full live catalog, got ${httpLive.length}`);

  const matrix = [];
  for (const route of httpLive) {
    const { pathname, request } = buildRequest(route);
    let response;
    try {
      response = await worker.fetch(request, env);
    } catch (error) {
      assert.fail(`${route.id} (${route.method} ${pathname}) threw: ${error?.message || error}`);
    }
    assert.ok(response, `${route.id} must return a Response`);
    assert.notEqual(response.status, 500, `${route.id} must not crash to raw 500`);

    const allowed = expectedStatuses(route);
    assert.ok(
      allowed.has(response.status),
      `${route.id} ${route.method} ${pathname} auth=${route.auth} → ${response.status}; expected one of ${[...allowed].join(',')}`,
    );

    let body = null;
    try {
      body = await response.clone().json();
    } catch {
      body = null;
    }
    if (response.status === 404) {
      assert.notEqual(
        body?.error,
        'not_found',
        `${route.id} live path ${pathname} must be dispatched (got generic not_found)`,
      );
    }
    matrix.push({ id: route.id, method: route.method, path: pathname, status: response.status, auth: route.auth });
  }

  // Coverage matrix is the suite oracle output — one row per live HTTP route.
  assert.equal(matrix.length, httpLive.length);
  const ids = new Set(matrix.map(row => row.id));
  for (const route of httpLive) {
    assert.ok(ids.has(route.id), `matrix missing ${route.id}`);
  }
});

/**
 * Achieves: both live CRON schedule strings are reachable via worker.scheduled and
 *   empty-fleet is a quiet no-op (no waitUntil work).
 * Fails when: scheduled export missing, or empty fleet still enqueues DO work.
 * Oracle: API_ROUTES cron ids + waitUntil length===0 for empty listScheduledBots.
 * Side effects / state checked: waitUntil queue only.
 * Gaps: Non-empty fleet position-check / stream-drop paths covered in routes.test.mjs.
 */
test('live CRON schedules smoke via scheduled() with empty fleet', async () => {
  const cronLive = API_ROUTES.filter(route => route.status === 'live' && route.method === 'CRON');
  assert.equal(cronLive.length, 2);
  assert.ok(cronLive.some(route => route.id === 'cron.hourly' && route.path === '0 * * * *'));
  assert.ok(cronLive.some(route => route.id === 'cron.stream-fallback' && route.path === '5,20,35,50 * * * *'));

  for (const route of cronLive) {
    const waited = [];
    await worker.scheduled(
      { cron: route.path, scheduledTime: 1_700_000_000_000 },
      fakeEnv({ listScheduledBots: async () => [] }),
      { waitUntil: promise => waited.push(promise) },
    );
    assert.equal(waited.length, 0, `${route.id} empty fleet must not enqueue work`);
  }
});

/**
 * Achieves: spot-check that owner/privy routes reject without credentials, and
 *   auth:none health/routes succeed — anchors the matrix auth classes.
 * Fails when: health requires auth or /api/me succeeds without owner.
 * Oracle: status codes only.
 * Side effects / state checked: none.
 * Gaps: none for this smoke.
 */
test('auth class anchors: health is open, me and grab-back require owner', async () => {
  const env = fakeEnv();
  const health = await worker.fetch(new Request('https://runtime/health'), env);
  assert.equal(health.status, 200);

  const me = await worker.fetch(new Request('https://runtime/api/me'), env);
  assert.equal(me.status, 401);

  const grab = await worker.fetch(new Request('https://runtime/security/grab-back', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }), env);
  assert.equal(grab.status, 401);

  const webhook = await worker.fetch(new Request('https://runtime/webhooks/quicknode', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }), env);
  assert.ok([401, 403, 503].includes(webhook.status));
});
