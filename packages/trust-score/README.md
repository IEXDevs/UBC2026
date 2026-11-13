# Trust score gate

Server-side trust score normalization and buy confirmation gate. Scores are integers from 0 to 1000. Below the configured threshold (default 400), purchases require an explicit user confirmation with the prompt: "This has a low trust score, are you sure you want to buy?"

```js
import { evaluateTrust, createTrustScoreProvider } from '@ubc2026/trust-score';
evaluateTrust({ score: '120' }); // confirmation-required
const lookup = createTrustScoreProvider({
  endpoint: env.TRUST_SCORE_URL,
  apiKey: env.TRUST_SCORE_API_KEY,
});
const result = await lookup(mint);
```

The provider adapter posts `{ mint }` to a configured endpoint and accepts only `{ mint, score, source? }` where `mint` matches the request. Model-invented scores must not bypass this adapter. API keys stay on the backend. Confirmation records and durable audit logging belong to the service layer; this package only returns the gate decision.

Run `npm test` here or at the repository root. Mocked tests require no secrets.
