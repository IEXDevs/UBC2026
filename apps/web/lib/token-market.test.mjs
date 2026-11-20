import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

/**
 * Achieves: verifies chart range labels, Solscan token URLs, and compact USD formatting.
 * Fails when: ranges reorder, invalid mint links, or $2.50M format drifts.
 * Oracle: CHART_RANGES fixed list; USDC solscan URL; invalid mint → null; 2.5e6 → $2.50M.
 * Side effects / state checked: N/A.
 * Gaps: none for URL/format helpers.
 */
test('chart ranges and solscan links stay on the token page', () => {
  assert.deepEqual(CHART_RANGES, ['1H', '1D', '1W', '1M', 'YTD', '1Y', 'All']);
  assert.equal(solscanTokenUrl(USDC), `https://solscan.io/token/${USDC}`);
  assert.equal(new URL(solscanTokenUrl(USDC, 'mainnet-beta')).search, '');
  assert.equal(solscanTokenUrl('nope'), null);
  assert.equal(formatCompactUsd(2_500_000), '$2.50M');
});

/**
 * Achieves: verifies candle range move, layout up flag, hover nearest point, and time formatting.
 * Fails when: pct ≤ 0 on rising series, nearest ends pick wrong prices, or UTC label drifts.
 * Oracle: points 1→1.02; nearest at 0/120; formatCandleTime fixed epoch → Nov 14 22:13 UTC.
 * Side effects / state checked: N/A.
 * Gaps: none for chart helpers; live price feeds not used.
 */
test('candles move and pick the hovered point', () => {
  const points = [{ t: 100, price: 1 }, { t: 200, price: 1.02 }];
  const move = rangeMove(points);
  assert.equal(move.price, 1.02);
  assert.ok(move.pct > 0);
  const layout = chartLayout(points, 120, 48);
  assert.equal(layout.up, true);
  assert.equal(nearestCoord(layout.coords, 0).price, 1);
  assert.equal(nearestCoord(layout.coords, 120).price, 1.02);
  const edge = chartLayout(points, 120, 48, 0);
  assert.equal(edge.coords[0].x, 0);
  assert.equal(edge.coords[1].x, 120);
  assert.equal(edge.coords[0].y, 48);
  assert.equal(edge.coords[1].y, 0);
  assert.equal(formatTokenPrice(1), '$1.00');
  assert.equal(formatCandleTime(1_700_000_000, '1D'), 'Nov 14 22:13 UTC');
});

/**
 * Achieves: verifies holdings across wallets combine by mint for amount and usdMicro.
 * Fails when: duplicate mints stay separate or sums are string-concatenated wrongly.
 * Oracle: 10+5 → amount 15; usdMicro 150; single row.
 * Side effects / state checked: N/A.
 * Gaps: none for combineHoldings.
 */
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

/**
 * Achieves: verifies a new chart range draws in instead of snapping.
 * Fails when: the line no longer uses pathLength or the site ease.
 * Oracle: TokenChart.js contains pathLength and [0.22, 1, 0.36, 1].
 * Side effects / state checked: source of the chart component.
 * Gaps: no browser frame timing.
 */
test('a new chart range draws the line in', () => {
  const chart = readFileSync(new URL('../components/TokenChart.js', import.meta.url), 'utf8');
  assert.match(chart, /pathLength: 0/);
  assert.match(chart, /pathLength: 1/);
  assert.match(chart, /\[0\.22, 1, 0\.36, 1\]/);
  assert.match(chart, /mode="wait"/);
  assert.match(chart, /preserveAspectRatio="none"/);
  assert.match(chart, /chartLayout\(points, width, height, 0\)/);
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.token-chart \{[\s\S]*margin-inline: calc\(var\(--wallet-pad-x, 22px\) \* -1\)/);
});
