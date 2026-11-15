import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flowName, partyBook, partyFromToken, signedUsdc } from './party-book.mjs';

test('a handle book totals money in, money out, and the net', () => {
  assert.equal(partyFromToken('@Bob').handle, 'bob');
  assert.equal(partyFromToken('not a handle'), null);
  const book = partyBook({
    party: partyFromToken('@bob'),
    transfers: [
      { id: 'in1', handle: 'bob', amount: '5000000', asset: 'USDC', direction: 'in' },
      { id: 'out1', handle: 'bob', amount: '1000000', asset: 'USDC', direction: 'out' },
      { id: 'other', handle: 'ada', amount: '9000000', asset: 'USDC', direction: 'in' },
    ],
    payments: [
      { id: 'pay1', counterparty: '@bob', direction: 'paid', amount: '2000000', asset: 'USDC', protocol: 'x402', cluster: 'devnet' },
    ],
  });
  assert.equal(book.inbound, '5000000');
  assert.equal(book.outbound, '3000000');
  assert.equal(book.net, '2000000');
  assert.deepEqual(book.rows.map(row => row.id), ['in1', 'out1', 'pay1']);
  assert.equal(signedUsdc(book.net), '+2');
  assert.equal(signedUsdc('-1000000'), '−1');
  assert.equal(flowName('in'), 'is-in');
  assert.equal(flowName('out'), 'is-out');
});
