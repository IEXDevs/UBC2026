import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  verifyQuickNodeSignature,
  normalizeStreamEvent,
  parseStreamPayload,
  planWalletKvSync,
  planBackfill,
  handleQuickNodeWebhook,
  createMemoryDedupeStore,
  createMemoryWalletKv,
  createQuickNodeKvClient,
  createSupabaseStreamStore,
  syncWalletsToKv,
  runStreamBackfill,
  streamsReadmeSection,
  StreamsError,
} from './streams.mjs';

const secret = 'qn_test_secret';
const wallet = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

function sign(nonce, timestamp, body) {
  return createHmac('sha256', secret).update(nonce + timestamp + body).digest('hex');
}

test('verifies QuickNode HMAC and rejects skew or bad signatures', () => {
  const nonce = 'n1';
  const timestamp = '1700000000';
  const rawBody = '{"signature":"sig"}';
  const signature = sign(nonce, timestamp, rawBody);
  assert.equal(verifyQuickNodeSignature({
    secret, nonce, timestamp, signature, rawBody, nowSeconds: 1700000000,
  }).ok, true);
  assert.throws(() => verifyQuickNodeSignature({
    secret, nonce, timestamp, signature: '00'.repeat(32), rawBody, nowSeconds: 1700000000,
  }), StreamsError);
  assert.throws(() => verifyQuickNodeSignature({
    secret, nonce, timestamp, signature, rawBody, nowSeconds: 1700000000 + 10_000,
  }), (error) => error.code === 'timestamp_skew');
});

test('normalizes compact stream events and plans KV sync', () => {
  const event = normalizeStreamEvent({
    signature: '5'.repeat(64),
    wallet,
    type: 'deposit',
    amount: '1000',
    token: 'USDC',
    slot: 12,
    botId: 'bot_1',
  });
  assert.equal(event.cluster, 'devnet');
  const plan = planWalletKvSync({ wallets: [wallet, { address: wallet }], existing: [] });
  assert.deepEqual(plan.add, [wallet]);
  assert.equal(plan.destination, 'POST /webhooks/quicknode');
  const backfill = planBackfill({ wallets: [wallet], fromSlot: 1, toSlot: 9 });
  assert.equal(backfill.toSlot, 9);
});

test('webhook handler dedupes by signature and queues bot wakes', async () => {
  const bodyObj = {
    signature: 'abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd',
    wallet,
    type: 'x402-in',
    amount: '50',
    botId: 'bot_shop',
  };
  const rawBody = JSON.stringify(bodyObj);
  const nonce = 'nonce-1';
  const timestamp = '1700000100';
  const signature = sign(nonce, timestamp, rawBody);
  const dedupeStore = createMemoryDedupeStore();
  const persisted = [];

  const first = await handleQuickNodeWebhook({
    secret,
    headers: { 'x-qn-nonce': nonce, 'x-qn-timestamp': timestamp, 'x-qn-signature': signature },
    rawBody,
    dedupeStore,
    persistEvent: async event => { persisted.push(event); },
    nowSeconds: 1700000100,
  });
  assert.equal(first.accepted.length, 1);
  assert.equal(first.wakes[0].botId, 'bot_shop');
  assert.equal(persisted.length, 1);

  const second = await handleQuickNodeWebhook({
    secret,
    headers: { 'x-qn-nonce': nonce, 'x-qn-timestamp': timestamp, 'x-qn-signature': signature },
    rawBody,
    dedupeStore,
    persistEvent: async event => { persisted.push(event); },
    nowSeconds: 1700000100,
  });
  assert.deepEqual(second.duplicates, [bodyObj.signature]);
  assert.equal(second.accepted.length, 0);
  assert.equal(persisted.length, 1);
  assert.match(streamsReadmeSection(), /solana-devnet/);
  assert.equal(parseStreamPayload(JSON.stringify([bodyObj])).length, 1);
});

test('syncWalletsToKv applies plan against memory and QuickNode list client', async () => {
  const kv = createMemoryWalletKv();
  const first = await syncWalletsToKv({ wallets: [wallet], walletKv: kv });
  assert.deepEqual(first.add, [wallet]);
  assert.deepEqual(await kv.list(), [wallet]);

  const calls = [];
  const qn = createQuickNodeKvClient({
    apiKey: 'qn_key',
    listKey: 'maelstrom-wallets',
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method, body: init.body });
      if (init.method === 'GET') return new Response(JSON.stringify([wallet]), { status: 200 });
      return new Response('{}', { status: 200 });
    },
  });
  const other = 'So11111111111111111111111111111111111111112';
  const synced = await syncWalletsToKv({ wallets: [other], walletKv: qn });
  assert.deepEqual(synced.add, [other]);
  assert.deepEqual(synced.remove, [wallet]);
  assert.equal(calls.some((c) => c.method === 'PATCH'), true);
});

test('supabase store resolves bots, persists, and backfill wakes with afterWake', async () => {
  const rest = [];
  const store = createSupabaseStreamStore({
    url: 'https://example.supabase.co',
    serviceKey: 'service',
    fetchImpl: async (url, init) => {
      rest.push({ url, method: init?.method || 'GET', body: init?.body });
      if (url.includes('/wallets?')) {
        return new Response(JSON.stringify([{ id: 'wal_1', owner_id: 'own_1', address: wallet, frozen: false }]), { status: 200 });
      }
      if (url.includes('/bots?')) {
        return new Response(JSON.stringify([{
          id: 'bot_1', owner_id: 'own_1', name: 'Shop', type: 'shopping', goal: 'buy', wallet_id: 'wal_1',
        }]), { status: 200 });
      }
      if (url.includes('/stream_events')) {
        if ((init?.method || 'GET') === 'GET') return new Response('[]', { status: 200 });
        return new Response(JSON.stringify([{ signature: 'x' }]), { status: 201 });
      }
      return new Response('[]', { status: 200 });
    },
  });

  const bots = await store.resolveBotsForWallet({ wallet });
  assert.equal(bots[0].botId, 'bot_1');
  await store.persistEvent({
    signature: 'abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd',
    wallet, type: 'deposit', amount: '1', token: null, slot: 1, cluster: 'devnet',
  });
  assert.equal(rest.some((r) => r.url.includes('stream_events') && r.method === 'POST'), true);

  const after = [];
  const dedupe = createMemoryDedupeStore();
  const backfill = await runStreamBackfill({
    rows: [{
      signature: 'def456def456def456def456def456def456def456def456def456def456def4',
      wallet, type: 'deposit', amount: '2', botId: 'bot_1',
    }],
    dedupeStore: dedupe,
    resolveBotIds: async () => [{ botId: 'bot_1', ownerId: 'own_1' }],
    afterWake: async (wake) => { after.push(wake.botId); return { wakeStatus: 200 }; },
  });
  assert.equal(backfill.accepted.length, 1);
  assert.deepEqual(after, ['bot_1']);
});
