/**
 * Token page view model. Jupiter supplies the 0–100 score.
 * Candles come from a DEX pool. This module does not sign.
 */

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const JUPITER = 'https://api.jup.ag/tokens/v2/search';
const GECKO = 'https://api.geckoterminal.com/api/v2/networks/solana';

export const CHART_RANGES = Object.freeze(['1H', '1D', '1W', '1M', 'YTD', '1Y', 'All']);

export class TokenMarketError extends Error {
  constructor(code) {
    super(code);
    this.name = 'TokenMarketError';
    this.code = code;
  }
}

export function geckoQuery(range, now = Date.now()) {
  if (range === '1H') return { timeframe: 'minute', aggregate: 1, limit: 60 };
  if (range === '1D') return { timeframe: 'minute', aggregate: 5, limit: 288 };
  if (range === '1W') return { timeframe: 'hour', aggregate: 1, limit: 168 };
  if (range === '1M') return { timeframe: 'hour', aggregate: 4, limit: 180 };
  if (range === '1Y') return { timeframe: 'day', aggregate: 1, limit: 365 };
  if (range === 'All') return { timeframe: 'day', aggregate: 1, limit: 1000 };
  if (range === 'YTD') {
    const start = Date.UTC(new Date(now).getUTCFullYear(), 0, 1);
    const days = Math.max(2, Math.ceil((now - start) / 86_400_000) + 1);
    return { timeframe: 'day', aggregate: 1, limit: Math.min(366, days) };
  }
  return null;
}

export function jupiterTrustScore(token) {
  const value = token?.organicScore;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function solscanTokenUrl(mint, cluster = 'mainnet') {
  if (typeof mint !== 'string' || !MINT.test(mint)) return null;
  if (cluster === 'mainnet') return `https://solscan.io/token/${mint}`;
  if (cluster === 'devnet' || cluster === 'testnet') return `https://solscan.io/token/${mint}?cluster=${cluster}`;
  return null;
}

export function parseOhlcv(list) {
  if (!Array.isArray(list)) return [];
  const points = [];
  const seen = new Set();
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const t = Number(row[0]);
    const price = Number(row[4]);
    if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(price) || price < 0) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    points.push({ t, price });
  }
  points.sort((a, b) => a.t - b.t);
  return points;
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
  const prices = points.map(point => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || Math.abs(max) || 1;
  const coords = points.map((point, index) => ({
    x: pad + (index / (points.length - 1)) * (width - pad * 2),
    y: pad + (1 - (point.price - min) / span) * (height - pad * 2),
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

export function poolAddress(pool) {
  const id = typeof pool?.id === 'string' ? pool.id : '';
  const address = id.startsWith('solana_') ? id.slice('solana_'.length) : '';
  return MINT.test(address) ? address : null;
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

async function readJson(fetcher, url) {
  let response;
  try {
    response = await fetcher(url, {
      headers: {
        Accept: 'application/json;version=20230203',
        'User-Agent': 'maelstrom/0.1',
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return null;
  }
  if (!response?.ok) return null;
  try { return await response.json(); } catch { return null; }
}

function coinGeckoDays(range, now) {
  if (range === '1H' || range === '1D') return '1';
  if (range === '1W') return '7';
  if (range === '1M') return '30';
  if (range === '1Y') return '365';
  if (range === 'All') return 'max';
  const start = Date.UTC(new Date(now).getUTCFullYear(), 0, 1);
  return String(Math.max(2, Math.ceil((now - start) / 86_400_000)));
}

export function parseMarketChart(prices, range, now = Date.now()) {
  if (!Array.isArray(prices)) return [];
  const cutoff = range === '1H' ? now - 3_600_000 : 0;
  const points = [];
  for (const row of prices) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const t = Number(row[0]);
    const price = Number(row[1]);
    if (!Number.isFinite(t) || t < cutoff || !Number.isFinite(price) || price < 0) continue;
    points.push({ t: Math.floor(t / 1000), price });
  }
  points.sort((a, b) => a.t - b.t);
  return points;
}

function matchingPool(pools, mint) {
  if (!Array.isArray(pools)) return null;
  for (const pool of pools) {
    const base = pool?.relationships?.base_token?.data?.id;
    if (base === `solana_${mint}`) return poolAddress(pool);
  }
  return null;
}

export async function loadTokenMarket({ mint, range = '1D', cluster = 'mainnet', fetcher = fetch, now = Date.now() } = {}) {
  if (typeof mint !== 'string' || !MINT.test(mint)) throw new TokenMarketError('invalid_mint');
  const spec = geckoQuery(range, now);
  if (!spec) throw new TokenMarketError('invalid_range');
  const [jupiterBody, poolsBody] = await Promise.all([
    readJson(fetcher, `${JUPITER}?query=${encodeURIComponent(mint)}`),
    readJson(fetcher, `${GECKO}/tokens/${mint}/pools?page=1`),
  ]);
  const rows = Array.isArray(jupiterBody) ? jupiterBody : [];
  const token = rows.find(row => row && row.id === mint) ?? null;
  const pool = matchingPool(poolsBody?.data, mint);
  let points = [];
  let source = 'none';
  if (pool) {
    const query = `aggregate=${spec.aggregate}&limit=${spec.limit}&currency=usd`;
    const candles = await readJson(fetcher, `${GECKO}/pools/${pool}/ohlcv/${spec.timeframe}?${query}`);
    points = parseOhlcv(candles?.data?.attributes?.ohlcv_list);
    if (points.length > 1) source = 'dex';
  }
  if (points.length < 2) {
    const days = coinGeckoDays(range, now);
    const chart = await readJson(
      fetcher,
      `https://api.coingecko.com/api/v3/coins/solana/contract/${mint}/market_chart?vs_currency=usd&days=${days}`,
    );
    const market = parseMarketChart(chart?.prices, range, now);
    if (market.length > 1) {
      points = market;
      source = 'market';
    }
  }
  const move = rangeMove(points);
  const symbol = typeof token?.symbol === 'string' && token.symbol.trim()
    ? token.symbol.trim()
    : (mint.slice(0, 4));
  const name = typeof token?.name === 'string' && token.name.trim() ? token.name.trim() : symbol;
  const candleNote = source === 'dex'
    ? 'DEX candles.'
    : source === 'market'
      ? 'Market candles.'
      : 'No candles for this mint.';
  return {
    mint,
    symbol,
    name,
    trustScore: jupiterTrustScore(token),
    solscanUrl: solscanTokenUrl(mint, cluster),
    points,
    price: move?.price ?? (points.at(-1)?.price ?? null),
    changePct: move?.pct ?? null,
    range,
    note: `${candleNote} devnet execution, mainnet pricing. This does not authorize a transaction.`,
  };
}
