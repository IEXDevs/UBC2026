/**
 * Privy's AffirmativeConsent Accept calls getAccessToken(), which can wipe
 * localStorage and still POST accept_terms with no Authorization header.
 *
 * Instance overrides of localStorage.setItem often do not stick in browsers.
 * We patch Storage.prototype, keep a Maelstrom backup key, harvest JWTs from
 * auth.privy.io responses, inject a bearer on accept_terms, and expose
 * postAcceptTerms() for a first-party Accept UI that never calls getAccessToken.
 */

export const ACCEPT_TERMS_PATH = '/api/v1/users/me/accept_terms';
export const ACCEPT_TERMS_URL = `https://auth.privy.io${ACCEPT_TERMS_PATH}`;
export const PRIVY_AUTH_ORIGIN = 'https://auth.privy.io';
export const MAELSTROM_TOKEN_KEY = 'maelstrom:privy-at';

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

function writeBackup(storage, token) {
  if (!storage || typeof storage.setItem !== 'function' || !isPrivyAccessToken(token)) return;
  try {
    storage.setItem(MAELSTROM_TOKEN_KEY, token);
  } catch {
    /* private mode / quota */
  }
}

function readBackup(storage) {
  if (!storage || typeof storage.getItem !== 'function') return '';
  try {
    return unwrapStoredToken(storage.getItem(MAELSTROM_TOKEN_KEY));
  } catch {
    return '';
  }
}

export function createAcceptTermsAuth() {
  let cached = '';
  return {
    remember(value, storages = []) {
      const token = unwrapStoredToken(value);
      if (!isPrivyAccessToken(token)) return;
      // Same token: skip writeBackup to avoid setItem → remember recursion.
      if (cached === token) return;
      cached = token;
      for (const storage of storages) writeBackup(storage, token);
    },
    current(storage, sessionStorage) {
      const live = readPrivyAccessToken(storage);
      if (live) {
        cached = live;
        writeBackup(storage, live);
        writeBackup(sessionStorage, live);
        return live;
      }
      const localBackup = readBackup(storage);
      if (isPrivyAccessToken(localBackup)) {
        cached = localBackup;
        return localBackup;
      }
      const sessionBackup = readBackup(sessionStorage);
      if (isPrivyAccessToken(sessionBackup)) {
        cached = sessionBackup;
        return sessionBackup;
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

function patchStoragePrototype(auth, localStorage, sessionStorage) {
  const StorageCtor = localStorage?.constructor;
  const proto = StorageCtor?.prototype;
  if (!proto || proto.__maelstromAcceptTermsPatched) return;

  const originalSet = proto.setItem;
  const originalRemove = proto.removeItem;
  const originalClear = proto.clear;

  if (typeof originalSet === 'function') {
    proto.setItem = function setItem(key, value) {
      const result = originalSet.call(this, key, value);
      if (isPrivyTokenStorageKey(key) || key === MAELSTROM_TOKEN_KEY) {
        auth.remember(value, [localStorage, sessionStorage]);
      }
      return result;
    };
  }

  if (typeof originalRemove === 'function') {
    proto.removeItem = function removeItem(key) {
      if (isPrivyTokenStorageKey(key)) {
        try {
          auth.remember(this.getItem(key), [localStorage, sessionStorage]);
        } catch {
          /* ignore */
        }
      }
      if (key === MAELSTROM_TOKEN_KEY) {
        // Keep the Maelstrom backup through Privy wipes of unrelated keys only.
        return originalRemove.call(this, key);
      }
      return originalRemove.call(this, key);
    };
  }

  if (typeof originalClear === 'function') {
    proto.clear = function clear() {
      auth.remember(readPrivyAccessToken(this), [localStorage, sessionStorage]);
      const backup = readBackup(this) || auth.current(localStorage, sessionStorage);
      originalClear.call(this);
      if (isPrivyAccessToken(backup)) {
        try {
          originalSet.call(this, MAELSTROM_TOKEN_KEY, backup);
        } catch {
          /* ignore */
        }
      }
    };
  }

  Object.defineProperty(proto, '__maelstromAcceptTermsPatched', {
    value: true,
    configurable: true,
  });
}

function patchStorageInstance(storage, auth, backups) {
  if (!storage || typeof storage.getItem !== 'function') return;

  if (typeof storage.setItem === 'function') {
    const originalSet = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      originalSet(key, value);
      if (isPrivyTokenStorageKey(key) || key === MAELSTROM_TOKEN_KEY) {
        auth.remember(value, backups);
      }
    };
  }

  if (typeof storage.removeItem === 'function') {
    const originalRemove = storage.removeItem.bind(storage);
    storage.removeItem = (key) => {
      if (isPrivyTokenStorageKey(key)) {
        try {
          auth.remember(storage.getItem(key), backups);
        } catch {
          /* ignore */
        }
      }
      originalRemove(key);
    };
  }

  if (typeof storage.clear === 'function') {
    const originalClear = storage.clear.bind(storage);
    const originalSet = storage.setItem.bind(storage);
    storage.clear = () => {
      auth.remember(readPrivyAccessToken(storage), backups);
      const backup = readBackup(storage) || auth.current(...backups);
      originalClear();
      if (isPrivyAccessToken(backup)) {
        try {
          originalSet(MAELSTROM_TOKEN_KEY, backup);
        } catch {
          /* ignore */
        }
      }
    };
  }
}

async function capturePrivyResponseTokens(auth, response, backups) {
  if (!auth || !response || typeof response.clone !== 'function') return;
  const contentType = String(response.headers?.get?.('content-type') || '');
  if (contentType && !contentType.includes('json')) return;
  try {
    const payload = await response.clone().json();
    rememberTokensFromPayload(auth, payload);
    const token = auth.current(...backups);
    if (token) {
      for (const storage of backups) writeBackup(storage, token);
    }
  } catch {
    /* non-JSON or empty body */
  }
}

/**
 * POST accept_terms with an explicit bearer. Used by the first-party Accept UI
 * so we never go through Privy's getAccessToken wipe path.
 */
export async function postAcceptTerms({
  token,
  appId,
  clientId,
  fetchImpl = globalThis.fetch.bind(globalThis),
} = {}) {
  const accessToken = unwrapStoredToken(token);
  const id = typeof appId === 'string' ? appId.trim() : '';
  if (!isPrivyAccessToken(accessToken)) {
    return { ok: false, status: 0, error: 'token_missing' };
  }
  if (!id) {
    return { ok: false, status: 0, error: 'app_id_missing' };
  }

  const headers = {
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
    'privy-app-id': id,
    'privy-client': 'react-auth:maelstrom-accept-terms',
  };
  if (typeof clientId === 'string' && clientId.trim()) {
    headers['privy-client-id'] = clientId.trim();
  }

  try {
    const response = await fetchImpl(ACCEPT_TERMS_URL, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: '{}',
    });
    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json();
        detail = typeof body?.error === 'string'
          ? body.error
          : (typeof body?.message === 'string' ? body.message : '');
      } catch {
        detail = '';
      }
      return { ok: false, status: response.status, error: detail || 'accept_failed' };
    }
    return { ok: true, status: response.status, error: '' };
  } catch {
    return { ok: false, status: 0, error: 'network_error' };
  }
}

/**
 * Install once on a window-like target. Returns the token cache.
 */
export function installAcceptTermsAuth(target = globalThis) {
  if (!target || target.__maelstromAcceptTermsAuth) {
    return target?.__maelstromAcceptTermsAuth ?? null;
  }
  const auth = createAcceptTermsAuth();
  const localStorage = target.localStorage;
  const sessionStorage = target.sessionStorage;
  const backups = [localStorage, sessionStorage].filter(Boolean);

  patchStoragePrototype(auth, localStorage, sessionStorage);
  patchStorageInstance(localStorage, auth, backups);
  if (sessionStorage) patchStorageInstance(sessionStorage, auth, backups);
  auth.remember(readPrivyAccessToken(localStorage), backups);
  auth.remember(readBackup(localStorage), backups);
  auth.remember(readBackup(sessionStorage), backups);

  const originalFetch = typeof target.fetch === 'function' ? target.fetch.bind(target) : null;
  const RequestImpl = target.Request ?? globalThis.Request;
  if (originalFetch && typeof RequestImpl === 'function') {
    target.fetch = (input, init) => {
      const url = requestUrl(input);
      const method = requestMethod(input, init);
      const token = auth.current(localStorage, sessionStorage);
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
          await capturePrivyResponseTokens(auth, response, backups);
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

export function resolveAcceptTermsToken(target = globalThis) {
  const auth = target?.__maelstromAcceptTermsAuth;
  if (auth && typeof auth.current === 'function') {
    return auth.current(target.localStorage, target.sessionStorage);
  }
  return (
    readPrivyAccessToken(target?.localStorage)
    || readBackup(target?.localStorage)
    || readBackup(target?.sessionStorage)
  );
}
