# `@ubc2026/browser-search`

Server-only, dependency-free adapters for **Firecrawl** (search + scrape) and Cloudflare Browser Run.

```js
import { createSearch, createScrape, createBrowserProvider } from '@ubc2026/browser-search';

const search = createSearch({ apiKey: env.FIRECRAWL_API_KEY });
const scrape = createScrape({ apiKey: env.FIRECRAWL_API_KEY });
const browsers = createBrowserProvider({
  accountId: env.CLOUDFLARE_ACCOUNT_ID,
  apiToken: env.CLOUDFLARE_API_TOKEN,
});

const hits = await search('solana usdc yield', 5);
const page = await scrape(hits[0].url);
const { sessionId } = await browsers.createSession();
const view = await browsers.readonlyView(sessionId); // short-lived, readonly Live View only
```

Keep `FIRECRAWL_API_KEY` in Worker secrets only — never in the model context or client bundle.

Run `npm test` in this directory. Tests use mocked upstream responses.

## Docs

- https://docs.firecrawl.dev/api-reference/v1-endpoint/search
- https://docs.firecrawl.dev/api-reference/v1-endpoint/scrape
- https://developers.cloudflare.com/browser-rendering/
