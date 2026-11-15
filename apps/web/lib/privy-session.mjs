/**
 * Soft Privy session mirror.
 *
 * Privy owns localStorage (`privy:pat` / `privy:token` / `privy:refresh_token`).
 * We only:
 * - mirror writes into Maelstrom backups
 * - restore those backups once on cold boot (before PrivyProvider)
 * - gap-fill a missing refresh_token when an access token is already live
 * - clear backups when Privy wipes every session key (failed refresh / logout)
 *
 * Never block removeItem/clear — that fought Privy and signed people out.
 *
 * Do NOT re-restore after Privy rejects a session. That left tokens in
 * storage while authenticated stayed false ("zombie" login).
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

function fillKey(storage, key, token, restored) {
  if (!token) return;
  const existing = key.includes('refresh_token') ? readRefresh(storage, key) : readAccess(storage, key);
  if (existing) return;
  if (write(storage, key, encodePrivyValue(token))) restored.push(key);
}

/** True when any Privy session credential is still in localStorage. */
export function livePrivySessionPresent(storage) {
  if (!storage) return false;
  if (
    readAccess(storage, PRIVY_ACCESS_TOKEN_KEY)
    || readAccess(storage, PRIVY_CUSTOMER_TOKEN_KEY)
    || readRefresh(storage, PRIVY_REFRESH_TOKEN_KEY)
  ) {
    return true;
  }
  if (typeof storage.length !== 'number' || typeof storage.key !== 'function') return false;
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!isPrivySessionStorageKey(key)) continue;
    if (isPrivyTokenStorageKey(key) && readAccess(storage, key)) return true;
    if (isPrivyCustomerTokenStorageKey(key) && readAccess(storage, key)) return true;
    if (isPrivyRefreshStorageKey(key) && readRefresh(storage, key)) return true;
  }
  return false;
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
 * Cold-boot restore: put backups back into the unprefixed keys Privy's
 * Session reads (`privy:pat` / `privy:token` / `privy:refresh_token`).
 * Call once before mounting PrivyProvider — not after a failed refresh.
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
    || unwrapStoredToken(read(sessionStorage, MAELSTROM_ACTIVE_USER_KEY));

  const pat = readAccess(storage, PRIVY_ACCESS_TOKEN_KEY)
    || (isPrivyAccessToken(backupPat) ? backupPat : '');
  const customer = readAccess(storage, PRIVY_CUSTOMER_TOKEN_KEY)
    || (isPrivyAccessToken(backupCustomer) ? backupCustomer : '');
  const refresh = readRefresh(storage, PRIVY_REFRESH_TOKEN_KEY) || backupRefresh;

  // Need refresh + at least one access token to hydrate. Don't half-restore.
  if (!refresh || (!pat && !customer)) {
    return { restored: false, keys: [] };
  }

  fillKey(storage, PRIVY_ACCESS_TOKEN_KEY, pat, restored);
  fillKey(storage, PRIVY_CUSTOMER_TOKEN_KEY, customer, restored);
  fillKey(storage, PRIVY_REFRESH_TOKEN_KEY, refresh, restored);

  const userId = backupUser || userIdFromPrivyToken(customer) || userIdFromPrivyToken(pat);
  if (userId) {
    const active = unwrapStoredToken(read(storage, PRIVY_ACTIVE_USER_KEY));
    if (active !== userId && write(storage, PRIVY_ACTIVE_USER_KEY, encodePrivyValue(userId))) {
      restored.push(PRIVY_ACTIVE_USER_KEY);
    }
    write(storage, MAELSTROM_ACTIVE_USER_KEY, userId);
  }

  return { restored: restored.length > 0, keys: [...new Set(restored)] };
}

/**
 * Only fill a missing refresh_token when an access token is already live.
 * Never resurrect wiped access tokens (that created zombie "logged out but
 * tokens present" state after Privy rejected a session).
 */
export function ensurePrivyRefreshOnly(storage, sessionStorage = null) {
  if (!storage) return { restored: false, keys: [] };
  const hasAccess = Boolean(
    readAccess(storage, PRIVY_ACCESS_TOKEN_KEY)
    || readAccess(storage, PRIVY_CUSTOMER_TOKEN_KEY),
  );
  if (!hasAccess) return { restored: false, keys: [] };
  if (readRefresh(storage, PRIVY_REFRESH_TOKEN_KEY)) return { restored: false, keys: [] };

  const backupRefresh = isRefreshToken(read(storage, MAELSTROM_REFRESH_KEY))
    || isRefreshToken(read(sessionStorage, MAELSTROM_REFRESH_KEY));
  if (!backupRefresh) return { restored: false, keys: [] };

  const restored = [];
  fillKey(storage, PRIVY_REFRESH_TOKEN_KEY, backupRefresh, restored);
  return { restored: restored.length > 0, keys: restored };
}

/** @deprecated use ensurePrivyRefreshOnly after boot — kept for call-site clarity */
export function ensurePrivySessionKeys(storage, sessionStorage = null) {
  return ensurePrivyRefreshOnly(storage, sessionStorage);
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
 * Mirror setItem into backups. Observe removeItem: when Privy clears every
 * session key, drop backups so we do not zombie-restore a rejected session.
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

  storage.setItem = (key, value) => {
    originalSet(key, value);
    mirrorPrivyStorageWrite(key, value, [storage, session].filter(Boolean));
  };

  if (originalRemove) {
    storage.removeItem = (key) => {
      originalRemove(key);
      if (!isPrivySessionStorageKey(key) && key !== PRIVY_ACTIVE_USER_KEY) return;
      if (livePrivySessionPresent(storage)) return;
      clearPrivySessionBackups(storage, session);
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
