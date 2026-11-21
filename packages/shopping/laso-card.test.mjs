import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  billingAddress,
  cardCanPay,
  lasoCardAction,
  payWithVirtualCard,
  presentLasoCard,
  publicLasoCard,
} from './laso-card.mjs';
import { prepareLasoCardAction } from './shopping.mjs';

const billing = {
  name: 'Ada Lovelace',
  line1: '1 Main St',
  city: 'Austin',
  region: 'TX',
  postalCode: '78701',
  country: 'us',
};
const pan = '4111111111111111';

test('one billing address is stamped on every card and secrets stay hidden', () => {
  const shared = billingAddress(billing);
  assert.equal(shared.country, 'US');
  const hidden = presentLasoCard({ id: 'card_123', pan, cvv: '123', expiry: '07/31', status: 'ready' }, { billing: shared });
  const shown = presentLasoCard({ id: 'card_123', pan, cvv: '123', expiry: '07/31', status: 'ready' }, { reveal: true, billing: shared });
  assert.equal(hidden.number, '•••• •••• •••• 1111');
  assert.equal(hidden.cvv, '•••');
  assert.equal(hidden.revealed, false);
  assert.equal(shown.number, '4111 1111 1111 1111');
  assert.equal(shown.cvv, '123');
  assert.equal(shown.billing.name, 'Ada Lovelace');
  assert.equal(JSON.stringify(publicLasoCard({ card_id: 'card_123', usd_amount: 10, status: 'pending' })).includes(pan), false);
});

test('setup and modify follow the x402 routes and a quote card cannot pay', () => {
  assert.equal(lasoCardAction('setup', 5).path, '/get-card');
  assert.equal(lasoCardAction('modify', 25).path, '/fund-card-balance');
  assert.equal(cardCanPay({ id: 'laso_bot_setup_5000000' }), false);
  assert.equal(cardCanPay({ id: 'card_123' }), true);
  const payment = payWithVirtualCard({
    card: { id: 'card_123', pan, cvv: '123', expiry: '07/31', status: 'ready' },
    billing,
    merchant: 'Ada Supply',
    amountUsd: '12.5',
  });
  assert.equal(payment.status, 'authorized');
  assert.equal(payment.last4, '1111');
  assert.equal(JSON.stringify(payment).includes(pan), false);
  assert.equal(Object.hasOwn(payment, 'cvv'), false);
  assert.equal(Object.hasOwn(payment, 'pan'), false);
  assert.throws(() => payWithVirtualCard({
    card: { id: 'laso_bot_setup_5000000' }, billing, merchant: 'Ada Supply', amountUsd: 5,
  }));
});

test('modify quotes the card balance route and returns a masked card', async () => {
  const accepted = {
    scheme: 'exact',
    network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    amount: '25000000',
    asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    payTo: '3MZVk97x9SeRxbYpc3jhzRfU2fyA3emYutnqfn9kNfYX',
    maxTimeoutSeconds: 60,
    extra: { feePayer: 'BENrLoUbndxoNMUS5JXApGMtNykLjFXXixMtpDwDR9SP' },
  };
  const result = await prepareLasoCardAction({
    bot: { id: 'bot_shop' },
    action: 'modify',
    amountUsd: 25,
    billing,
    fetcher: async (url) => {
      assert.equal(url, 'https://laso.finance/fund-card-balance?amount=25');
      return Response.json({ x402Version: 2, accepts: [accepted] }, { status: 402 });
    },
  });
  assert.equal(result.lasoAction, 'modify');
  assert.equal(result.card.kind, 'reloadable');
  assert.equal(result.card.number, '•••• •••• •••• ••••');
  assert.equal(result.card.billing.line1, '1 Main St');
  assert.equal(result.next, 'await-owner-mainnet-approval');
});
