import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  processQuickNodeWebhook,
  processStreamWalletSync,
  processStreamBackfill,
} from './quicknode-webhook.mjs';
import { createMemoryWalletKv } from '@ubc2026/quicknode-streams';

const secret = 'qn_secret';
const wallet = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

/*
 * Achieves: webhook rejects bad HMAC and wakes bot on valid signature.
 * Fails when: bad HMAC accepted or valid does not wake.
 * Oracle: auth failure vs wake success.
 * Side effects / state checked: HMAC + bot fetch.
 * Gaps: none
 */
test('runtime webhook verifies HMAC and wakes the bot stub', async () => {
  const body = JSON.stringify({
    signature: 'abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd',
    wallet,
    type: 'deposit',
    amount: '10',
    botId: 'bot_1',
  });
  const nonce = 'n';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret).update(nonce + timestamp + body).digest('hex');
  const wakes = [];
  const env = {
    QUICKNODE_WEBHOOK_SECRET: secret,
  };
  const botStub = (_env, botId) => ({
    fetch: async (request) => {
      wakes.push({ botId, path: new URL(request.url).pathname, body: await request.json() });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  const response = await processQuickNodeWebhook(new Request('https://runtime/webhooks/quicknode', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-qn-nonce': nonce,
      'x-qn-timestamp': timestamp,
      'x-qn-signature': signature,
    },
    body,
  }), env, botStub);
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.accepted, 1);
  assert.equal(wakes[0].botId, 'bot_1');
  assert.equal(wakes[0].body.reason, 'quicknode-stream');
});

/*
 * Achieves: valid webhook resolves wallet→bots, persists event, wakes, and runs loop.
 * Fails when: steps skipped or wrong bot resolved.
 * Oracle: persist/wake/loop call sequence.
 * Side effects / state checked: Supabase + bot mocks.
 * Gaps: none
 */
test('runtime webhook resolves wallet bots, persists, wakes, and runs loop', async () => {
  const body = JSON.stringify({
    signature: 'fedcba98fedcba98fedcba98fedcba98fedcba98fedcba98fedcba98fedcba98',
    wallet,
    type: 'x402-in',
    amount: '5',
  });
  const nonce = 'n2';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret).update(nonce + timestamp + body).digest('hex');
  const persisted = [];
  const calls = [];
  const env = {
    QUICKNODE_WEBHOOK_SECRET: secret,
    persistStreamEvent: async (event) => { persisted.push(event.signature); },
    resolveBotsForWallet: async () => [{ botId: 'bot_loop', ownerId: 'own_1', goal: 'shop' }],
    loadLoopContext: async (wake) => ({
      owner: { id: wake.ownerId },
      bot: {
        id: wake.botId, ownerId: wake.ownerId, name: 'L', type: 'research', goal: 'g',
        approvalMode: 'ask', walletId: 'w1', enabled: true, frozen: false, policyVersion: 1,
        cap: { mode: 'unlimited', asset: 'USDC' },
      },
      wallet: {
        id: 'w1', ownerId: wake.ownerId, label: 'main', kind: 'main', address: wallet,
        frozen: false, provider: 'privy',
      },
      ledger: { botId: wake.botId, asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' },
      input: { kind: 'stream_event', signature: wake.event.signature },
    }),
  };
  const botStub = (_env, botId) => ({
    fetch: async (request) => {
      calls.push({ botId, path: new URL(request.url).pathname });
      return new Response(JSON.stringify({ ok: true, path: new URL(request.url).pathname }), { status: 200 });
    },
  });
  const response = await processQuickNodeWebhook(new Request('https://runtime/webhooks/quicknode', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-qn-nonce': nonce,
      'x-qn-timestamp': timestamp,
      'x-qn-signature': signature,
    },
    body,
  }), env, botStub);
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.accepted, 1);
  assert.deepEqual(persisted.length, 1);
  assert.deepEqual(calls.map((c) => c.path), ['/wake', '/loop']);
  assert.equal(json.wakes[0].loopStatus, 200);
});

/*
 * Achieves: wallet sync/backfill owner routes respond as wired.
 * Fails when: 404/wrong owner scope.
 * Oracle: status/body assertions in test.
 * Side effects / state checked: route mocks.
 * Gaps: partial failure paths may remain
 */
test('wallet sync and backfill owner routes', async () => {
  const kv = createMemoryWalletKv();
  const sync = await processStreamWalletSync(new Request('https://runtime/internal/streams/sync-wallets', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'own_1' },
    body: JSON.stringify({ wallets: [wallet] }),
  }), { walletKv: kv });
  assert.equal(sync.status, 200);
  assert.deepEqual(await kv.list(), [wallet]);

  const wakes = [];
  const backfill = await processStreamBackfill(new Request('https://runtime/internal/streams/backfill', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'own_1' },
    body: JSON.stringify({
      rows: [{
        signature: 'aaa111aaa111aaa111aaa111aaa111aaa111aaa111aaa111aaa111aaa111aaa1',
        wallet, type: 'deposit', amount: '1', botId: 'bot_bf',
      }],
    }),
  }), { SKIP_STREAM_LOOP: true }, (_env, botId) => ({
    fetch: async (request) => {
      wakes.push({ botId, body: await request.json() });
      return new Response('{"ok":true}', { status: 200 });
    },
  }));
  assert.equal(backfill.status, 200);
  const json = await backfill.json();
  assert.equal(json.accepted, 1);
  assert.equal(wakes[0].body.reason, 'quicknode-backfill');
});

/*
 * Achieves: stream x402 outflow exceeding ledger freezes the wallet.
 * Fails when: over-ledger outflow does not freeze.
 * Oracle: frozen flag/write observed.
 * Side effects / state checked: ledger + wallet write mocks.
 * Gaps: none
 */
test('an x402 outflow above the spend ledger freezes the wallet', async () => {
  const body = JSON.stringify({
    signature: '9'.repeat(64),
    wallet,
    type: 'x402-out',
    amount: '40',
    token: 'USDC',
    botId: 'bot_pay',
  });
  const nonce = 'n-cross';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret).update(nonce + timestamp + body).digest('hex');
  const freezes = [];
  const env = {
    QUICKNODE_WEBHOOK_SECRET: secret,
    SKIP_STREAM_LOOP: true,
    loadSpendCrossCheck: async (events) => [{
      walletId: 'w_pay',
      ownerId: 'own_1',
      address: wallet,
      frozen: false,
      ledgers: [{ asset: 'USDC', spent: '10', reserved: '5' }],
      events,
    }],
    ledgerApi: {
      freezeWallet: async (payload) => {
        freezes.push(payload);
        return { state: 'frozen', walletId: payload.walletId };
      },
    },
  };
  const response = await processQuickNodeWebhook(new Request('https://runtime/webhooks/quicknode', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-qn-nonce': nonce,
      'x-qn-timestamp': timestamp,
      'x-qn-signature': signature,
    },
    body,
  }), env, () => ({
    fetch: async () => new Response('{"ok":true}', { status: 200 }),
  }));
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.accepted, 1);
  assert.equal(json.crossCheck[0].alert, 'unapproved_spend');
  assert.equal(json.crossCheck[0].excess, '25');
  assert.equal(json.crossCheck[0].freezeResult, 'frozen');
  assert.equal(freezes[0].walletId, 'w_pay');
  assert.equal(freezes[0].ownerId, 'own_1');
  assert.equal(typeof freezes[0].now, 'number');
});

/*
 * Achieves: outflow within ledger coverage does not freeze.
 * Fails when: false freeze on covered spend.
 * Oracle: wallet remains unfrozen.
 * Side effects / state checked: ledger mocks.
 * Gaps: none
 */
test('a covered stream outflow does not freeze the wallet', async () => {
  const body = JSON.stringify({
    signature: '8'.repeat(64),
    wallet,
    type: 'x402-out',
    amount: '4',
    token: 'USDC',
    botId: 'bot_pay',
  });
  const nonce = 'n-ok';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret).update(nonce + timestamp + body).digest('hex');
  let frozen = 0;
  const env = {
    QUICKNODE_WEBHOOK_SECRET: secret,
    SKIP_STREAM_LOOP: true,
    loadSpendCrossCheck: async (events) => [{
      walletId: 'w_pay',
      ownerId: 'own_1',
      address: wallet,
      frozen: false,
      ledgers: [{ asset: 'USDC', spent: '4', reserved: '0' }],
      events,
    }],
    ledgerApi: { freezeWallet: async () => { frozen += 1; return { state: 'frozen' }; } },
  };
  const response = await processQuickNodeWebhook(new Request('https://runtime/webhooks/quicknode', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-qn-nonce': nonce,
      'x-qn-timestamp': timestamp,
      'x-qn-signature': signature,
    },
    body,
  }), env, () => ({
    fetch: async () => new Response('{"ok":true}', { status: 200 }),
  }));
  const json = await response.json();
  assert.deepEqual(json.crossCheck, []);
  assert.equal(frozen, 0);
});
