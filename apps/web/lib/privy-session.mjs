/**
 * Soft Privy session mirror.
 *
 * Privy owns localStorage (`privy:pat` / `privy:token` / `privy:refresh_token`,
 * optionally prefixed with the active user id). We only:
 * - mirror writes into Maelstrom backups
 * - gap-fill any missing Privy keys from those backups on boot / before token reads
 *
 * Never block removeItem/clear — that fought Privy and signed people out.
 *
 * Critical: Privy destroys the whole session when an access token is present
 * without a refresh token. Restoring only when *all* keys are missing left
 * that hole open after a partial wipe or a raced login write.
 */

import {
  isPrivyAccessToken,
  isPrivyCustomerTokenStorageKey,
  isPrivyRefreshStorageKey,
  isPrivySessionStorageKey,
  isPrivyTokenStorageKey,
  MAELSTROM_CUSTOMER_KEY,
  MAELSTROM_REFRESH_KEY,
  MAELSTROM_TOKEN_KEY,
  PRIVY_ACCESS_TOKEN_KEY,
  PRIVY_CUSTOMER_TOKEN_KEY,
  PRIVY_REFRESH_TOKEN_KEY,
  unwrapStoredToken,
} from './accept-terms-auth.mjs';

export const PRIVY_ACTIVE_USER_KEY = 'privy:active-user';
export const PRIVY_SAVED_USERS_KEY = 'privy:saved-users';
export const MAELSTROM_ACTIVE_USER_KEY = 'maelstrom:privy-uid';

function isRefreshToken(value) {
  const token = unwrapStoredToken(value);
  if (!token || token === 'deprecated' || token.length < 8 || token.length > 8192 || /\s/.test(token)) {
    return '';
  }
  return token;
}

function write(storage, key, value) {
  if (!storage || typeof storage.setItem !== 'function' || !key || value == null || value === '') return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function read(storage, key) {
  if (!storage || typeof storage.getItem !== 'function') return '';
  try {
    return storage.getItem(key) || '';
  } catch {
    return '';
  }
}

function remove(storage, key) {
  if (!storage || typeof storage.removeItem !== 'function' || !key) return;
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function encodePrivyValue(token) {
  return JSON.stringify(token);
}

function patKey(userId) {
  return userId ? `privy:${userId}:pat` : PRIVY_ACCESS_TOKEN_KEY;
}

function customerKey(userId) {
  return userId ? `privy:${userId}:token` : PRIVY_CUSTOMER_TOKEN_KEY;
}

function refreshKey(userId) {
  return userId ? `privy:${userId}:refresh_token` : PRIVY_REFRESH_TOKEN_KEY;
}

/** Best-effort user id (`did:privy:…`) from a Privy access/customer JWT. */
export function userIdFromPrivyToken(value) {
  const token = unwrapStoredToken(value);
  if (!isPrivyAccessToken(token)) return '';
  try {
    const part = token.split('.')[1];
    if (!part) return '';
    const padded = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = globalThis.atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='));
    const payload = JSON.parse(json);
    const sub = typeof payload?.sub === 'string' ? payload.sub.trim() : '';
    if (!sub || sub.length > 256 || /\s/.test(sub)) return '';
    return sub;
  } catch {
    return '';
  }
}

function readAccess(storage, key) {
  const token = unwrapStoredToken(read(storage, key));
  return isPrivyAccessToken(token) ? token : '';
}

function readRefresh(storage, key) {
  return isRefreshToken(read(storage, key));
}

function firstAccess(storage, userId, base) {
  if (userId) {
    const prefixed = readAccess(storage, base === 'pat' ? patKey(userId) : customerKey(userId));
    if (prefixed) return prefixed;
  }
  return readAccess(storage, base === 'pat' ? PRIVY_ACCESS_TOKEN_KEY : PRIVY_CUSTOMER_TOKEN_KEY);
}

function firstRefresh(storage, userId) {
  if (userId) {
    const prefixed = readRefresh(storage, refreshKey(userId));
    if (prefixed) return prefixed;
  }
  return readRefresh(storage, PRIVY_REFRESH_TOKEN_KEY);
}

function fillKey(storage, key, token, restored) {
  if (!token) return;
  const existing = key.includes('refresh_token') ? readRefresh(storage, key) : readAccess(storage, key);
  if (existing) return;
  if (write(storage, key, encodePrivyValue(token))) restored.push(key);
}

function ensureActiveUser(storage, userId, restored) {
  if (!userId) return;
  const active = unwrapStoredToken(read(storage, PRIVY_ACTIVE_USER_KEY));
  if (active !== userId) {
    if (write(storage, PRIVY_ACTIVE_USER_KEY, encodePrivyValue(userId))) {
      restored.push(PRIVY_ACTIVE_USER_KEY);
    }
  }
  try {
    const raw = read(storage, PRIVY_SAVED_USERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
    if (!list.includes(userId)) {
      if (write(storage, PRIVY_SAVED_USERS_KEY, JSON.stringify([...list, userId]))) {
        restored.push(PRIVY_SAVED_USERS_KEY);
      }
    }
  } catch {
    if (write(storage, PRIVY_SAVED_USERS_KEY, JSON.stringify([userId]))) {
      restored.push(PRIVY_SAVED_USERS_KEY);
    }
  }
}

/** Backup whatever Privy just wrote. Safe to call repeatedly. */
export function mirrorPrivyStorageWrite(key, value, storages = []) {
  const name = String(key || '');
  if (name === PRIVY_ACTIVE_USER_KEY) {
    const userId = unwrapStoredToken(typeof value === 'string' ? value : '');
    if (!userId) return false;
    for (const storage of storages) write(storage, MAELSTROM_ACTIVE_USER_KEY, userId);
    return true;
  }
  if (!isPrivySessionStorageKey(name)) return false;
  const raw = typeof value === 'string' ? value : '';
  if (isPrivyTokenStorageKey(name)) {
    const token = unwrapStoredToken(raw);
    if (!isPrivyAccessToken(token)) return false;
    for (const storage of storages) {
      write(storage, MAELSTROM_TOKEN_KEY, token);
      const userId = userIdFromPrivyToken(token);
      if (userId) write(storage, MAELSTROM_ACTIVE_USER_KEY, userId);
    }
    return true;
  }
  if (isPrivyCustomerTokenStorageKey(name)) {
    const token = unwrapStoredToken(raw);
    if (!isPrivyAccessToken(token)) return false;
    for (const storage of storages) {
      write(storage, MAELSTROM_CUSTOMER_KEY, token);
      const userId = userIdFromPrivyToken(token);
      if (userId) write(storage, MAELSTROM_ACTIVE_USER_KEY, userId);
    }
    return true;
  }
  if (isPrivyRefreshStorageKey(name)) {
    const token = isRefreshToken(raw);
    if (!token) return false;
    for (const storage of storages) write(storage, MAELSTROM_REFRESH_KEY, token);
    return true;
  }
  return false;
}

/**
 * Gap-fill any missing Privy session keys from Maelstrom backups.
 * Call before mounting PrivyProvider and again before getAccessToken.
 */
export function restorePrivySessionIfMissing(storage, sessionStorage = null) {
  if (!storage) return { restored: false, keys: [] };
  const restored = [];

  const backupPat = unwrapStoredToken(read(storage, MAELSTROM_TOKEN_KEY))
    || unwrapStoredToken(read(sessionStorage, MAELSTROM_TOKEN_KEY));
  const backupCustomer = unwrapStoredToken(read(storage, MAELSTROM_CUSTOMER_KEY))
    || unwrapStoredToken(read(sessionStorage, MAELSTROM_CUSTOMER_KEY));
  const backupRefresh = isRefreshToken(read(storage, MAELSTROM_REFRESH_KEY))
    || isRefreshToken(read(sessionStorage, MAELSTROM_REFRESH_KEY));
  const backupUser = unwrapStoredToken(read(storage, MAELSTROM_ACTIVE_USER_KEY))
    || unwrapStoredToken(read(sessionStorage, MAELSTROM_ACTIVE_USER_KEY))
    || unwrapStoredToken(read(storage, PRIVY_ACTIVE_USER_KEY));

  const userId = backupUser
    || userIdFromPrivyToken(firstAccess(storage, '', 'token') || backupCustomer)
    || userIdFromPrivyToken(firstAccess(storage, '', 'pat') || backupPat);

  const pat = firstAccess(storage, userId, 'pat') || (isPrivyAccessToken(backupPat) ? backupPat : '');
  const customer = firstAccess(storage, userId, 'token')
    || (isPrivyAccessToken(backupCustomer) ? backupCustomer : '');
  const refresh = firstRefresh(storage, userId) || backupRefresh;

  // Write legacy (unprefixed) + user-prefixed forms so either Privy path can find them.
  for (const id of (userId ? [null, userId] : [null])) {
    fillKey(storage, patKey(id), pat, restored);
    fillKey(storage, customerKey(id), customer, restored);
    fillKey(storage, refreshKey(id), refresh, restored);
  }

  ensureActiveUser(storage, userId, restored);
  if (userId) write(storage, MAELSTROM_ACTIVE_USER_KEY, userId);

  return { restored: restored.length > 0, keys: [...new Set(restored)] };
}

/** Same as restore — name used at call sites that run right before getAccessToken. */
export function ensurePrivySessionKeys(storage, sessionStorage = null) {
  return restorePrivySessionIfMissing(storage, sessionStorage);
}

export function clearPrivySessionBackups(storage, sessionStorage = null) {
  for (const store of [storage, sessionStorage]) {
    remove(store, MAELSTROM_TOKEN_KEY);
    remove(store, MAELSTROM_CUSTOMER_KEY);
    remove(store, MAELSTROM_REFRESH_KEY);
    remove(store, MAELSTROM_ACTIVE_USER_KEY);
  }
}

/**
 * Install a setItem mirror only. Does not wrap removeItem/clear.
 */
export function installPrivySessionMirror(target = globalThis) {
  if (!target || target.__maelstromPrivySessionMirror) {
    return target?.__maelstromPrivySessionMirror ?? null;
  }
  const storage = target.localStorage;
  const session = target.sessionStorage;
  if (!storage || typeof storage.setItem !== 'function') return null;

  const original = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    original(key, value);
    mirrorPrivyStorageWrite(key, value, [storage, session].filter(Boolean));
  };

  const api = {
    uninstall() {
      try {
        storage.setItem = original;
      } catch {
        /* ignore */
      }
      try {
        delete target.__maelstromPrivySessionMirror;
      } catch {
        target.__maelstromPrivySessionMirror = null;
      }
    },
  };
  Object.defineProperty(target, '__maelstromPrivySessionMirror', {
    value: api,
    configurable: true,
    enumerable: false,
    writable: true,
  });
  return api;
}
