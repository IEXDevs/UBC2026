import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NETWORKS } from '@ubc2026/x402';
import worker, { withOfflineOwner } from './owner-auth.fixture.mjs';
import {
  matchCommerceRoute,
  dispatchCommerceRoute,
} from './commerce-routes.mjs';

const bot = {
  id: 'bot_shop',
  ownerId: 'own_1',
  name: 'Shop',
  goal: 'Buy the cheapest sandbox sticker',
  type: 'shopping',
  enabled: true,
  frozen: false,
  policyVersion: 1,
  approvalMode: 'ask',
  walletId: 'wal_1',
  cap: { mode: 'limited', asset: 'USDC', maxOutflow: '10000000', maxPerTransaction: '5000000' },
};
const ledger = { asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' };
const payTo = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const feePayer = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/**
 * Achieves: shopping prepare then settle completes through worker commerce routes.
 * Fails when: prepare/settle status wrong or payload missing.
 * Oracle: status/body assertions in test.
 * Side effects / state checked: commerce handler mocks.
 * Gaps: payment failure path partial
 */
test('sandbox shopping prepare and settle are disabled on mainnet', async () => {
  assert.equal(matchCommerceRoute('POST', '/bots/bot_shop/shopping/prepare').kind, 'shopping-prepare');
  const env = {
    sandboxStoreClient: {
      listCatalog: async () => [{ id: 'sku_lo', name: 'Sticker', price: '1000' }],
      buy: async ({ paymentSignature }) => {
        if (!paymentSignature) {
          return {
            state: 'payment-required',
            status: 402,
            paymentRequired: 'dGVzdA==',
            body: {
              accepts: [{
                scheme: 'exact',
                network: NETWORKS.solana,
                amount: '1000',
                asset: payTo,
                payTo,
                maxTimeoutSeconds: 60,
                extra: { feePayer },
              }],
            },
          };
        }
        return { state: 'ordered', orderId: 'ord_9', itemId: 'sku_lo' };
      },
    },
    signShoppingPayment: async () => 'sig_route_1',
  };

  const prep = await dispatchCommerceRoute(new Request('https://runtime/bots/bot_shop/shopping/prepare', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'own_1' },
    body: JSON.stringify({ bot, ledger, recipient: payTo }),
  }), withOfflineOwner(env), { kind: 'shopping-prepare', botId: 'bot_shop' });
  assert.equal(prep.status, 409);
  const prepBody = await prep.json();
  assert.equal(prepBody.error, 'sandbox_disabled_on_mainnet');

  const settle = await dispatchCommerceRoute(new Request('https://runtime/bots/bot_shop/shopping/settle', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'own_1' },
    body: JSON.stringify({
      bot,
      itemId: 'sku_lo',
      accepted: {
        scheme: 'exact',
        network: NETWORKS.solana,
        amount: '1000',
        asset: payTo,
        payTo,
        maxTimeoutSeconds: 60,
        extra: { feePayer },
      },
    }),
  }), withOfflineOwner(env), { kind: 'shopping-settle', botId: 'bot_shop' });
  assert.equal(settle.status, 409);
  const settled = await settle.json();
  assert.equal(settled.error, 'sandbox_disabled_on_mainnet');
});

test('mainnet signal routes decline offers and assumed payments', async () => {
  const path = '/bots/bot_1/commerce/signals/sig_1';
  const offer = await worker.fetch(new Request(`https://runtime${path}`), {});
  assert.equal(offer.status, 503);
  assert.equal((await offer.json()).error, 'signal_payments_unavailable');
  const settle = await worker.fetch(new Request(`https://runtime${path}/settle`, {
    method: 'POST',
    headers: { 'payment-signature': 'unconfirmed' },
  }), {});
  assert.equal(settle.status, 503);
  assert.equal((await settle.json()).error, 'signal_payments_unavailable');
});

test('mainnet agents cannot bypass permissioned spending with legacy signers', async () => {
  const sns = await worker.fetch(new Request('https://runtime/bots/bot_1/sns/send', {
    method: 'POST',
    headers: { 'x-owner-id': 'own_1' },
    body: JSON.stringify({ execute: true }),
  }), { executeSnsTransfer: () => assert.fail('unexpected SNS execution') });
  assert.equal(sns.status, 409);
  assert.equal((await sns.json()).error, 'use_permissioned_spend');

  const raw = await worker.fetch(new Request('https://runtime/api/wallets/wal_1/sign', {
    method: 'POST',
    headers: { 'x-owner-id': 'own_1' },
    body: JSON.stringify({ bot: { id: 'bot_1' }, transaction: 'unchecked' }),
  }), {});
  assert.equal(raw.status, 409);
  assert.equal((await raw.json()).error, 'use_permissioned_spend');
});

/**
 * Achieves: grab-back dry-run returns planned sweeps for additional wallets without executing.
 * Fails when: live transfers occur or plan empty incorrectly.
 * Oracle: plan includes additional wallets; no broadcast.
 * Side effects / state checked: dry-run flag.
 * Gaps: none
 */
test('grab-back dry-run plans additional wallet sweeps', async () => {
  const res = await dispatchCommerceRoute(new Request('https://runtime/security/grab-back', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'own_1' },
    body: JSON.stringify({
      dryRun: true,
      mainWallet: {
        id: 'main_1', ownerId: 'own_1', label: 'main', kind: 'main',
        address: payTo, frozen: false, provider: 'privy',
      },
      wallets: [{
        id: 'add_1', ownerId: 'own_1', label: 'bot', kind: 'additional',
        address: feePayer, frozen: false, provider: 'privy',
      }],
    }),
  }), withOfflineOwner({}), { kind: 'grab-back' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.dryRun, true);
  assert.equal(body.moves.length, 1);
});

/**
 * Achieves: SNS send builds unsigned transfer intent via demo resolver.
 * Fails when: intent signed early or address unresolved.
 * Oracle: unsigned intent fields / resolved address.
 * Side effects / state checked: demo SNS map.
 * Gaps: none
 */
test('sns send builds unsigned intent from demo resolver', async () => {
  const dest = 'So11111111111111111111111111111111111111112';
  const res = await dispatchCommerceRoute(new Request('https://runtime/bots/bot_1/sns/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'own_1' },
    body: JSON.stringify({
      from: payTo,
      domain: 'alex.sol',
      amount: '1000',
    }),
  }), withOfflineOwner({
    SNS_DEMO_MAP: { 'alex.sol': dest },
  }), { kind: 'sns-send', botId: 'bot_1' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.intent.to, dest);
  assert.equal(body.next, 'await-owner-or-signer');
});

/**
 * Achieves: commerce owner routes reject via worker.fetch without x-owner-id;
 *   signal settle returns 503 on mainnet; grab-back without wallets is 400.
 * Fails when: owner checks are skipped at the Worker boundary or settle accepts empty pay.
 * Oracle: status codes + error codes through the live Worker dispatch path.
 * Side effects / state checked: none (no signer / store).
 * Gaps: laso prepare network path still needs LASO_BASE_URL double — not covered here.
 */
test('commerce exports via worker.fetch enforce owner and payment gates', async () => {
  const env = {
    PRODUCT: 'Maelstrom',
    SOLANA_CLUSTER: 'mainnet-beta',
    BOT: {
      idFromName: name => name,
      get: () => ({ fetch: async () => Response.json({ ok: true }) }),
    },
  };

  const prepare = await worker.fetch(new Request('https://runtime/bots/bot_shop/shopping/prepare', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }), env);
  assert.equal(prepare.status, 401);
  assert.equal((await prepare.json()).error, 'owner_required');

  const sns = await worker.fetch(new Request('https://runtime/bots/bot_1/sns/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }), env);
  assert.equal(sns.status, 401);

  const settle = await worker.fetch(new Request('https://runtime/bots/bot_1/commerce/signals/sig_1/settle', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }), env);
  assert.equal(settle.status, 503);
  assert.equal((await settle.json()).error, 'signal_payments_unavailable');

  const grab = await worker.fetch(new Request('https://runtime/security/grab-back', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'own_1' },
    body: '{}',
  }), env);
  assert.equal(grab.status, 400);
  assert.equal((await grab.json()).error, 'wallets_required');
});
