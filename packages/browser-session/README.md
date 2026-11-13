# Browser / search session service

Isaac-lane service layer over `@ubc2026/browser-search`. Adds durable session ownership, per-bot concurrency limits, agent tool schemas, and concise timeline events for general assistant search plus heavier Cloudflare browser work.

```js
import { createMemoryStore, createBrowserSessionService } from '@ubc2026/browser-session';
import { createSearch, createBrowserProvider } from '@ubc2026/browser-search';

const store = durableObjectStore; // tests may use createMemoryStore()
const service = createBrowserSessionService({
  store,
  search: createSearch({ apiKey: env.BRAVE_API_KEY }),
  browsers: createBrowserProvider({ accountId: env.CLOUDFLARE_ACCOUNT_ID, apiToken: env.CLOUDFLARE_API_TOKEN }),
  maxSessionsPerBot: 2,
});

await service.invokeTool('web_search', { query: 'USDC gift cards' }, { ownerId, botId });
const { sessionRecordId } = await service.openSession({ ownerId, botId, purpose: 'checkout' });
const view = await service.liveView({ ownerId, botId, sessionRecordId }); // Cache-Control: no-store
```

## Rules

- Persist session records in a Durable Object or transactional DB. Queues deliver jobs; they are not ownership or exactly-once storage.
- Never treat a model- or client-supplied Cloudflare `sessionId` as authorization — only `sessionRecordId` values created for that owner/bot.
- Live View URLs contain bearer credentials: return only to the owner, never log them. Vercel iframe embedding is still unverified; separate-tab fallback is explicit.
- This is not a coding-agent filesystem UI. Tools are web search + browser open/view/release only.
- Search provider remains swappable; Brave is the current adapter starter.

Run `npm test` here or at the repository root. Mocked tests need no secrets.
