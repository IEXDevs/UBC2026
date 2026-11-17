import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logRows, sendPreview, signatureOf, swapPreview } from './txn-preview.mjs';

/**
 * Achieves: verifies send preview title and From/To/Amount/Network line labels.
 * Fails when: title omits amount, label order drifts, or destination value is wrong.
 * Oracle: sendPreview({ from, to, amountLabel }) → title 'Send …' and fixed line labels.
 * Side effects / state checked: N/A.
 * Gaps: does not assert Network line value or From line.
 */
test('a send preview names the wallet, destination, and amount', () => {
  const preview = sendPreview({ from: 'Main', to: '@alex', amountLabel: '1.5 USDC' });
  assert.equal(preview.title, 'Send 1.5 USDC');
  assert.deepEqual(preview.lines.map(line => line.label), ['From', 'To', 'Amount', 'Network']);
  assert.equal(preview.lines[1].value, '@alex');
  assert.equal(preview.lines[0].value, 'Main');
  assert.equal(preview.lines[2].value, '1.5 USDC');
});

/**
 * Achieves: verifies log rows merge receipts/payments/activity with Solscan links and signature helpers.
 * Fails when: row order/ids drift, cluster query missing on solscan, or swap placeholder text changes.
 * Oracle: solscan.io/tx/{sig}[+?cluster=devnet]; signatureOf; swapPreview empty receive → 'Quoted when you slide'.
 * Side effects / state checked: N/A.
 * Gaps: does not assert payment/activity row titles or mainnet cluster query omission beyond rows[2].
 */
test('log rows keep a timestamp, the transfer, and a solscan link', () => {
  const signature = '5'.repeat(64);
  const rows = logRows({
    receipts: [{
      id: 'r1',
      at: '2026-11-15T05:00:00.000Z',
      title: 'Send 1 USDC',
      lines: [{ label: 'To', value: '@alex' }],
      signature,
      cluster: 'devnet',
    }],
    payments: [{
      id: 'p1',
      amount: '1000000',
      asset: 'USDC',
      direction: 'paid',
      counterparty: 'shop',
      cluster: 'devnet',
      txSignature: signature,
      createdAt: '2026-11-15T04:00:00.000Z',
    }],
    activity: [{
      id: 'a1',
      action: 'tx.confirmed',
      status: 'ok',
      at: '2026-11-15T03:00:00.000Z',
      detail: { signature, cluster: 'mainnet' },
    }],
  });
  assert.equal(rows[0].id, 'r1');
  assert.match(rows[0].solscanUrl, /solscan.io\/tx\//);
  assert.match(rows[0].solscanUrl, /cluster=devnet/);
  assert.equal(rows[2].solscanUrl, `https://solscan.io/tx/${signature}`);
  assert.equal(signatureOf({ txSignature: signature }), signature);
  assert.equal(swapPreview({ pay: '1', from: 'USDC', to: 'SOL', receive: '' }).lines[1].value, 'Quoted when you slide');
});
