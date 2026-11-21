import { test } from 'node:test';
import assert from 'node:assert/strict';
import { txReceiptFromResult, withSolscanUrl } from './tx-receipt.mjs';

const signature = '5'.repeat(64);

/**
 * Achieves: a mainnet-beta signature becomes one Solscan line the owner can open.
 * Fails when: the URL drops a test network, a failed spend still links, or the network is guessed.
 */
test('a mainnet-beta signature is a Solscan message and a failed spend is not', () => {
  const receipt = txReceiptFromResult({ signed: true, signature, cluster: 'mainnet-beta' });
  assert.equal(receipt.url, `https://solscan.io/tx/${signature}`);
  assert.equal(receipt.text, `Sent. ${receipt.url}`);
  assert.equal(txReceiptFromResult(JSON.stringify({ ok: true, signature, cluster: 'testnet' })).cluster, 'testnet');
  assert.equal(txReceiptFromResult({ signed: false, signature, cluster: 'mainnet-beta' }), null);
  assert.equal(txReceiptFromResult({ error: 'desk_locked', signature, cluster: 'mainnet-beta' }), null);
  assert.equal(txReceiptFromResult({ signed: true, signature, cluster: 'mainnet' }).url, receipt.url);
  assert.equal(txReceiptFromResult({ signed: true, signature, cluster: 'devnet' }).url, `${receipt.url}?cluster=devnet`);
  assert.equal(txReceiptFromResult({ signed: true, signature }), null);
  assert.equal(txReceiptFromResult({ ok: true, cluster: 'mainnet-beta' }), null);
});

/**
 * Achieves: the tool payload the model reads includes solscanUrl once.
 * Fails when: the field is missing, or a second pass rewrites a URL that is already set.
 */
test('withSolscanUrl adds the link onto the tool result', () => {
  const next = withSolscanUrl({ signed: true, signature, cluster: 'mainnet-beta' });
  assert.equal(next.solscanUrl, `https://solscan.io/tx/${signature}`);
  assert.equal(withSolscanUrl(next).solscanUrl, next.solscanUrl);
  const text = withSolscanUrl(JSON.stringify({ ok: true, signature, cluster: 'mainnet-beta' }));
  assert.match(text, /solscanUrl/);
  assert.equal(withSolscanUrl({ error: 'nope' }).error, 'nope');
});

test('Laso outcomes name the product that settled', () => {
  const base = { signed: true, signature, cluster: 'mainnet-beta' };
  assert.match(txReceiptFromResult({ ...base, card: { card_id: 'card_1', usd_amount: 10, status: 'ready' } }).text, /Laso card card_1: \$10, ready/);
  assert.match(txReceiptFromResult({ ...base, giftCard: { card_id: 'gc_1', laso_server_id: 'amazon', amount: 50, currency: 'USD', status: 'completed' } }).text, /Laso gift card gc_1 \(amazon\): 50 USD, completed/);
  assert.match(txReceiptFromResult({ ...base, intlCardOrder: { card_id: '1706', on_card_usd_amount: 250 } }).text, /Laso international card 1706: \$250 queued/);
  assert.match(txReceiptFromResult({ ...base, topUp: { top_up_id: 't1', funded_usd: 50, status: 'paid' } }).text, /top-up \$50: paid/);
  assert.match(txReceiptFromResult({ ...base, kycRequired: true }).text, /needs KYC/);
});
