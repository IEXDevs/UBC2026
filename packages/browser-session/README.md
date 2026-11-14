# Browser / search session service

Service layer over `@ubc2026/browser-search`. Adds durable session ownership, per-bot concurrency limits, agent tool schemas, and concise timeline events for Firecrawl research plus heavier Cloudflare browser work.

```js
import { createMemoryStore, createBrowserSessionService } from '@ubc2026/browser-session';
import { createSearch, createScrape, createBrowserProvider } from '@ubc2026/browser-search';

const store = durableObjectStore; // tests may use createMemoryStore()
const service = createBrowserSessionService({
  store,
  search: createSearch({ apiKey: env.FIRECRAWL_API_KEY }),
  scrape: createScrape({ apiKey: env.FIRECRAWL_API_KEY }),
  browsers: createBrowserProvider({ accountId: env.CLOUDFLARE_ACCOUNT_ID, apiToken: env.CLOUDFLARE_API_TOKEN }),
  maxSessionsPerBot: 2,
});

await service.invokeTool('web_search', { query: 'USDC gift cards' }, { ownerId, botId });
await service.invokeTool('web_scrape', { url: 'https://example.com' }, { ownerId, botId });
const { sessionRecordId } = await service.openSession({ ownerId, botId, purpose: 'checkout' });
const view = await service.liveView({ ownerId, botId, sessionRecordId }); // Cache-Control: no-store
```

## Rules

- Persist session records in a Durable Object or transactional DB. Queues deliver jobs; they are not ownership or exactly-once storage.
- Never treat a model- or client-supplied Cloudflare `sessionId` as authorization — only `sessionRecordId` values created for that owner/bot.
- Live View URLs contain bearer credentials: the owner HTTP route returns them with `Cache-Control: no-store`. `invokeTool('browser_live_view')` redacts the URL so the model never sees it.
- `https://live.browser.run/ui/view` and `/ui/inspector` send `content-security-policy: frame-ancestors *` (checked 2026-11-14), so the owner UI may iframe those URLs. Any other host stays a separate-tab fallback. Do not log the URL.
- This is not a coding-agent filesystem UI. Tools are web search, scrape, and browser open/view/release only.
- Research provider is Firecrawl (`FIRECRAWL_API_KEY` in Worker secrets). Interactive browse stays on Cloudflare Browser Rendering.

Run `npm test` here or at the repository root. Mocked tests need no secrets.
