import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logRows, sendPreview, swapPreview } from './txn-preview.mjs';

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
 * Achieves: verifies the log keeps money movement rows and omits generic activity.
 * Fails when: non-money events leak, a duplicate stream event appears, or a Solscan link is missing.
 * Oracle: receipts, payments, ledger transfers, and money movement events in time order.
 * Side effects / state checked: N/A.
 * Gaps: does not render the Logs panel.
 */
test('log rows keep a timestamp, the transfer, and a solscan link', () => {
  const signature = '5'.repeat(64);
  const deposit = '6'.repeat(64);
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
    transfers: [{ id: 't1', amount: '2500000', direction: 'in', handle: 'alex', at: '2026-11-15T03:30:00.000Z' }],
    events: [
      { id: `stream:${deposit}`, kind: 'tx.confirmed', at: '2026-11-15T03:00:00.000Z', summary: 'Stream deposit' },
      { id: `stream:${signature}`, kind: 'tx.confirmed' },
      { id: 'refund', kind: 'funds.grabbed', at: '2026-11-15T02:00:00.000Z' },
      { id: 'tool', kind: 'tool.call' },
      { id: 'approval', kind: 'approval.requested' },
      { id: 'http', action: 'POST /api/spend', status: 200 },
    ],
  });
  assert.equal(rows[0].id, 'r1');
  assert.match(rows[0].solscanUrl, /solscan.io\/tx\//);
  assert.match(rows[0].solscanUrl, /cluster=devnet/);
  assert.deepEqual(rows.map(row => row.id), ['r1', 'p1', 't1', `stream:${deposit}`, 'refund']);
  assert.equal(rows[2].solscanUrl, null);
  assert.equal(rows[3].solscanUrl, `https://solscan.io/tx/${deposit}?cluster=devnet`);
  assert.equal(rows[3].lines[0].value, 'Stream deposit');
  assert.equal(swapPreview({ pay: '1', from: 'USDC', to: 'SOL', receive: '' }).lines[1].value, 'Quoted when you slide');
});
