import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOL_MINT } from './portfolio.mjs';
import { layoutPositionBook } from './position-book.mjs';
import { buildEarningsSeries, mergeWalletPositions } from './earnings-chart.mjs';

const PHANTOM = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV';
const EMBEDDED = '11111111111111111111111111111111';
const RUNTIME_WALLET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL = { mint: SOL_MINT, symbol: 'SOL', amount: '2000000000', decimals: 9, usdMicro: '200000000' };

test('the earnings line only includes confirmed USDC movements on the active network', () => {
  const confirmed = { streamConfirmed: true, cluster: 'mainnet-beta', asset: 'USDC' };
  const outgoing = { ...confirmed, direction: 'paid', amount: '1250000', txSignature: '5'.repeat(64), createdAt: 10 };
  const incoming = { ...confirmed, direction: 'earned', amount: '1000000', txSignature: '6'.repeat(64), createdAt: 20 };
  const series = buildEarningsSeries({ payments: [
    incoming, outgoing, outgoing,
    { ...incoming, txSignature: '7'.repeat(64), cluster: 'devnet' },
    { ...incoming, txSignature: '8'.repeat(64), streamConfirmed: false },
  ], transfers: [{ direction: 'in', amount: '100000000' }] });
  assert.deepEqual(series.points.map(point => point.micro), ['0', '-1250000', '-250000']);
  assert.equal(series.label, 'Net USDC flow');
  assert.equal(buildEarningsSeries({ payments: [{ ...incoming, txSignature: '' }] }), null);
});

test('the positions book shows chain balances for linked and runtime wallets without inventing PnL', () => {
  const wallets = [
    { id: 'embedded', address: EMBEDDED, label: 'Main' },
    { id: 'agent', address: RUNTIME_WALLET, label: 'Agent wallet', holdings: [
      { ...SOL, asset: 'SOL', mint: null, amount: '1000000000', cluster: 'mainnet-beta' },
      { ...SOL, cluster: 'testnet', amount: '5000000000' },
    ] },
  ];
  const portfolio = { cluster: 'mainnet', authorizesTransaction: false, wallets: [
    { address: EMBEDDED, client: 'privy', holdings: [SOL] },
    { address: PHANTOM, label: 'Phantom', client: 'phantom', holdings: [SOL] },
  ] };
  const { positions, wallets: merged } = mergeWalletPositions({
    wallets, portfolio, positions: [{ id: 'old-paper-lot', amount: '99' }],
  });
  assert.equal(positions.length, 3);
  assert.equal(positions.find(position => position.walletId === 'embedded').amount, SOL.amount);
  assert.equal(positions.find(position => position.walletId === 'agent').amount, '1000000000');
  assert.equal(positions.find(position => position.holder === 'Phantom').readOnly, true);
  assert.equal(merged.find(wallet => wallet.address === EMBEDDED).readOnly, undefined);
  const book = layoutPositionBook(positions, [], merged);
  assert.equal(book.summary.pnlLabel, null);
  assert.ok(book.cards.every(card => card.pnlLabel === null));
  assert.equal(mergeWalletPositions({ wallets, portfolio: { ...portfolio, cluster: 'testnet' } }).positions.length, 1);
  assert.equal(mergeWalletPositions({ portfolio: { ...portfolio, authorizesTransaction: true } }).positions.length, 0);
});
