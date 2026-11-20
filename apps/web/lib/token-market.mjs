import { SOLANA_CLUSTER, explorerClusterQuery } from '@ubc2026/contracts/solana';
/**
 * Token page chart math. Prices and token details come from DexScreener
 * in the browser (`dex-token.mjs`). This module does not sign or fetch.
 */

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const CHART_RANGES = Object.freeze(['1H', '1D', '1W', '1M', 'YTD', '1Y', 'All']);

export function solscanTokenUrl(mint, cluster = 'mainnet') {
  if (typeof mint !== 'string' || !MINT.test(mint)) return null;
  if (cluster === 'mainnet') return `https://solscan.io/token/${mint}`;
  if (['mainnet-beta', 'mainnet', 'devnet', 'testnet'].includes(cluster)) return `https://solscan.io/token/${mint}${explorerClusterQuery(cluster)}`;
  return null;
}

export function rangeMove(points) {
  if (!Array.isArray(points) || points.length < 2 || !(points[0].price > 0)) return null;
  const first = points[0].price;
  const last = points[points.length - 1].price;
  return {
    price: last,
    delta: last - first,
    pct: ((last - first) / first) * 100,
  };
}

export function formatTokenPrice(price) {
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return '';
  if (price >= 1000) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  if (price >= 0.01) return `$${price.toFixed(4)}`;
  if (price === 0) return '$0.00';
  return `$${price.toPrecision(2)}`;
}

export function formatCompactUsd(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '';
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return '';
}

export function formatCandleTime(unixSeconds, range) {
  const date = new Date(Number(unixSeconds) * 1000);
  if (Number.isNaN(date.getTime())) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = `${months[date.getUTCMonth()]} ${date.getUTCDate()}`;
  if (range === '1H' || range === '1D' || range === '1W') {
    const hour = String(date.getUTCHours()).padStart(2, '0');
    const minute = String(date.getUTCMinutes()).padStart(2, '0');
    return `${day} ${hour}:${minute} UTC`;
  }
  return `${day} ${date.getUTCFullYear()}`;
}

export function chartLayout(points, width, height, pad = 8) {
  if (!Array.isArray(points) || points.length < 2 || width < 32 || height < 32) return null;
  const inset = Number.isFinite(pad) ? Math.max(0, pad) : 0;
  const prices = points.map(point => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || Math.abs(max) || 1;
  const coords = points.map((point, index) => ({
    x: inset + (index / (points.length - 1)) * (width - inset * 2),
    y: inset + (1 - (point.price - min) / span) * (height - inset * 2),
    price: point.price,
    t: point.t,
  }));
  const d = coords.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const last = coords[coords.length - 1];
  const first = coords[0];
  return {
    d,
    area: `${d} L${last.x.toFixed(1)} ${height - pad} L${first.x.toFixed(1)} ${height - pad} Z`,
    coords,
    up: prices[prices.length - 1] >= prices[0],
  };
}

export function nearestCoord(coords, x) {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  let best = coords[0];
  let dist = Math.abs(best.x - x);
  for (const coord of coords) {
    const next = Math.abs(coord.x - x);
    if (next < dist) {
      best = coord;
      dist = next;
    }
  }
  return best;
}

export function combineHoldings(portfolio) {
  const map = new Map();
  const wallets = Array.isArray(portfolio?.wallets) ? portfolio.wallets : [];
  for (const wallet of wallets) {
    const rows = Array.isArray(wallet?.holdings) ? wallet.holdings : [];
    for (const row of rows) {
      if (!row || !MINT.test(row.mint)) continue;
      const amount = typeof row.amount === 'string' ? row.amount : '0';
      const usd = typeof row.usdMicro === 'string' ? row.usdMicro : '0';
      if (!/^(0|[1-9][0-9]*)$/.test(amount) || !/^(0|[1-9][0-9]*)$/.test(usd)) continue;
      const current = map.get(row.mint);
      if (!current) {
        map.set(row.mint, {
          mint: row.mint,
          symbol: row.symbol || 'Token',
          decimals: Number.isInteger(row.decimals) ? row.decimals : 0,
          amount,
          usdMicro: usd,
        });
        continue;
      }
      current.amount = (BigInt(current.amount) + BigInt(amount)).toString();
      current.usdMicro = (BigInt(current.usdMicro) + BigInt(usd)).toString();
    }
  }
  return [...map.values()].sort((a, b) => (BigInt(b.usdMicro) > BigInt(a.usdMicro) ? 1 : -1));
}
