import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankCatalogItems, buildShoppingProposal, prepareSandboxPurchase } from './shopping.mjs';

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
