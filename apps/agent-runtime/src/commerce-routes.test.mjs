import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPaymentSignature, NETWORKS } from '@ubc2026/x402';
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
const payTo = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const feePayer = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/**
 * Achieves: shopping prepare then settle completes through worker commerce routes.
 * Fails when: prepare/settle status wrong or payload missing.
 * Oracle: status/body assertions in test.
 * Side effects / state checked: commerce handler mocks.
 * Gaps: payment failure path partial
 */
test('shopping prepare + settle through worker routes', async () => {
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
                network: NETWORKS.devnet,
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
  assert.equal(prep.status, 200);
  const prepBody = await prep.json();
  assert.equal(prepBody.provider, 'sandbox');
  assert.equal(prepBody.pick.item.id, 'sku_lo');

  const settle = await dispatchCommerceRoute(new Request('https://runtime/bots/bot_shop/shopping/settle', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'own_1' },
    body: JSON.stringify({
      bot,
      itemId: 'sku_lo',
      accepted: {
        scheme: 'exact',
        network: NETWORKS.devnet,
        amount: '1000',
        asset: payTo,
        payTo,
        maxTimeoutSeconds: 60,
        extra: { feePayer },
      },
    }),
  }), withOfflineOwner(env), { kind: 'shopping-settle', botId: 'bot_shop' });
  assert.equal(settle.status, 200);
  const settled = await settle.json();
  assert.equal(settled.next, 'settled');
});

/**
 * Achieves: signal sell challenges with 402 then settle releases payload after payment.
 * Fails when: 402 skipped or settle returns empty without pay.
 * Oracle: 402 then settled payload fields.
 * Side effects / state checked: payment/settle mocks.
 * Gaps: none
 */
test('signal sell returns 402 and settle releases payload', async () => {
  const offers = new Map();
  const env = {
    SIGNAL_PAY_TO: payTo,
    SIGNAL_FEE_PAYER: feePayer,
    signalOffers: {
      put: async (k, v) => offers.set(k, v),
      get: async (k) => offers.get(k) ?? null,
    },
  };
  const offerRes = await dispatchCommerceRoute(new Request('https://runtime/bots/bot_1/commerce/signals/apy-1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amount: '25000' }),
  }), env, { kind: 'signal-offer', botId: 'bot_1', signalId: 'apy-1' });
  assert.equal(offerRes.status, 402);
  const challenge = await offerRes.json();
  const header = buildPaymentSignature({
    accepted: challenge.accepts[0],
    signature: 'buyer_sig',
  });
  const settle = await dispatchCommerceRoute(new Request('https://runtime/bots/bot_1/commerce/signals/apy-1/settle', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'payment-signature': header },
    body: JSON.stringify({ signalPayload: { tip: 'rotate LP' }, buyer: feePayer }),
  }), env, { kind: 'signal-settle', botId: 'bot_1', signalId: 'apy-1' });
  assert.equal(settle.status, 200);
  const body = await settle.json();
  assert.equal(body.next, 'released');
  assert.equal(body.payload.tip, 'rotate LP');
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
 *   signal settle without payment-signature returns 402; grab-back without wallets is 400.
 * Fails when: owner checks are skipped at the Worker boundary or settle accepts empty pay.
 * Oracle: status codes + error codes through the live Worker dispatch path.
 * Side effects / state checked: none (no signer / store).
 * Gaps: laso prepare network path still needs LASO_BASE_URL double — not covered here.
 */
test('commerce exports via worker.fetch enforce owner and payment gates', async () => {
  const env = {
    PRODUCT: 'Maelstrom',
    CLUSTER: 'devnet',
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
  assert.equal(settle.status, 402);
  assert.equal((await settle.json()).error, 'payment_signature_required');

  const grab = await worker.fetch(new Request('https://runtime/security/grab-back', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'own_1' },
    body: '{}',
  }), env);
  assert.equal(grab.status, 400);
  assert.equal((await grab.json()).error, 'wallets_required');
});
