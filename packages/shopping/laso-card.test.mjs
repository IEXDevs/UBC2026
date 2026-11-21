import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  billingAddress,
  cardCanPay,
  chooseLasoCardKind,
  LASO_CARD_CHOICE_PROMPT,
  lasoCardAction,
  lasoCardChecklist,
  lasoIntlMaxUnits,
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

test('card choice never guesses: reloadable, prepaid, top-up, or ask', () => {
  assert.equal(chooseLasoCardKind('get me a laso finance reloadable card'), 'reloadable');
  assert.equal(chooseLasoCardKind('order a non-reloadable USA card for $20'), 'non-reloadable-usa');
  assert.equal(chooseLasoCardKind('get me a lasso prepaid card'), 'non-reloadable-usa');
  assert.equal(chooseLasoCardKind('add funds to the Laso card'), 'top-up');
  assert.equal(chooseLasoCardKind('get me a laso card'), 'undecided');
  assert.equal(chooseLasoCardKind('get me a lasso card'), 'undecided');
  assert.equal(chooseLasoCardKind('buy a $50 amazon gift card'), 'gift');
  assert.match(LASO_CARD_CHOICE_PROMPT, /Reloadable or non-reloadable USA/);
  const reloadable = lasoCardChecklist('reloadable');
  assert.ok(reloadable.some((step) => /kyc/i.test(step)));
  assert.ok(reloadable.some((step) => /verify-card-issuer-link/i.test(step)));
  assert.ok(reloadable.some((step) => /create-reloadable-card/i.test(step)));
  const prepaid = lasoCardChecklist('non-reloadable-usa');
  assert.ok(prepaid.some((step) => /get-card\?amount/i.test(step)));
  assert.ok(prepaid.some((step) => /get-card-data/i.test(step)));
  assert.ok(lasoCardChecklist('top-up').some((step) => /fund-card-balance/i.test(step)));
});

test('intl and gift specs carry their routes, limits, and fee bounds', () => {
  const intl = lasoCardAction('intl', 250);
  assert.equal(intl.path, '/order-intl-card');
  assert.equal(intl.kind, 'prepaid-intl');
  assert.equal(lasoIntlMaxUnits('250000000'), '259500000');
  assert.throws(() => lasoCardAction('intl', 250.5), /invalid_amount/);
  assert.throws(() => lasoCardAction('intl', 50), /invalid_amount/);
  const gift = lasoCardAction('gift', 50, { laso_server_id: 'amazon', country: 'us' });
  assert.equal(gift.path, '/order-gift-card');
  assert.equal(gift.laso_server_id, 'amazon');
  assert.equal(gift.country, 'US');
  assert.throws(() => lasoCardAction('gift', 50, {}), /gift_product_required/);
  assert.throws(() => lasoCardAction('gift', 50, { laso_server_id: 'amazon', country: 'USA' }), /gift_country/);
  assert.throws(() => lasoCardAction('bogus', 5), /invalid_action/);
});
