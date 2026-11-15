/**
 * Privy's AffirmativeConsent Accept calls getAccessToken(), which can wipe
 * localStorage and still POST accept_terms with no Authorization header.
 *
 * We:
 * - keep Maelstrom backups of access + refresh tokens
 * - refuse Privy session key deletes unless logout is explicitly allowed
 * - preserve privy:* keys across localStorage.clear()
 * - harvest tokens from auth.privy.io JSON responses
 * - inject a bearer on accept_terms when the header is missing
 * - expose postAcceptTerms() for a first-party Accept UI
 */

export const ACCEPT_TERMS_PATH = '/api/v1/users/me/accept_terms';
export const ACCEPT_TERMS_URL = `https://auth.privy.io${ACCEPT_TERMS_PATH}`;
export const PRIVY_AUTH_ORIGIN = 'https://auth.privy.io';
export const MAELSTROM_TOKEN_KEY = 'maelstrom:privy-at';
export const MAELSTROM_REFRESH_KEY = 'maelstrom:privy-rt';
export const PRIVY_LOGOUT_FLAG = '__maelstromAllowPrivyLogout';

/** Exact keys Privy writes today, plus app-scoped variants like privy:<appId>:pat. */
export const PRIVY_TOKEN_KEY_RE = /^privy(?::[\w-]+)?:(pat|token)$/;
export const PRIVY_REFRESH_KEY_RE = /^privy(?::[\w-]+)?:refresh_token$/;

export const PRIVY_TOKEN_KEYS = Object.freeze(['privy:pat', 'privy:token']);
export const PRIVY_REFRESH_KEYS = Object.freeze(['privy:refresh_token']);

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

export function isPrivyRefreshToken(value) {
  const token = unwrapStoredToken(value);
  return Boolean(token) && token.length <= 8192 && !/\s/.test(token);
}

export function isPrivyTokenStorageKey(key) {
  return PRIVY_TOKEN_KEY_RE.test(String(key || ''));
}

export function isPrivyRefreshStorageKey(key) {
  return PRIVY_REFRESH_KEY_RE.test(String(key || ''));
}

export function isPrivySessionStorageKey(key) {
  const name = String(key || '');
  return isPrivyTokenStorageKey(name)
    || isPrivyRefreshStorageKey(name)
    || name === 'privy:id_token'
    || /^privy(?::[\w-]+)?:id[_-]token$/.test(name);
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
  if (typeof payload.refresh_token === 'string') auth.rememberRefresh(payload.refresh_token);
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

function writeRefreshBackup(storage, token) {
  if (!storage || typeof storage.setItem !== 'function' || !isPrivyRefreshToken(token)) return;
  try {
    storage.setItem(MAELSTROM_REFRESH_KEY, token);
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

function readRefreshBackup(storage) {
  if (!storage || typeof storage.getItem !== 'function') return '';
  try {
    return unwrapStoredToken(storage.getItem(MAELSTROM_REFRESH_KEY));
  } catch {
    return '';
  }
}

function encodePrivyValue(value) {
  return JSON.stringify(String(value));
}

function logoutAllowed(target) {
  return Boolean(target?.[PRIVY_LOGOUT_FLAG]);
}

export function allowPrivyLogout(target = globalThis, enabled = true) {
  if (!target) return;
  target[PRIVY_LOGOUT_FLAG] = enabled === true;
}

export async function withPrivyLogout(target, run) {
  allowPrivyLogout(target, true);
  try {
    return await run();
  } finally {
    allowPrivyLogout(target, false);
  }
}

export function createAcceptTermsAuth() {
  let cached = '';
  let cachedRefresh = '';
  return {
    remember(value, storages = []) {
      const token = unwrapStoredToken(value);
      if (!isPrivyAccessToken(token)) return;
      if (cached === token) return;
      cached = token;
      for (const storage of storages) writeBackup(storage, token);
    },
    rememberRefresh(value, storages = []) {
      const token = unwrapStoredToken(value);
      if (!isPrivyRefreshToken(token)) return;
      if (cachedRefresh === token) return;
      cachedRefresh = token;
      for (const storage of storages) writeRefreshBackup(storage, token);
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
    currentRefresh(storage, sessionStorage) {
      const live = readPrivyRefreshToken(storage);
      if (live) {
        cachedRefresh = live;
        writeRefreshBackup(storage, live);
        writeRefreshBackup(sessionStorage, live);
        return live;
      }
      const localBackup = readRefreshBackup(storage);
      if (isPrivyRefreshToken(localBackup)) {
        cachedRefresh = localBackup;
        return localBackup;
      }
      const sessionBackup = readRefreshBackup(sessionStorage);
      if (isPrivyRefreshToken(sessionBackup)) {
        cachedRefresh = sessionBackup;
        return sessionBackup;
      }
      return cachedRefresh;
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

export function readPrivyRefreshToken(storage) {
  if (!storage || typeof storage.getItem !== 'function') return '';
  const keys = new Set(PRIVY_REFRESH_KEYS);
  if (typeof storage.length === 'number' && typeof storage.key === 'function') {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && isPrivyRefreshStorageKey(key)) keys.add(key);
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
    if (isPrivyRefreshToken(token)) return token;
  }
  return '';
}

/** Put backed-up Privy session keys back so refresh restores login. */
export function restorePrivySession(storage, auth) {
  if (!storage || typeof storage.setItem !== 'function') return false;
  let restored = false;
  const access = auth?.current?.(storage) || readBackup(storage) || readPrivyAccessToken(storage);
  const refresh = auth?.currentRefresh?.(storage) || readRefreshBackup(storage) || readPrivyRefreshToken(storage);
  try {
    if (isPrivyAccessToken(access) && !readPrivyAccessToken(storage)) {
      storage.setItem('privy:pat', encodePrivyValue(access));
      restored = true;
    }
    if (isPrivyRefreshToken(refresh) && !readPrivyRefreshToken(storage)) {
      storage.setItem('privy:refresh_token', encodePrivyValue(refresh));
      restored = true;
    }
  } catch {
    return false;
  }
  return restored;
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

function snapshotSessionKey(storage, auth, key, backups) {
  if (!storage || typeof storage.getItem !== 'function') return;
  try {
    const value = storage.getItem(key);
    if (isPrivyTokenStorageKey(key)) auth.remember(value, backups);
    if (isPrivyRefreshStorageKey(key)) auth.rememberRefresh(value, backups);
  } catch {
    /* ignore */
  }
}

function preserveSessionEntries(storage) {
  const keep = {};
  if (!storage || typeof storage.key !== 'function' || typeof storage.getItem !== 'function') return keep;
  const length = typeof storage.length === 'number' ? storage.length : 0;
  for (let i = 0; i < length; i += 1) {
    const key = storage.key(i);
    if (!key) continue;
    if (isPrivySessionStorageKey(key) || key === MAELSTROM_TOKEN_KEY || key === MAELSTROM_REFRESH_KEY) {
      try {
        const value = storage.getItem(key);
        if (value != null) keep[key] = value;
      } catch {
        /* ignore */
      }
    }
  }
  return keep;
}

function patchStoragePrototype(auth, localStorage, sessionStorage, target) {
  const StorageCtor = localStorage?.constructor;
  const proto = StorageCtor?.prototype;
  // Never patch Object.prototype (test doubles) — only real Storage.
  if (!proto || proto === Object.prototype || proto.__maelstromAcceptTermsPatched) return;
  if (typeof StorageCtor?.name === 'string' && StorageCtor.name && StorageCtor.name !== 'Storage') return;
  const backups = [localStorage, sessionStorage].filter(Boolean);

  const originalSet = proto.setItem;
  const originalRemove = proto.removeItem;
  const originalClear = proto.clear;

  if (typeof originalSet === 'function') {
    proto.setItem = function setItem(key, value) {
      const result = originalSet.call(this, key, value);
      if (isPrivyTokenStorageKey(key) || key === MAELSTROM_TOKEN_KEY) {
        auth.remember(value, backups);
      }
      if (isPrivyRefreshStorageKey(key) || key === MAELSTROM_REFRESH_KEY) {
        auth.rememberRefresh(value, backups);
      }
      return result;
    };
  }

  if (typeof originalRemove === 'function') {
    proto.removeItem = function removeItem(key) {
      snapshotSessionKey(this, auth, key, backups);
      if (isPrivySessionStorageKey(key) && !logoutAllowed(target)) {
        // getAccessToken() can destroyLocalState() when refresh is briefly
        // missing; keep the session so refresh still restores login.
        return undefined;
      }
      return originalRemove.call(this, key);
    };
  }

  if (typeof originalClear === 'function') {
    proto.clear = function clear() {
      auth.remember(readPrivyAccessToken(this), backups);
      auth.rememberRefresh(readPrivyRefreshToken(this), backups);
      const keep = preserveSessionEntries(this);
      originalClear.call(this);
      for (const [key, value] of Object.entries(keep)) {
        try {
          originalSet.call(this, key, value);
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

function patchStorageInstance(storage, auth, backups, target) {
  if (!storage || typeof storage.getItem !== 'function') return;

  if (typeof storage.setItem === 'function') {
    const originalSet = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      originalSet(key, value);
      if (isPrivyTokenStorageKey(key) || key === MAELSTROM_TOKEN_KEY) {
        auth.remember(value, backups);
      }
      if (isPrivyRefreshStorageKey(key) || key === MAELSTROM_REFRESH_KEY) {
        auth.rememberRefresh(value, backups);
      }
    };
  }

  if (typeof storage.removeItem === 'function') {
    const originalRemove = storage.removeItem.bind(storage);
    storage.removeItem = (key) => {
      snapshotSessionKey(storage, auth, key, backups);
      if (isPrivySessionStorageKey(key) && !logoutAllowed(target)) return;
      originalRemove(key);
    };
  }

  if (typeof storage.clear === 'function') {
    const originalClear = storage.clear.bind(storage);
    const originalSet = storage.setItem.bind(storage);
    storage.clear = () => {
      auth.remember(readPrivyAccessToken(storage), backups);
      auth.rememberRefresh(readPrivyRefreshToken(storage), backups);
      const keep = preserveSessionEntries(storage);
      originalClear();
      for (const [key, value] of Object.entries(keep)) {
        try {
          originalSet(key, value);
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
    const refresh = auth.currentRefresh(...backups);
    for (const storage of backups) {
      if (token) writeBackup(storage, token);
      if (refresh) writeRefreshBackup(storage, refresh);
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

  patchStoragePrototype(auth, localStorage, sessionStorage, target);
  patchStorageInstance(localStorage, auth, backups, target);
  if (sessionStorage) patchStorageInstance(sessionStorage, auth, backups, target);
  auth.remember(readPrivyAccessToken(localStorage), backups);
  auth.remember(readBackup(localStorage), backups);
  auth.remember(readBackup(sessionStorage), backups);
  auth.rememberRefresh(readPrivyRefreshToken(localStorage), backups);
  auth.rememberRefresh(readRefreshBackup(localStorage), backups);
  auth.rememberRefresh(readRefreshBackup(sessionStorage), backups);
  restorePrivySession(localStorage, auth);

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
          restorePrivySession(localStorage, auth);
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
