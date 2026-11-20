import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NETWORKS, SOLANA_USDC_MINT, X402Error,
  buildPaymentRequired, parsePaymentSignature, buildPaymentSignature, buildPaymentResponse, paymentFeedEntry,
  createSandboxStoreClient,
} from './x402.mjs';

const payTo = 'So11111111111111111111111111111111111111112';
const feePayer = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/**
 * Achieves: buildPaymentRequired returns 402 with base64 v2 accepts on solana-mainnet USDC exact scheme.
 * Fails when: Wrong version/network/asset/scheme or missing feePayer.
 * Oracle: x402 v2 PAYMENT-REQUIRED header contract.
 * Side effects: none
 * Gaps: none meaningful
 */
test('402 challenge encodes v2 PAYMENT-REQUIRED for Solana mainnet-beta USDC', () => {
  const challenge = buildPaymentRequired({
    resourceUrl: 'https://api.example.com/trust-score',
    description: 'Paid trust score lookup',
    amount: '10000',
    payTo,
    feePayer,
  });
  assert.equal(challenge.status, 402);
  const decoded = JSON.parse(Buffer.from(challenge.headers['PAYMENT-REQUIRED'], 'base64').toString('utf8'));
  assert.equal(decoded.x402Version, 2);
  assert.equal(decoded.accepts[0].network, NETWORKS.solana);
  assert.equal(decoded.accepts[0].asset, SOLANA_USDC_MINT);
  assert.equal(decoded.accepts[0].scheme, 'exact');
  assert.equal(decoded.accepts[0].extra.feePayer, feePayer);
});

/**
 * Achieves: Mainnet network and decimal amounts throw from buildPaymentRequired.
 * Fails when: Mainnet challenges are built, or decimal amounts accepted.
 * Oracle: Solana-only builder policy for default helpers.
 * Side effects: none
 * Gaps: Laso mainnet path is separate (shopping).
 */
test('mainnet challenges and malformed amounts are rejected', () => {
  assert.throws(() => buildPaymentRequired({
    resourceUrl: 'https://api.example.com/x', description: 'x', amount: '1', payTo, feePayer, network: NETWORKS.devnet,
  }));
  assert.throws(() => buildPaymentRequired({
    resourceUrl: 'https://api.example.com/x', description: 'x', amount: '1.5', payTo, feePayer,
  }));
});

/**
 * Achieves: build/parsePaymentSignature round-trip on solana; mainnet accepted terms throw.
 * Fails when: Mainnet signatures build successfully.
 * Oracle: PAYMENT-SIGNATURE header encode/decode.
 * Side effects: none
 * Gaps: none meaningful
 */
test('payment signature header round-trips on mainnet-beta and rejects mainnet', () => {
  const accepted = { scheme: 'exact', network: NETWORKS.solana, amount: '10000', asset: SOLANA_USDC_MINT, payTo };
  const header = buildPaymentSignature({ accepted, signature: 'sig' });
  assert.equal(parsePaymentSignature(header).payload.signature, 'sig');
  assert.throws(() => buildPaymentSignature({
    accepted: { ...accepted, network: NETWORKS.devnet },
    signature: 'sig',
  }));
});

/**
 * Achieves: Parsed headers require exact+solana; mainnet accepted in payload throws.
 * Fails when: Mainnet payloads parse as valid.
 * Oracle: parsePaymentSignature network/scheme gate.
 * Side effects: none
 * Gaps: Wrong scheme (non-exact) rejection is untested.
 */
test('payment signature must target exact scheme on Solana mainnet-beta', () => {
  const payload = {
    x402Version: 2,
    accepted: { scheme: 'exact', network: NETWORKS.solana, amount: '10000', asset: SOLANA_USDC_MINT, payTo },
    payload: { signature: 'sig' },
  };
  const header = Buffer.from(JSON.stringify(payload)).toString('base64');
  assert.equal(parsePaymentSignature(header).accepted.amount, '10000');
  const mainnet = { ...payload, accepted: { ...payload.accepted, network: NETWORKS.devnet } };
  assert.throws(() => parsePaymentSignature(Buffer.from(JSON.stringify(mainnet)).toString('base64')));
});

/**
 * Achieves: PAYMENT-RESPONSE encodes success on solana; feed entries require known status and x402-v2 protocol.
 * Fails when: Unknown statuses accepted or network flips.
 * Oracle: paymentFeedEntry status enum + network label.
 * Side effects: none
 * Gaps: none meaningful
 */
test('settlement response and payment feed stay on mainnet-beta', () => {
  const ok = buildPaymentResponse({ success: true, transaction: '5'.repeat(64) });
  assert.ok(ok.headers['PAYMENT-RESPONSE']);
  assert.equal(ok.body.network, NETWORKS.solana);
  const entry = paymentFeedEntry({
    id: 'p1', botId: 'b1', recipient: payTo, amount: '10000', resourceUrl: 'https://api.example.com/trust-score',
    transaction: '5'.repeat(64), status: 'verified', createdAt: 1,
  });
  assert.equal(entry.protocol, 'x402-v2');
  assert.throws(() => paymentFeedEntry({
    id: 'p1', botId: 'b1', recipient: payTo, amount: '10000', resourceUrl: 'https://api.example.com/x',
    status: 'unknown', createdAt: 1,
  }));
});

/**
 * Achieves: listCatalog normalizes quality; unsigned buy returns 402 without PAYMENT-SIGNATURE; signed buy returns an order.
 * Fails when: Invalid quality kept, unsigned buy sends a signature header, or signed buy ignores PAYMENT-SIGNATURE.
 * Oracle: Sandbox /store/catalog and /store/buy 402/order contract.
 * Side effects: Injected fetcher.
 * Gaps: none meaningful
 */
test('sandbox store client lists catalog and surfaces 402 buy challenges', async () => {
  const client = createSandboxStoreClient({
    fetcher: async (url, options) => {
      if (String(url).endsWith('/store/catalog')) {
        return Response.json({
          items: [
            { id: 'sku_1', name: 'Sticker', price: '10000', description: 'demo', quality: '700' },
            { id: 'sku_2', name: 'Odd', price: '1000', quality: 'nope' },
          ],
        });
      }
      assert.equal(options.method, 'POST');
      if (!options.headers['PAYMENT-SIGNATURE']) {
        assert.equal(options.headers['PAYMENT-SIGNATURE'], undefined);
        return new Response(JSON.stringify({ error: 'payment required' }), {
          status: 402,
          headers: { 'PAYMENT-REQUIRED': 'dGVzdA==', 'Content-Type': 'application/json' },
        });
      }
      assert.equal(options.headers['PAYMENT-SIGNATURE'], 'sig_header');
      return Response.json({ orderId: 'ord_paid', itemId: 'sku_1' });
    },
  });
  const items = await client.listCatalog();
  assert.equal(items[0].id, 'sku_1');
  assert.equal(items[0].quality, '700');
  assert.equal(items[1].quality, undefined);
  const challenge = await client.buy({ itemId: 'sku_1' });
  assert.equal(challenge.state, 'payment-required');
  assert.equal(challenge.paymentRequired, 'dGVzdA==');
  const ordered = await client.buy({ itemId: 'sku_1', paymentSignature: 'sig_header' });
  assert.equal(ordered.state, 'ordered');
  assert.equal(ordered.orderId, 'ord_paid');
});

/**
 * Achieves: X402Error is thrown for malformed challenges, signatures, and relative resource URLs.
 * Fails when: Soft returns instead of throw, or wrong error class.
 * Oracle: instanceof X402Error on builder/parser failure paths.
 * Side effects: none.
 * Gaps: Worker payment settlement errors are apps/x402-service-owned.
 */
test('X402Error is thrown for malformed payment artifacts', () => {
  assert.throws(
    () => buildPaymentRequired({
      resourceUrl: '/relative',
      description: 'x',
      amount: '1',
      payTo,
      feePayer,
    }),
    X402Error,
  );
  assert.throws(() => parsePaymentSignature(''), X402Error);
  assert.throws(() => parsePaymentSignature('%%%'), X402Error);
  assert.throws(
    () => buildPaymentSignature({
      accepted: { scheme: 'exact', network: NETWORKS.devnet, amount: '1', asset: SOLANA_USDC_MINT, payTo },
      signature: 'sig',
    }),
    X402Error,
  );
  assert.throws(() => buildPaymentResponse({ success: true, transaction: '', network: NETWORKS.solana }), X402Error);
});
