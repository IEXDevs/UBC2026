// Server-only provider adapters. Supply owner-authorized session IDs from app storage.
export class ProviderError extends Error {
  constructor(code, status = 502) { super(code); this.code = code; this.status = status; }
}
async function jsonRequest(fetcher, url, options) {
  let response;
  try { response = await fetcher(url, { ...options, signal: AbortSignal.timeout(15000) }); }
  catch { throw new ProviderError('provider_unavailable'); }
  if (!response.ok) throw new ProviderError(response.status === 429 ? 'provider_rate_limited' : 'provider_failed', response.status === 429 ? 429 : 502);
  try { return await response.json(); } catch { throw new ProviderError('invalid_provider_response'); }
}
export function createSearch({ apiKey, fetcher = fetch }) {
  return async function search(query, limit = 5) {
    if (!apiKey) throw new ProviderError('search_not_configured', 503);
    if (typeof query !== 'string' || !query.trim() || query.length > 1000 || !Number.isInteger(limit) || limit < 1 || limit > 10) throw new ProviderError('invalid_search', 400);
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query.trim()); url.searchParams.set('count', String(limit));
    const data = await jsonRequest(fetcher, url, { headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' } });
    if (!data || typeof data !== 'object' || (data.web?.results !== undefined && !Array.isArray(data.web.results))) throw new ProviderError('invalid_provider_response');
    const fetchedAt = new Date().toISOString();
    return (data.web?.results ?? []).flatMap(result => {
      try {
        const source = new URL(result.url);
        if (!['https:', 'http:'].includes(source.protocol)) return [];
        return [{ title: String(result.title ?? ''), url: source.href, snippet: String(result.description ?? ''), fetchedAt }];
      } catch { return []; }
    }).slice(0, limit);
  };
}
export function createBrowserProvider({ accountId, apiToken, fetcher = fetch }) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId ?? '')}/browser-rendering/devtools/browser`;
  async function call(path, body) {
    if (!accountId || !apiToken) throw new ProviderError('browser_not_configured', 503);
    const result = await jsonRequest(fetcher, base + path, {
      method: 'POST', headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (result.success === false) throw new ProviderError('browser_provider_failed');
    return result.result ?? result;
  }
  return {
    async createSession() {
      const result = await call('?keep_alive=600000&targets=true', {});
      if (typeof result.sessionId !== 'string' || !result.sessionId) throw new ProviderError('invalid_provider_response');
      // Do not return provider CDP URLs or privileged default viewer links to the frontend.
      return { sessionId: result.sessionId };
    },
    async readonlyView(sessionId) {
      if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(sessionId)) throw new ProviderError('invalid_session', 400);
      const result = await call(`/${encodeURIComponent(sessionId)}/live_view`, { mode: 'tab', expiresInMs: 60000, guardrails: { mode: 'readonly' } });
      let url;
      try { url = new URL(result.devtoolsFrontendUrl); } catch { throw new ProviderError('invalid_provider_response'); }
      if (url.protocol !== 'https:' || url.hostname !== 'live.browser.run' || url.username || url.password) throw new ProviderError('invalid_provider_response');
      return { viewerUrl: url.href, connectBefore: new Date(Date.now() + 60000).toISOString(), mode: 'readonly' };
    },
  };
}
