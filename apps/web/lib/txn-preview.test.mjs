import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logRows, sendPreview, signatureOf, swapPreview } from './txn-preview.mjs';

test('a send preview names the wallet, destination, and amount', () => {
  const preview = sendPreview({ from: 'Main', to: '@alex', amountLabel: '1.5 USDC' });
  assert.equal(preview.title, 'Send 1.5 USDC');
  assert.deepEqual(preview.lines.map(line => line.label), ['From', 'To', 'Amount', 'Network']);
  assert.equal(preview.lines[1].value, '@alex');
});

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
