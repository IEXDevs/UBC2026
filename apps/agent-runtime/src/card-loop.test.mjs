import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BotDurableObject, BotStateMachine, INTERNAL_CARD_LOOP_VALUE, INTERNAL_POSITION_HEADER } from './bot-do.mjs';
import worker from './owner-auth.fixture.mjs';
import { PLATFORM_PROMPT } from './platform-prompt.mjs';

const NOW = 1_700_000_000_000;
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

function post(pathname, body, headers = {}) {
  return new Request(`https://bot${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1', ...headers },
    body: JSON.stringify(body),
  });
}

/**
 * Achieves: creating a loop stores the purpose, and a cooldown under 15 minutes is rejected.
 * Fails when: the purpose is dropped, 14 minutes is stored, or a model flag breaks the loop.
 * Oracle: DO JSON status and cardLoop storage.
 * Side effects: in-memory BotStateMachine.
 * Gaps: Cloudflare alarm delivery is not simulated.
 */
test('the card loop stores a purpose and rejects a short cooldown', async () => {
  const machine = new BotStateMachine();
  const rejected = await machine.handle(post('/card-loop', {
    botId: 'bot_1',
    purpose: 'Check positions',
    cooldownMinutes: '14',
  }));
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error, 'cooldown_too_short');
  assert.equal(await machine.get('cardLoop'), null);

  const created = await machine.handle(post('/card-loop', {
    botId: 'bot_1',
    purpose: 'Check positions',
    cooldownMinutes: '15',
  }));
  assert.equal(created.status, 200);
  const body = await created.json();
  assert.equal(body.loop.purpose, 'Check positions');
  assert.equal(body.loop.cooldownLabel, '15m');
  assert.equal(body.loop.active, true);

  const status = await machine.handle(new Request('https://bot/status', { headers: { 'x-owner-id': 'user_1' } }));
  const listed = await status.json();
  assert.equal(listed.cardLoop.purpose, 'Check positions');

  const shorter = await machine.handle(post('/card-loop/cooldown', { cooldownMinutes: '10' }));
  assert.equal(shorter.status, 400);
  assert.equal((await shorter.json()).error, 'cooldown_too_short');
  assert.equal((await machine.get('cardLoop')).cooldownMinutes, 15);

  const longer = await machine.handle(post('/card-loop/cooldown', { cooldownMinutes: '60' }));
  assert.equal((await longer.json()).loop.cooldownLabel, '1h');

  const spoofed = await machine.handle(post('/card-loop/break', { ownerAsked: true }));
  assert.equal(spoofed.status, 403);
  assert.equal((await spoofed.json()).error, 'owner_must_ask');
  assert.equal((await machine.get('cardLoop')).active, true);

  const broken = await machine.handle(post('/card-loop/break', {}, { 'x-loop-break': 'owner-asked' }));
  assert.equal(broken.status, 200);
  assert.equal((await broken.json()).loop, null);
  assert.equal(await machine.get('cardLoop'), null);
});

/**
 * Achieves: a due loop wakes through runBotLoop and does not spend when the wallet is frozen.
 * Fails when: the signer or model runs before the gate, or a future loop wakes early.
 * Oracle: transfer client and model spies stay empty; pause reason is spend-frozen.
 * Side effects: in-memory run checkpoint.
 * Gaps: a passing gate's mainnet-beta broadcast is covered by the loop engine tests.
 */
test('a loop wake goes through the decision gate before any spend', async () => {
  const machine = new BotStateMachine();
  const signs = [];
  const models = [];
  await machine.handle(post('/card-loop', {
    botId: 'bot_1',
    purpose: 'Check positions',
    cooldownMinutes: '15',
  }));
  const stored = await machine.get('cardLoop');
  await machine.put('cardLoop', { ...stored, nextWakeAt: NOW + 60_000 });
  const env = {
    SOLANA_CLUSTER: 'mainnet-beta',
    loadLoopContext: async () => ({
      bot: { ...bot, frozen: true },
      wallet: { ...wallet, frozen: true },
      ledger,
    }),
    openRouter: { async complete() { models.push('called'); return { text: 'no' }; } },
    transferClient: { async signAndBroadcastSolana(request) { signs.push(request); } },
  };
  const early = await machine.handle(post('/card-loop/tick', { now: NOW }, {
    [INTERNAL_POSITION_HEADER]: INTERNAL_CARD_LOOP_VALUE,
  }), env);
  assert.equal((await early.json()).woke, false);
  assert.equal(signs.length, 0);
  assert.equal(models.length, 0);

  await machine.put('cardLoop', { ...(await machine.get('cardLoop')), nextWakeAt: NOW });
  const due = await machine.handle(post('/card-loop/tick', { now: NOW }, {
    [INTERNAL_POSITION_HEADER]: INTERNAL_CARD_LOOP_VALUE,
  }), env);
  const woke = await due.json();
  assert.equal(woke.woke, true);
  assert.equal(woke.throughGate, true);
  assert.equal(woke.spent, false);
  assert.equal(woke.gate, 'spend-frozen');
  assert.equal(woke.loop.purpose, 'Check positions');
  assert.equal(signs.length, 0);
  assert.equal(models.length, 0);
  assert.equal((await machine.get('cardLoop')).nextWakeAt, NOW + 15 * 60_000);
  assert.match(PLATFORM_PROMPT, /platform rules are locked/);

  const hidden = await machine.handle(post('/card-loop/tick', { now: NOW }));
  assert.equal(hidden.status, 404);
});

/**
 * Achieves: the public card-loop route requires an owner before it reaches a bot.
 * Fails when: an anonymous post is accepted.
 * Oracle: HTTP 401.
 * Side effects: none.
 * Gaps: signed-in create is covered by the state machine test.
 */
test('public card-loop routes require the owner', async () => {
  const env = {
    PRODUCT: 'Maelstrom',
    SOLANA_CLUSTER: 'mainnet-beta',
    BOT: {
      idFromName: (name) => name,
      get: () => ({ fetch: async () => Response.json({ ok: true }) }),
    },
  };
  const response = await worker.fetch(new Request('https://runtime.example/bots/bot_1/card-loop', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ purpose: 'Check positions', cooldownMinutes: '15' }),
  }), env);
  assert.equal(response.status, 401);
});

test('an alarm loads the saved owner and wallet, runs the loop and arms the next wake', async () => {
  const records = new Map();
  const alarms = [];
  const storage = {
    get: key => records.get(key),
    put: (key, value) => records.set(key, value),
    setAlarm: at => alarms.push(at),
  };
  const reads = [];
  const models = [];
  const durable = new BotDurableObject({ storage }, {
    SUPABASE_URL: 'https://supabase.example',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-key',
    fetch: async (url, init) => {
      assert.equal(init.method, 'GET');
      const { pathname, searchParams } = new URL(url);
      reads.push(pathname);
      if (pathname.endsWith('/bots')) {
        assert.equal(searchParams.get('owner_id'), 'eq.' + bot.ownerId);
        return Response.json([{
          id: bot.id, owner_id: bot.ownerId, wallet_id: wallet.id, cap_asset: 'USDC',
          name: bot.name, goal: bot.goal, type: bot.type, enabled: true, frozen: false,
          approval_mode: bot.approvalMode, policy_version: bot.policyVersion,
          cap_mode: bot.cap.mode, max_outflow: bot.cap.maxOutflow, max_per_transaction: bot.cap.maxPerTransaction,
        }]);
      }
      if (pathname.endsWith('/wallets')) {
        assert.equal(searchParams.get('owner_id'), 'eq.' + bot.ownerId);
        return Response.json([{ ...wallet, owner_id: wallet.ownerId }]);
      }
      assert.ok(pathname.endsWith('/spend_ledgers'));
      return Response.json([{ asset: 'USDC' }]);
    },
    openRouter: {
      async complete({ role, goal }) {
        models.push(role);
        if (role === 'research') {
          assert.equal(goal, 'Check positions');
          return { text: 'No change.' };
        }
        return { text: role === 'verify' ? '{"allow":true}' : '{"proposal":null}' };
      },
    },
  });
  const create = await durable.fetch(post('/card-loop', { botId: bot.id, purpose: 'Check positions', cooldownMinutes: '15' }));
  assert.equal(create.status, 200);
  assert.equal(alarms.length, 1);
  records.set('cardLoop', { ...records.get('cardLoop'), nextWakeAt: NOW });
  await durable.alarm();
  assert.deepEqual(reads, ['/rest/v1/bots', '/rest/v1/wallets', '/rest/v1/spend_ledgers']);
  assert.deepEqual(models, ['research', 'verify', 'decide']);
  assert.equal(records.get('run').checkpoints.research.status, 'done');
  const loop = records.get('cardLoop');
  assert.equal(loop.nextWakeAt, loop.lastWakeAt + 15 * 60_000);
  assert.equal(alarms.at(-1), loop.nextWakeAt);
});

test('desk checks use server time and share a single wake with cron', async () => {
  const machine = new BotStateMachine();
  await machine.handle(post('/card-loop', { botId: bot.id, purpose: 'Check positions', cooldownMinutes: '15' }));
  const loop = await machine.get('cardLoop');
  const early = await machine.handle(post('/card-loop/check', { now: loop.nextWakeAt }));
  assert.equal((await early.json()).reason, 'cooling');
  const forbidden = await machine.handle(post('/card-loop/check', {}, { 'x-owner-id': 'user_2' }));
  assert.equal(forbidden.status, 403);

  await machine.put('cardLoop', { ...loop, nextWakeAt: NOW });
  let release;
  let calls = 0;
  const loaded = new Promise(resolve => { release = resolve; });
  let began;
  const started = new Promise(resolve => { began = resolve; });
  const env = {
    loadLoopContext: async () => {
      calls += 1;
      began();
      return loaded;
    },
  };
  const desk = machine.handle(post('/card-loop/check', {}), env);
  await started;
  const cron = await machine.handle(post('/card-loop/tick', { now: NOW }, {
    [INTERNAL_POSITION_HEADER]: INTERNAL_CARD_LOOP_VALUE,
  }), env);
  assert.equal((await cron.json()).reason, 'running');
  const stopped = await machine.handle(post('/card-loop/break', {}, { 'x-loop-break': 'owner-asked' }));
  assert.equal(stopped.status, 200);
  release({ bot, wallet, ledger });
  assert.equal((await (await desk).json()).reason, 'schedule_changed');
  assert.equal(calls, 1);
  assert.equal(await machine.get('cardLoop'), null);
  assert.equal(await machine.get('run'), null);
});

test('cron asks only enabled and unfrozen owned agents to check due loops', async () => {
  const requests = [];
  const work = [];
  await worker.scheduled({ cron: '5,20,35,50 * * * *', scheduledTime: NOW }, {
    listScheduledBots: async () => [
      { ...bot, id: 'ready' }, { ...bot, id: 'disabled', enabled: false }, { ...bot, id: 'frozen', frozen: true },
    ],
    readStreamHealth: async () => ({ lastEventAt: NOW, status: 'up' }),
    BOT: {
      idFromName: name => name,
      get: id => ({ fetch: async request => {
        requests.push({ id, path: new URL(request.url).pathname, owner: request.headers.get('x-owner-id'),
          internal: request.headers.get(INTERNAL_POSITION_HEADER) });
        return Response.json({ ok: true });
      } }),
    },
  }, { waitUntil: promise => work.push(promise) });
  await Promise.all(work);
  assert.deepEqual(requests, [{ id: 'ready', path: '/card-loop/tick', owner: bot.ownerId, internal: INTERNAL_CARD_LOOP_VALUE }]);
});
