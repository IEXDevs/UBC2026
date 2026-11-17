import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NETWORKS, DEVNET_USDC_MINT, buildPaymentRequired, parsePaymentSignature, buildPaymentSignature, buildPaymentResponse, paymentFeedEntry,
  createSandboxStoreClient,
} from './x402.mjs';

const payTo = 'So11111111111111111111111111111111111111112';
const feePayer = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/**
 * Achieves: buildPaymentRequired returns 402 with base64 v2 accepts on solana-devnet USDC exact scheme.
 * Fails when: Wrong version/network/asset/scheme or missing feePayer.
 * Oracle: x402 v2 PAYMENT-REQUIRED header contract.
 * Side effects: none
 * Gaps: none meaningful
 */
test('402 challenge encodes v2 PAYMENT-REQUIRED for Solana devnet USDC', () => {
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
  assert.equal(decoded.accepts[0].network, NETWORKS.devnet);
  assert.equal(decoded.accepts[0].asset, DEVNET_USDC_MINT);
  assert.equal(decoded.accepts[0].scheme, 'exact');
  assert.equal(decoded.accepts[0].extra.feePayer, feePayer);
});

/**
 * Achieves: Mainnet network and decimal amounts throw from buildPaymentRequired.
 * Fails when: Mainnet challenges are built, or decimal amounts accepted.
 * Oracle: Devnet-only builder policy for default helpers.
 * Side effects: none
 * Gaps: Laso mainnet path is separate (shopping).
 */
test('mainnet challenges and malformed amounts are rejected', () => {
  assert.throws(() => buildPaymentRequired({
    resourceUrl: 'https://api.example.com/x', description: 'x', amount: '1', payTo, feePayer, network: NETWORKS.mainnet,
  }));
  assert.throws(() => buildPaymentRequired({
    resourceUrl: 'https://api.example.com/x', description: 'x', amount: '1.5', payTo, feePayer,
  }));
});

/**
 * Achieves: build/parsePaymentSignature round-trip on devnet; mainnet accepted terms throw.
 * Fails when: Mainnet signatures build successfully.
 * Oracle: PAYMENT-SIGNATURE header encode/decode.
 * Side effects: none
 * Gaps: none meaningful
 */
test('payment signature header round-trips on devnet and rejects mainnet', () => {
  const accepted = { scheme: 'exact', network: NETWORKS.devnet, amount: '10000', asset: DEVNET_USDC_MINT, payTo };
  const header = buildPaymentSignature({ accepted, signature: 'sig' });
  assert.equal(parsePaymentSignature(header).payload.signature, 'sig');
  assert.throws(() => buildPaymentSignature({
    accepted: { ...accepted, network: NETWORKS.mainnet },
    signature: 'sig',
  }));
});

/**
 * Achieves: Parsed headers require exact+devnet; mainnet accepted in payload throws.
 * Fails when: Mainnet payloads parse as valid.
 * Oracle: parsePaymentSignature network/scheme gate.
 * Side effects: none
 * Gaps: Wrong scheme (non-exact) rejection is untested.
 */
test('payment signature must target exact scheme on Solana devnet', () => {
  const payload = {
    x402Version: 2,
    accepted: { scheme: 'exact', network: NETWORKS.devnet, amount: '10000', asset: DEVNET_USDC_MINT, payTo },
    payload: { signature: 'sig' },
  };
  const header = Buffer.from(JSON.stringify(payload)).toString('base64');
  assert.equal(parsePaymentSignature(header).accepted.amount, '10000');
  const mainnet = { ...payload, accepted: { ...payload.accepted, network: NETWORKS.mainnet } };
  assert.throws(() => parsePaymentSignature(Buffer.from(JSON.stringify(mainnet)).toString('base64')));
});

/**
 * Achieves: PAYMENT-RESPONSE encodes success on devnet; feed entries require known status and x402-v2 protocol.
 * Fails when: Unknown statuses accepted or network flips.
 * Oracle: paymentFeedEntry status enum + network label.
 * Side effects: none
 * Gaps: none meaningful
 */
test('settlement response and payment feed stay on devnet', () => {
  const ok = buildPaymentResponse({ success: true, transaction: '5'.repeat(64) });
  assert.ok(ok.headers['PAYMENT-RESPONSE']);
  assert.equal(ok.body.network, NETWORKS.devnet);
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
