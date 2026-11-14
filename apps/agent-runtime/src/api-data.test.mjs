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
  }));
  const body = await res.json();
  assert.equal(body.signing, true);
  assert.equal(body.supabase, true);
  assert.equal(body.secrets.SUPABASE_URL.set, true);
});
