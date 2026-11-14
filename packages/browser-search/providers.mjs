// Server-only provider adapters. Supply owner-authorized session IDs from app storage.
// Research uses Firecrawl (search + scrape). Interactive browse uses Cloudflare Browser Run.
export class ProviderError extends Error {
  constructor(code, status = 502) { super(code); this.code = code; this.status = status; }
}

async function jsonRequest(fetcher, url, options) {
  let response;
  try { response = await fetcher(url, { ...options, signal: AbortSignal.timeout(30000) }); }
  catch { throw new ProviderError('provider_unavailable'); }
  if (!response.ok) throw new ProviderError(response.status === 429 ? 'provider_rate_limited' : 'provider_failed', response.status === 429 ? 429 : 502);
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new ProviderError('invalid_provider_response'); }
}

function firecrawlHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

/**
 * Firecrawl web search. Returns titles, URLs, and snippets only — no secrets.
 * API key must come from Worker secrets (FIRECRAWL_API_KEY), never the model or client.
 */
export function createSearch({ apiKey, fetcher = fetch, baseUrl = 'https://api.firecrawl.dev/v1' }) {
  return async function search(query, limit = 5) {
    if (!apiKey) throw new ProviderError('search_not_configured', 503);
    if (typeof query !== 'string' || !query.trim() || query.length > 1000 || !Number.isInteger(limit) || limit < 1 || limit > 10) {
      throw new ProviderError('invalid_search', 400);
    }
    const data = await jsonRequest(fetcher, `${baseUrl}/search`, {
      method: 'POST',
      headers: firecrawlHeaders(apiKey),
      body: JSON.stringify({ query: query.trim(), limit, ignoreInvalidURLs: true }),
    });
    if (!data || data.success !== true || !Array.isArray(data.data)) throw new ProviderError('invalid_provider_response');
    const fetchedAt = new Date().toISOString();
    return data.data.flatMap(result => {
      try {
        const source = new URL(result.url);
        if (!['https:', 'http:'].includes(source.protocol)) return [];
        return [{
          title: String(result.title ?? ''),
          url: source.href,
          snippet: String(result.description ?? ''),
          fetchedAt,
        }];
      } catch { return []; }
    }).slice(0, limit);
  };
}

/**
 * Firecrawl page→Markdown scrape for research. Caps markdown size so tool events stay concise.
 */
export function createScrape({ apiKey, fetcher = fetch, baseUrl = 'https://api.firecrawl.dev/v1', maxMarkdownChars = 12000 }) {
  return async function scrape(url) {
    if (!apiKey) throw new ProviderError('scrape_not_configured', 503);
    if (typeof url !== 'string' || !url.trim() || url.length > 2000) throw new ProviderError('invalid_scrape', 400);
    let target;
    try {
      target = new URL(url.trim());
      if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) throw new Error('bad');
    } catch { throw new ProviderError('invalid_scrape', 400); }
    if (!Number.isSafeInteger(maxMarkdownChars) || maxMarkdownChars < 500 || maxMarkdownChars > 50000) {
      throw new ProviderError('invalid_scrape', 400);
    }
    const data = await jsonRequest(fetcher, `${baseUrl}/scrape`, {
      method: 'POST',
      headers: firecrawlHeaders(apiKey),
      body: JSON.stringify({ url: target.href, formats: ['markdown'], onlyMainContent: true }),
    });
    if (!data || data.success !== true || !data.data || typeof data.data !== 'object') {
      throw new ProviderError('invalid_provider_response');
    }
    const markdown = typeof data.data.markdown === 'string' ? data.data.markdown : '';
    const title = typeof data.data.metadata?.title === 'string' ? data.data.metadata.title : '';
    const truncated = markdown.length > maxMarkdownChars;
    return {
      url: target.href,
      title,
      markdown: truncated ? markdown.slice(0, maxMarkdownChars) : markdown,
      truncated,
      fetchedAt: new Date().toISOString(),
    };
  };
}

const LIVE_VIEW_TTL_MS = 300000;

export function createBrowserProvider({ accountId, apiToken, fetcher = fetch }) {
  // Browser Run REST API. The older `/browser-rendering/` prefix is not the Live View API.
  const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId ?? '')}/browser-run/devtools/browser`;
  async function call(path, { method = 'POST', body } = {}) {
    if (!accountId || !apiToken) throw new ProviderError('browser_not_configured', 503);
    const headers = { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' };
    const options = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const result = await jsonRequest(fetcher, base + path, options);
    if (result && result.success === false) throw new ProviderError('browser_provider_failed');
    return result?.result ?? result ?? {};
  }
  return {
    async createSession() {
      const result = await call('?keep_alive=600000&targets=true', { body: {} });
      if (typeof result.sessionId !== 'string' || !result.sessionId) throw new ProviderError('invalid_provider_response');
      // Do not return provider CDP URLs or privileged default viewer links to the frontend.
      return { sessionId: result.sessionId };
    },
    async readonlyView(sessionId) {
      if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(sessionId)) throw new ProviderError('invalid_session', 400);
      const result = await call(`/${encodeURIComponent(sessionId)}/live_view`, {
        body: { mode: 'tab', expiresInMs: LIVE_VIEW_TTL_MS, guardrails: { mode: 'readonly' } },
      });
      let url;
      try { url = new URL(result.devtoolsFrontendUrl); } catch { throw new ProviderError('invalid_provider_response'); }
      if (url.protocol !== 'https:' || url.hostname !== 'live.browser.run' || url.username || url.password) throw new ProviderError('invalid_provider_response');
      if (url.pathname !== '/ui/view' && url.pathname !== '/ui/inspector') throw new ProviderError('invalid_provider_response');
      return { viewerUrl: url.href, connectBefore: new Date(Date.now() + LIVE_VIEW_TTL_MS).toISOString(), mode: 'readonly' };
    },
    async closeSession(sessionId) {
      if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(sessionId)) throw new ProviderError('invalid_session', 400);
      const result = await call(`/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
      return { status: typeof result.status === 'string' ? result.status : 'closing' };
    },
  };
}
