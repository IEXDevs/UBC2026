/**
 * Soft Privy session helpers.
 *
 * Privy destroys the entire session (pat + token + refresh) when
 * getAccessToken() runs with a live access token and no refresh_token.
 * We:
 * - mirror writes into Maelstrom backups
 * - restore once on cold boot
 * - re-attach refresh from backup if Privy deletes it while access is live
 * - never call getAccessToken when that would trigger destroyLocalState
 *
 * Do not wrap clear() or block all removeItem — only repair refresh deletes.
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

function readAccess(storage, key) {
  const token = unwrapStoredToken(read(storage, key));
  return isPrivyAccessToken(token) ? token : '';
}

function readRefresh(storage, key) {
  return isRefreshToken(read(storage, key));
}

function fillKey(storage, key, token) {
  if (!token) return false;
  const existing = key.includes('refresh_token') ? readRefresh(storage, key) : readAccess(storage, key);
  if (existing) return false;
  return write(storage, key, encodePrivyValue(token));
}

function liveAccessToken(storage) {
  return readAccess(storage, PRIVY_CUSTOMER_TOKEN_KEY) || readAccess(storage, PRIVY_ACCESS_TOKEN_KEY);
}

function backupRefresh(storage, sessionStorage) {
  return isRefreshToken(read(storage, MAELSTROM_REFRESH_KEY))
    || isRefreshToken(read(sessionStorage, MAELSTROM_REFRESH_KEY));
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

export function livePrivySessionPresent(storage) {
  if (!storage) return false;
  return Boolean(liveAccessToken(storage) || readRefresh(storage, PRIVY_REFRESH_TOKEN_KEY));
}

/** True when calling Privy getAccessToken would destroyLocalState. */
export function getAccessTokenWouldDestroy(storage) {
  if (!storage) return false;
  return Boolean(liveAccessToken(storage) && !readRefresh(storage, PRIVY_REFRESH_TOKEN_KEY));
}

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
 * Cold-boot restore into the unprefixed keys Privy's Session reads.
 */
export function restorePrivySessionIfMissing(storage, sessionStorage = null) {
  if (!storage) return { restored: false, keys: [] };
  const restored = [];

  const backupPat = unwrapStoredToken(read(storage, MAELSTROM_TOKEN_KEY))
    || unwrapStoredToken(read(sessionStorage, MAELSTROM_TOKEN_KEY));
  const backupCustomer = unwrapStoredToken(read(storage, MAELSTROM_CUSTOMER_KEY))
    || unwrapStoredToken(read(sessionStorage, MAELSTROM_CUSTOMER_KEY));
  const refresh = readRefresh(storage, PRIVY_REFRESH_TOKEN_KEY) || backupRefresh(storage, sessionStorage);
  const backupUser = unwrapStoredToken(read(storage, MAELSTROM_ACTIVE_USER_KEY))
    || unwrapStoredToken(read(sessionStorage, MAELSTROM_ACTIVE_USER_KEY));

  const pat = readAccess(storage, PRIVY_ACCESS_TOKEN_KEY)
    || (isPrivyAccessToken(backupPat) ? backupPat : '');
  const customer = readAccess(storage, PRIVY_CUSTOMER_TOKEN_KEY)
    || (isPrivyAccessToken(backupCustomer) ? backupCustomer : '');

  if (!refresh || (!pat && !customer)) {
    return { restored: false, keys: [] };
  }

  if (fillKey(storage, PRIVY_ACCESS_TOKEN_KEY, pat)) restored.push(PRIVY_ACCESS_TOKEN_KEY);
  if (fillKey(storage, PRIVY_CUSTOMER_TOKEN_KEY, customer)) restored.push(PRIVY_CUSTOMER_TOKEN_KEY);
  if (fillKey(storage, PRIVY_REFRESH_TOKEN_KEY, refresh)) restored.push(PRIVY_REFRESH_TOKEN_KEY);

  const userId = backupUser || userIdFromPrivyToken(customer) || userIdFromPrivyToken(pat);
  if (userId) {
    const active = unwrapStoredToken(read(storage, PRIVY_ACTIVE_USER_KEY));
    if (active !== userId && write(storage, PRIVY_ACTIVE_USER_KEY, encodePrivyValue(userId))) {
      restored.push(PRIVY_ACTIVE_USER_KEY);
    }
    write(storage, MAELSTROM_ACTIVE_USER_KEY, userId);
  }

  return { restored: restored.length > 0, keys: restored };
}

/** Re-attach refresh from backup when access is live but refresh is gone. */
export function ensurePrivyRefreshOnly(storage, sessionStorage = null) {
  if (!storage) return { restored: false, keys: [] };
  if (!liveAccessToken(storage)) return { restored: false, keys: [] };
  if (readRefresh(storage, PRIVY_REFRESH_TOKEN_KEY)) return { restored: false, keys: [] };
  const refresh = backupRefresh(storage, sessionStorage);
  if (!refresh) return { restored: false, keys: [] };
  if (!fillKey(storage, PRIVY_REFRESH_TOKEN_KEY, refresh)) return { restored: false, keys: [] };
  return { restored: true, keys: [PRIVY_REFRESH_TOKEN_KEY] };
}

/**
 * Read a Privy access token without ever calling getAccessToken when that
 * would wipe localStorage. Prefer Privy's refresher when refresh is present.
 */
export function safePrivyAccessToken(getAccessToken, storage, sessionStorage = null) {
  try {
    ensurePrivyRefreshOnly(storage, sessionStorage);
  } catch {
    /* private mode */
  }
  if (getAccessTokenWouldDestroy(storage)) {
    return Promise.resolve(liveAccessToken(storage) || '');
  }
  return Promise.resolve(getAccessToken?.()).catch(() => liveAccessToken(storage) || '');
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
 * Mirror setItem. If Privy deletes refresh while access tokens remain
 * (e.g. a token response omitted refresh_token), put it back from backup.
 */
export function installPrivySessionMirror(target = globalThis) {
  if (!target || target.__maelstromPrivySessionMirror) {
    return target?.__maelstromPrivySessionMirror ?? null;
  }
  const storage = target.localStorage;
  const session = target.sessionStorage;
  if (!storage || typeof storage.setItem !== 'function') return null;

  const originalSet = storage.setItem.bind(storage);
  const originalRemove = typeof storage.removeItem === 'function'
    ? storage.removeItem.bind(storage)
    : null;
  const backups = [storage, session].filter(Boolean);

  storage.setItem = (key, value) => {
    originalSet(key, value);
    mirrorPrivyStorageWrite(key, value, backups);
    if (isPrivyTokenStorageKey(key) || isPrivyCustomerTokenStorageKey(key)) {
      ensurePrivyRefreshOnly(storage, session);
    }
  };

  if (originalRemove) {
    storage.removeItem = (key) => {
      originalRemove(key);
      if (!isPrivyRefreshStorageKey(key)) return;
      // Logout clears backups first, so this no-ops there.
      ensurePrivyRefreshOnly(storage, session);
    };
  }

  const api = {
    uninstall() {
      try {
        storage.setItem = originalSet;
      } catch {
        /* ignore */
      }
      if (originalRemove) {
        try {
          storage.removeItem = originalRemove;
        } catch {
          /* ignore */
        }
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
