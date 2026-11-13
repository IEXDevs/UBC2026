# Browser and search adapters

Server-only, dependency-free adapters for Brave Web Search and Cloudflare Browser Run.

```js
import { createSearch, createBrowserProvider } from '@ubc2026/browser-search';
const search = createSearch({ apiKey: env.BRAVE_API_KEY });
const results = await search('Solana developer documentation', 5);
const browsers = createBrowserProvider({ accountId: env.CLOUDFLARE_ACCOUNT_ID, apiToken: env.CLOUDFLARE_API_TOKEN });
const { sessionId } = await browsers.createSession();
const view = await browsers.readonlyView(sessionId);
```

Authenticate callers and authorize bot/session ownership before calling these adapters. Store session IDs against their owner. Never accept an arbitrary client-supplied session ID as authorization. Viewer links contain bearer credentials: return only to their owner with Cache-Control: no-store and never log them. Provider API keys stay on the backend.

Search returns title, URL, snippet and fetchedAt. Viewer links request tab mode, read-only interaction and a 60-second connection deadline. This deadline does not terminate an established viewer connection. Session cleanup and app authorization belong to the service layer.

Run `npm test` in this directory. Tests use mocked upstream responses; live Cloudflare/Brave checks still require credentials. Embedding the hosted viewer in Vercel remains unverified; a separate viewer tab is a fallback.

Official references:
- https://developers.cloudflare.com/browser-run/features/live-view/
- https://developers.cloudflare.com/api/resources/browser_rendering/
- https://api-dashboard.search.brave.com/app/documentation/web-search/get-started
