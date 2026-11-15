/**
 * Mainnet price reads for paper PnL / research.
 * Execution stays on Solana devnet; these quotes are labeled as mainnet pricing.
 */
export class PriceError extends Error {
  constructor(code, status = 502) { super(code); this.code = code; this.status = status; }
}

const mintPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function assertMint(mint) {
  if (typeof mint !== 'string' || !mintPattern.test(mint)) throw new PriceError('invalid_mint', 400);
  return mint;
}

/**
 * DexScreener free tokens endpoint. No API key.
 * Picks the highest-liquidity USD-priced pair for the mint.
 */
export function createDexScreenerPriceProvider({
  fetcher = fetch,
  baseUrl = 'https://api.dexscreener.com/tokens/v1/solana',
} = {}) {
  return async function lookupPrice(mint) {
    assertMint(mint);
    let response;
    try {
      response = await fetcher(`${baseUrl}/${encodeURIComponent(mint)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new PriceError('provider_unavailable');
    }
    if (!response.ok) {
      throw new PriceError(response.status === 429 ? 'provider_rate_limited' : 'provider_failed', response.status === 429 ? 429 : 502);
    }
    let pairs;
    try { pairs = await response.json(); } catch { throw new PriceError('invalid_provider_response'); }
    if (!Array.isArray(pairs) || pairs.length < 1) throw new PriceError('price_not_found', 404);

    const scored = pairs
      .filter(pair => pair && pair.baseToken?.address === mint && typeof pair.priceUsd === 'string' && pair.priceUsd.length > 0)
      .map(pair => ({
        pair,
        liquidityUsd: typeof pair.liquidity?.usd === 'number' ? pair.liquidity.usd : 0,
      }))
      .sort((a, b) => b.liquidityUsd - a.liquidityUsd);

    const best = scored[0]?.pair;
    if (!best) throw new PriceError('price_not_found', 404);
    const priceUsd = best.priceUsd;
    if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(priceUsd)) throw new PriceError('invalid_provider_response');

    return {
      mint,
      priceUsd,
      quoteSource: 'dexscreener',
      pricingCluster: 'mainnet',
      executionCluster: 'devnet',
      label: 'devnet execution, mainnet pricing',
      pairAddress: typeof best.pairAddress === 'string' ? best.pairAddress : null,
      liquidityUsd: typeof best.liquidity?.usd === 'number' ? best.liquidity.usd : null,
      fetchedAt: new Date().toISOString(),
    };
  };
}

export const PRICE_LABEL = 'devnet execution, mainnet pricing';
const FALLBACK_CODES = new Set([
  'price_not_found',
  'provider_unavailable',
  'provider_failed',
  'provider_rate_limited',
  'invalid_provider_response',
]);

/**
 * Decimal string for a finite USD price. Rejects scientific notation and signs.
 * Jupiter returns a JSON number; DexScreener already returns a decimal string.
 */
export function formatUsdPrice(value) {
  if (typeof value === 'string') {
    if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) throw new PriceError('invalid_provider_response');
    return value;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || Object.is(value, -0)) {
    throw new PriceError('invalid_provider_response');
  }
  const raw = Object.is(value, 0) ? '0' : value.toString();
  const plain = /e/i.test(raw) ? expandScientific(raw) : raw;
  if (!plain || !/^(0|[1-9]\d*)(\.\d+)?$/.test(plain)) throw new PriceError('invalid_provider_response');
  return plain;
}

function expandScientific(raw) {
  const match = raw.match(/^(\d+(?:\.\d+)?)e([+-]?\d+)$/i);
  if (!match) return null;
  const exp = Number(match[2]);
  if (!Number.isSafeInteger(exp)) return null;
  const [whole, frac = ''] = match[1].split('.');
  const digits = `${whole}${frac}`;
  const point = whole.length + exp;
  let text;
  if (point <= 0) text = `0.${'0'.repeat(-point)}${digits}`;
  else if (point >= digits.length) text = `${digits}${'0'.repeat(point - digits.length)}`;
  else text = `${digits.slice(0, point)}.${digits.slice(point)}`;
  text = text.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  if (text.startsWith('.')) text = `0${text}`;
  return text;
}

/**
 * Unsigned micro-USD integer for a USD decimal. Used when a consensus field
 * must stay an integer string. A quote still does not authorize a transaction.
 */
export function usdPriceBaseUnits(priceUsd) {
  const plain = formatUsdPrice(priceUsd);
  const [whole, frac = ''] = plain.split('.');
  const digits = `${frac}000000`.slice(0, 6);
  const micro = BigInt(whole) * 1_000_000n + BigInt(digits);
  if (micro <= 0n) throw new PriceError('invalid_provider_response');
  const text = micro.toString();
  if (!/^(0|[1-9][0-9]{0,39})$/.test(text)) throw new PriceError('invalid_provider_response');
  return text;
}

/**
 * One paper-PnL quote for an agent tool. DexScreener, then Jupiter Price API v3.
 * The result never carries a signature, a transaction, or permission to broadcast.
 */
export async function readAgentPriceQuote(mint, options = {}) {
  const lookup = typeof options.lookup === 'function'
    ? options.lookup
    : createMainnetPriceProvider(options);
  const quote = await lookup(mint);
  if (
    !quote
    || quote.label !== PRICE_LABEL
    || quote.pricingCluster !== 'mainnet'
    || quote.executionCluster !== 'devnet'
    || typeof quote.priceUsd !== 'string'
  ) throw new PriceError('invalid_provider_response');
  return {
    mint: quote.mint,
    priceUsd: quote.priceUsd,
    priceBaseUnits: usdPriceBaseUnits(quote.priceUsd),
    quoteSource: quote.quoteSource,
    fallbackFrom: typeof quote.fallbackFrom === 'string' ? quote.fallbackFrom : null,
    pricingCluster: 'mainnet',
    executionCluster: 'devnet',
    label: PRICE_LABEL,
    paperPnl: true,
    authorizesTransaction: false,
    fetchedAt: quote.fetchedAt,
  };
}

function quoteShell(mint, priceUsd, extra) {
  return {
    mint,
    priceUsd,
    pricingCluster: 'mainnet',
    executionCluster: 'devnet',
    label: PRICE_LABEL,
    pairAddress: null,
    fetchedAt: new Date().toISOString(),
    ...extra,
  };
}

/**
 * Jupiter Price API V3. Optional `apiKey` is sent as `x-api-key` (free tier works without it).
 * Tokens with no reliable price are omitted from the body; that is `price_not_found`.
 */
export function createJupiterPriceProvider({
  fetcher = fetch,
  apiKey = null,
  baseUrl = 'https://api.jup.ag/price/v3',
} = {}) {
  return async function lookupPrice(mint) {
    assertMint(mint);
    const headers = { Accept: 'application/json' };
    if (apiKey) headers['x-api-key'] = apiKey;
    let response;
    try {
      response = await fetcher(`${baseUrl}?ids=${encodeURIComponent(mint)}`, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new PriceError('provider_unavailable');
    }
    if (!response.ok) {
      throw new PriceError(response.status === 429 ? 'provider_rate_limited' : 'provider_failed', response.status === 429 ? 429 : 502);
    }
    let data;
    try { data = await response.json(); } catch { throw new PriceError('invalid_provider_response'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new PriceError('invalid_provider_response');
    const row = data[mint];
    if (!row || typeof row !== 'object') throw new PriceError('price_not_found', 404);
    const priceUsd = formatUsdPrice(row.usdPrice);
    return quoteShell(mint, priceUsd, {
      quoteSource: 'jupiter-price-v3',
      liquidityUsd: typeof row.liquidity === 'number' && Number.isFinite(row.liquidity) ? row.liquidity : null,
      blockId: Number.isInteger(row.blockId) ? row.blockId : null,
    });
  };
}

/**
 * DexScreener first. Jupiter Price API V3 is used only after a provider failure
 * (missing pair, rate limit, or bad upstream). Invalid mints are not retried.
 */
export function createMainnetPriceProvider({
  fetcher = fetch,
  apiKey = null,
  dexBaseUrl,
  jupiterBaseUrl,
  primary,
  fallback,
} = {}) {
  const dex = primary ?? createDexScreenerPriceProvider({
    fetcher,
    ...(dexBaseUrl ? { baseUrl: dexBaseUrl } : {}),
  });
  const jupiter = fallback ?? createJupiterPriceProvider({
    fetcher,
    apiKey,
    ...(jupiterBaseUrl ? { baseUrl: jupiterBaseUrl } : {}),
  });
  return async function lookupPrice(mint) {
    try {
      return await dex(mint);
    } catch (error) {
      if (!(error instanceof PriceError) || !FALLBACK_CODES.has(error.code)) throw error;
      const quote = await jupiter(mint);
      return { ...quote, fallbackFrom: 'dexscreener' };
    }
  };
}
