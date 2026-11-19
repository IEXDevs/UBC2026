/**
 * Same-origin stand-in for https://auth.privy.io.
 * Privy returns the refresh token in JSON, which the page can read.
 * This proxy keeps that token in an HttpOnly cookie and removes it from
 * the body. A later session refresh sends the cookie, not page storage.
 * The access token stays in the body so the open tab can keep working.
 */

export const PRIVY_AUTH_ORIGIN = 'https://auth.privy.io';
export const PRIVY_AUTH_PROXY_PREFIX = '/api/privy-auth';
export const PRIVY_REFRESH_COOKIE = 'maelstrom_privy_refresh';
// Page-readable flag that the HttpOnly refresh cookie exists. Not a credential.
export const PRIVY_SESSION_MARKER = 'privy-session';

const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;
const PATH_OK = /^\/api\/v1\/[A-Za-z0-9._~/-]{1,200}$/;
const SESSION_WRITE = new Set(['/api/v1/sessions', '/api/v1/sessions/logout']);
const FORWARD_HEADERS = Object.freeze([
  'authorization',
  'content-type',
  'accept',
  'origin',
  'privy-app-id',
  'privy-ca-id',
  'privy-client',
]);

export function privyUpstreamUrl(path, search = '') {
  if (typeof path !== 'string' || !PATH_OK.test(path) || path.includes('..')) return '';
  const query = typeof search === 'string' && search.startsWith('?') ? search : '';
  return `${PRIVY_AUTH_ORIGIN}${path}${query}`;
}

export function readRefreshCookie(cookieHeader) {
  const header = typeof cookieHeader === 'string' ? cookieHeader : '';
  const match = new RegExp(`(?:^|;\\s*)${PRIVY_REFRESH_COOKIE}=([^;]*)`).exec(header);
  if (!match) return '';
  let value = match[1].trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    /* keep the raw value */
  }
  if (!value || value.length > 4096 || /[\r\n;\s]/.test(value)) return '';
  return value;
}

export function refreshCookieHeader(token, { secure = true, clear = false } = {}) {
  const flags = `HttpOnly; Path=${PRIVY_AUTH_PROXY_PREFIX}; SameSite=Lax${secure ? '; Secure' : ''}`;
  if (clear) return `${PRIVY_REFRESH_COOKIE}=; ${flags}; Max-Age=0`;
  if (typeof token !== 'string' || !token || token.length > 4096 || /[\r\n;]/.test(token)) return '';
  return `${PRIVY_REFRESH_COOKIE}=${encodeURIComponent(token)}; ${flags}; Max-Age=${REFRESH_MAX_AGE}`;
}

/** Readable companion to the HttpOnly refresh cookie. Path=/ so the page can see it. */
export function sessionMarkerCookie({ secure = true, clear = false } = {}) {
  const flags = `Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
  if (clear) return `${PRIVY_SESSION_MARKER}=; ${flags}; Max-Age=0`;
  return `${PRIVY_SESSION_MARKER}=1; ${flags}; Max-Age=${REFRESH_MAX_AGE}`;
}

/** Prefer the HttpOnly cookie over a refresh token the page still has stored. */
export function bodyWithStoredRefresh(path, method, bodyText, cookieHeader) {
  if (method !== 'POST' || !SESSION_WRITE.has(path)) return typeof bodyText === 'string' ? bodyText : '';
  const stored = readRefreshCookie(cookieHeader);
  if (!stored) return typeof bodyText === 'string' ? bodyText : '';
  let parsed = {};
  if (bodyText) {
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      return bodyText;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return typeof bodyText === 'string' ? bodyText : '';
  parsed.refresh_token = stored;
  return JSON.stringify(parsed);
}

/** Drop the refresh token from a JSON body. Leave every other field. */
export function sealPrivyAuthBody(bodyText) {
  const text = typeof bodyText === 'string' ? bodyText : '';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { bodyText: text, refreshToken: '' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { bodyText: text, refreshToken: '' };
  }
  const refresh = typeof parsed.refresh_token === 'string' ? parsed.refresh_token : '';
  if (!refresh) return { bodyText: text, refreshToken: '' };
  delete parsed.refresh_token;
  return { bodyText: JSON.stringify(parsed), refreshToken: refresh };
}

export async function proxyPrivyAuth(request, path, fetchImpl = globalThis.fetch) {
  const method = request?.method || 'GET';
  const target = privyUpstreamUrl(path, (() => {
    try { return new URL(request.url).search; } catch { return ''; }
  })());
  if (!target) {
    return Response.json({ error: 'not_found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  const rawBody = method === 'GET' || method === 'HEAD' ? '' : await request.text();
  const body = bodyWithStoredRefresh(path, method, rawBody, request.headers.get('cookie'));
  const headers = new Headers();
  for (const name of FORWARD_HEADERS) {
    const value = request.headers.get(name);
    if (typeof value === 'string' && value.length > 0 && value.length < 12000 && !/[\r\n]/.test(value)) {
      headers.set(name, value);
    }
  }
  const upstream = await fetchImpl(target, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
  });
  const text = await upstream.text();
  const sealed = sealPrivyAuthBody(text);
  let secure = false;
  try { secure = new URL(request.url).protocol === 'https:'; } catch { secure = false; }
  const responseHeaders = new Headers();
  const type = upstream.headers.get('content-type');
  if (type && type.length < 200 && !/[\r\n]/.test(type)) responseHeaders.set('content-type', type);
  responseHeaders.set('cache-control', 'no-store');
  const logout = path === '/api/v1/sessions/logout';
  // A refresh Privy rejected must not keep replaying the same dead token.
  const refreshRejected = path === '/api/v1/sessions' && upstream.status === 401 && !sealed.refreshToken;
  const clear = logout || refreshRejected;
  if (clear) {
    responseHeaders.append('set-cookie', refreshCookieHeader('', { secure, clear: true }));
    responseHeaders.append('set-cookie', sessionMarkerCookie({ secure, clear: true }));
  } else {
    const cookie = refreshCookieHeader(sealed.refreshToken, { secure });
    if (cookie) {
      responseHeaders.append('set-cookie', cookie);
      responseHeaders.append('set-cookie', sessionMarkerCookie({ secure }));
    }
  }
  return new Response(sealed.bodyText, { status: upstream.status, headers: responseHeaders });
}
