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

/**
 * provider_failed is a Firecrawl server error (HTTP 5xx).
 * A missing key, a missing client, or a 4xx from the wrong host is not an outage.
 */
function firecrawlStatus(status) {
  if (status === 429) return new ProviderError('provider_rate_limited', 429);
  if (status === 401 || status === 403) return new ProviderError('client_missing', status);
  if (status >= 500 && status <= 599) return new ProviderError('provider_failed', 502);
  return new ProviderError('provider_rejected', 502);
}

function firecrawlKey(apiKey) {
  return typeof apiKey === 'string' ? apiKey.trim() : '';
}

async function firecrawlRequest(fetcher, url, options) {
  if (typeof fetcher !== 'function') throw new ProviderError('client_missing', 503);
  let response;
  try { response = await fetcher(url, { ...options, signal: AbortSignal.timeout(30000) }); }
  catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('provider_unavailable');
  }
  if (!response.ok) throw firecrawlStatus(response.status);
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
  const key = firecrawlKey(apiKey);
  return async function search(query, limit = 5) {
    if (!key) throw new ProviderError('search_not_configured', 503);
    if (typeof fetcher !== 'function') throw new ProviderError('client_missing', 503);
    if (typeof query !== 'string' || !query.trim() || query.length > 1000 || !Number.isInteger(limit) || limit < 1 || limit > 10) {
      throw new ProviderError('invalid_search', 400);
    }
    const data = await firecrawlRequest(fetcher, `${baseUrl}/search`, {
      method: 'POST',
      headers: firecrawlHeaders(key),
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
  const key = firecrawlKey(apiKey);
  return async function scrape(url) {
    if (!key) throw new ProviderError('scrape_not_configured', 503);
    if (typeof fetcher !== 'function') throw new ProviderError('client_missing', 503);
    if (typeof url !== 'string' || !url.trim() || url.length > 2000) throw new ProviderError('invalid_scrape', 400);
    let target;
    try {
      target = new URL(url.trim());
      if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) throw new Error('bad');
    } catch { throw new ProviderError('invalid_scrape', 400); }
    if (!Number.isSafeInteger(maxMarkdownChars) || maxMarkdownChars < 500 || maxMarkdownChars > 50000) {
      throw new ProviderError('invalid_scrape', 400);
    }
    const data = await firecrawlRequest(fetcher, `${baseUrl}/scrape`, {
      method: 'POST',
      headers: firecrawlHeaders(key),
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
const SESSION_ID = /^[a-zA-Z0-9-]{1,128}$/;
const TARGET_ID = /^[a-zA-Z0-9_-]{1,128}$/;

/** Public http(s) page URL only — no credentials, javascript:, or data:. */
export function assertPublicHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) {
    throw new ProviderError('invalid_navigate', 400);
  }
  let target;
  try {
    target = new URL(value.trim());
  } catch {
    throw new ProviderError('invalid_navigate', 400);
  }
  if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) {
    throw new ProviderError('invalid_navigate', 400);
  }
  return target;
}

// Browser Run egress location is not configurable, so Google may geo-localize
// (e.g. Hong Kong, Chinese UI). Pin English / US unless the URL already says otherwise.
const GOOGLE_HOST = /^(?:[a-z0-9-]+\.)*google\.(?:com|[a-z]{2}|com?\.[a-z]{2})$/;
export function withEnglishGoogle(target) {
  if (!GOOGLE_HOST.test(target.hostname)) return target;
  const next = new URL(target.href);
  if (!next.searchParams.has('hl')) next.searchParams.set('hl', 'en');
  if (!next.searchParams.has('gl')) next.searchParams.set('gl', 'us');
  return next;
}

function browserHttpError(status, sessionScoped) {
  if (status === 410 && sessionScoped) return new ProviderError('browser_session_expired', 410);
  if (status === 429) return new ProviderError('provider_rate_limited', 429);
  if (status === 401 || status === 403) return new ProviderError('browser_not_configured', 503);
  if (status === 404) return new ProviderError('browser_endpoint_missing', 502);
  if (status >= 500 && status <= 599) return new ProviderError('provider_failed', 502);
  return new ProviderError('provider_rejected', 502);
}

async function browserRequest(fetcher, url, options, sessionScoped = false) {
  let response;
  try { response = await fetcher(url, { ...options, signal: AbortSignal.timeout(30000) }); }
  catch { throw new ProviderError('provider_unavailable'); }
  if (!response.ok) {
    const error = browserHttpError(response.status, sessionScoped);
    error.providerStatus = response.status;
    const body = await response.text();
    if (sessionScoped && /failed to fetch targets/i.test(body)) error.providerReason = 'targets_unavailable';
    throw error;
  }
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new ProviderError('invalid_provider_response'); }
}

function sanitizedBindingError(value) {
  return String(value ?? '')
    .replace(/(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+/gi, '[redacted]')
    .replace(/\b[\w.-]+\.[a-z]{2,}(?:[/:?]\S*)?/gi, '[redacted]')
    .replace(/\b(?:bearer\s+\S+|[\w-]*(?:token|secret|password|key)[\w-]*\s*[:=]\s*\S+)/gi, '[redacted]')
    .replace(/\b[a-zA-Z0-9_+/=-]{20,}\b/g, '[redacted]')
    .replace(/[\r\n\t]/g, ' ')
    .slice(0, 240);
}

async function viaBinding(method, work) {
  try { return await work(); }
  catch (error) {
    if (error instanceof ProviderError) throw error;
    if (method !== 'acquire' && /(?:session\b[^\n]{0,120}\b(?:not found|does not exist|expired|closed)|no such session|unknown session|failed to fetch targets)/i.test(String(error?.message))) {
      if (method === 'closeSession') return { status: 'closed' };
      const expired = new ProviderError('browser_session_expired', 410);
      expired.providerReason = 'binding_session_expired';
      throw expired;
    }
    console.error(`Browser binding ${method}: ${sanitizedBindingError(error?.name)}: ${sanitizedBindingError(error?.message)}`);
    if (/429|rate limit/i.test(String(error?.message))) throw new ProviderError('provider_rate_limited', 429);
    const failed = new ProviderError('provider_failed', 502);
    failed.providerReason = 'binding_failed';
    throw failed;
  }
}

function checkedTab(result, fallbackUrl) {
  const targetId = typeof result?.id === 'string' ? result.id : '';
  if (!TARGET_ID.test(targetId)) throw new ProviderError('invalid_provider_response');
  return {
    targetId,
    url: typeof result.url === 'string' && result.url.startsWith('http') ? result.url : fallbackUrl,
    title: typeof result.title === 'string' ? result.title.slice(0, 200) : '',
  };
}

function checkedViewer(result, interactive) {
  let url;
  try { url = new URL(result?.devtoolsFrontendUrl); } catch { throw new ProviderError('invalid_provider_response'); }
  if (url.protocol !== 'https:' || url.hostname !== 'live.browser.run' || url.username || url.password) throw new ProviderError('invalid_provider_response');
  if (url.pathname !== '/ui/view' && url.pathname !== '/ui/inspector') throw new ProviderError('invalid_provider_response');
  return {
    viewerUrl: url.href,
    connectBefore: new Date(Date.now() + LIVE_VIEW_TTL_MS).toISOString(),
    mode: interactive ? 'interactive' : 'readonly',
  };
}

function liveViewOptions({ targetId, interactive }) {
  const body = { mode: 'tab', expiresInMs: LIVE_VIEW_TTL_MS };
  if (!interactive) body.guardrails = { mode: 'readonly' };
  if (typeof targetId === 'string' && TARGET_ID.test(targetId)) body.targetId = targetId;
  return body;
}

// Agent clicks run over the page-scoped CDP websocket: locator + pointer overlay
// via Runtime.evaluate, then real Input.dispatchMouseEvent presses. The overlay is
// the only cursor the Live View can show — synthetic input draws none by itself.
const CLICK_PAUSE_MS = 350;
const CURSOR_ID = 'ms-agent-cursor';
const CDP_COMMAND_TIMEOUT_MS = 30000;

function assertClickSelector(selector) {
  if (typeof selector !== 'string' || !selector.trim() || selector.length > 256) {
    throw new ProviderError('invalid_selector', 400);
  }
  return selector.trim();
}

function clickTargetExpression(selector) {
  return `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;`
    + ' const r = el.getBoundingClientRect();'
    + " return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.tagName.toLowerCase(),"
    + " text: (el.textContent || '').trim().slice(0, 80) }; })()";
}

function cursorMoveExpression(x, y) {
  const left = Math.round(x);
  const top = Math.round(y);
  return `(() => { let c = document.getElementById('${CURSOR_ID}'); if (!c) {`
    + ` c = document.createElement('div'); c.id = '${CURSOR_ID}';`
    + ` c.setAttribute('style', 'position:fixed;left:${left}px;top:${top}px;width:14px;height:14px;`
    + 'z-index:2147483647;pointer-events:none;background:#111827;border:1.5px solid #f9fafb;'
    + "border-radius:50% 50% 50% 0;box-shadow:0 1px 4px rgba(0,0,0,0.6);');"
    + ' document.documentElement.appendChild(c); }'
    + ` c.style.left = '${left}px'; c.style.top = '${top}px'; return true; })()`;
}

/** Minimal CDP client over a page-scoped WebSocket upgrade (Workers fetch pattern). */
async function cdpPageChannel({ fetcher, accountId, apiToken, sessionId, targetId }) {
  if (!accountId || !apiToken) throw new ProviderError('browser_input_not_configured', 503);
  const url = `wss://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`
    + `/browser-run/devtools/browser/${encodeURIComponent(sessionId)}/page/${encodeURIComponent(targetId)}`;
  let response;
  try {
    response = await fetcher(url, { headers: { Upgrade: 'websocket', Authorization: `Bearer ${apiToken}` } });
  } catch {
    throw new ProviderError('provider_unavailable');
  }
  const socket = response?.webSocket;
  if (!socket) {
    const status = response?.status;
    if (status === 401 || status === 403) throw new ProviderError('browser_not_configured', 503);
    if (status === 404 || status === 410) {
      const expired = new ProviderError('browser_session_expired', 410);
      expired.providerStatus = status;
      throw expired;
    }
    throw new ProviderError('provider_failed', 502);
  }
  let nextId = 0;
  const pending = new Map();
  const drain = error => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
  const onMessage = event => {
    let message;
    try { message = JSON.parse(typeof event?.data === 'string' ? event.data : ''); } catch { return; }
    const waiter = pending.get(message?.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new ProviderError('provider_failed', 502));
    else waiter.resolve(message.result ?? {});
  };
  if (typeof socket.addEventListener === 'function') {
    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', () => drain(new ProviderError('provider_unavailable')));
    socket.addEventListener('error', () => drain(new ProviderError('provider_unavailable')));
  } else {
    socket.onmessage = onMessage;
  }
  return {
    send(method, params) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new ProviderError('provider_unavailable'));
        }, CDP_COMMAND_TIMEOUT_MS);
        pending.set(id, {
          resolve: value => { clearTimeout(timer); resolve(value); },
          reject: error => { clearTimeout(timer); reject(error); },
        });
        try { socket.send(JSON.stringify({ id, method, params })); }
        catch {
          pending.delete(id);
          clearTimeout(timer);
          reject(new ProviderError('provider_unavailable'));
        }
      });
    },
    close() { try { socket.close(); } catch {} },
  };
}

function assertSessionId(sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) throw new ProviderError('invalid_session', 400);
}

/** Workers Browser Run binding (`env.BROWSER`): no API token, runs from the calling Worker. */
function createBindingBrowserProvider(binding, restProvider) {
  return {
    async createSession() {
      const result = await viaBinding('acquire', () => binding.acquire({ keepAlive: 600000 }));
      if (typeof result?.sessionId !== 'string' || !result.sessionId) throw new ProviderError('invalid_provider_response');
      return { sessionId: result.sessionId };
    },
    async openTab(sessionId, url) {
      assertSessionId(sessionId);
      const target = withEnglishGoogle(assertPublicHttpUrl(url));
      return checkedTab(await viaBinding('devtools.newTarget', () => binding.devtools.newTarget(sessionId, target.href)), target.href);
    },
    async readonlyView(sessionId, { targetId, interactive = false } = {}) {
      assertSessionId(sessionId);
      if (!interactive) {
        if (!restProvider) throw new ProviderError('browser_readonly_not_configured', 503);
        return restProvider.readonlyView(sessionId, { targetId });
      }
      return checkedViewer(await viaBinding('getLiveView', () => binding.getLiveView(sessionId, liveViewOptions({ targetId, interactive: true }))), true);
    },
    async closeTab(sessionId, targetId) {
      if (!restProvider) throw new ProviderError('browser_readonly_not_configured', 503);
      return restProvider.closeTab(sessionId, targetId);
    },
    async click(sessionId, targetId, selector, options = {}) {
      assertSessionId(sessionId);
      if (!restProvider) throw new ProviderError('browser_input_not_configured', 503);
      return restProvider.click(sessionId, targetId, selector, options);
    },
    async closeSession(sessionId) {
      assertSessionId(sessionId);
      const result = await viaBinding('closeSession', () => binding.closeSession(sessionId));
      const status = typeof result === 'string' ? result : result?.status;
      return { status: typeof status === 'string' ? status : 'closing' };
    },
  };
}

export function createBrowserProvider({ accountId, apiToken, fetcher = fetch, binding } = {}) {
  if (binding && typeof binding.acquire === 'function' && typeof binding.devtools?.newTarget === 'function') {
    const restProvider = accountId && apiToken ? createBrowserProvider({ accountId, apiToken, fetcher }) : null;
    return createBindingBrowserProvider(binding, restProvider);
  }
  // Live View is served from browser-run. Accounts that still publish the
  // session API under browser-rendering get that path when browser-run 404s.
  const prefixes = [
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId ?? '')}/browser-run/devtools/browser`,
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId ?? '')}/browser-rendering/devtools/browser`,
  ];
  async function call(path, { method = 'POST', body } = {}) {
    if (!accountId || !apiToken) throw new ProviderError('browser_not_configured', 503);
    const headers = { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' };
    const options = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    let last;
    for (const base of prefixes) {
      try {
        const result = await browserRequest(fetcher, base + path, options, path.startsWith('/'));
        if (result && result.success === false) throw new ProviderError('browser_provider_failed');
        return result?.result ?? result ?? {};
      } catch (error) {
        last = error;
        if (error?.code === 'browser_session_expired' && method === 'DELETE') return { status: 'closed' };
        if (!(error instanceof ProviderError) || error.code !== 'browser_endpoint_missing') throw error;
      }
    }
    if (last?.code === 'browser_endpoint_missing' && path.startsWith('/')) {
      if (method === 'DELETE') return { status: 'closed' };
      const expired = new ProviderError('browser_session_expired', 410);
      expired.providerStatus = last.providerStatus;
      expired.providerReason = last.providerReason;
      throw expired;
    }
    throw last ?? new ProviderError('browser_endpoint_missing', 502);
  }
  return {
    async createSession() {
      const result = await call('?keep_alive=600000&targets=true');
      if (typeof result.sessionId !== 'string' || !result.sessionId) throw new ProviderError('invalid_provider_response');
      // Do not return provider CDP URLs or privileged default viewer links to the frontend.
      // New sessions start on about:blank until openTab navigates.
      return { sessionId: result.sessionId };
    },
    async closeTab(sessionId, targetId) {
      assertSessionId(sessionId);
      if (typeof targetId !== 'string' || !TARGET_ID.test(targetId)) throw new ProviderError('invalid_target', 400);
      return call(`/${encodeURIComponent(sessionId)}/json/close/${encodeURIComponent(targetId)}`, { method: 'GET' });
    },
    /**
     * Open a tab and navigate. Sessions otherwise stay on about:blank.
     * CDP: PUT /devtools/browser/{sessionId}/json/new?url=
     */
    async openTab(sessionId, url) {
      if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) throw new ProviderError('invalid_session', 400);
      const target = withEnglishGoogle(assertPublicHttpUrl(url));
      const result = await call(
        `/${encodeURIComponent(sessionId)}/json/new?url=${encodeURIComponent(target.href)}`,
        { method: 'PUT' },
      );
      const targetId = typeof result.id === 'string' ? result.id : '';
      if (!TARGET_ID.test(targetId)) throw new ProviderError('invalid_provider_response');
      const pageUrl = typeof result.url === 'string' && result.url.startsWith('http')
        ? result.url
        : target.href;
      return {
        targetId,
        url: pageUrl,
        title: typeof result.title === 'string' ? result.title.slice(0, 200) : '',
      };
    },
    async readonlyView(sessionId, { targetId, interactive = false } = {}) {
      if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) throw new ProviderError('invalid_session', 400);
      const body = liveViewOptions({ targetId, interactive });
      const result = await call(`/${encodeURIComponent(sessionId)}/live_view`, { body });
      let url;
      try { url = new URL(result.devtoolsFrontendUrl); } catch { throw new ProviderError('invalid_provider_response'); }
      if (url.protocol !== 'https:' || url.hostname !== 'live.browser.run' || url.username || url.password) throw new ProviderError('invalid_provider_response');
      if (url.pathname !== '/ui/view' && url.pathname !== '/ui/inspector') throw new ProviderError('invalid_provider_response');
      return {
        viewerUrl: url.href,
        connectBefore: new Date(Date.now() + LIVE_VIEW_TTL_MS).toISOString(),
        mode: interactive ? 'interactive' : 'readonly',
      };
    },
    async closeSession(sessionId) {
      if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) throw new ProviderError('invalid_session', 400);
      const result = await call(`/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
      return { status: typeof result.status === 'string' ? result.status : 'closing' };
    },
    async click(sessionId, targetId, selector, options = {}) {
      assertSessionId(sessionId);
      if (typeof targetId !== 'string' || !TARGET_ID.test(targetId)) throw new ProviderError('invalid_target', 400);
      const pick = assertClickSelector(selector);
      const channel = await cdpPageChannel({ fetcher, accountId, apiToken, sessionId, targetId });
      try {
        const located = await channel.send('Runtime.evaluate', {
          expression: clickTargetExpression(pick),
          returnByValue: true,
        });
        const found = (located && typeof located === 'object' && 'result' in located && located.result && typeof located.result === 'object')
          ? located.result.value
          : located?.value;
        if (found == null) throw new ProviderError('browser_click_target_missing', 400);
        if (!Number.isFinite(found.x) || !Number.isFinite(found.y)) throw new ProviderError('invalid_provider_response');
        await channel.send('Runtime.evaluate', {
          expression: cursorMoveExpression(found.x, found.y),
          returnByValue: true,
        });
        // Let the Live View render the pointer before the press reads as a click.
        const pause = Number.isSafeInteger(options.pauseMs) ? options.pauseMs : CLICK_PAUSE_MS;
        if (pause > 0) await new Promise(resolve => setTimeout(resolve, pause));
        await channel.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: found.x, y: found.y });
        await channel.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: found.x, y: found.y, button: 'left', clickCount: 1 });
        await channel.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: found.x, y: found.y, button: 'left', clickCount: 1 });
        return {
          x: Math.round(found.x),
          y: Math.round(found.y),
          tag: typeof found.tag === 'string' ? found.tag.slice(0, 40) : '',
          text: typeof found.text === 'string' ? found.text : '',
        };
      } finally {
        channel.close();
      }
    },
  };
}
