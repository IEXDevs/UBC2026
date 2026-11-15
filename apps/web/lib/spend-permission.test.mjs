import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  netChangeSummary,
  parsePermission,
  permissionInstruction,
  transactionNeedsPerson,
} from './spend-permission.mjs';

test('permission defaults to ask and transactions always wait', () => {
  assert.equal(parsePermission('full'), 'full');
  assert.equal(parsePermission('nope'), 'ask');
  assert.equal(transactionNeedsPerson('full'), true);
  assert.match(permissionInstruction('full'), /never sent until the owner confirms/);
  assert.match(permissionInstruction('review'), /review by AI/);
  assert.match(permissionInstruction('ask'), /ask every time/);
});

test('a send summary shows the outflow and the net', () => {
  const summary = netChangeSummary({ amount: '5000000', asset: 'USDC', handle: 'bob' });
  assert.equal(summary.title, 'Send to @bob');
  assert.deepEqual(summary.lines, [{ label: 'USDC', signed: '−5' }]);
  assert.equal(summary.net, '−5 USDC');
});

test('swap legs keep each asset and net the USDC side', () => {
  const summary = netChangeSummary({
    asset: 'USDC',
    legs: [
      { symbol: 'USDC', amount: '5000000', direction: 'out' },
      { symbol: 'SOL', amount: '21000000', direction: 'in' },
    ],
  });
  assert.equal(summary.lines[0].signed, '−5');
  assert.equal(summary.lines[1].label, 'SOL');
  assert.equal(summary.net, '−5 USDC');
});
