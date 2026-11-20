# `@ubc2026/prices`

Mainnet price reads for paper PnL and research.

DexScreener is the primary source (no API key). Jupiter Price API V3 is the fallback when DexScreener has no pair, is rate-limited, or returns an unusable body. Invalid mints are not retried. Jupiter's `x-api-key` is optional on the free tier (`JUPITER_API_KEY`); leave it unset in tests.

Quotes are labeled `mainnet-beta execution, mainnet pricing`.

```js
import { createMainnetPriceProvider } from '@ubc2026/prices';

const lookup = createMainnetPriceProvider({ apiKey: env.JUPITER_API_KEY });
const quote = await lookup(mint);
// quote.quoteSource is 'dexscreener', or 'jupiter-price-v3' with fallbackFrom: 'dexscreener'
```

```bash
npm test -w @ubc2026/prices
```
