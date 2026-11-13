import { createSearch, createBrowserProvider, ProviderError } from '@ubc2026/browser-search';

export { ProviderError };
export class SessionError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status = 400) => { throw new SessionError(code, status); };
const idOk = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[a-zA-Z0-9:_-]+$/.test(value);
const now = () => Date.now();

/** In-memory store for tests. Production must use a Durable Object or transactional DB. */
export function createMemoryStore() {
  const rows = new Map();
  return {
    async get(key) { return rows.has(key) ? structuredClone(rows.get(key)) : null; },
    async put(key, value) { rows.set(key, structuredClone(value)); },
    async delete(key) { rows.delete(key); },
    async list(prefix) {
      return [...rows.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([, value]) => structuredClone(value));
    },
  };
}

export const agentTools = Object.freeze([
  {
    name: 'web_search',
    description: 'Search the public web for general research, shopping, or assistant questions. Returns titles, URLs, and snippets. Not a payment or trading authority.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 1000 },
        limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
      },
    },
  },
  {
    name: 'browser_open',
    description: 'Open a Cloudflare browser session owned by this bot for heavier browsing or checkout. Subject to per-bot concurrency limits. Does not expose CDP or privileged URLs.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        purpose: { type: 'string', maxLength: 256 },
      },
    },
  },
  {
    name: 'browser_live_view',
    description: 'Mint a short-lived read-only Live View URL for the bot owner to watch the session. Embedding from Vercel is unverified; a separate tab is an accepted fallback.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['sessionRecordId'],
      properties: {
        sessionRecordId: { type: 'string', minLength: 1, maxLength: 128 },
      },
    },
  },
  {
    name: 'browser_release',
    description: 'Release a bot-owned browser session so concurrency slots free up.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['sessionRecordId'],
      properties: {
        sessionRecordId: { type: 'string', minLength: 1, maxLength: 128 },
      },
    },
  },
]);

/**
 * Owner-authorized browser + search service for Cloudflare Workers.
 * Session records must live in the injected durable store. Queues may deliver jobs,
 * but this module never treats a queue message as proof of ownership or durability.
 */
export function createBrowserSessionService({
  store,
  search = null,
  browsers = null,
  maxSessionsPerBot = 2,
  clock = now,
  idFactory = () => `bs_${clock().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
}) {
  if (!store || typeof store.get !== 'function' || typeof store.put !== 'function' || typeof store.delete !== 'function' || typeof store.list !== 'function') {
    fail('durable_store_required', 500);
  }
  if (!Number.isSafeInteger(maxSessionsPerBot) || maxSessionsPerBot < 1 || maxSessionsPerBot > 8) fail('invalid_concurrency_limit', 500);

  const keyFor = (ownerId, botId, sessionRecordId) => `browser:${ownerId}:${botId}:${sessionRecordId}`;
  const prefixFor = (ownerId, botId) => `browser:${ownerId}:${botId}:`;

  async function requireOwned(ownerId, botId, sessionRecordId) {
    if (![ownerId, botId, sessionRecordId].every(idOk)) fail('invalid_identity');
    const record = await store.get(keyFor(ownerId, botId, sessionRecordId));
    if (!record || record.ownerId !== ownerId || record.botId !== botId || record.status !== 'open') fail('session_not_found', 404);
    return record;
  }

  return {
    tools: agentTools,

    async search({ ownerId, botId, query, limit = 5 }) {
      if (![ownerId, botId].every(idOk)) fail('invalid_identity');
      if (!search) throw new ProviderError('search_not_configured', 503);
      const results = await search(query, limit);
      return {
        ownerId,
        botId,
        query: typeof query === 'string' ? query.trim() : query,
        results,
        // Concise tool event for timelines — not model chain-of-thought.
        event: { type: 'tool', name: 'web_search', status: 'ok', resultCount: results.length, at: clock() },
      };
    },

    async openSession({ ownerId, botId, purpose = 'browse' }) {
      if (![ownerId, botId].every(idOk)) fail('invalid_identity');
      if (typeof purpose !== 'string' || purpose.length > 256) fail('invalid_purpose');
      if (!browsers) throw new ProviderError('browser_not_configured', 503);
      const open = (await store.list(prefixFor(ownerId, botId))).filter(row => row.status === 'open');
      if (open.length >= maxSessionsPerBot) fail('concurrency_limit', 429);
      const { sessionId } = await browsers.createSession();
      const sessionRecordId = idFactory();
      const record = {
        sessionRecordId,
        providerSessionId: sessionId,
        ownerId,
        botId,
        purpose,
        status: 'open',
        createdAt: clock(),
        updatedAt: clock(),
      };
      await store.put(keyFor(ownerId, botId, sessionRecordId), record);
      return {
        sessionRecordId,
        purpose,
        status: 'open',
        event: { type: 'tool', name: 'browser_open', status: 'ok', sessionRecordId, at: clock() },
      };
    },

    async liveView({ ownerId, botId, sessionRecordId }) {
      if (!browsers) throw new ProviderError('browser_not_configured', 503);
      const record = await requireOwned(ownerId, botId, sessionRecordId);
      const view = await browsers.readonlyView(record.providerSessionId);
      // Viewer URLs contain bearer credentials: return only to the authorized owner with no-store.
      return {
        sessionRecordId,
        viewerUrl: view.viewerUrl,
        connectBefore: view.connectBefore,
        mode: view.mode,
        headers: { 'Cache-Control': 'no-store' },
        embedVerified: false,
        fallback: 'open-viewer-in-separate-tab',
        event: { type: 'tool', name: 'browser_live_view', status: 'ok', sessionRecordId, at: clock() },
      };
    },

    async releaseSession({ ownerId, botId, sessionRecordId }) {
      const record = await requireOwned(ownerId, botId, sessionRecordId);
      const closed = { ...record, status: 'closed', updatedAt: clock(), closedAt: clock() };
      await store.put(keyFor(ownerId, botId, sessionRecordId), closed);
      return {
        sessionRecordId,
        status: 'closed',
        event: { type: 'tool', name: 'browser_release', status: 'ok', sessionRecordId, at: clock() },
      };
    },

    async listOpenSessions({ ownerId, botId }) {
      if (![ownerId, botId].every(idOk)) fail('invalid_identity');
      const rows = (await store.list(prefixFor(ownerId, botId)))
        .filter(row => row.status === 'open')
        .map(({ sessionRecordId, purpose, createdAt, updatedAt, status }) => ({ sessionRecordId, purpose, createdAt, updatedAt, status }));
      return { sessions: rows, maxSessionsPerBot };
    },

    /**
     * Dispatch an agent tool call. Never accepts a raw provider session ID from the model —
     * only durable sessionRecordIds previously opened for this owner/bot.
     */
    async invokeTool(name, args, identity) {
      if (!identity || !idOk(identity.ownerId) || !idOk(identity.botId)) fail('invalid_identity');
      switch (name) {
        case 'web_search':
          return this.search({ ...identity, query: args?.query, limit: args?.limit ?? 5 });
        case 'browser_open':
          return this.openSession({ ...identity, purpose: args?.purpose ?? 'browse' });
        case 'browser_live_view':
          return this.liveView({ ...identity, sessionRecordId: args?.sessionRecordId });
        case 'browser_release':
          return this.releaseSession({ ...identity, sessionRecordId: args?.sessionRecordId });
        default:
          fail('unknown_tool');
      }
    },
  };
}

export function createDefaultBrowserSessionService(env, store) {
  return createBrowserSessionService({
    store,
    search: createSearch({ apiKey: env.BRAVE_API_KEY, fetcher: env.fetcher }),
    browsers: createBrowserProvider({
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: env.CLOUDFLARE_API_TOKEN,
      fetcher: env.fetcher,
    }),
    maxSessionsPerBot: env.MAX_BROWSER_SESSIONS_PER_BOT ?? 2,
  });
}
