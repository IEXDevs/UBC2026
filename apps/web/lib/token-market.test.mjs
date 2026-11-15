import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHART_RANGES,
  TokenMarketError,
  chartLayout,
  combineHoldings,
  formatCandleTime,
  formatTokenPrice,
  geckoQuery,
  jupiterTrustScore,
  loadTokenMarket,
  nearestCoord,
  parseOhlcv,
  rangeMove,
  solscanTokenUrl,
} from './token-market.mjs';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const POOL = 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE';

test('chart ranges and the jupiter score stay on a 0 to 100 scale', () => {
  assert.deepEqual(CHART_RANGES, ['1H', '1D', '1W', '1M', 'YTD', '1Y', 'All']);
  assert.equal(geckoQuery('nope'), null);
  assert.equal(geckoQuery('1H').timeframe, 'minute');
  assert.equal(geckoQuery('YTD', Date.UTC(2026, 10, 14)).timeframe, 'day');
  assert.equal(jupiterTrustScore({ organicScore: 100 }), 100);
  assert.equal(jupiterTrustScore({ organicScore: 72.4 }), 72);
  assert.equal(jupiterTrustScore({ organicScore: 140 }), 100);
  assert.equal(jupiterTrustScore({}), null);
  assert.equal(solscanTokenUrl(USDC), `https://solscan.io/token/${USDC}`);
  assert.match(solscanTokenUrl(USDC, 'devnet'), /cluster=devnet$/);
});

test('candles sort, move, and pick the hovered point', () => {
  const points = parseOhlcv([
    [200, 1, 1, 1, 1.02, 0],
    [100, 1, 1, 1, 1, 0],
    [100, 9, 9, 9, 9, 0],
    ['bad'],
  ]);
  assert.deepEqual(points, [{ t: 100, price: 1 }, { t: 200, price: 1.02 }]);
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

test('token market reads jupiter and the dex pool without signing', async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    if (url.includes('api.jup.ag')) {
      return Response.json([{ id: USDC, symbol: 'USDC', name: 'USD Coin', organicScore: 100 }]);
    }
    if (url.includes('/pools?')) {
      return Response.json({
        data: [{
          id: `solana_${POOL}`,
          relationships: { base_token: { data: { id: `solana_${USDC}` } } },
        }],
      });
    }
    return Response.json({
      data: { attributes: { ohlcv_list: [[100, 1, 1, 1, 1, 1], [200, 1, 1, 1, 1.01, 1]] } },
    });
  };
  const view = await loadTokenMarket({ mint: USDC, range: '1D', fetcher });
  assert.equal(view.symbol, 'USDC');
  assert.equal(view.trustScore, 100);
  assert.equal(view.points.length, 2);
  assert.equal(view.price, 1.01);
  assert.match(view.solscanUrl, /solscan.io\/token\//);
  assert.equal(calls.some(url => url.includes('sendTransaction')), false);
  assert.match(view.note, /devnet execution, mainnet pricing/);
});

test('a quote-side pool falls through to the token market chart', async () => {
  const fetcher = async (url) => {
    if (url.includes('api.jup.ag')) return Response.json([{ id: USDC, symbol: 'USDC', name: 'USD Coin', organicScore: 88 }]);
    if (url.includes('/pools?')) {
      return Response.json({
        data: [{ relationships: { base_token: { data: { id: 'solana_So11111111111111111111111111111111111111112' } } } }],
      });
    }
    if (url.includes('coingecko')) {
      return Response.json({ prices: [[1_700_000_000_000, 1], [1_700_003_600_000, 1.002]] });
    }
    return Response.json({});
  };
  const view = await loadTokenMarket({ mint: USDC, range: '1D', fetcher, now: 1_700_003_600_000 });
  assert.equal(view.price, 1.002);
  assert.match(view.note, /Market candles/);
});

test('a missing mint is refused before any request', async () => {
  let called = false;
  await assert.rejects(
    () => loadTokenMarket({ mint: 'nope', fetcher: async () => { called = true; return new Response('{}'); } }),
    error => error instanceof TokenMarketError && error.code === 'invalid_mint',
  );
  assert.equal(called, false);
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
