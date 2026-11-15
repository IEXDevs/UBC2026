/**
 * Soft Privy session mirror.
 *
 * Privy owns localStorage (`privy:pat` / `privy:token` / `privy:refresh_token`).
 * We only:
 * - mirror writes into Maelstrom backups
 * - restore those backups once if Privy keys are missing on boot
 *
 * Never block removeItem/clear — that fought Privy and signed people out.
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

function isRefreshToken(value) {
  const token = unwrapStoredToken(value);
  if (!token || token.length < 8 || token.length > 8192 || /\s/.test(token)) return '';
  return token;
}

function liveSessionPresent(storage) {
  if (!storage || typeof storage.length !== 'number' || typeof storage.key !== 'function') {
    return Boolean(
      unwrapStoredToken(storage?.getItem?.(PRIVY_ACCESS_TOKEN_KEY))
      || unwrapStoredToken(storage?.getItem?.(PRIVY_CUSTOMER_TOKEN_KEY))
      || isRefreshToken(storage?.getItem?.(PRIVY_REFRESH_TOKEN_KEY)),
    );
  }
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!isPrivySessionStorageKey(key)) continue;
    const raw = storage.getItem(key);
    if (isPrivyTokenStorageKey(key) && isPrivyAccessToken(raw)) return true;
    if (isPrivyCustomerTokenStorageKey(key) && isPrivyAccessToken(raw)) return true;
    if (isPrivyRefreshStorageKey(key) && isRefreshToken(raw)) return true;
  }
  return false;
}

function write(storage, key, value) {
  if (!storage || typeof storage.setItem !== 'function' || !key || !value) return;
  try {
    storage.setItem(key, value);
  } catch {
    /* private mode / quota */
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

/** Backup whatever Privy just wrote. Safe to call repeatedly. */
export function mirrorPrivyStorageWrite(key, value, storages = []) {
  const name = String(key || '');
  if (!isPrivySessionStorageKey(name)) return false;
  const raw = typeof value === 'string' ? value : '';
  if (isPrivyTokenStorageKey(name)) {
    const token = unwrapStoredToken(raw);
    if (!isPrivyAccessToken(token)) return false;
    for (const storage of storages) write(storage, MAELSTROM_TOKEN_KEY, token);
    return true;
  }
  if (isPrivyCustomerTokenStorageKey(name)) {
    const token = unwrapStoredToken(raw);
    if (!isPrivyAccessToken(token)) return false;
    for (const storage of storages) write(storage, MAELSTROM_CUSTOMER_KEY, token);
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
 * If Privy keys are missing but Maelstrom backups exist, put them back.
 * Call once before mounting PrivyProvider.
 */
export function restorePrivySessionIfMissing(storage, sessionStorage = null) {
  if (!storage || liveSessionPresent(storage)) return { restored: false, keys: [] };
  const restored = [];
  const pat = unwrapStoredToken(read(storage, MAELSTROM_TOKEN_KEY))
    || unwrapStoredToken(read(sessionStorage, MAELSTROM_TOKEN_KEY));
  const customer = unwrapStoredToken(read(storage, MAELSTROM_CUSTOMER_KEY))
    || unwrapStoredToken(read(sessionStorage, MAELSTROM_CUSTOMER_KEY));
  const refresh = isRefreshToken(read(storage, MAELSTROM_REFRESH_KEY))
    || isRefreshToken(read(sessionStorage, MAELSTROM_REFRESH_KEY));

  // Privy stores JSON-encoded strings in localStorage.
  if (isPrivyAccessToken(pat)) {
    write(storage, PRIVY_ACCESS_TOKEN_KEY, JSON.stringify(pat));
    restored.push(PRIVY_ACCESS_TOKEN_KEY);
  }
  if (isPrivyAccessToken(customer)) {
    write(storage, PRIVY_CUSTOMER_TOKEN_KEY, JSON.stringify(customer));
    restored.push(PRIVY_CUSTOMER_TOKEN_KEY);
  }
  if (refresh) {
    write(storage, PRIVY_REFRESH_TOKEN_KEY, JSON.stringify(refresh));
    restored.push(PRIVY_REFRESH_TOKEN_KEY);
  }
  return { restored: restored.length > 0, keys: restored };
}

export function clearPrivySessionBackups(storage, sessionStorage = null) {
  for (const store of [storage, sessionStorage]) {
    remove(store, MAELSTROM_TOKEN_KEY);
    remove(store, MAELSTROM_CUSTOMER_KEY);
    remove(store, MAELSTROM_REFRESH_KEY);
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
