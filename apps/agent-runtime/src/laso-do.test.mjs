import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BotStateMachine } from './bot-do.mjs';
import worker from './owner-auth.fixture.mjs';
import { INTERNAL_LASO_SESSION_HEADER, INTERNAL_LASO_SESSION_VALUE, saveLasoSession } from './laso-payment.mjs';

const NOW = 1_700_000_000_000;

function post(pathname, body, headers = {}) {
  return new Request(`https://bot${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1', ...headers },
    body: JSON.stringify(body),
  });
}

function get(pathname, headers = {}) {
  return new Request(`https://bot${pathname}`, {
    headers: { 'x-owner-id': 'user_1', ...headers },
  });
}

const sessionHeaders = { [INTERNAL_LASO_SESSION_HEADER]: INTERNAL_LASO_SESSION_VALUE };

test('Laso sessions stash owner-bound, expire, and never echo the token', async () => {
  const machine = new BotStateMachine();
  const denied = await machine.handle(post('/laso/session', { ownerId: 'user_1', botId: 'bot_1' }));
  assert.equal(denied.status, 403);
  const bad = await machine.handle(post('/laso/session', { ownerId: 'user_1' }, sessionHeaders));
  assert.equal((await bad.json()).error, 'invalid_session');
  const ok = await machine.handle(post('/laso/session', {
    ownerId: 'user_1', botId: 'bot_1', idToken: 'tok_123', expiresAt: Date.now() + 3600_000,
  }, sessionHeaders));
  assert.equal((await ok.json()).ok, true);
  const stored = await machine.get('lasoSession');
  assert.equal(stored.idToken, 'tok_123');
  const foreign = await machine.handle(post('/laso/session', {
    ownerId: 'user_2', botId: 'bot_1', idToken: 'tok_x', expiresAt: Date.now() + 3600_000,
  }, sessionHeaders));
  assert.equal(foreign.status, 403);
});

test('Laso checkpoints save facts, resume from the stage, and close', async () => {
  const machine = new BotStateMachine();
  const anon = await machine.handle(new Request('https://bot/laso/checkpoint'));
  assert.equal(anon.status, 401);
  const empty = await machine.handle(get('/laso/checkpoint'));
  assert.deepEqual(await empty.json(), { ok: true, flow: null });
  const saved = await machine.handle(post('/laso/checkpoint', {
    botId: 'bot_1', kind: 'reloadable', stage: 'waiting-owner', amountUsd: 25, note: 'issuer code sent',
  }));
  const savedFlow = (await saved.json()).flow;
  assert.equal(savedFlow.kind, 'reloadable');
  assert.equal(savedFlow.stage, 'waiting-owner');
  assert.equal(savedFlow.amountUsd, 25);
  assert.ok(Number.isSafeInteger(savedFlow.updatedAt));
  const read = await machine.handle(get('/laso/checkpoint'));
  assert.equal((await read.json()).flow.stage, 'waiting-owner');
  const moved = await machine.handle(post('/laso/checkpoint', { stage: 'verifying', card_id: 'card_9' }));
  assert.equal((await moved.json()).flow.card_id, 'card_9');
  const closed = await machine.handle(post('/laso/checkpoint', { close: true }));
  assert.equal((await closed.json()).flow.stage, 'done');
  const reopen = await machine.handle(post('/laso/checkpoint', { stage: 'paid' }));
  assert.equal((await reopen.json()).error, 'flow_closed');
});

test('Laso status reads strip card numbers and honor expiry', async () => {
  const machine = new BotStateMachine();
  const missing = await machine.handle(get('/laso/status?view=card&card_id=card_1'));
  assert.equal((await missing.json()).error, 'laso_session_expired');
  await machine.put('lasoSession', { idToken: 'tok_123', expiresAt: Date.now() + 3600_000 });
  const calls = [];
  const env = { fetch: async (url, init) => {
    calls.push(String(url));
    assert.match(init.headers.Authorization, /^Bearer tok_123$/);
    if (String(url).includes('/get-card-data?card_id=card_1')) {
      return Response.json({
        card_id: 'card_1', status: 'ready', usd_amount: 10, last4: '4242',
        card_details: { card_number: '4111111111111111', cvv: '123', exp_month: '12', exp_year: '2027' },
      });
    }
    if (String(url).endsWith('/get-account-balance')) return Response.json({ balance: 0, agent_wallet: {} });
    throw new Error('unexpected');
  } };
  const card = await machine.handle(get('/laso/status?view=card&card_id=card_1'), env);
  const payload = await card.json();
  assert.equal(payload.card.status, 'ready');
  assert.equal(payload.card.last4, '4242');
  assert.equal(JSON.stringify(payload).includes('4111111111111111'), false);
  const account = await machine.handle(get('/laso/status?view=account'), env);
  assert.equal((await account.json()).account.balance, 0);
  await machine.put('lasoSession', { idToken: 'tok_old', expiresAt: Date.now() - 1000 });
  const expired = await machine.handle(get('/laso/status?view=card&card_id=card_1'), env);
  assert.equal((await expired.json()).error, 'laso_session_expired');
  assert.equal(await machine.get('lasoSession'), null);
  assert.ok(calls.length >= 2);
});

test('public laso routes require the owner', async () => {
  const env = { PRODUCT: 'Maelstrom', SOLANA_CLUSTER: 'mainnet-beta' };
  for (const [method, path] of [
    ['POST', '/bots/bot_1/laso/checkpoint'],
    ['GET', '/bots/bot_1/laso/checkpoint'],
    ['GET', '/bots/bot_1/laso/status'],
  ]) {
    const response = await worker.fetch(new Request(`https://runtime.example${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'POST' ? '{}' : undefined,
    }), env);
    assert.equal(response.status, 401);
  }
});

test('settle stashes the fresh session without echoing it', async () => {
  const stored = [];
  const env = {
    fetch: async (url) => {
      if (String(url).includes('/get-card-data')) return Response.json({ card_id: 'card_7', status: 'ready' });
      if (String(url).includes('/get-auth-link')) return Response.json({});
      return Response.json(
        { card: { card_id: 'card_7', usd_amount: 10, status: 'pending' }, auth: { id_token: 'fresh-token', expires_in: '3600' } },
        { headers: { 'PAYMENT-RESPONSE': Buffer.from(JSON.stringify({ success: true, network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', transaction: '5'.repeat(88) })).toString('base64') } },
      );
    },
    BOT: {
      idFromName: name => name,
      get: () => ({ fetch: async (request) => {
        stored.push(await request.json());
        return Response.json({ ok: true });
      } }),
    },
  };
  const { settleLasoPayment } = await import('./laso-payment.mjs');
  const ticket = {
    amount: '10000000',
    ownerId: 'user_1',
    botId: 'bot_1',
    resource: { url: 'https://laso.finance/get-card?amount=10' },
    accepted: { network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' },
  };
  const settled = await settleLasoPayment(env, ticket, 'txn', { tries: 1, delayMs: 0 });
  assert.equal(settled.card.status, 'ready');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].idToken, 'fresh-token');
  assert.equal(JSON.stringify(settled).includes('fresh-token'), false);
  assert.equal(await saveLasoSession({}, ticket, 'x', 60), false);
});
