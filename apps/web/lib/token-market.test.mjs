import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHART_RANGES,
  chartLayout,
  combineHoldings,
  formatCandleTime,
  formatCompactUsd,
  formatTokenPrice,
  nearestCoord,
  rangeMove,
  solscanTokenUrl,
} from './token-market.mjs';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

test('chart ranges and solscan links stay on the token page', () => {
  assert.deepEqual(CHART_RANGES, ['1H', '1D', '1W', '1M', 'YTD', '1Y', 'All']);
  assert.equal(solscanTokenUrl(USDC), `https://solscan.io/token/${USDC}`);
  assert.match(solscanTokenUrl(USDC, 'devnet'), /cluster=devnet$/);
  assert.equal(solscanTokenUrl('nope'), null);
  assert.equal(formatCompactUsd(2_500_000), '$2.50M');
});

test('candles move and pick the hovered point', () => {
  const points = [{ t: 100, price: 1 }, { t: 200, price: 1.02 }];
  const move = rangeMove(points);
  assert.equal(move.price, 1.02);
  assert.ok(move.pct > 0);
  const layout = chartLayout(points, 120, 48);
  assert.equal(layout.up, true);
  assert.equal(nearestCoord(layout.coords, 0).price, 1);
  assert.equal(nearestCoord(layout.coords, 120).price, 1.02);
  assert.equal(formatTokenPrice(1), '$1.00');
  assert.equal(formatCandleTime(1_700_000_000, '1D'), 'Nov 14 22:13 UTC');
});

test('holdings from several wallets add by mint', () => {
  const rows = combineHoldings({
    wallets: [
      { holdings: [{ mint: USDC, symbol: 'USDC', decimals: 6, amount: '10', usdMicro: '100' }] },
      { holdings: [{ mint: USDC, symbol: 'USDC', decimals: 6, amount: '5', usdMicro: '50' }] },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, '15');
  assert.equal(rows[0].usdMicro, '150');
});
