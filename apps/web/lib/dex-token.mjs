/**
 * Browser DexScreener reads for token details and USD prices.
 * Profiles are cached per user. The spot price is never stored.
 * Calls stay on the visitor IP because DexScreener limits by IP.
 * This module does not sign.
 */

import { buildPortfolio, withKnownPegs } from './portfolio.mjs';
import {
  CHART_RANGES,
  rangeMove,
  solscanTokenUrl,
} from './token-market.mjs';

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PRICE = /^(0|[1-9]\d*)(\.\d+)?$/;
const BATCH = 30;
const MAX_MINTS = 60;

export const DEX_TOKEN_ORIGIN = 'https://api.dexscreener.com/tokens/v1/solana';

const CHANGE_WINDOW = Object.freeze({
  '1H': { key: 'h1', ms: 3_600_000, label: '1H' },
  '1D': { key: 'h24', ms: 86_400_000, label: '24H' },
  '1W': { key: 'h24', ms: 86_400_000, label: '24H' },
  '1M': { key: 'h24', ms: 86_400_000, label: '24H' },
  YTD: { key: 'h24', ms: 86_400_000, label: '24H' },
  '1Y': { key: 'h24', ms: 86_400_000, label: '24H' },
  All: { key: 'h24', ms: 86_400_000, label: '24H' },
});

export function dexCacheKey(userId) {
  const raw = typeof userId === 'string' ? userId.trim() : '';
  const safe = raw.replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 80);
  return `maelstrom.dex.v1.${safe || 'local'}`;
}

export function dexTokenUrl(mints) {
  const list = (Array.isArray(mints) ? mints : []).filter(mint => MINT.test(mint)).slice(0, BATCH);
  if (list.length === 0) return null;
  return `${DEX_TOKEN_ORIGIN}/${list.map(mint => encodeURIComponent(mint)).join(',')}`;
}

export function rateLimitCopy(url) {
  const dex = typeof url === 'string' && url.includes('api.dexscreener.com');
  if (dex) {
    return {
      id: 'rate-limit-dex',
      title: 'DexScreener rate limit',
      description: 'This network is limited. Saved token details stay on this device. Prices are not cached.',
      duration: 6400,
      closeButton: true,
    };
  }
  return {
    id: 'rate-limit',
    title: 'Rate limit',
    description: 'A request was limited. Wait a moment, then try again.',
    duration: 6400,
    closeButton: true,
  };
}

export function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (input && typeof input.url === 'string') return input.url;
  return '';
}

function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  return text.slice(0, max);
}

function httpsUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function priceChangeOf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const change = {};
  for (const key of ['m5', 'h1', 'h6', 'h24']) {
    const value = finiteNumber(raw[key]);
    if (value != null) change[key] = value;
  }
  return Object.keys(change).length ? change : null;
}

/** Cacheable token details. Spot price fields are dropped on purpose. */
export function toProfile(token) {
  if (!token || typeof token !== 'object') return null;
  const profile = {};
  const symbol = cleanText(token.symbol, 16);
  const name = cleanText(token.name, 64);
  const dexId = cleanText(token.dexId, 32);
  const quoteSymbol = cleanText(token.quoteSymbol, 16);
  const pairAddress = MINT.test(token.pairAddress) ? token.pairAddress : null;
  const imageUrl = httpsUrl(token.imageUrl);
  const url = httpsUrl(token.url);
  const liquidityUsd = finiteNumber(token.liquidityUsd);
  const marketCap = finiteNumber(token.marketCap);
  const fdv = finiteNumber(token.fdv);
  const priceChange = priceChangeOf(token.priceChange);
  if (symbol) profile.symbol = symbol;
  if (name) profile.name = name;
  if (dexId) profile.dexId = dexId;
  if (quoteSymbol) profile.quoteSymbol = quoteSymbol;
  if (pairAddress) profile.pairAddress = pairAddress;
  if (imageUrl) profile.imageUrl = imageUrl;
  if (url) profile.url = url;
  if (liquidityUsd != null && liquidityUsd >= 0) profile.liquidityUsd = liquidityUsd;
  if (marketCap != null && marketCap >= 0) profile.marketCap = marketCap;
  if (fdv != null && fdv >= 0) profile.fdv = fdv;
  if (priceChange) profile.priceChange = priceChange;
  return Object.keys(profile).length ? profile : null;
}

function livePrice(value) {
  return typeof value === 'string' && PRICE.test(value) ? value : null;
}

function pairRow(pair, mint) {
  if (!pair || pair.baseToken?.address !== mint) return null;
  if (pair.chainId && pair.chainId !== 'solana') return null;
  const profile = toProfile({
    symbol: pair.baseToken?.symbol,
    name: pair.baseToken?.name,
    dexId: pair.dexId,
    quoteSymbol: pair.quoteToken?.symbol,
    pairAddress: pair.pairAddress,
    imageUrl: pair.info?.imageUrl,
    url: pair.url,
    liquidityUsd: pair.liquidity?.usd,
    marketCap: pair.marketCap,
    fdv: pair.fdv,
    priceChange: pair.priceChange,
  });
  if (!profile) return null;
  return { ...profile, priceUsd: livePrice(pair.priceUsd), liquiditySort: finiteNumber(pair.liquidity?.usd) ?? 0 };
}

export function indexDexPairs(body, mints) {
  const wanted = new Set((Array.isArray(mints) ? mints : []).filter(mint => MINT.test(mint)));
  const rows = Array.isArray(body) ? body : [];
  const best = new Map();
  for (const pair of rows) {
    const mint = pair?.baseToken?.address;
    if (!wanted.has(mint)) continue;
    const row = pairRow(pair, mint);
    if (!row) continue;
    const current = best.get(mint);
    const betterPrice = row.priceUsd && !current?.priceUsd;
    const richer = row.liquiditySort >= (current?.liquiditySort ?? -1) && Boolean(row.priceUsd) === Boolean(current?.priceUsd || row.priceUsd);
    if (!current || betterPrice || richer) best.set(mint, row);
  }
  return best;
}

function readCache(storage, userId) {
  if (!storage || typeof storage.getItem !== 'function') return {};
  try {
    const parsed = JSON.parse(storage.getItem(dexCacheKey(userId)) || 'null');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const [mint, profile] of Object.entries(parsed)) {
      if (!MINT.test(mint)) continue;
      const clean = toProfile(profile);
      if (clean) out[mint] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

function writeCache(storage, userId, cache, live) {
  if (!storage || typeof storage.setItem !== 'function') return;
  const next = { ...cache };
  for (const [mint, row] of live) {
    const profile = toProfile(row);
    if (profile) next[mint] = profile;
  }
  try {
    storage.setItem(dexCacheKey(userId), JSON.stringify(next));
  } catch {
    /* A full disk leaves the previous cache in place. */
  }
}

export function memoryDexStorage() {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
  };
}

export async function readDexTokens({ mints, userId, storage, fetcher = fetch } = {}) {
  const unique = [];
  const seen = new Set();
  for (const mint of Array.isArray(mints) ? mints : []) {
    if (!MINT.test(mint) || seen.has(mint)) continue;
    seen.add(mint);
    unique.push(mint);
    if (unique.length >= MAX_MINTS) break;
  }
  const cache = readCache(storage, userId);
  const live = new Map();
  let rateLimited = false;
  for (let index = 0; index < unique.length && !rateLimited; index += BATCH) {
    const chunk = unique.slice(index, index + BATCH);
    const url = dexTokenUrl(chunk);
    let response;
    try {
      response = await fetcher(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      break;
    }
    if (response?.status === 429) {
      rateLimited = true;
      break;
    }
    if (!response?.ok) break;
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    for (const [mint, row] of indexDexPairs(body, chunk)) live.set(mint, row);
  }
  if (storage) writeCache(storage, userId, cache, live);
  const tokens = unique.map(mint => {
    const fresh = live.get(mint) || null;
    const profile = fresh ? toProfile(fresh) : (cache[mint] || null);
    return {
      mint,
      ...(profile || {}),
      priceUsd: fresh ? livePrice(fresh.priceUsd) : null,
      fromCache: !fresh && Boolean(profile),
    };
  });
  return { tokens, rateLimited };
}

export function windowPoints(price, pct, windowMs, now) {
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return [];
  const end = Number.isFinite(now) ? now : Date.now();
  const ratio = typeof pct === 'number' && Number.isFinite(pct) ? 1 + pct / 100 : 1;
  const start = ratio > 0 ? price / ratio : price;
  if (!Number.isFinite(start) || start < 0) return [];
  return [
    { t: Math.floor((end - windowMs) / 1000), price: start },
    { t: Math.floor(end / 1000), price },
  ];
}

export function dexTokenView({ mint, range = '1D', cluster = 'mainnet', token = null, now = Date.now() } = {}) {
  if (!MINT.test(mint) || !CHART_RANGES.includes(range)) return null;
  const spec = CHANGE_WINDOW[range];
  const priceUsd = livePrice(token?.priceUsd);
  const price = priceUsd == null ? null : Number(priceUsd);
  const pct = finiteNumber(token?.priceChange?.[spec.key]);
  const points = price == null ? [] : windowPoints(price, pct, spec.ms, now);
  const move = rangeMove(points);
  const symbol = token?.symbol || mint.slice(0, 4);
  const cached = token?.fromCache === true;
  return {
    mint,
    symbol,
    name: token?.name || symbol,
    dexId: token?.dexId || null,
    imageUrl: token?.imageUrl || null,
    pairUrl: token?.url || null,
    liquidityUsd: finiteNumber(token?.liquidityUsd),
    marketCap: finiteNumber(token?.marketCap),
    solscanUrl: solscanTokenUrl(mint, cluster),
    points,
    price,
    changePct: move?.pct ?? null,
    changeLabel: spec.label,
    range,
    quoteSource: 'dexscreener',
    fromCache: cached,
    note: cached
      ? 'Saved token details. The price waits on DexScreener. devnet execution, mainnet pricing. This does not authorize a transaction.'
      : 'DexScreener price. devnet execution, mainnet pricing. This does not authorize a transaction.',
  };
}

export function portfolioWithDex(portfolio, tokens = []) {
  if (!portfolio || (portfolio.cluster !== 'mainnet' && portfolio.cluster !== 'devnet' && portfolio.cluster !== 'testnet')) {
    return portfolio;
  }
  const prices = {};
  const symbols = {};
  for (const token of tokens) {
    if (!token || !MINT.test(token.mint)) continue;
    const price = livePrice(token.priceUsd);
    if (price) prices[token.mint] = price;
    if (typeof token.symbol === 'string' && token.symbol.trim()) symbols[token.mint] = token.symbol.trim().slice(0, 16);
  }
  const rebuilt = buildPortfolio({
    cluster: portfolio.cluster,
    wallets: (portfolio.wallets || []).map(wallet => ({
      address: wallet.address,
      label: wallet.label,
      walletClientType: wallet.client,
      spendable: wallet.spendable === true,
      tokens: (wallet.holdings || []).map(row => ({
        mint: row.mint,
        amount: row.amount,
        decimals: row.decimals,
      })),
    })),
    prices: withKnownPegs(portfolio.cluster, prices),
  });
  const paint = row => (symbols[row.mint] ? { ...row, symbol: symbols[row.mint] } : row);
  return {
    ...rebuilt,
    truncated: portfolio.truncated === true,
    fetchedAt: portfolio.fetchedAt,
    slices: rebuilt.slices.map(paint),
    wallets: rebuilt.wallets.map(wallet => ({
      ...wallet,
      holdings: wallet.holdings.map(paint),
    })),
  };
}

export async function enrichPortfolio(portfolio, options = {}) {
  const mints = [];
  for (const wallet of portfolio?.wallets || []) {
    for (const row of wallet.holdings || []) mints.push(row.mint);
  }
  if (mints.length === 0) return { portfolio, rateLimited: false };
  try {
    const book = await readDexTokens({ mints, ...options });
    return { portfolio: portfolioWithDex(portfolio, book.tokens), rateLimited: book.rateLimited };
  } catch {
    return { portfolio, rateLimited: false };
  }
}
