import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSignalOffer, signalSaleFeedEntry, settleSignalSale, CommerceError } from './commerce.mjs';
import { buildPaymentSignature, SOLANA_USDC_MINT, NETWORKS } from '@ubc2026/x402';

const payTo = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const feePayer = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const buyer = 'So11111111111111111111111111111111111111112';

/**
 * Achieves: A bot signal sale produces a 402 challenge on Solana mainnet-beta USDC with earned direction.
 * Fails when: Challenge status/network/asset drift, or direction is not earned (buyer-facing).
 * Oracle: x402 NETWORKS.solana + SOLANA_USDC_MINT constants and HTTP 402 semantics — not commerce.mjs internals.
 * Side effects: none (pure builders).
 * Gaps: Does not assert on-chain settlement or fee-payer signature validity.
 */
test('builds a mainnet-beta x402 challenge for a bot signal sale', () => {
  const offer = buildSignalOffer({
    botId: 'bot_1',
    walletAddress: payTo,
    feePayer,
    resourceUrl: 'https://api.maelstrom.local/signals/apy-1',
    amount: '25000',
    signalId: 'apy-1',
  });
  assert.equal(offer.challenge.status, 402);
  assert.equal(offer.direction, 'earned');
  assert.equal(offer.cluster, 'mainnet-beta');
  assert.equal(offer.botId, 'bot_1');
  assert.equal(offer.signalId, 'apy-1');
  const accepted = offer.challenge.body.accepts[0];
  assert.equal(accepted.network, NETWORKS.solana);
  assert.equal(accepted.asset, SOLANA_USDC_MINT);
  assert.equal(accepted.payTo, payTo);
  assert.equal(accepted.amount, '25000');
  const feed = signalSaleFeedEntry({
    id: 'pay_1',
    botId: 'bot_1',
    buyer,
    amount: '25000',
    resourceUrl: 'https://api.maelstrom.local/signals/apy-1',
    createdAt: 1,
  });
  assert.equal(feed.status, 'requested');
  assert.equal(feed.protocol, 'x402-v2');
  assert.equal(feed.asset, SOLANA_USDC_MINT);
});

/**
 * Achieves: Matching PAYMENT-SIGNATURE releases the signal payload and marks the feed paid.
 * Fails when: Payload leaks before match, status stays requested after settle, or next ≠ released.
 * Oracle: Independent buildPaymentSignature from @ubc2026/x402 against the offer's accept row.
 * Side effects: none (pure settle; no broadcast).
 * Gaps: Does not verify the buyer signature cryptographically — x402 package owns that.
 */
test('settleSignalSale releases payload after matching payment signature', () => {
  const offer = buildSignalOffer({
    botId: 'bot_1',
    walletAddress: payTo,
    feePayer,
    resourceUrl: 'https://api.maelstrom.local/signals/apy-1',
    amount: '25000',
    signalId: 'apy-1',
  });
  const header = buildPaymentSignature({
    accepted: offer.challenge.body.accepts[0],
    signature: 'buyer_sig_1',
  });
  const settled = settleSignalSale({
    offer,
    paymentSignatureHeader: header,
    signalPayload: { apy: '12.4%', pool: 'meteora' },
    buyer,
    now: 2,
  });
  assert.equal(settled.next, 'released');
  assert.equal(settled.payload.apy, '12.4%');
  assert.equal(settled.payment.status, 'paid');
  assert.equal(settled.payment.transaction, 'buyer_sig_1');
  assert.equal(settled.botId, 'bot_1');
  assert.equal(settled.signalId, 'apy-1');
});

/**
 * Achieves: Offer construction rejects empty bot/signal ids before building a challenge.
 * Fails when: Empty strings are accepted or errors are not CommerceError.
 * Oracle: Required-field contract from commerce module docs (botId + signalId mandatory).
 * Side effects: none.
 * Gaps: Does not cover malformed wallet/feePayer — deferred to x402 validators.
 */
test('buildSignalOffer rejects missing botId and signalId', () => {
  const base = {
    walletAddress: payTo,
    feePayer,
    resourceUrl: 'https://api.maelstrom.local/signals/apy-1',
    amount: '25000',
  };
  assert.throws(() => buildSignalOffer({ ...base, botId: '', signalId: 'apy-1' }), CommerceError);
  assert.throws(() => buildSignalOffer({ ...base, botId: 'bot_1', signalId: '' }), CommerceError);
  assert.throws(() => buildSignalOffer({ ...base, signalId: 'apy-1' }), CommerceError);
});

/**
 * Achieves: Settle refuses mismatched amount/payTo, missing payload, and incomplete offers.
 * Fails when: Wrong payment still releases payload, or null payload is accepted.
 * Oracle: Compare forged header accept fields against the real offer accept row (independent mismatch).
 * Side effects: none.
 * Gaps: Does not cover expired challenges or replayed signatures.
 */
test('settleSignalSale rejects mismatched signatures and incomplete inputs', () => {
  const offer = buildSignalOffer({
    botId: 'bot_1',
    walletAddress: payTo,
    feePayer,
    resourceUrl: 'https://api.maelstrom.local/signals/apy-1',
    amount: '25000',
    signalId: 'apy-1',
  });
  const wrongAmount = buildPaymentSignature({
    accepted: { ...offer.challenge.body.accepts[0], amount: '1' },
    signature: 'buyer_sig_1',
  });
  assert.throws(
    () => settleSignalSale({
      offer,
      paymentSignatureHeader: wrongAmount,
      signalPayload: { apy: '12.4%' },
      buyer,
    }),
    CommerceError,
  );
  const wrongPayTo = buildPaymentSignature({
    accepted: { ...offer.challenge.body.accepts[0], payTo: buyer },
    signature: 'buyer_sig_1',
  });
  assert.throws(
    () => settleSignalSale({
      offer,
      paymentSignatureHeader: wrongPayTo,
      signalPayload: { apy: '12.4%' },
      buyer,
    }),
    CommerceError,
  );
  const good = buildPaymentSignature({
    accepted: offer.challenge.body.accepts[0],
    signature: 'buyer_sig_1',
  });
  assert.throws(
    () => settleSignalSale({ offer, paymentSignatureHeader: good, signalPayload: null, buyer }),
    CommerceError,
  );
  assert.throws(
    () => settleSignalSale({
      offer: { challenge: { body: { accepts: [] } } },
      paymentSignatureHeader: good,
      signalPayload: { apy: '1' },
    }),
    CommerceError,
  );
});

/**
 * Achieves: Feed entry flips to paid only when a transaction signature is supplied.
 * Fails when: Missing tx is marked paid, or present tx stays requested.
 * Oracle: status = transaction ? 'paid' : 'requested' contract from payment feed semantics.
 * Side effects: none.
 * Gaps: none for this pure helper.
 */
test('signalSaleFeedEntry status depends on transaction presence', () => {
  const requested = signalSaleFeedEntry({
    id: 'pay_1',
    botId: 'bot_1',
    buyer,
    amount: '25000',
    resourceUrl: 'https://api.maelstrom.local/signals/apy-1',
    createdAt: 1,
  });
  assert.equal(requested.status, 'requested');
  assert.equal(requested.transaction, null);
  const paid = signalSaleFeedEntry({
    id: 'pay_2',
    botId: 'bot_1',
    buyer,
    amount: '25000',
    resourceUrl: 'https://api.maelstrom.local/signals/apy-1',
    transaction: 'sig_on_chain',
    createdAt: 2,
  });
  assert.equal(paid.status, 'paid');
  assert.equal(paid.transaction, 'sig_on_chain');
});
