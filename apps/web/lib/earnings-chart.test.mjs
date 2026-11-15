import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOL_MINT } from './portfolio.mjs';
import { describePositions } from './money-views.mjs';
import { layoutPositionBook } from './position-book.mjs';
import { chartLine } from './wallet-desk.mjs';
import {
  PAPER_PNL_LABEL,
  buildEarningsSeries,
  mergeConnectedPositions,
} from './earnings-chart.mjs';

const PHANTOM = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const SOLFLARE = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const paper = {
  id: 'pos_sol',
  botId: 'bot_positions',
  asset: 'SOL',
  amount: '1000000000',
  decimals: 9,
  pnlMicroUsdc: '-1500000',
  quoteSource: 'jupiter',
  venue: 'Jupiter',
  market: 'mainnet price',
  side: 'long',
};

function portfolio() {
  return {
    cluster: 'mainnet',
    authorizesTransaction: false,
    broadcast: false,
    priceLabel: PAPER_PNL_LABEL,
    wallets: [
      {
        address: PHANTOM,
        label: 'Phantom',
        client: 'phantom',
        spendable: false,
        holdings: [
          { mint: SOL_MINT, symbol: 'SOL', amount: '2000000000', decimals: 9, usdMicro: '200000000' },
        ],
      },
      {
        address: SOLFLARE,
        label: 'Solflare',
        client: 'solflare',
        spendable: false,
        holdings: [
          { mint: SOL_MINT, symbol: 'SOL', amount: '500000000', decimals: 9, usdMicro: '50000000' },
        ],
      },
      {
        address: 'So11111111111111111111111111111111111111112',
        label: 'Main',
        client: 'privy',
        spendable: true,
        holdings: [
          { mint: SOL_MINT, symbol: 'SOL', amount: '9000000000', decimals: 9, usdMicro: '900000000' },
        ],
      },
    ],
  };
}

test('earnings chart is paper PnL and does not authorize a transaction', () => {
  const series = buildEarningsSeries({
    positions: [paper, { id: 'balance', source: 'connected-balance', readOnly: true, pnlMicroUsdc: '9000000' }],
    payments: [
      { direction: 'earned', amount: '1000000', asset: 'USDC', createdAt: 20 },
      { direction: 'paid', amount: '250000', asset: 'USDC', createdAt: 10 },
    ],
    transfers: [{ direction: 'in', amount: '500000', asset: 'USDC', createdAt: 30 }],
  });
  assert.equal(series.broadcast, false);
  assert.equal(series.authorizesTransaction, false);
  assert.equal(series.paperPnl, true);
  assert.equal(series.label, PAPER_PNL_LABEL);
  assert.match(series.caption, /devnet execution, mainnet pricing/);
  assert.match(series.caption, /does not authorize a transaction/);
  assert.deepEqual(series.points.map(point => point.micro), ['0', '-250000', '750000', '1250000', '-250000']);
  assert.equal(series.totalMicro, '-250000');
  const line = chartLine(series.values);
  assert.ok(line);
  assert.equal(line.up, false);
});

test('connected wallets add read-only mainnet balances and keep paper lots', () => {
  const merged = mergeConnectedPositions({
    positions: [paper],
    wallets: [{ id: 'wallet_main', label: 'Main', address: 'So11111111111111111111111111111111111111112', kind: 'main' }],
    portfolio: portfolio(),
  });
  assert.equal(merged.broadcast, false);
  assert.equal(merged.authorizesTransaction, false);
  assert.equal(merged.label, PAPER_PNL_LABEL);
  assert.equal(merged.positions[0].id, 'pos_sol');
  assert.equal(merged.positions.length, 3);
  const phantom = merged.positions.find(row => row.holder === 'Phantom');
  const solflare = merged.positions.find(row => row.holder === 'Solflare');
  assert.equal(phantom.market, 'mainnet price');
  assert.equal(phantom.broadcast, false);
  assert.equal(phantom.readOnly, true);
  assert.equal(phantom.pnlMicroUsdc, '0');
  assert.equal(phantom.amount, '2000000000');
  assert.equal(solflare.walletId.startsWith('connected_'), true);
  assert.equal(merged.positions.some(row => row.holder === 'Main' && row.source === 'connected-balance'), false);
  assert.equal(merged.wallets.find(wallet => wallet.label === 'Phantom').readOnly, true);
  assert.equal(merged.wallets.find(wallet => wallet.label === 'Phantom').spendable, false);

  const again = mergeConnectedPositions({
    positions: merged.positions,
    wallets: merged.wallets,
    portfolio: portfolio(),
  });
  assert.equal(again.positions.length, 3);

  const described = describePositions(merged.positions, [{ id: 'bot_positions', name: 'Position guard' }]);
  assert.equal(described[0].botName, 'Position guard');
  assert.equal(described.find(row => row.asset === 'SOL' && row.botName === 'Phantom').market, 'mainnet price');
  assert.match(described.find(row => row.botName === 'Phantom').note, /devnet execution, mainnet pricing/);

  const book = layoutPositionBook(merged.positions, [], merged.wallets);
  const node = book.wallets.find(wallet => wallet.label === 'Phantom');
  assert.equal(node.readOnly, true);
  assert.equal(book.cards.filter(card => card.walletId === node.id).length, 1);
  assert.equal(book.cards.find(card => card.holder === 'Phantom' || card.botName === 'Phantom').market, 'mainnet price');
});

test('a quote that authorizes a transaction does not add balances', () => {
  const merged = mergeConnectedPositions({
    positions: [paper],
    wallets: [],
    portfolio: { ...portfolio(), authorizesTransaction: true },
  });
  assert.equal(merged.positions.length, 1);
  assert.equal(merged.positions[0].id, 'pos_sol');
  assert.equal(merged.authorizesTransaction, false);
  assert.equal(merged.broadcast, false);
});
