import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NETWORKS } from '@ubc2026/x402';
import { prepareLasoCardAction } from '@ubc2026/shopping';
import { issueLasoTicket, readLasoTicket, settleLasoPayment } from './laso-payment.mjs';

const NOW = 1_700_000_000_000;
const KEY = 'e2e-offline-key';
const MAINNET_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const PAY_TO = '3MZVk97x9SeRxbYpc3jhzRfU2fyA3emYutnqfn9kNfYX';
const FEE_PAYER = 'BENrLoUbndxoNMUS5JXApGMtNykLjFXXixMtpDwDR9SP';
const TX = '5'.repeat(88);

const bot = {
  id: 'bot_e2e', ownerId: 'user_1', name: 'E2E', goal: 'Buy a card',
  type: 'shopping', enabled: true, frozen: false, policyVersion: 1, approvalMode: 'ask',
  walletId: 'wallet_1', cap: { mode: 'limited', asset: 'USDC', maxOutflow: '1000000000', maxPerTransaction: '1000000000' },
};
const ledger = { botId: 'bot_e2e', asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' };

function challenge(amount) {
  return {
    x402Version: 2,
    accepts: [{
      scheme: 'exact', network: NETWORKS.mainnet, amount,
      asset: MAINNET_USDC, payTo: PAY_TO, maxTimeoutSeconds: 300,
      extra: { feePayer: FEE_PAYER },
    }],
  };
}

function require402(status, body, paySig) {
  if (paySig) throw new Error('signed replay must not receive a 402');
  return {
    status: 402,
    headers: { 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(body)).toString('base64') },
    body,
  };
}

/**
 * A stateful Laso stand-in speaking the real shapes: unpaid calls get a 402
 * challenge, the signed replay gets a receipt plus the product body, and
 * card reads move pending to ready.
 */
function createMockLaso(log) {
  let cardReads = 0;
  return async (url, init = {}) => {
    const target = new URL(url);
    const paySig = init.headers?.['PAYMENT-SIGNATURE'];
    log.push(`${init.method || 'GET'} ${target.pathname}${target.search}`);
    if (target.pathname === '/get-card-data') {
      cardReads += 1;
      assert.match(init.headers.Authorization, /^Bearer e2e-id-token$/);
      if (cardReads === 1) return Response.json({ card_id: 'card_e2e', status: 'pending' });
      return Response.json({
        card_id: 'card_e2e', status: 'ready', usd_amount: 10, last4: '4242',
        card_details: { card_number: '4111111111111111', cvv: '123', exp_month: '12', exp_year: '2027' },
      });
    }
    if (target.pathname === '/get-auth-link') {
      assert.match(init.headers.Authorization, /^Bearer e2e-id-token$/);
      return Response.json({ auth_url: 'https://laso.finance/agent/dashboard/auth?code=e2e-owner-only' });
    }
    if (target.pathname === '/get-card' && target.searchParams.get('amount') === '10') {
      if (!paySig) return Response.json(require402(402, challenge('10000000')).body, {
        status: 402,
        headers: require402(402, challenge('10000000')).headers,
      });
      const envelope = JSON.parse(Buffer.from(paySig, 'base64').toString('utf8'));
      assert.equal(envelope.x402Version, 2);
      assert.equal(envelope.accepted.amount, '10000000');
      assert.equal(envelope.accepted.payTo, PAY_TO);
      assert.ok(envelope.payload.transaction.length > 0);
      return Response.json(
        { card: { card_id: 'card_e2e', usd_amount: 10, status: 'pending' }, auth: { id_token: 'e2e-id-token', expires_in: '3600' } },
        { headers: { 'PAYMENT-RESPONSE': Buffer.from(JSON.stringify({ success: true, network: NETWORKS.mainnet, transaction: TX })).toString('base64') } },
      );
    }
    if (target.pathname === '/order-gift-card') {
      if (!paySig) {
        const body = challenge('52400000');
        return Response.json(body, { status: 402, headers: { 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(body)).toString('base64') } });
      }
      return Response.json(
        { gift_card: { card_id: 'gc_e2e', laso_server_id: 'amazon', amount: 50, currency: 'USD', country: 'US', status: 'completed', redemption_code: 'XXXX-E2E-1111' } },
        { headers: { 'PAYMENT-RESPONSE': Buffer.from(JSON.stringify({ success: true, network: NETWORKS.mainnet, transaction: TX })).toString('base64') } },
      );
    }
    throw new Error(`unexpected laso call ${target.pathname}`);
  };
}

test('end to end: USA prepaid quote, ticket, x402 settle, ready poll, card', async () => {
  const log = [];
  const sessions = [];
  const env = {
    fetch: createMockLaso(log),
    BOT: {
      idFromName: name => name,
      get: () => ({ fetch: async request => { sessions.push(await request.json()); return Response.json({ ok: true }); } }),
    },
  };
  // 1. Quote: the unpaid call returns the 402 challenge, never a charge.
  const prepared = await prepareLasoCardAction({ bot, ledger, action: 'setup', amountUsd: 10, fetcher: env.fetch, now: NOW });
  assert.equal(prepared.next, 'await-owner-mainnet-approval');
  assert.equal(prepared.proposal.outflow, '10000000');
  assert.equal(prepared.challenge.accepted.payTo, PAY_TO);
  assert.ok(log[0].includes('/get-card?amount=10'));
  // 2. Owner approval binds the exact terms into a ticket.
  const ticket = issueLasoTicket(prepared, 'user_1', 'bot_e2e', KEY, NOW);
  const offer = readLasoTicket(ticket, 'user_1', 'bot_e2e', KEY, NOW);
  assert.equal(offer.amount, '10000000');
  assert.equal(offer.botId, 'bot_e2e');
  // 3. Settle: signed replay hits Laso, receipt validates, card polls to ready.
  const settled = await settleLasoPayment(env, offer, 'signed-tx-bytes', { tries: 5, delayMs: 0 });
  assert.equal(settled.signature, TX);
  assert.deepEqual(settled.card, { card_id: 'card_e2e', usd_amount: 10, status: 'ready', last4: '4242' });
  assert.equal(settled.claimUrl, 'https://laso.finance/agent/dashboard/auth?code=e2e-owner-only');
  // 4. The replay carried a v2 PAYMENT-SIGNATURE, the poll used Bearer, the token was stashed, and no PAN leaked.
  assert.ok(log.some(entry => entry.startsWith('GET /get-card-data?card_id=card_e2e')));
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].idToken, 'e2e-id-token');
  assert.equal(sessions[0].ownerId, 'user_1');
  const leaked = JSON.stringify(settled);
  assert.equal(leaked.includes('e2e-id-token'), false);
  assert.equal(leaked.includes('4111111111111111'), false);
});

test('end to end: gift quote settles to a redemption code', async () => {
  const log = [];
  const env = { fetch: createMockLaso(log) };
  const prepared = await prepareLasoCardAction({
    bot, ledger, action: 'gift', amountUsd: 50,
    extra: { laso_server_id: 'amazon', country: 'US' }, fetcher: env.fetch, now: NOW,
  });
  assert.equal(prepared.proposal.outflow, '52400000');
  assert.ok(log[0].includes('/order-gift-card?') && log[0].includes('laso_server_id=amazon'));
  const offer = readLasoTicket(issueLasoTicket(prepared, 'user_1', 'bot_e2e', KEY, NOW), 'user_1', 'bot_e2e', KEY, NOW);
  const settled = await settleLasoPayment(env, offer, 'signed-tx-bytes', { tries: 1, delayMs: 0 });
  assert.equal(settled.giftCard.status, 'completed');
  assert.equal(settled.giftCard.redemption_code, 'XXXX-E2E-1111');
  assert.equal(settled.card, undefined);
});
