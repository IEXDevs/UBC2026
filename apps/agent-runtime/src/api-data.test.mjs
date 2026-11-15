import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.mjs';
import { enrichEnv } from './runtime-env.mjs';
import { mapBotRow, mapWalletRow, mapLedgerRow } from './supabase-rest.mjs';

function fakeEnv(extra = {}) {
  return {
    PRODUCT: 'Maelstrom',
    CLUSTER: 'devnet',
    BOT: {
      idFromName: name => name,
      get: () => ({
        fetch: async request => Response.json({ forwarded: new URL(request.url).pathname }),
      }),
    },
    ...extra,
  };
}

test('enrichEnv is idempotent and leaves injectables alone', () => {
  const transferClient = { signAndBroadcastDevnet: async () => ({}) };
  const loadLoopContext = async () => ({});
  const once = enrichEnv(fakeEnv({ transferClient, loadLoopContext }));
  const twice = enrichEnv(once);
  assert.equal(once, twice);
  assert.equal(once.transferClient, transferClient);
  assert.equal(once.loadLoopContext, loadLoopContext);
});

test('data routes require an owner and stay empty without Supabase', async () => {
  const env = fakeEnv();
  const denied = await worker.fetch(new Request('https://runtime/api/metrics'), env);
  assert.equal(denied.status, 401);

  const empty = await worker.fetch(new Request('https://runtime/api/metrics', {
    headers: { 'x-owner-id': 'user_1' },
  }), env);
  assert.equal(empty.status, 200);
  const body = await empty.json();
  assert.equal(body.source, 'unconfigured');
  assert.deepEqual(body.items, []);
  assert.equal(body.stub, undefined);
});

test('wallet create reports signer_not_configured without Privy secrets', async () => {
  const env = fakeEnv();
  const res = await worker.fetch(new Request('https://runtime/api/wallets', {
    method: 'POST',
    headers: { authorization: 'Bearer tok_1', 'x-owner-id': 'user_1' },
  }), env);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'signer_not_configured');
});

test('supabase mappers turn rows into bot/wallet/ledger records', () => {
  const bot = mapBotRow({
    id: 'bot_1',
    owner_id: 'user_1',
    wallet_id: 'wal_1',
    name: 'Shop',
    goal: 'buy',
    type: 'shopping',
    approval_mode: 'ask',
    enabled: true,
    frozen: false,
    policy_version: 2,
    cap_mode: 'limited',
    cap_asset: 'USDC',
    max_outflow: 100,
    max_per_transaction: 50,
  });
  assert.equal(bot.walletId, 'wal_1');
  assert.equal(bot.cap.maxOutflow, '100');
  assert.equal(mapWalletRow({
    id: 'wal_1',
    owner_id: 'user_1',
    kind: 'main',
    label: 'Main',
    address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    provider: 'privy',
    frozen: false,
  }).privyWalletId, 'wal_1');
  assert.deepEqual(mapLedgerRow({ asset: 'USDC', spent: 1, reserved: 2, realized_loss: 3 }, 'bot_1'), {
    botId: 'bot_1',
    asset: 'USDC',
    spent: '1',
    reserved: '2',
    realizedLoss: '3',
  });
});

test('activity logs require an owner and stay empty without Supabase', async () => {
  const env = fakeEnv();
  const denied = await worker.fetch(new Request('https://runtime/api/logs'), env);
  assert.equal(denied.status, 401);
  const empty = await worker.fetch(new Request('https://runtime/api/logs', {
    headers: { 'x-owner-id': 'user_1' },
  }), env);
  assert.equal(empty.status, 200);
  const body = await empty.json();
  assert.equal(body.source, 'unconfigured');
  assert.deepEqual(body.items, []);
});

test('profile lookup sends a handle to its owner and a .sol name through SNS', async () => {
  const address = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const fetcher = async (url) => {
    const href = String(url);
    if (href.includes('profiles?handle=eq.alex')) {
      return Response.json([{ owner_id: 'user_2', handle: 'alex', display_name: 'Alex', avatar_url: null }]);
    }
    if (href.includes('wallets?')) return Response.json([{ address }]);
    return new Response('[]', { status: 201, headers: { 'content-type': 'application/json' } });
  };
  const env = fakeEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: fetcher,
    SNS_DEMO_MAP: { 'richclub.sol': address },
  });
  const handle = await worker.fetch(new Request('https://runtime/api/profiles/lookup?q=%40Alex', {
    headers: { 'x-owner-id': 'user_1' },
  }), env);
  const handleBody = await handle.json();
  assert.equal(handleBody.recipient.kind, 'handle');
  assert.equal(handleBody.recipient.displayName, 'Alex');
  assert.equal(handleBody.recipient.address, address);

  const sns = await worker.fetch(new Request('https://runtime/api/profiles/lookup?q=%40richclub.sol', {
    headers: { 'x-owner-id': 'user_1' },
  }), env);
  const snsBody = await sns.json();
  assert.equal(snsBody.recipient.kind, 'sns');
  assert.equal(snsBody.recipient.domain, 'richclub.sol');
  assert.equal(snsBody.recipient.address, address);
});

test('bot text chat requires owner and OpenRouter', async () => {
  const denied = await worker.fetch(new Request('https://runtime/api/bots/bot_1/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'hi' }),
  }), fakeEnv());
  assert.equal(denied.status, 401);

  const missingKey = await worker.fetch(new Request('https://runtime/api/bots/bot_1/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ message: 'hi', name: 'Nova', goal: 'watch' }),
  }), fakeEnv());
  assert.equal(missingKey.status, 503);
  assert.equal((await missingKey.json()).error, 'openrouter_not_configured');
});

test('bot text chat returns an OpenRouter reply for the owner', async () => {
  const env = fakeEnv({
    openRouter: {
      chat: async ({ message, botName }) => ({
        model: 'muse-spark-1.3-contributor',
        text: `${botName} heard: ${message}`,
      }),
    },
  });
  const res = await worker.fetch(new Request('https://runtime/api/bots/bot_1/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({
      message: 'status?',
      name: 'Nova',
      goal: 'Watch SOL',
      history: [{ role: 'user', text: 'hi' }, { role: 'agent', text: 'hello' }],
    }),
  }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.reply, 'Nova heard: status?');
  assert.equal(body.botId, 'bot_1');
});

test('bot delete is dispatched when Supabase is unconfigured', async () => {
  const res = await worker.fetch(new Request('https://runtime/api/bots/bot_1', {
    method: 'DELETE',
    headers: { 'x-owner-id': 'user_1' },
  }), fakeEnv());
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'unconfigured');
});

test('a platform send posts to the recipient handle and lists it on both wallets', async () => {
  const fetcher = async (url, init = {}) => {
    const href = String(url);
    if (href.includes('/rpc/policy_reserve_budget')) {
      return Response.json({ state: 'reserved' });
    }
    if (href.includes('/rpc/platform_post_transfer')) {
      const body = JSON.parse(init.body);
      assert.equal(body.payload.handle, 'bob');
      assert.equal(body.payload.amount, '5000000');
      return Response.json({
        replay: false,
        transfer: {
          id: body.payload.idempotencyKey,
          handle: 'bob',
          amount: '5000000',
          from_owner_id: 'alice',
          to_owner_id: 'bob',
          bot_id: 'bot_shop',
        },
      });
    }
    if (href.includes('bots?')) return Response.json([{ id: 'bot_shop' }]);
    if (href.includes('platform_transfers?')) {
      return Response.json([{
        id: 'send_bob_5000000',
        handle: 'bob',
        amount: '5000000',
        from_owner_id: 'alice',
        to_owner_id: 'bob',
        asset: 'USDC',
      }]);
    }
    return Response.json([]);
  };
  const env = fakeEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: fetcher,
  });
  const posted = await worker.fetch(new Request('https://runtime/api/transfers', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'alice' },
    body: JSON.stringify({
      handle: '@bob',
      amount: '5000000',
      idempotencyKey: 'send_bob_5000000',
      botId: 'bot_shop',
    }),
  }), env);
  const postedBody = await posted.json();
  assert.equal(posted.status, 200);
  assert.equal(postedBody.transfer.direction, 'out');
  assert.equal(postedBody.transfer.handle, 'bob');

  const listed = await worker.fetch(new Request('https://runtime/api/transfers', {
    headers: { 'x-owner-id': 'bob' },
  }), env);
  const listedBody = await listed.json();
  assert.equal(listedBody.items[0].direction, 'in');
  assert.equal(listedBody.items[0].amount, '5000000');
});

test('health reports signing and supabase readiness flags', async () => {
  const incomplete = await worker.fetch(new Request('https://runtime/health'), fakeEnv({
    transferClient: { ok: true },
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    SUPABASE_URL: '',
  }));
  const incompleteBody = await incomplete.json();
  assert.equal(incompleteBody.signing, true);
  assert.equal(incompleteBody.supabase, false);
  assert.equal(incompleteBody.secrets.SUPABASE_SERVICE_ROLE_KEY.set, true);
  assert.equal(incompleteBody.secrets.SUPABASE_URL.bound, true);
  assert.equal(incompleteBody.secrets.SUPABASE_URL.set, false);

  const res = await worker.fetch(new Request('https://runtime/health'), fakeEnv({
    transferClient: { ok: true },
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    fetch: async () => new Response('[]', { status: 201, headers: { 'content-type': 'application/json' } }),
  }));
  const body = await res.json();
  assert.equal(body.signing, true);
  assert.equal(body.supabase, true);
  assert.equal(body.secrets.SUPABASE_URL.set, true);
});
