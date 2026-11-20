import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_KINDS } from '@ubc2026/contracts';
import { BotStateMachine } from './bot-do.mjs';
import worker from './owner-auth.fixture.mjs';
import {
  alertFromSpend,
  botAlertEvent,
  rememberBotAlert,
  readBotAlerts,
  BOT_LOCATION_HINT,
} from './bot-alerts.mjs';

const at = 1_700_000_000_000;
const mint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

/**
 * Achieves: alert builders emit EVENT_KINDS events scoped to the given botId only.
 * Fails when: unknown kind or wrong botId in payload.
 * Oracle: kinds ⊆ EVENT_KINDS; botId matches input.
 * Side effects / state checked: N/A.
 * Gaps: none for builder shape
 */
test('each bot alert stays inside EVENT_KINDS and names only that bot', () => {
  const cases = [
    ['max-loss', 'bot.paused'],
    ['near-max-loss', 'run.checkpoint'],
    ['price-down', 'run.checkpoint'],
    ['verify-mismatch', 'verify.mismatch'],
    ['unapproved-spend', 'approval.requested'],
  ];
  for (const [alert, kind] of cases) {
    const event = botAlertEvent({
      id: `evt_${alert}`,
      botId: 'bot_desk',
      ownerId: 'user_1',
      alert,
      at,
    });
    assert.equal(EVENT_KINDS.includes(event.kind), true);
    assert.equal(event.kind, kind);
    assert.equal(event.botId, 'bot_desk');
    assert.equal(event.summary.includes('this bot'), true);
  }
  assert.throws(
    () => botAlertEvent({ id: 'evt_nope', botId: 'bot_desk', ownerId: 'user_1', alert: 'email', at }),
    error => error.code === 'unknown_alert',
  );
  assert.equal(alertFromSpend(
    { state: 'approval-needed', signed: false },
    { permission: 'ask', confirmed: false },
  ), null);
});

/**
 * Achieves: timeline write posts one row when configured and no-ops without service key.
 * Fails when: writes without key, or multiple rows for one alert.
 * Oracle: configured: one write; unconfigured: zero writes.
 * Side effects / state checked: fetch call count/body.
 * Gaps: none
 */
test('timeline writes one row for that bot and stays quiet without a service key', async () => {
  const input = {
    alert: 'verify-mismatch',
    botId: 'bot_desk',
    ownerId: 'user_1',
    at,
    scope: 'run_1',
  };
  let called = false;
  const quiet = await rememberBotAlert(
    { SUPABASE_URL: 'https://db.example' },
    null,
    input,
    async () => {
      called = true;
      return Response.json([]);
    },
  );
  assert.equal(called, false);
  assert.equal(quiet.kind, 'verify.mismatch');

  const seen = [];
  const key = 'service-role-test';
  await rememberBotAlert(
    { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: key },
    null,
    { ...input, alert: 'max-loss', scope: 'check_1' },
    async (url, init) => {
      seen.push({ url: String(url), method: init.method, body: JSON.parse(init.body) });
      return new Response(null, { status: 201 });
    },
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'POST');
  assert.match(seen[0].url, /\/rest\/v1\/timeline_events$/);
  assert.equal(seen[0].url.includes(key), false);
  assert.equal(seen[0].body.bot_id, 'bot_desk');
  assert.equal(EVENT_KINDS.includes(seen[0].body.kind), true);
  assert.equal(seen[0].body.kind, 'bot.paused');
});

/**
 * Achieves: max-loss and verify-mismatch alerts write only to the subject bot timeline.
 * Fails when: alerts fan out to other bots or wrong kinds.
 * Oracle: timeline rows for subject bot only with expected kinds.
 * Side effects / state checked: timeline writes captured.
 * Gaps: none
 */
test('a max-loss check and a verify mismatch land on that bot timeline only', async () => {
  const desk = new BotStateMachine();
  const other = new BotStateMachine();
  const checked = await desk.handle(new Request('https://bot/position-check', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-maelstrom-internal': 'position-check',
      'x-owner-id': 'user_1',
    },
    body: JSON.stringify({
      botId: 'bot_desk',
      ownerId: 'user_1',
      now: at,
      maxLoss: '400000',
      positions: [{ mint, amount: '1000000', decimals: 6, entryPriceUsd: '2.00' }],
      quotes: { [mint]: { priceUsd: '1.50', quoteSource: 'dexscreener' } },
    }),
  }));
  assert.equal(checked.status, 200);
  const alerts = await desk.handle(new Request('https://bot/alerts', {
    headers: { 'x-owner-id': 'user_1' },
  }));
  const deskAlerts = await alerts.json();
  assert.equal(deskAlerts.items.length, 1);
  assert.equal(deskAlerts.items[0].botId, 'bot_desk');
  assert.equal(deskAlerts.items[0].kind, 'bot.paused');
  assert.match(deskAlerts.items[0].summary, /Max loss/);

  const stranger = await desk.handle(new Request('https://bot/alerts', {
    headers: { 'x-owner-id': 'user_2' },
  }));
  assert.deepEqual((await stranger.json()).items, []);
  const elsewhere = await other.handle(new Request('https://bot/alerts', {
    headers: { 'x-owner-id': 'user_1' },
  }));
  assert.deepEqual((await elsewhere.json()).items, []);

  const mismatched = new BotStateMachine();
  await mismatched.handle(new Request('https://bot/wake', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ botId: 'bot_1', goal: 'yield' }),
  }));
  const wallet = {
    id: 'w_main',
    ownerId: 'user_1',
    kind: 'main',
    label: 'Main',
    address: mint,
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
  const decided = await mismatched.handle(new Request('https://bot/decide', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      bot,
      wallet,
      ledger: { botId: 'bot_1', asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' },
      proposal: {
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
        expiresAt: at + 60_000,
      },
      facts: {
        asset: 'USDC',
        mint,
        cluster: 'devnet',
        price: '1000000',
        amount: '1001',
        trustScore: '800',
        reasonSummary: 'Transfer under cap',
      },
      trustScore: '800',
    }),
  }));
  assert.equal(decided.status, 200);
  const gate = await decided.json();
  assert.equal(gate.gate.state, 'verify-mismatch');
  const verifyAlerts = await mismatched.handle(new Request('https://bot/alerts', {
    headers: { 'x-owner-id': 'user_1' },
  }));
  const verifyItems = (await verifyAlerts.json()).items;
  assert.equal(verifyItems.length, 1);
  assert.equal(verifyItems[0].kind, 'verify.mismatch');
  assert.equal(verifyItems[0].botId, 'bot_1');
});

/**
 * Achieves: over-cap spend produces unapproved_spend alert for that bot.
 * Fails when: wrong kind or other botId.
 * Oracle: alert kind/botId assertions in file.
 * Side effects / state checked: timeline write.
 * Gaps: none
 */
test('an over-cap spend attempt is an unapproved alert on that bot', async () => {
  const machines = new Map();
  const env = {
    PRODUCT: 'Maelstrom',
    CLUSTER: 'devnet',
    spendNow: at,
    trustLookup: null,
    loadSpendContext: async () => ({
      bot: {
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
      },
      wallet: {
        id: 'w_main',
        ownerId: 'user_1',
        kind: 'main',
        label: 'Main',
        address: mint,
        frozen: false,
        provider: 'privy',
      },
      ledger: { botId: 'bot_1', asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' },
    }),
    transferClient: {
      async signAndBroadcastDevnet() {
        throw new Error('should not sign');
      },
    },
  };
  env.BOT = {
    idFromName: name => name,
    get: name => ({
      fetch: request => {
        if (!machines.has(name)) machines.set(name, new BotStateMachine());
        return machines.get(name).handle(request, env);
      },
    }),
  };
  const response = await worker.fetch(new Request('https://runtime/api/spend', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({
      permission: 'full',
      botId: 'bot_1',
      action: 'pay',
      amount: '60000',
      destination: '11111111111111111111111111111111',
      idempotencyKey: 'spend_over_1',
    }),
  }), env);
  const body = await response.json();
  assert.equal(body.signed, false);
  assert.equal(body.state, 'approval-needed');
  const listed = await worker.fetch(new Request('https://runtime/api/events?botId=bot_1', {
    headers: { 'x-owner-id': 'user_1' },
  }), env);
  const events = await listed.json();
  assert.equal(events.items.length, 1);
  assert.equal(events.items[0].botId, 'bot_1');
  assert.equal(events.items[0].kind, 'approval.requested');
  assert.match(events.items[0].summary, /Unapproved spend/);
  const other = await worker.fetch(new Request('https://runtime/api/events?botId=bot_other', {
    headers: { 'x-owner-id': 'user_1' },
  }), env);
  assert.deepEqual((await other.json()).items, []);
});

test('bot Durable Objects are created with a Western North America location hint', async () => {
  const calls = [];
  const env = {
    BOT: {
      idFromName: name => `id:${name}`,
      get: (id, options) => {
        calls.push({ id, options });
        return { fetch: async () => Response.json({ alerts: [] }) };
      },
    },
  };
  await readBotAlerts(env, 'bot-1', 'owner-1');
  assert.deepEqual(calls, [{ id: 'id:bot-1', options: { locationHint: 'wnam' } }]);
  assert.equal(BOT_LOCATION_HINT, 'wnam');
});
