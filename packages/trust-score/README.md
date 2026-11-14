# Trust score gate

Server-side trust score normalization and buy confirmation gate. Scores are integers from 0 to 1000. Below the configured threshold (default 400), purchases require an explicit user confirmation with the prompt: "This has a low trust score, are you sure you want to buy?"

```js
import {
  evaluateTrust,
  createJupiterTrustProvider,
  createTrustScoreProvider,
  createDurableTokenCache,
  createFileTrustStorage,
  adaptCloudflareKv,
} from '@ubc2026/trust-score';

evaluateTrust({ score: '120' }); // confirmation-required

// Preferred for Maelstrom: Jupiter Tokens API V2 (organicScore + audit flags)

// Durable per-mint cache (1h default). Pass a JSON file, Cloudflare KV, or DO storage.
// A new provider bound to the same storage reuses the record and re-applies its own threshold.
const cache = createDurableTokenCache({
  storage: createFileTrustStorage('/tmp/ubc-trust-cache.json'),
  // storage: adaptCloudflareKv(env.TRUST_CACHE, { expirationTtl: 3600 }),
});
const lookup = createJupiterTrustProvider({ apiKey: env.JUPITER_API_KEY, cache }); // apiKey optional on free tier
const result = await lookup(mint); // cache: 'miss' then 'hit'

// Generic POST adapter remains available for our own x402 trust Worker later
const custom = createTrustScoreProvider({
  endpoint: env.TRUST_SCORE_URL,
  apiKey: env.TRUST_SCORE_API_KEY,
});
```

Model-invented scores must not bypass these adapters. API keys stay on the backend and are never written into the trust cache. Confirmation records and durable audit logging belong to the service layer; this package returns the gate decision and can persist the per-token Jupiter record in caller-owned storage.

Run `npm test` here or at the repository root. Mocked tests require no secrets.
