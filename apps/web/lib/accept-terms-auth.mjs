/**
 * Privy's terms Accept screen posts to auth.privy.io. Before that POST, the SDK
 * calls getAccessToken(), which can wipe localStorage and still send the request
 * with no Authorization header — Privy answers "Missing auth token."
 *
 * localStorage.setItem overrides are unreliable in browsers, so we also:
 * - snapshot tokens when Privy removeItem/clears them
 * - remember token fields from auth.privy.io JSON responses
 * - attach a cached bearer on the accept_terms POST when the header is missing
 *   or empty
 */

export const ACCEPT_TERMS_PATH = '/api/v1/users/me/accept_terms';
export const ACCEPT_TERMS_URL = `https://auth.privy.io${ACCEPT_TERMS_PATH}`;
export const PRIVY_AUTH_ORIGIN = 'https://auth.privy.io';

/** Exact keys Privy writes today, plus app-scoped variants like privy:<appId>:pat. */
export const PRIVY_TOKEN_KEY_RE = /^privy(?::[\w-]+)?:(pat|token)$/;

export const PRIVY_TOKEN_KEYS = Object.freeze(['privy:pat', 'privy:token']);

// Later fields win. Prefer Privy's own access JWT over the customer `token`.
const RESPONSE_TOKEN_FIELDS = Object.freeze([
  'access_token',
  'token',
  'privy_access_token',
]);

export function unwrapStoredToken(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('"') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
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

export function isPrivyTokenStorageKey(key) {
  return PRIVY_TOKEN_KEY_RE.test(String(key || ''));
}

export function isPrivyAuthOrigin(url) {
  try {
    return new URL(String(url)).origin === PRIVY_AUTH_ORIGIN;
  } catch {
    return false;
  }
}

export function isAcceptTermsRequest(url, method = 'GET') {
  if (String(method || 'GET').toUpperCase() !== 'POST') return false;
  try {
    const parsed = new URL(String(url), PRIVY_AUTH_ORIGIN);
    return parsed.origin === PRIVY_AUTH_ORIGIN && parsed.pathname === ACCEPT_TERMS_PATH;
  } catch {
    return false;
  }
}

export function authorizationNeedsToken(headers) {
  if (!headers || typeof headers.has !== 'function') return true;
  if (!headers.has('authorization')) return true;
  const value = String(headers.get('authorization') || '').trim();
  if (!value) return true;
  const match = /^Bearer(?:\s+(.*))?$/i.exec(value);
  if (!match) return false;
  const token = String(match[1] || '').trim();
  return !token || token === 'null' || token === 'undefined' || !isPrivyAccessToken(token);
}

export function rememberTokensFromPayload(auth, payload) {
  if (!auth || !payload || typeof payload !== 'object') return;
  for (const field of RESPONSE_TOKEN_FIELDS) {
    const value = payload[field];
    if (typeof value === 'string') auth.remember(value);
  }
  if (payload.data && typeof payload.data === 'object') {
    rememberTokensFromPayload(auth, payload.data);
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
  const keys = new Set(PRIVY_TOKEN_KEYS);
  if (typeof storage.length === 'number' && typeof storage.key === 'function') {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && isPrivyTokenStorageKey(key)) keys.add(key);
    }
  }
  for (const key of keys) {
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

function patchStorage(storage, auth) {
  if (!storage || typeof storage.getItem !== 'function') return;

  if (typeof storage.setItem === 'function') {
    const originalSet = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      originalSet(key, value);
      if (isPrivyTokenStorageKey(key)) auth.remember(value);
    };
  }

  // getAccessToken() → destroyLocalState() deletes keys; snapshot first.
  if (typeof storage.removeItem === 'function') {
    const originalRemove = storage.removeItem.bind(storage);
    storage.removeItem = (key) => {
      if (isPrivyTokenStorageKey(key)) {
        try {
          auth.remember(storage.getItem(key));
        } catch {
          /* ignore */
        }
      }
      originalRemove(key);
    };
  }

  if (typeof storage.clear === 'function') {
    const originalClear = storage.clear.bind(storage);
    storage.clear = () => {
      auth.remember(readPrivyAccessToken(storage));
      originalClear();
    };
  }

  auth.remember(readPrivyAccessToken(storage));
}

async function capturePrivyResponseTokens(auth, response) {
  if (!auth || !response || typeof response.clone !== 'function') return;
  const contentType = String(response.headers?.get?.('content-type') || '');
  if (contentType && !contentType.includes('json')) return;
  try {
    const payload = await response.clone().json();
    rememberTokensFromPayload(auth, payload);
  } catch {
    /* non-JSON or empty body */
  }
}

/**
 * Install once on a window-like target. Returns the token cache.
 * Does not read or print secret values other than copying a JWT onto the
 * terms request header.
 */
export function installAcceptTermsAuth(target = globalThis) {
  if (!target || target.__maelstromAcceptTermsAuth) {
    return target?.__maelstromAcceptTermsAuth ?? null;
  }
  const auth = createAcceptTermsAuth();
  patchStorage(target.localStorage, auth);

  const originalFetch = typeof target.fetch === 'function' ? target.fetch.bind(target) : null;
  const RequestImpl = target.Request ?? globalThis.Request;
  if (originalFetch && typeof RequestImpl === 'function') {
    target.fetch = (input, init) => {
      const url = requestUrl(input);
      const method = requestMethod(input, init);
      const token = auth.current(target.localStorage);
      const headers = new Headers(init?.headers || input?.headers || undefined);

      let nextInput = input;
      let nextInit = init;
      if (isAcceptTermsRequest(url, method) && token && authorizationNeedsToken(headers)) {
        headers.set('authorization', `Bearer ${token}`);
        if (typeof input === 'string' || input instanceof URL) {
          nextInit = { ...init, headers };
        } else {
          nextInput = new RequestImpl(input, { headers });
          nextInit = undefined;
        }
      }

      return Promise.resolve(
        nextInit === undefined ? originalFetch(nextInput) : originalFetch(nextInput, nextInit),
      ).then(async (response) => {
        if (isPrivyAuthOrigin(url) || isPrivyAuthOrigin(requestUrl(nextInput))) {
          await capturePrivyResponseTokens(auth, response);
        }
        return response;
      });
    };
  }

  Object.defineProperty(target, '__maelstromAcceptTermsAuth', {
    value: auth,
    configurable: true,
  });
  return auth;
}
