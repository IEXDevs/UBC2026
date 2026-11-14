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
