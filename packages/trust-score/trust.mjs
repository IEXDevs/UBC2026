export class TrustError extends Error {}
const fail = message => { throw new TrustError(message); };

export class ProviderError extends Error {
  constructor(code, status = 502) { super(code); this.code = code; this.status = status; }
}

const mintPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const required = value => typeof value === 'string' && value.length > 0 && value.length <= 256;

export function normalizeScore(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1000) return String(value);
  if (typeof value === 'string' && /^(0|[1-9][0-9]{0,2}|1000)$/.test(value) && Number(value) <= 1000) return value;
  fail('Trust score must be an integer from 0 to 1000');
}

export function evaluateTrust({ score, threshold = '400', confirmed = false }) {
  const normalized = normalizeScore(score);
  const limit = normalizeScore(threshold);
  if (typeof confirmed !== 'boolean') fail('Confirmation flag must be boolean');
  if (BigInt(normalized) >= BigInt(limit)) {
    return { state: 'allowed', score: normalized, threshold: limit, requiresConfirmation: false };
  }
  if (confirmed) {
    return { state: 'allowed-with-confirmation', score: normalized, threshold: limit, requiresConfirmation: true };
  }
  return {
    state: 'confirmation-required',
    score: normalized,
    threshold: limit,
    requiresConfirmation: true,
    prompt: 'This has a low trust score, are you sure you want to buy?',
  };
}

/**
 * Server-only adapter. The upstream response shape is intentionally narrow so the
 * trading agent cannot treat model-invented scores as authoritative.
 */
export function createTrustScoreProvider({ endpoint, apiKey, fetcher = fetch, threshold = '400' }) {
  return async function lookupTrust(mint) {
    if (!endpoint || !apiKey) throw new ProviderError('trust_not_configured', 503);
    if (!required(mint) || !mintPattern.test(mint)) throw new ProviderError('invalid_mint', 400);
    let response;
    try {
      response = await fetcher(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ mint }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new ProviderError('provider_unavailable');
    }
    if (!response.ok) throw new ProviderError(response.status === 429 ? 'provider_rate_limited' : 'provider_failed', response.status === 429 ? 429 : 502);
    let data;
    try { data = await response.json(); } catch { throw new ProviderError('invalid_provider_response'); }
    if (!data || typeof data !== 'object' || data.mint !== mint) throw new ProviderError('invalid_provider_response');
    let score;
    try { score = normalizeScore(data.score); } catch { throw new ProviderError('invalid_provider_response'); }
    const decision = evaluateTrust({ score, threshold, confirmed: false });
    return {
      mint,
      score,
      source: typeof data.source === 'string' && data.source.length <= 64 ? data.source : 'provider',
      fetchedAt: new Date().toISOString(),
      decision,
    };
  };
}
