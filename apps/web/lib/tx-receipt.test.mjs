import { test } from 'node:test';
import assert from 'node:assert/strict';
import { txReceiptFromResult, withSolscanUrl } from './tx-receipt.mjs';

const signature = '5'.repeat(64);

/**
 * Achieves: a devnet signature becomes one Solscan line the owner can open.
 * Fails when: the URL drops the cluster, a failed spend still links, or mainnet is linked.
 * Oracle: text includes solscan.io/tx and cluster=devnet; signed false and mainnet return null.
 */
test('a devnet signature is a Solscan message and a failed spend is not', () => {
  const receipt = txReceiptFromResult({ signed: true, signature, cluster: 'devnet' });
  assert.equal(receipt.url, `https://solscan.io/tx/${signature}?cluster=devnet`);
  assert.equal(receipt.text, `Sent. ${receipt.url}`);
  assert.equal(txReceiptFromResult(JSON.stringify({ ok: true, signature, cluster: 'testnet' })).cluster, 'testnet');
  assert.equal(txReceiptFromResult({ signed: false, signature, cluster: 'devnet' }), null);
  assert.equal(txReceiptFromResult({ error: 'desk_locked', signature, cluster: 'devnet' }), null);
  assert.equal(txReceiptFromResult({ signed: true, signature, cluster: 'mainnet' }), null);
  assert.equal(txReceiptFromResult({ ok: true, cluster: 'devnet' }), null);
});

/**
 * Achieves: the tool payload the model reads includes solscanUrl once.
 * Fails when: the field is missing, or a second pass rewrites a URL that is already set.
 */
test('withSolscanUrl adds the link onto the tool result', () => {
  const next = withSolscanUrl({ signed: true, signature, cluster: 'devnet' });
  assert.equal(next.solscanUrl, `https://solscan.io/tx/${signature}?cluster=devnet`);
  assert.equal(withSolscanUrl(next).solscanUrl, next.solscanUrl);
  const text = withSolscanUrl(JSON.stringify({ ok: true, signature, cluster: 'devnet' }));
  assert.match(text, /solscanUrl/);
  assert.equal(withSolscanUrl({ error: 'nope' }).error, 'nope');
});
