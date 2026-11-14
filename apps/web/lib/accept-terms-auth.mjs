/**
 * Privy's terms Accept screen posts to auth.privy.io before the SDK attaches a
 * bearer token. getAccessToken() can clear local storage and still let that
 * POST go out, and Privy answers "Missing auth token." Remember the access
 * token as it is written, and put it on that one request when the header is
 * missing.
 */

export const ACCEPT_TERMS_URL = 'https://auth.privy.io/api/v1/users/me/accept_terms';
export const PRIVY_TOKEN_KEYS = Object.freeze(['privy:pat', 'privy:token']);

export function unwrapStoredToken(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'string') return parsed.trim();
    } catch {
      /* Privy sometimes stores the raw JWT. */
    }
  }
  return trimmed;
}

export function isPrivyAccessToken(value) {
  const token = unwrapStoredToken(value);
  if (!token || token.length > 8192 || /\s/.test(token)) return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

export function isAcceptTermsRequest(url, method = 'GET') {
  if (String(method || 'GET').toUpperCase() !== 'POST') return false;
  try {
    const parsed = new URL(String(url));
    const expected = new URL(ACCEPT_TERMS_URL);
    return parsed.origin === expected.origin && parsed.pathname === expected.pathname;
  } catch {
    return false;
  }
}

export function createAcceptTermsAuth() {
  let cached = '';
  return {
    remember(value) {
      const token = unwrapStoredToken(value);
      if (isPrivyAccessToken(token)) cached = token;
    },
    current(storage) {
      const live = readPrivyAccessToken(storage);
      if (live) {
        cached = live;
        return live;
      }
      return cached;
    },
  };
}

export function readPrivyAccessToken(storage) {
  if (!storage || typeof storage.getItem !== 'function') return '';
  for (const key of PRIVY_TOKEN_KEYS) {
    let value = '';
    try {
      value = storage.getItem(key);
    } catch {
      value = '';
    }
    const token = unwrapStoredToken(value);
    if (isPrivyAccessToken(token)) return token;
  }
  return '';
}

function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input.url === 'string') return input.url;
  return '';
}

function requestMethod(input, init) {
  if (init && typeof init.method === 'string') return init.method;
  if (input && typeof input.method === 'string') return input.method;
  return 'GET';
}

/**
 * Install once on a window-like target. Returns the token cache.
 * Does not read or print secret values other than copying a JWT onto the
 * terms request header.
 */
export function installAcceptTermsAuth(target = globalThis) {
  if (!target || target.__maelstromAcceptTermsAuth) return target?.__maelstromAcceptTermsAuth ?? null;
  const auth = createAcceptTermsAuth();
  const storage = target.localStorage;
  if (storage && typeof storage.setItem === 'function') {
    const originalSet = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      originalSet(key, value);
      if (PRIVY_TOKEN_KEYS.includes(String(key))) auth.remember(value);
    };
    auth.remember(readPrivyAccessToken(storage));
  }
  const originalFetch = typeof target.fetch === 'function' ? target.fetch.bind(target) : null;
  const RequestImpl = target.Request ?? globalThis.Request;
  if (originalFetch && typeof RequestImpl === 'function') {
    target.fetch = (input, init) => {
      const url = requestUrl(input);
      const method = requestMethod(input, init);
      const token = auth.current(target.localStorage);
      const headers = new Headers(init?.headers || input?.headers || undefined);
      if (isAcceptTermsRequest(url, method) && token && !headers.has('authorization')) {
        headers.set('authorization', `Bearer ${token}`);
        if (typeof input === 'string' || input instanceof URL) {
          return originalFetch(input, { ...init, headers });
        }
        return originalFetch(new RequestImpl(input, { headers }));
      }
      return originalFetch(input, init);
    };
  }
  Object.defineProperty(target, '__maelstromAcceptTermsAuth', { value: auth, configurable: true });
  return auth;
}
