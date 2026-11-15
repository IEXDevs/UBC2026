/**
 * Privy stores two JWTs:
 * - `privy:pat` is the user session (`privy_access_token`) that
 *   auth.privy.io expects on `POST /api/v1/users/me/accept_terms`.
 * - `privy:token` is the customer access token for our own API. Sending it
 *   as the Accept bearer is rejected as a missing session.
 *
 * `getAccessToken()` also deletes `privy:pat` when the refresh token is
 * missing, then posts accept_terms with no Authorization. ofetch captures
 * `globalThis.fetch` at import, so a late fetch wrapper never sees that
 * call. We keep the session JWT (and refresh token) ourselves and POST
 * accept_terms with `Authorization: Bearer <privy:pat>`.
 */

export const ACCEPT_TERMS_PATH = '/api/v1/users/me/accept_terms';
export const SESSIONS_PATH = '/api/v1/sessions';
export const ACCEPT_TERMS_URL = `https://auth.privy.io${ACCEPT_TERMS_PATH}`;
export const SESSIONS_URL = `https://auth.privy.io${SESSIONS_PATH}`;
export const PRIVY_AUTH_ORIGIN = 'https://auth.privy.io';
export const MAELSTROM_TOKEN_KEY = 'maelstrom:privy-at';
export const MAELSTROM_REFRESH_KEY = 'maelstrom:privy-rt';
export const PRIVY_ACCESS_TOKEN_KEY = 'privy:pat';
export const PRIVY_REFRESH_TOKEN_KEY = 'privy:refresh_token';
export const PRIVY_CA_ID_KEY = 'privy:caid';
/** Matches @privy-io/react-auth 3.51's `privy-client` header. */
export const PRIVY_CLIENT_HEADER = 'react-auth:3.51.4';

/** Session key only. `privy:token` is the customer access token, not the session. */
export const PRIVY_ACCESS_TOKEN_KEY_RE = /^privy(?::[\w-]+)?:pat$/;
export const PRIVY_REFRESH_TOKEN_KEY_RE = /^privy(?::[\w-]+)?:refresh_token$/;

export const PRIVY_TOKEN_KEYS = Object.freeze([PRIVY_ACCESS_TOKEN_KEY]);

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
  return PRIVY_ACCESS_TOKEN_KEY_RE.test(String(key || ''));
}

export function isPrivyRefreshStorageKey(key) {
  return PRIVY_REFRESH_TOKEN_KEY_RE.test(String(key || ''));
}

export function isRefreshToken(value) {
  const token = unwrapStoredToken(value);
  if (!token || token === 'deprecated' || token.length > 8192 || /\s/.test(token)) return '';
  return token;
}

function jwtPayload(token) {
  try {
    const part = String(token).split('.')[1];
    if (!part) return null;
    const padded = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = globalThis.atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='));
    const payload = JSON.parse(json);
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

/** A JWT we cannot decode is treated as usable so opaque test tokens still send. */
export function isUnexpiredPrivyAccessToken(value, now = Date.now()) {
  const token = unwrapStoredToken(value);
  if (!isPrivyAccessToken(token)) return false;
  const payload = jwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') return true;
  return now < payload.exp * 1000;
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

export function bearerFromHeaders(headers) {
  if (!headers || typeof headers.get !== 'function') return '';
  const value = String(headers.get('authorization') || '').trim();
  const match = /^Bearer\s+(\S+)/i.exec(value);
  return match ? match[1] : '';
}

export function authorizationNeedsToken(headers) {
  if (!headers || typeof headers.has !== 'function') return true;
  if (!headers.has('authorization')) return true;
  const token = bearerFromHeaders(headers);
  return !token || token === 'null' || token === 'undefined' || !isPrivyAccessToken(token);
}

export function rememberTokensFromPayload(auth, payload) {
  if (!auth || !payload || typeof payload !== 'object') return;
  const session = payload.privy_access_token;
  if (typeof session === 'string') auth.remember(session);
  const refresh = payload.refresh_token;
  if (typeof refresh === 'string' && auth.rememberRefresh) auth.rememberRefresh(refresh);
  if (payload.data && typeof payload.data === 'object') {
    rememberTokensFromPayload(auth, payload.data);
  }
}

function writeBackup(storage, key, token) {
  if (!storage || typeof storage.setItem !== 'function' || !token) return;
  try {
    storage.setItem(key, token);
  } catch {
    /* private mode / quota */
  }
}

function readBackup(storage, key) {
  if (!storage || typeof storage.getItem !== 'function') return '';
  try {
    return unwrapStoredToken(storage.getItem(key));
  } catch {
    return '';
  }
}

export function createAcceptTermsAuth() {
  let cached = '';
  let refresh = '';
  return {
    remember(value, storages = []) {
      const token = unwrapStoredToken(value);
      if (!isPrivyAccessToken(token)) return;
      if (cached === token) return;
      cached = token;
      for (const storage of storages) writeBackup(storage, MAELSTROM_TOKEN_KEY, token);
    },
    rememberRefresh(value, storages = []) {
      const token = isRefreshToken(value);
      if (!token) return;
      if (refresh === token) return;
      refresh = token;
      for (const storage of storages) writeBackup(storage, MAELSTROM_REFRESH_KEY, token);
    },
    current(storage, sessionStorage) {
      const live = readPrivyAccessToken(storage);
      if (live) {
        cached = live;
        writeBackup(storage, MAELSTROM_TOKEN_KEY, live);
        writeBackup(sessionStorage, MAELSTROM_TOKEN_KEY, live);
        return live;
      }
      const localBackup = readBackup(storage, MAELSTROM_TOKEN_KEY);
      if (isPrivyAccessToken(localBackup)) {
        cached = localBackup;
        return localBackup;
      }
      const sessionBackup = readBackup(sessionStorage, MAELSTROM_TOKEN_KEY);
      if (isPrivyAccessToken(sessionBackup)) {
        cached = sessionBackup;
        return sessionBackup;
      }
      return cached;
    },
    refreshToken(storage, sessionStorage) {
      const live = readPrivyRefreshToken(storage);
      if (live) {
        refresh = live;
        writeBackup(storage, MAELSTROM_REFRESH_KEY, live);
        writeBackup(sessionStorage, MAELSTROM_REFRESH_KEY, live);
        return live;
      }
      const localBackup = isRefreshToken(readBackup(storage, MAELSTROM_REFRESH_KEY));
      if (localBackup) {
        refresh = localBackup;
        return localBackup;
      }
      const sessionBackup = isRefreshToken(readBackup(sessionStorage, MAELSTROM_REFRESH_KEY));
      if (sessionBackup) {
        refresh = sessionBackup;
        return sessionBackup;
      }
      return refresh;
    },
  };
}

function tokenFromStorage(storage, seedKeys, matches, accept) {
  if (!storage || typeof storage.getItem !== 'function') return '';
  const keys = new Set(seedKeys);
  if (typeof storage.length === 'number' && typeof storage.key === 'function') {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && matches(key)) keys.add(key);
    }
  }
  for (const key of keys) {
    let value = '';
    try {
      value = storage.getItem(key);
    } catch {
      value = '';
    }
    const token = accept(value);
    if (token) return token;
  }
  return '';
}

export function readPrivyAccessToken(storage) {
  return tokenFromStorage(
    storage,
    PRIVY_TOKEN_KEYS,
    isPrivyTokenStorageKey,
    (value) => {
      const token = unwrapStoredToken(value);
      return isPrivyAccessToken(token) ? token : '';
    },
  );
}

export function readPrivyRefreshToken(storage) {
  return tokenFromStorage(
    storage,
    [PRIVY_REFRESH_TOKEN_KEY],
    isPrivyRefreshStorageKey,
    isRefreshToken,
  );
}

export function readPrivyCaId(storage) {
  if (!storage || typeof storage.getItem !== 'function') return '';
  try {
    const value = unwrapStoredToken(storage.getItem(PRIVY_CA_ID_KEY));
    if (!value || value.length > 128 || /\s/.test(value)) return '';
    return value;
  } catch {
    return '';
  }
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

function noteStoredValue(auth, key, value, backups) {
  if (isPrivyTokenStorageKey(key) || key === MAELSTROM_TOKEN_KEY) {
    auth.remember(value, backups);
  }
  if (isPrivyRefreshStorageKey(key) || key === MAELSTROM_REFRESH_KEY) {
    auth.rememberRefresh(value, backups);
  }
}

function snapshotBeforeRemove(auth, storage, key, backups) {
  if (!isPrivyTokenStorageKey(key) && !isPrivyRefreshStorageKey(key)) return;
  try {
    noteStoredValue(auth, key, storage.getItem(key), backups);
  } catch {
    /* ignore */
  }
}

function restoreBackups(auth, storage, backups, originalSet) {
  const access = readBackup(storage, MAELSTROM_TOKEN_KEY) || auth.current(...backups);
  const refresh = isRefreshToken(readBackup(storage, MAELSTROM_REFRESH_KEY)) || auth.refreshToken(...backups);
  if (isPrivyAccessToken(access)) {
    try { originalSet.call(storage, MAELSTROM_TOKEN_KEY, access); } catch { /* ignore */ }
  }
  if (refresh) {
    try { originalSet.call(storage, MAELSTROM_REFRESH_KEY, refresh); } catch { /* ignore */ }
  }
}

function patchStoragePrototype(auth, localStorage, sessionStorage) {
  const StorageCtor = localStorage?.constructor;
  const proto = StorageCtor?.prototype;
  if (!proto || proto.__maelstromAcceptTermsPatched) return;

  const originalSet = proto.setItem;
  const originalRemove = proto.removeItem;
  const originalClear = proto.clear;
  const backups = [localStorage, sessionStorage];

  if (typeof originalSet === 'function') {
    proto.setItem = function setItem(key, value) {
      const result = originalSet.call(this, key, value);
      noteStoredValue(auth, key, value, backups);
      return result;
    };
  }

  if (typeof originalRemove === 'function') {
    proto.removeItem = function removeItem(key) {
      snapshotBeforeRemove(auth, this, key, backups);
      return originalRemove.call(this, key);
    };
  }

  if (typeof originalClear === 'function') {
    proto.clear = function clear() {
      auth.remember(readPrivyAccessToken(this), backups);
      auth.rememberRefresh(readPrivyRefreshToken(this), backups);
      originalClear.call(this);
      restoreBackups(auth, this, backups, originalSet);
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
      noteStoredValue(auth, key, value, backups);
    };
  }

  if (typeof storage.removeItem === 'function') {
    const originalRemove = storage.removeItem.bind(storage);
    storage.removeItem = (key) => {
      snapshotBeforeRemove(auth, storage, key, backups);
      originalRemove(key);
    };
  }

  if (typeof storage.clear === 'function') {
    const originalClear = storage.clear.bind(storage);
    const originalSet = storage.setItem.bind(storage);
    storage.clear = () => {
      auth.remember(readPrivyAccessToken(storage), backups);
      auth.rememberRefresh(readPrivyRefreshToken(storage), backups);
      originalClear();
      restoreBackups(auth, storage, backups, originalSet);
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
    const refresh = auth.refreshToken(...backups);
    for (const storage of backups) {
      if (token) writeBackup(storage, MAELSTROM_TOKEN_KEY, token);
      if (refresh) writeBackup(storage, MAELSTROM_REFRESH_KEY, refresh);
    }
  } catch {
    /* non-JSON or empty body */
  }
}

function privyHeaders({ appId, clientId, caId, token }) {
  const headers = {
    'content-type': 'application/json',
    'privy-app-id': appId,
    'privy-client': PRIVY_CLIENT_HEADER,
    'privy-ca-id': typeof caId === 'string' ? caId : '',
  };
  if (typeof clientId === 'string' && clientId.trim()) {
    headers['privy-client-id'] = clientId.trim();
  }
  if (isPrivyAccessToken(token)) headers.authorization = `Bearer ${unwrapStoredToken(token)}`;
  return headers;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function mintPrivyAccessToken({
  refreshToken,
  appId,
  clientId,
  caId,
  fetchImpl,
}) {
  const refresh = isRefreshToken(refreshToken);
  const id = typeof appId === 'string' ? appId.trim() : '';
  if (!refresh || !id) return { token: '', refresh: '', error: refresh ? 'app_id_missing' : 'refresh_missing' };
  try {
    const response = await fetchImpl(SESSIONS_URL, {
      method: 'POST',
      credentials: 'include',
      headers: privyHeaders({ appId: id, clientId, caId }),
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!response.ok) return { token: '', refresh: '', error: 'refresh_failed' };
    const body = await readJson(response);
    const token = unwrapStoredToken(body?.privy_access_token);
    const nextRefresh = isRefreshToken(body?.refresh_token) || refresh;
    if (!isPrivyAccessToken(token)) return { token: '', refresh: nextRefresh, error: 'refresh_failed' };
    return { token, refresh: nextRefresh, error: '' };
  } catch {
    return { token: '', refresh: '', error: 'network_error' };
  }
}

function persistSession(storages, accessToken, refreshToken) {
  for (const storage of storages || []) {
    if (!storage || typeof storage.setItem !== 'function') continue;
    try {
      if (isPrivyAccessToken(accessToken)) {
        storage.setItem(PRIVY_ACCESS_TOKEN_KEY, JSON.stringify(unwrapStoredToken(accessToken)));
      }
      const refresh = isRefreshToken(refreshToken);
      if (refresh) storage.setItem(PRIVY_REFRESH_TOKEN_KEY, JSON.stringify(refresh));
    } catch {
      /* ignore */
    }
  }
}

/**
 * POST accept_terms with the privy access token. A customer access token is
 * never sent. When the session JWT is missing or expired, mint one with the
 * refresh token first.
 */
export async function postAcceptTerms({
  token,
  refreshToken,
  appId,
  clientId,
  caId,
  storages,
  fetchImpl = globalThis.fetch.bind(globalThis),
} = {}) {
  const id = typeof appId === 'string' ? appId.trim() : '';
  if (!id) return { ok: false, status: 0, error: 'app_id_missing' };

  let accessToken = unwrapStoredToken(token);
  let refresh = isRefreshToken(refreshToken);
  if (!isUnexpiredPrivyAccessToken(accessToken) && refresh) {
    const minted = await mintPrivyAccessToken({
      refreshToken: refresh,
      appId: id,
      clientId,
      caId,
      fetchImpl,
    });
    if (minted.error === 'network_error') return { ok: false, status: 0, error: 'network_error' };
    if (minted.token) {
      accessToken = minted.token;
      refresh = minted.refresh || refresh;
    }
  }
  if (!isPrivyAccessToken(accessToken)) {
    return { ok: false, status: 0, error: 'token_missing' };
  }

  persistSession(storages, accessToken, refresh);

  try {
    const response = await fetchImpl(ACCEPT_TERMS_URL, {
      method: 'POST',
      credentials: 'include',
      headers: privyHeaders({
        appId: id,
        clientId,
        caId,
        token: accessToken,
      }),
      body: '{}',
    });
    if (!response.ok) {
      const body = await readJson(response);
      const detail = typeof body?.error === 'string'
        ? body.error
        : (typeof body?.message === 'string' ? body.message : '');
      return { ok: false, status: response.status, error: detail || 'accept_failed' };
    }
    return { ok: true, status: response.status, error: '' };
  } catch {
    return { ok: false, status: 0, error: 'network_error' };
  }
}

function applySessionBearer(headers, token) {
  if (!isPrivyAccessToken(token)) return false;
  if (bearerFromHeaders(headers) === unwrapStoredToken(token)) return false;
  headers.set('authorization', `Bearer ${unwrapStoredToken(token)}`);
  return true;
}

/**
 * Install once on a window-like target. Returns the token cache.
 * Call this before `@privy-io/react-auth` evaluates ofetch, which freezes
 * the fetch it will use for accept_terms.
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
  auth.remember(readBackup(localStorage, MAELSTROM_TOKEN_KEY), backups);
  auth.remember(readBackup(sessionStorage, MAELSTROM_TOKEN_KEY), backups);
  auth.rememberRefresh(readPrivyRefreshToken(localStorage), backups);
  auth.rememberRefresh(readBackup(localStorage, MAELSTROM_REFRESH_KEY), backups);
  auth.rememberRefresh(readBackup(sessionStorage, MAELSTROM_REFRESH_KEY), backups);

  const originalFetch = typeof target.__maelstromNativeFetch === 'function'
    ? target.__maelstromNativeFetch
    : (typeof target.fetch === 'function' ? target.fetch.bind(target) : null);
  const RequestImpl = target.Request ?? globalThis.Request;
  if (originalFetch && typeof RequestImpl === 'function') {
    const hookedFetch = async (input, init) => {
      const url = requestUrl(input);
      const method = requestMethod(input, init);
      let nextInput = input;
      let nextInit = init;

      if (isAcceptTermsRequest(url, method)) {
        const headers = new Headers(init?.headers || input?.headers || undefined);
        let token = auth.current(localStorage, sessionStorage);
        if (!isUnexpiredPrivyAccessToken(token)) {
          const minted = await mintPrivyAccessToken({
            refreshToken: auth.refreshToken(localStorage, sessionStorage),
            appId: headers.get('privy-app-id') || '',
            clientId: headers.get('privy-client-id') || '',
            caId: headers.get('privy-ca-id') || readPrivyCaId(localStorage),
            fetchImpl: originalFetch,
          });
          if (minted.token) {
            token = minted.token;
            auth.remember(token, backups);
            auth.rememberRefresh(minted.refresh, backups);
            persistSession(backups, token, minted.refresh);
          }
        }
        if (applySessionBearer(headers, token)) {
          if (typeof input === 'string' || input instanceof URL) {
            nextInit = { ...init, headers };
          } else {
            nextInput = new RequestImpl(input, { headers });
            nextInit = undefined;
          }
        }
      }

      const response = await (
        nextInit === undefined ? originalFetch(nextInput) : originalFetch(nextInput, nextInit)
      );
      if (isPrivyAuthOrigin(url) || isPrivyAuthOrigin(requestUrl(nextInput))) {
        await capturePrivyResponseTokens(auth, response, backups);
      }
      return response;
    };
    target.__maelstromFetchHook = hookedFetch;
    target.fetch = hookedFetch;
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
    || readBackup(target?.localStorage, MAELSTROM_TOKEN_KEY)
    || readBackup(target?.sessionStorage, MAELSTROM_TOKEN_KEY)
  );
}

export function resolvePrivyRefreshToken(target = globalThis) {
  const auth = target?.__maelstromAcceptTermsAuth;
  if (auth && typeof auth.refreshToken === 'function') {
    return auth.refreshToken(target.localStorage, target.sessionStorage);
  }
  return (
    readPrivyRefreshToken(target?.localStorage)
    || isRefreshToken(readBackup(target?.localStorage, MAELSTROM_REFRESH_KEY))
    || isRefreshToken(readBackup(target?.sessionStorage, MAELSTROM_REFRESH_KEY))
  );
}
