import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NETWORKS, DEVNET_USDC_MINT, buildPaymentRequired, parsePaymentSignature, buildPaymentResponse, paymentFeedEntry,
} from './x402.mjs';

const payTo = 'So11111111111111111111111111111111111111112';
const feePayer = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

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

test('mainnet challenges and malformed amounts are rejected', () => {
  assert.throws(() => buildPaymentRequired({
    resourceUrl: 'https://api.example.com/x', description: 'x', amount: '1', payTo, feePayer, network: NETWORKS.mainnet,
  }));
  assert.throws(() => buildPaymentRequired({
    resourceUrl: 'https://api.example.com/x', description: 'x', amount: '1.5', payTo, feePayer,
  }));
});

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
