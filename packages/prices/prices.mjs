import { SOLANA_CLUSTER, EXECUTION_LABEL } from '@ubc2026/contracts/solana';
/**
 * Mainnet price reads for paper PnL / research.
 * Execution stays on configured Solana network; these quotes are labeled as mainnet pricing.
 */
export class PriceError extends Error {
  constructor(code, status = 502) { super(code); this.code = code; this.status = status; }
}

const mintPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Mainnet wrapped SOL. Native SOL has no mint; this is the price identity. */
export const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';
export const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const JUPITER_SWAP_QUOTE_URL = 'https://lite-api.jup.ag/swap/v1/quote';
export const JUPITER_SWAP_BUILD_URL = 'https://lite-api.jup.ag/swap/v1/swap';

/**
 * Unwrap a UI label such as `SOL (So11…112)` down to the mint.
 * A symbol of SOL or WSOL is the wrapped-SOL mint.
 */
export function normalizePriceMint(mint) {
  if (typeof mint !== 'string') return mint;
  const text = mint.trim();
  if (/^(?:sol|wsol|wrapped\s+sol)$/i.test(text)) return WRAPPED_SOL_MINT;
  if (text.includes(WRAPPED_SOL_MINT)) return WRAPPED_SOL_MINT;
  return text;
}

function assertMint(mint) {
  const normalized = normalizePriceMint(mint);
  if (typeof normalized !== 'string' || !mintPattern.test(normalized)) throw new PriceError('invalid_mint', 400);
  return normalized;
}

function requireFetcher(fetcher) {
  if (typeof fetcher !== 'function') throw new PriceError('client_missing', 503);
  return fetcher;
}

/**
 * provider_failed is an upstream outage (HTTP 5xx).
 * A bad mint, a missing client, or a 4xx from the wrong host is not an outage.
 */
function providerStatus(status) {
  if (status === 429) return new PriceError('provider_rate_limited', 429);
  if (status === 404) return new PriceError('price_not_found', 404);
  if (status === 400) return new PriceError('invalid_mint', 400);
  if (status === 401 || status === 403) return new PriceError('client_missing', 401);
  if (status >= 500 && status <= 599) return new PriceError('provider_failed', 502);
  return new PriceError('provider_rejected', 502);
}

/**
 * DexScreener free tokens endpoint. No API key.
 * Picks the highest-liquidity USD-priced pair for the mint.
 */
function pairRows(body) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object' && Array.isArray(body.pairs)) return body.pairs;
  return null;
}

function pairPriceUsd(pair) {
  try { return formatUsdPrice(pair?.priceUsd); } catch { return null; }
}

export function createDexScreenerPriceProvider({
  fetcher = fetch,
  baseUrl = 'https://api.dexscreener.com/tokens/v1/solana',
} = {}) {
  const client = requireFetcher(fetcher);
  return async function lookupPrice(rawMint) {
    const mint = assertMint(rawMint);
    let response;
    try {
      response = await client(`${baseUrl}/${encodeURIComponent(mint)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      if (error instanceof PriceError) throw error;
      throw new PriceError('provider_unavailable');
    }
    if (!response.ok) throw providerStatus(response.status);
    let body;
    try { body = await response.json(); } catch { throw new PriceError('invalid_provider_response'); }
    const pairs = pairRows(body);
    if (!pairs) throw new PriceError('invalid_provider_response');
    if (pairs.length < 1) throw new PriceError('price_not_found', 404);

    const scored = pairs
      .filter(pair => pair && pair.baseToken?.address === mint && pairPriceUsd(pair))
      .map(pair => ({
        pair,
        priceUsd: pairPriceUsd(pair),
        liquidityUsd: typeof pair.liquidity?.usd === 'number' ? pair.liquidity.usd : 0,
      }))
      .sort((a, b) => b.liquidityUsd - a.liquidityUsd);

    const best = scored[0];
    if (!best) throw new PriceError('price_not_found', 404);
    const priceUsd = best.priceUsd;
    if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(priceUsd)) throw new PriceError('invalid_provider_response');

    return {
      mint,
      priceUsd,
      quoteSource: 'dexscreener',
      pricingCluster: 'mainnet',
      executionCluster: SOLANA_CLUSTER,
      label: EXECUTION_LABEL,
      pairAddress: typeof best.pair.pairAddress === 'string' ? best.pair.pairAddress : null,
      liquidityUsd: typeof best.pair.liquidity?.usd === 'number' ? best.pair.liquidity.usd : null,
      fetchedAt: new Date().toISOString(),
    };
  };
}

export const PRICE_LABEL = EXECUTION_LABEL;
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
  if (options.fetcher != null && typeof options.fetcher !== 'function' && typeof options.lookup !== 'function') {
    throw new PriceError('client_missing', 503);
  }
  const lookup = typeof options.lookup === 'function'
    ? options.lookup
    : createMainnetPriceProvider(options);
  const quote = await lookup(normalizePriceMint(mint));
  if (
    !quote
    || quote.label !== PRICE_LABEL
    || quote.pricingCluster !== 'mainnet'
    || quote.executionCluster !== SOLANA_CLUSTER
    || typeof quote.priceUsd !== 'string'
  ) throw new PriceError('invalid_provider_response');
  return {
    mint: quote.mint,
    priceUsd: quote.priceUsd,
    priceBaseUnits: usdPriceBaseUnits(quote.priceUsd),
    quoteSource: quote.quoteSource,
    fallbackFrom: typeof quote.fallbackFrom === 'string' ? quote.fallbackFrom : null,
    pricingCluster: 'mainnet',
    executionCluster: SOLANA_CLUSTER,
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
    executionCluster: SOLANA_CLUSTER,
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
  const client = requireFetcher(fetcher);
  return async function lookupPrice(rawMint) {
    const mint = assertMint(rawMint);
    const headers = { Accept: 'application/json' };
    if (apiKey) headers['x-api-key'] = apiKey;
    let response;
    try {
      response = await client(`${baseUrl}?ids=${encodeURIComponent(mint)}`, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      if (error instanceof PriceError) throw error;
      throw new PriceError('provider_unavailable');
    }
    if (!response.ok) throw providerStatus(response.status);
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

const AMOUNT = /^(?:[1-9][0-9]{0,39})$/;

/**
 * Jupiter swap quote. Read-only. The response never includes a transaction
 * to sign, and it does not authorize a mainnet broadcast.
 */
export function jupiterSwapQuoteUrl({ inputMint, outputMint, amount, slippageBps = '50' } = {}) {
  const input = assertMint(inputMint);
  const output = assertMint(outputMint);
  if (input === output) throw new PriceError('invalid_mint', 400);
  if (typeof amount !== 'string' || !AMOUNT.test(amount)) throw new PriceError('invalid_quote', 400);
  if (slippageBps !== '50') throw new PriceError('invalid_quote', 400);
  const url = new URL(JUPITER_SWAP_QUOTE_URL);
  url.searchParams.set('inputMint', input);
  url.searchParams.set('outputMint', output);
  url.searchParams.set('amount', amount);
  url.searchParams.set('slippageBps', slippageBps);
  return url.toString();
}

export async function readJupiterSwapQuote({
  inputMint,
  outputMint,
  amount,
  fetcher = fetch,
  apiKey = null,
} = {}) {
  const client = requireFetcher(fetcher);
  const url = jupiterSwapQuoteUrl({ inputMint, outputMint, amount });
  const headers = { Accept: 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;
  let response;
  try {
    response = await client(url, { headers, signal: AbortSignal.timeout(15000) });
  } catch (error) {
    if (error instanceof PriceError) throw error;
    throw new PriceError('provider_unavailable');
  }
  if (!response.ok) throw providerStatus(response.status);
  let data;
  try { data = await response.json(); } catch { throw new PriceError('invalid_provider_response'); }
  const outAmount = data?.outAmount;
  if (typeof outAmount !== 'string' || !AMOUNT.test(outAmount)) throw new PriceError('invalid_provider_response');
  return {
    inputMint: assertMint(inputMint),
    outputMint: assertMint(outputMint),
    inAmount: amount,
    outAmount,
    quoteSource: 'jupiter-swap-v1',
    pricingCluster: 'mainnet',
    executionCluster: SOLANA_CLUSTER,
    label: PRICE_LABEL,
    broadcast: false,
    authorizesTransaction: false,
  };
}

async function jupiterJson(client, url, init) {
  let response;
  try {
    response = await client(url, { ...init, signal: AbortSignal.timeout(15000) });
  } catch (error) {
    if (error instanceof PriceError) throw error;
    throw new PriceError('provider_unavailable');
  }
  if (!response.ok) throw providerStatus(response.status);
  try { return await response.json(); } catch { throw new PriceError('invalid_provider_response'); }
}

/**
 * Live Jupiter swap order for one signer: quote, then the unsigned serialized
 * transaction from /swap. The caller still simulates, signs, and broadcasts
 * through @ubc2026/wallets after every spend gate has passed.
 */
export async function readJupiterSwapOrder({
  inputMint,
  outputMint,
  amount,
  userPublicKey,
  fetcher = fetch,
  apiKey = null,
} = {}) {
  const client = requireFetcher(fetcher);
  const owner = assertMint(userPublicKey);
  const url = jupiterSwapQuoteUrl({ inputMint, outputMint, amount });
  const headers = { Accept: 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;
  const quote = await jupiterJson(client, url, { headers });
  if (quote?.inputMint !== inputMint || quote?.outputMint !== outputMint || quote?.inAmount !== amount
    || typeof quote?.outAmount !== 'string' || !AMOUNT.test(quote.outAmount)
    || typeof quote?.otherAmountThreshold !== 'string' || !AMOUNT.test(quote.otherAmountThreshold)) {
    throw new PriceError('invalid_provider_response');
  }
  const built = await jupiterJson(client, JUPITER_SWAP_BUILD_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: owner,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    }),
  });
  const transaction = built?.swapTransaction;
  if (typeof transaction !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(transaction) || built.simulationError) {
    throw new PriceError('invalid_provider_response');
  }
  return {
    inputMint,
    outputMint,
    inAmount: amount,
    outAmount: quote.outAmount,
    minOutAmount: quote.otherAmountThreshold,
    transaction,
    quoteSource: 'jupiter-swap-v1',
    executionCluster: SOLANA_CLUSTER,
  };
}
