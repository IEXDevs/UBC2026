import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lasoQuoteBody, shoppingBotForCards } from './laso-quote.mjs';

const shop = { id: 'bot_shop', type: 'shopping', name: 'Shop', goal: 'buy', walletId: 'wallet_1' };

test('a card quote uses the shopping agent and leaves the number out of the request', () => {
  assert.equal(shoppingBotForCards({ id: 'bot_trade', type: 'trading' }, [shop]).id, 'bot_shop');
  const body = lasoQuoteBody(shop, 'owner_1', {
    lasoAction: 'modify',
    amountUsd: '25',
    billing: { name: 'Ada Lovelace', line1: '1 Main St', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US' },
  });
  assert.equal(body.provider, 'laso');
  assert.equal(body.lasoAction, 'modify');
  assert.equal(body.amountUsd, 25);
  assert.equal(body.bot.walletId, 'wallet_1');
  assert.equal(JSON.stringify(body).includes('4111'), false);
  assert.equal(lasoQuoteBody({ ...shop, walletId: '' }, 'owner_1'), null);
});
