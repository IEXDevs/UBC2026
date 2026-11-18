/**
 * Resolve the trust lookup the runtime uses while an agent is deciding.
 * Calls the existing Jupiter Tokens API v2 adapter. `trustLookup: null` disables it.
 * A model-invented score must not replace this result. The decision gate still
 * checks the returned score with evaluateTrust.
 */
import { createJupiterTrustProvider } from '@ubc2026/trust-score';

export function resolveTrustLookup(env = {}) {
  if (env.trustLookup === null) return null;
  if (typeof env.trustLookup === 'function') return env.trustLookup;
  const raw = env.JUPITER_API_KEY;
  const apiKey = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  return createJupiterTrustProvider({
    fetcher: typeof env.fetch === 'function' ? env.fetch : fetch,
    apiKey,
  });
}
