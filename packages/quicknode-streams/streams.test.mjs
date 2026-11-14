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
