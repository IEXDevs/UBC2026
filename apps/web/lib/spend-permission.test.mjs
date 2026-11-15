import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  netChangeSummary,
  managesFunds,
  parsePermission,
  permissionInstruction,
  transactionNeedsPerson,
} from './spend-permission.mjs';

test('full permissions manages funds and the other modes still wait', () => {
  assert.equal(parsePermission('full'), 'full');
  assert.equal(parsePermission('nope'), 'ask');
  assert.equal(managesFunds('full'), true);
  assert.equal(transactionNeedsPerson('full'), false);
  assert.equal(transactionNeedsPerson('ask'), true);
  assert.equal(transactionNeedsPerson('review'), true);
  assert.match(permissionInstruction('full'), /manage funds/);
  assert.match(permissionInstruction('full'), /Do not ask whether they are going to buy, sell, spend, or pay/);
  assert.match(permissionInstruction('review'), /review by AI/);
  assert.match(permissionInstruction('ask'), /ask every time/);
  assert.match(permissionInstruction('ask'), /mainnet price quote never authorizes/);
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
