import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rankCatalogItems,
  buildShoppingProposal,
  prepareSandboxPurchase,
  settleSandboxPurchase,
  prepareLasoTinyCardPurchase,
} from './shopping.mjs';
import { NETWORKS, buildPaymentRequired, DEVNET_USDC_MINT } from '@ubc2026/x402';

const bot = {
  id: 'bot_shop',
  ownerId: 'user_1',
  name: 'Sandbox shopper',
  goal: 'Buy the cheapest sticker',
  type: 'shopping',
  enabled: true,
  policyVersion: 1,
  cap: { mode: 'limited', asset: 'USDC', maxOutflow: '100000', maxPerTransaction: '50000' },
};
const ledger = { asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' };
const recipient = 'So11111111111111111111111111111111111111112';

test('ranks catalog by lowest price', () => {
  const { best, reason } = rankCatalogItems([
    { id: 'a', name: 'A', price: '5000' },
    { id: 'b', name: 'B', price: '1000' },
  ]);
  assert.equal(best.id, 'b');
  assert.match(reason, /lowest/);
});

test('builds a policy-bound shopping proposal', () => {
  const { proposal, digest } = buildShoppingProposal({
    bot,
    item: { id: 'sku_1', name: 'Sticker', price: '1000' },
    recipient,
    now: 1_700_000_000_000,
  });
  assert.equal(proposal.outflow, '1000');
  assert.equal(digest.length, 64);
});

test('prepareSandboxPurchase lists, picks, evaluates policy, and surfaces 402', async () => {
  const storeClient = {
    listCatalog: async () => [
      { id: 'sku_hi', name: 'Fancy', price: '9000' },
      { id: 'sku_lo', name: 'Sticker', price: '1000' },
    ],
    buy: async ({ itemId }) => {
      assert.equal(itemId, 'sku_lo');
      return { state: 'payment-required', paymentRequired: 'dGVzdA==', status: 402, body: null };
    },
  };
  const result = await prepareSandboxPurchase({
    bot,
    ledger,
    recipient,
    storeClient,
    now: Date.now(),
  });
  assert.equal(result.pick.item.id, 'sku_lo');
  assert.equal(result.challenge.state, 'payment-required');
  assert.equal(result.next, 'await-owner-approval');
  assert.equal(result.policy.state, 'approval-needed');
});

test('settleSandboxPurchase signs and confirms an order', async () => {
  const challenge = buildPaymentRequired({
    resourceUrl: 'https://sandbox.test/store/buy',
    description: 'sticker',
    amount: '1000',
    payTo: recipient,
    feePayer: recipient,
  });
  const accepted = challenge.body.accepts[0];
  const storeClient = {
    buy: async ({ itemId, paymentSignature }) => {
      assert.equal(itemId, 'sku_lo');
      assert.ok(paymentSignature);
      return { state: 'ordered', orderId: 'ord_1', itemId };
    },
  };
  const settled = await settleSandboxPurchase({
    bot,
    itemId: 'sku_lo',
    accepted,
    storeClient,
    signPayment: async ({ amount, payTo }) => {
      assert.equal(amount, '1000');
      assert.equal(payTo, recipient);
      return 'sig_shop_1';
    },
    now: 1_700_000_000_000,
  });
  assert.equal(settled.next, 'settled');
  assert.equal(settled.payment.transaction, 'sig_shop_1');
  assert.equal(settled.order.orderId, 'ord_1');
});

test('prepareLasoTinyCardPurchase surfaces a mainnet owner gate', async () => {
  const lasoBot = {
    ...bot,
    cap: { mode: 'limited', asset: 'USDC', maxOutflow: '20000000', maxPerTransaction: '10000000' },
  };
  const body = {
    x402Version: 2,
    accepts: [{
      scheme: 'exact',
      network: NETWORKS.mainnet,
      amount: '5000000',
      asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      payTo: recipient,
      maxTimeoutSeconds: 60,
      extra: { feePayer: recipient },
    }],
    resource: { url: 'https://laso.finance/get-card?amount=5', description: 'card' },
  };
  const header = Buffer.from(JSON.stringify(body)).toString('base64');
  const result = await prepareLasoTinyCardPurchase({
    bot: lasoBot,
    ledger,
    amountUsd: 5,
    fetcher: async () => new Response(JSON.stringify(body), {
      status: 402,
      headers: { 'PAYMENT-REQUIRED': header, 'content-type': 'application/json' },
    }),
  });
  assert.equal(result.provider, 'laso');
  assert.equal(result.next, 'await-owner-mainnet-approval');
  assert.equal(result.proposal.outflow, '5000000');
  assert.equal(result.challenge.accepted.payTo, recipient);
  assert.ok(DEVNET_USDC_MINT);
});
