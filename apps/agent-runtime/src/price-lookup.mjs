/**
 * Resolve the paper-PnL lookup the runtime uses outside the model.
 * DexScreener first, Jupiter Price API v3 on failure. `lookupPrice: null` disables it.
 */
import { createMainnetPriceProvider } from '@ubc2026/prices';

export function resolvePriceLookup(env = {}) {
  if (env.lookupPrice === null) return null;
  if (typeof env.lookupPrice === 'function') return env.lookupPrice;
  const raw = env.JUPITER_API_KEY;
  const apiKey = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  return createMainnetPriceProvider({
    fetcher: typeof env.fetch === 'function' ? env.fetch : fetch,
    apiKey,
  });
}
