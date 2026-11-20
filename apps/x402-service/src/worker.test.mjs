import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SOLANA_USDC_MINT, NETWORKS, buildPaymentSignature } from '@ubc2026/x402';
import worker, { CATALOG, LOW_TRUST_MINT, SOL_MINT, createPriceTrustHandler } from './worker.mjs';

const payTo = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const feePayer = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const signature = '2'.repeat(88);

function env(extra = {}) {
  return { SOLANA_CLUSTER: 'mainnet-beta', X402_PAY_TO: payTo, X402_FEE_PAYER: feePayer, ...extra };
}

function handler(extra = {}) {
  return createPriceTrustHandler({ payTo, feePayer, ...extra });
}

async function challengeFor(handle, path) {
  const response = await handle(new Request(`https://x402.test${path}`), env());
  assert.equal(response.status, 402);
  const body = await response.json();
  assert.equal(body.accepts[0].network, NETWORKS.solana);
  assert.equal(body.accepts[0].asset, SOLANA_USDC_MINT);
  assert.equal(body.accepts[0].payTo, payTo);
  assert.equal(body.resource.url, `https://x402.test${path}`);
  return body;
}

/**
 * Achieves: health/challenge/unpaid paths stay on mainnet-beta and never hit live network; mainnet cluster refused.
 * Fails when: live fetch called, mainnet accepted, or challenge not 402/solana.
 * Oracle: health 200/solana; 402 challenge NETWORKS.solana; mainnet health 403; fetch throws if called.
 * Side effects / state checked: global fetch replaced with thrower.
 * Gaps: none
 */
test('health, catalog challenge, and unpaid body stay on mainnet-beta without a network call', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('live network'); };
  try {
    const health = await worker.fetch(new Request('https://x402.test/health'), env());
    assert.equal(health.status, 200);
    const healthy = await health.json();
    assert.equal(healthy.cluster, 'mainnet-beta');
    assert.equal(healthy.configured, true);

    const missing = await worker.fetch(new Request('https://x402.test/price/' + SOL_MINT), { SOLANA_CLUSTER: 'mainnet-beta' });
    assert.equal(missing.status, 503);

    const handle = handler();
    const body = await challengeFor(handle, `/price/${SOL_MINT}`);
    assert.equal(body.accepts[0].amount, '10000');
    assert.equal(body.accepts[0].extra.feePayer, feePayer);
    assert.equal(JSON.stringify(body).includes(CATALOG.prices[SOL_MINT].priceUsd), false);

    const unknown = await handle(new Request('https://x402.test/price/' + LOW_TRUST_MINT), env());
    assert.equal(unknown.status, 404);
    const invalid = await handle(new Request('https://x402.test/trust/not-a-mint'), env());
    assert.equal(invalid.status, 400);
    const refused = await worker.fetch(new Request('https://x402.test/health'), { SOLANA_CLUSTER: 'mainnet' });
    assert.equal(refused.status, 403);
  } finally {
    globalThis.fetch = original;
  }
});

/**
 * Achieves: confirmed payment-signature releases price/trust payloads on solana.
 * Fails when: 200 without confirm, or wrong cluster/asset in paid.
 * Oracle: priceUsd 150.25; trust score 120; confirms===2; paid.network/asset assertions.
 * Side effects / state checked: confirmPayment mock count.
 * Gaps: none
 */
test('a confirmed mainnet-beta payment releases the price and trust score', async () => {
  let confirms = 0;
  const handle = handler({
    confirmPayment: async ({ signature: presented, accepted, kind }) => {
      confirms += 1;
      assert.equal(presented, signature);
      assert.equal(accepted.network, NETWORKS.solana);
      return { ok: true, kind };
    },
  });
  const priceChallenge = await challengeFor(handle, `/price/${SOL_MINT}`);
  const priceHeader = buildPaymentSignature({ accepted: priceChallenge.accepts[0], signature });
  const price = await handle(new Request(`https://x402.test/price/${SOL_MINT}`, {
    headers: { 'payment-signature': priceHeader },
  }), env());
  assert.equal(price.status, 200);
  const quote = await price.json();
  assert.equal(quote.priceUsd, '150.25');
  assert.equal(quote.pricingCluster, 'mainnet');
  assert.equal(quote.executionCluster, 'mainnet-beta');
  assert.equal(quote.label, 'mainnet-beta execution, mainnet pricing');
  assert.equal(quote.paid.network, NETWORKS.solana);
  assert.equal(quote.paid.asset, SOLANA_USDC_MINT);
  assert.ok(price.headers.get('payment-response'));

  const trustChallenge = await challengeFor(handle, `/trust/${LOW_TRUST_MINT}`);
  assert.equal(trustChallenge.accepts[0].amount, '5000');
  const trustHeader = buildPaymentSignature({ accepted: trustChallenge.accepts[0], signature });
  const trust = await handle(new Request(`https://x402.test/trust/${LOW_TRUST_MINT}`, {
    headers: { 'payment-signature': trustHeader },
  }), env());
  const score = await trust.json();
  assert.equal(score.score, '120');
  assert.equal(score.decision.state, 'confirmation-required');
  assert.match(score.decision.prompt, /low trust score/);
  assert.equal(score.executionCluster, 'mainnet-beta');
  assert.equal(confirms, 2);
});

/**
 * Achieves: terms mismatch and unbound/failed confirmer keep 402 and do not release quotes.
 * Fails when: mismatch still confirms or unbound returns 200.
 * Oracle: payment_terms_mismatch; settlement_unconfirmed; unknown_transaction; confirms 0 on mismatch.
 * Side effects / state checked: confirmPayment counter.
 * Gaps: none
 */
test('mismatched terms and an unbound confirmer do not release a quote', async () => {
  let confirms = 0;
  const handle = handler({
    confirmPayment: async () => { confirms += 1; return { ok: false, reason: 'unknown_transaction' }; },
  });
  const accepted = {
    scheme: 'exact', network: NETWORKS.solana, amount: '1', asset: SOLANA_USDC_MINT, payTo,
  };
  const mismatch = await handle(new Request(`https://x402.test/price/${SOL_MINT}`, {
    headers: { 'payment-signature': buildPaymentSignature({ accepted, signature }) },
  }), env());
  assert.equal(mismatch.status, 402);
  assert.equal((await mismatch.json()).error, 'payment_terms_mismatch');
  assert.equal(confirms, 0);

  const challenge = await challengeFor(handle, `/price/${SOL_MINT}`);
  const unbound = createPriceTrustHandler({ payTo, feePayer });
  const refused = await unbound(new Request(`https://x402.test/price/${SOL_MINT}`, {
    headers: { 'payment-signature': buildPaymentSignature({ accepted: challenge.accepts[0], signature }) },
  }), env());
  assert.equal(refused.status, 402);
  assert.equal((await refused.json()).error, 'settlement_unconfirmed');
  const failed = await handle(new Request(`https://x402.test/price/${SOL_MINT}`, {
    headers: { 'payment-signature': buildPaymentSignature({ accepted: challenge.accepts[0], signature }) },
  }), env());
  assert.equal((await failed.json()).error, 'unknown_transaction');
});

/**
 * Achieves: worker.mjs source text excludes mainnet USDC mint and mainnet CAIP id.
 * Fails when: mainnet identifiers appear in source.
 * Oracle: readFileSync excludes known mainnet strings.
 * Side effects / state checked: N/A.
 * Gaps: none — static source scan only
 */
test('worker source does not name a mainnet USDC mint or mainnet CAIP network', () => {
  const source = readFileSync(new URL('./worker.mjs', import.meta.url), 'utf8');
  assert.equal(source.includes('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'), false);
  assert.equal(source.includes('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), false);
});
