import { createSearch, createScrape, createBrowserProvider, ProviderError } from '@ubc2026/browser-search';

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

const EMBEDDABLE_LIVE_VIEW_PATHS = new Set(['/ui/view', '/ui/inspector']);

/**
 * live.browser.run serves /ui/view and /ui/inspector with
 * `content-security-policy: frame-ancestors *` and no X-Frame-Options
 * (checked 2026-11-14). Other hosts stay unembedded.
 */
export function describeLiveViewEmbed(viewerUrl) {
  let url;
  try { url = new URL(viewerUrl); } catch {
    return { embedVerified: false, fallback: 'open-viewer-in-separate-tab' };
  }
  const embedVerified = url.protocol === 'https:'
    && url.hostname === 'live.browser.run'
    && EMBEDDABLE_LIVE_VIEW_PATHS.has(url.pathname)
    && !url.username
    && !url.password;
  return { embedVerified, fallback: 'open-viewer-in-separate-tab' };
}

export const agentTools = Object.freeze([
  {
    name: 'web_search',
    description: 'Search the public web via Firecrawl for general research, shopping, or assistant questions. For a product fact such as the latest model or its price, search once and answer from the snippets. Do not open a browser for that fact. When the prompt lists an owner place or local time, include them in the query for weather, hours, events, news for today, or anything near them. Returns titles, URLs, and snippets. Not a payment or trading authority.',
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
    name: 'web_scrape',
    description: 'Scrape a public http(s) page into Markdown via Firecrawl for research. Use it after web_search only when the snippets do not already contain the fact. Do not open a browser to read a product page. Truncated for timeline size. Not a payment or trading authority.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        url: { type: 'string', minLength: 1, maxLength: 2000 },
      },
    },
  },
  {
    name: 'browser_open',
    description: 'Open a Cloudflare browser session owned by this agent. Pass url (https) to load a page — without url the Live View stays on about:blank. If this agent is already at its session limit, reuses the newest open session and navigates when url is set. When the page is a search or map for a local or time-bound ask, include the owner place and local date from the prompt. Do not open x.com, twitter.com, or reddit.com; those sites block this browser. Does not expose CDP or privileged URLs.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        purpose: { type: 'string', maxLength: 256 },
        url: { type: 'string', minLength: 1, maxLength: 2000, description: 'https URL to open in the session (required to leave about:blank)' },
      },
    },
  },
  {
    name: 'browser_navigate',
    description: 'Open a new tab to an https URL in an existing agent-owned browser session. Prefer this over browser_open when a session is already open and the owner asks to use the site or change pages. Do not use it for a product fact such as the latest model or its price; use web_search for that. When the page is a search or map for a local or time-bound ask, include the owner place and local date from the prompt. Do not open x.com, twitter.com, or reddit.com.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        sessionRecordId: { type: 'string', minLength: 1, maxLength: 128, description: 'Optional when exactly one session is open; otherwise required' },
        url: { type: 'string', minLength: 1, maxLength: 2000 },
      },
    },
  },
  {
    name: 'browser_live_view',
    description: 'Ask the owner UI to mint a read-only Live View for this session. The tool result never includes the viewer URL. A separate tab remains the fallback if the iframe does not load.',
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
  scrape = null,
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

  async function withSession(record, work) {
    try { return await work(); }
    catch (error) {
      if (error?.code === 'browser_session_expired') {
        await store.put(keyFor(record.ownerId, record.botId, record.sessionRecordId), {
          ...record, status: 'closed', updatedAt: clock(), closedAt: clock(),
        });
      }
      throw error;
    }
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

    async scrape({ ownerId, botId, url }) {
      if (![ownerId, botId].every(idOk)) fail('invalid_identity');
      if (!scrape) throw new ProviderError('scrape_not_configured', 503);
      const page = await scrape(url);
      return {
        ownerId,
        botId,
        page,
        event: {
          type: 'tool',
          name: 'web_scrape',
          status: 'ok',
          url: page.url,
          truncated: page.truncated,
          chars: page.markdown.length,
          at: clock(),
        },
      };
    },

    async openSession({ ownerId, botId, purpose = 'browse', url = null } = {}) {
      if (![ownerId, botId].every(idOk)) fail('invalid_identity');
      if (typeof purpose !== 'string' || purpose.length > 256) fail('invalid_purpose');
      if (!browsers) throw new ProviderError('browser_not_configured', 503);
      let open = (await store.list(prefixFor(ownerId, botId))).filter(row => row.status === 'open');
      // At capacity: reuse the newest open session (navigate when url is set) instead of
      // failing with concurrency_limit — chat kept calling open and getting stuck.
      if (open.length >= maxSessionsPerBot) {
        const newest = [...open].sort((a, b) => {
          const aAt = Number(a.updatedAt ?? a.createdAt ?? 0);
          const bAt = Number(b.updatedAt ?? b.createdAt ?? 0);
          return bAt - aAt;
        })[0];
        if (!newest?.sessionRecordId) fail('concurrency_limit', 429);
        let navigated = null;
        if (url != null && url !== '') {
          try {
            navigated = await this.navigateSession({
              ownerId,
              botId,
              sessionRecordId: newest.sessionRecordId,
              url,
              recover: false,
            });
          } catch (error) {
            // Cloudflare expired the reused session; its record is now closed, so open a fresh one below.
            if (error?.code !== 'browser_session_expired') throw error;
            open = (await store.list(prefixFor(ownerId, botId))).filter(row => row.status === 'open');
          }
        }
        if (navigated) {
          return {
            sessionRecordId: navigated.sessionRecordId,
            purpose: newest.purpose || purpose,
            status: 'open',
            url: navigated.url,
            title: navigated.title,
            reused: true,
            note: 'Reused an existing session (at concurrency limit) and navigated to the url.',
            event: {
              type: 'tool',
              name: 'browser_open',
              status: 'ok',
              sessionRecordId: navigated.sessionRecordId,
              url: navigated.url,
              reused: true,
              at: clock(),
            },
          };
        }
        if (open.length >= maxSessionsPerBot) return {
          sessionRecordId: newest.sessionRecordId,
          purpose: newest.purpose || purpose,
          status: 'open',
          url: typeof newest.url === 'string' ? newest.url : null,
          title: '',
          reused: true,
          note: 'Reused an existing session (at concurrency limit). Call browser_navigate with an https url to change the page.',
          event: {
            type: 'tool',
            name: 'browser_open',
            status: 'ok',
            sessionRecordId: newest.sessionRecordId,
            url: typeof newest.url === 'string' ? newest.url : null,
            reused: true,
            at: clock(),
          },
        };
      }
      const { sessionId } = await browsers.createSession();
      let pageUrl = null;
      let targetId = null;
      let title = '';
      if (url != null && url !== '') {
        if (typeof browsers.openTab !== 'function') throw new ProviderError('browser_not_configured', 503);
        const tab = await browsers.openTab(sessionId, url);
        pageUrl = tab.url;
        targetId = tab.targetId;
        title = tab.title || '';
      }
      const sessionRecordId = idFactory();
      const record = {
        sessionRecordId,
        providerSessionId: sessionId,
        ownerId,
        botId,
        purpose,
        status: 'open',
        url: pageUrl,
        targetId,
        revision: 0,
        createdAt: clock(),
        updatedAt: clock(),
      };
      await store.put(keyFor(ownerId, botId, sessionRecordId), record);
      return {
        sessionRecordId,
        purpose,
        status: 'open',
        url: pageUrl,
        title,
        reused: false,
        note: pageUrl
          ? undefined
          : 'Session is on about:blank until browser_open/browser_navigate is called with an https url.',
        event: {
          type: 'tool',
          name: 'browser_open',
          status: 'ok',
          sessionRecordId,
          url: pageUrl,
          at: clock(),
        },
      };
    },

    async navigateSession({ ownerId, botId, sessionRecordId, url, recover = true }) {
      if (!browsers) throw new ProviderError('browser_not_configured', 503);
      if (typeof browsers.openTab !== 'function') throw new ProviderError('browser_not_configured', 503);
      let recordId = sessionRecordId;
      if (!recordId) {
        if (![ownerId, botId].every(idOk)) fail('invalid_identity');
        const open = (await store.list(prefixFor(ownerId, botId))).filter(row => row.status === 'open');
        if (open.length === 0) fail('session_not_found', 404);
        open.sort((a, b) => Number(b.updatedAt ?? b.createdAt ?? 0) - Number(a.updatedAt ?? a.createdAt ?? 0));
        recordId = open[0].sessionRecordId;
      }
      const record = await requireOwned(ownerId, botId, recordId);
      if (record.control === 'owner') fail('owner_has_control', 409);
      let tab;
      try {
        tab = await withSession(record, () => browsers.openTab(record.providerSessionId, url));
      } catch (error) {
        if (!recover || error?.code !== 'browser_session_expired') throw error;
        // Cloudflare ended the session (keepAlive lapsed). Continue in a fresh one so the agent
        // and the Computer panel keep following the page instead of failing the step.
        const reopened = await this.openSession({ ownerId, botId, purpose: record.purpose || 'browse', url });
        return {
          sessionRecordId: reopened.sessionRecordId,
          url: reopened.url,
          title: reopened.title,
          recovered: true,
          note: 'The previous browser session had expired, so a new session was opened at this url.',
          event: {
            type: 'tool',
            name: 'browser_navigate',
            status: 'ok',
            sessionRecordId: reopened.sessionRecordId,
            url: reopened.url,
            recovered: true,
            at: clock(),
          },
        };
      }
      const updated = {
        ...record,
        url: tab.url,
        targetId: tab.targetId,
        revision: (record.revision ?? 0) + 1,
        updatedAt: clock(),
      };
      await store.put(keyFor(ownerId, botId, record.sessionRecordId), updated);
      if (record.targetId && record.targetId !== tab.targetId && typeof browsers.closeTab === 'function') {
        try { await browsers.closeTab(record.providerSessionId, record.targetId); } catch {}
      }
      return {
        sessionRecordId: record.sessionRecordId,
        url: tab.url,
        title: tab.title,
        event: {
          type: 'tool',
          name: 'browser_navigate',
          status: 'ok',
          sessionRecordId: record.sessionRecordId,
          url: tab.url,
          at: clock(),
        },
      };
    },

    async liveView({ ownerId, botId, sessionRecordId, control }) {
      if (!browsers) throw new ProviderError('browser_not_configured', 503);
      const record = await requireOwned(ownerId, botId, sessionRecordId);
      const nextControl = control === 'owner' || control === 'agent'
        ? control
        : (record.control === 'owner' ? 'owner' : 'agent');
      if (nextControl !== record.control) {
        await store.put(keyFor(ownerId, botId, sessionRecordId), {
          ...record,
          control: nextControl,
          updatedAt: clock(),
        });
      }
      const view = await withSession(record, () => browsers.readonlyView(record.providerSessionId, {
        targetId: typeof record.targetId === 'string' ? record.targetId : undefined,
        interactive: nextControl === 'owner',
      }));
      const embed = describeLiveViewEmbed(view.viewerUrl);
      // Viewer URLs contain bearer credentials: return only to the authorized owner with no-store.
      // Do not put the URL on the tool event.
      return {
        sessionRecordId,
        viewerUrl: view.viewerUrl,
        connectBefore: view.connectBefore,
        mode: view.mode,
        control: nextControl,
        pageUrl: typeof record.url === 'string' ? record.url : null,
        headers: { 'Cache-Control': 'no-store' },
        embedVerified: embed.embedVerified,
        fallback: embed.fallback,
        event: { type: 'tool', name: 'browser_live_view', status: 'ok', sessionRecordId, at: clock() },
      };
    },

    async releaseSession({ ownerId, botId, sessionRecordId }) {
      const record = await requireOwned(ownerId, botId, sessionRecordId);
      if (browsers && typeof browsers.closeSession === 'function') {
        try { await browsers.closeSession(record.providerSessionId); }
        catch (error) {
          if (error?.code !== 'browser_session_expired') throw error;
        }
      }
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
        .map(({ sessionRecordId, purpose, createdAt, updatedAt, status, url, revision }) => ({
          sessionRecordId,
          purpose,
          createdAt,
          updatedAt,
          status,
          revision: revision ?? 0,
          url: typeof url === 'string' ? url : null,
        }));
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
        case 'web_scrape':
          return this.scrape({ ...identity, url: args?.url });
        case 'browser_open':
          return this.openSession({
            ...identity,
            purpose: args?.purpose ?? 'browse',
            url: args?.url ?? null,
          });
        case 'browser_navigate':
          return this.navigateSession({
            ...identity,
            sessionRecordId: args?.sessionRecordId,
            url: args?.url,
          });
        case 'browser_live_view': {
          const view = await this.liveView({ ...identity, sessionRecordId: args?.sessionRecordId });
          // The model must not receive the bearer URL. The owner HTTP route returns it.
          return {
            sessionRecordId: view.sessionRecordId,
            mode: view.mode,
            connectBefore: view.connectBefore,
            embedVerified: view.embedVerified,
            fallback: view.fallback,
            pageUrl: view.pageUrl,
            event: view.event,
          };
        }
        case 'browser_release':
          return this.releaseSession({ ...identity, sessionRecordId: args?.sessionRecordId });
        default:
          fail('unknown_tool');
      }
    },
  };
}

function concurrencyLimit(value) {
  if (value == null || value === '') return 2;
  const parsed = typeof value === 'string' ? Number(value) : value;
  return parsed;
}

export function createDefaultBrowserSessionService(env, store) {
  const firecrawlKey = env.FIRECRAWL_API_KEY;
  return createBrowserSessionService({
    store,
    search: createSearch({ apiKey: firecrawlKey, fetcher: env.fetcher }),
    scrape: createScrape({ apiKey: firecrawlKey, fetcher: env.fetcher }),
    browsers: createBrowserProvider({
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: env.CLOUDFLARE_API_TOKEN,
      fetcher: env.fetcher,
      binding: env.BROWSER,
    }),
    maxSessionsPerBot: concurrencyLimit(env.MAX_BROWSER_SESSIONS_PER_BOT),
  });
}
