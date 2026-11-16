/**
 * Wallet password for a signed-in owner.
 * The verifier lives in local storage. A successful unlock also stores an
 * expiry, so a refresh stays open until that time, then the wallet locks.
 */

export const DESK_LOCK_ITERATIONS = 120000;
export const DESK_LOCK_IDLE_MS = 30 * 60 * 1000;
export const DESK_LOCK_MIN_LENGTH = 8;

const textEncoder = new TextEncoder();

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

function sameBytes(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

async function deriveBits(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt,
    iterations,
    hash: 'SHA-256',
  }, key, 256);
  return new Uint8Array(bits);
}

export function deskLockStorageKey(ownerId) {
  if (typeof ownerId !== 'string') return '';
  const id = ownerId.trim();
  if (!id || id.length > 256) return '';
  return `maelstrom.desk-lock.${id}`;
}

export function deskOpenStorageKey(ownerId) {
  const lockKey = deskLockStorageKey(ownerId);
  if (!lockKey) return '';
  return lockKey.replace('maelstrom.desk-lock.', 'maelstrom.desk-open.');
}

export function normalizePassword(password) {
  return typeof password === 'string' ? password.normalize('NFC') : '';
}

export function passwordProblem(password) {
  const clean = normalizePassword(password);
  if (clean.length < DESK_LOCK_MIN_LENGTH) {
    return `Use at least ${DESK_LOCK_MIN_LENGTH} characters.`;
  }
  if (clean.length > 128) return 'Use 128 characters or fewer.';
  return '';
}

export function parseDeskLock(value) {
  let record = value;
  if (typeof value === 'string') {
    try {
      record = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!record || typeof record !== 'object' || record.v !== 1) return null;
  const iterations = record.iterations;
  if (!Number.isSafeInteger(iterations) || iterations < 10000 || iterations > 2000000) return null;
  const salt = hexToBytes(record.salt);
  const hash = hexToBytes(record.hash);
  if (!salt || salt.length !== 16 || !hash || hash.length !== 32) return null;
  return { v: 1, iterations, salt: bytesToHex(salt), hash: bytesToHex(hash) };
}

export async function createDeskLock(password) {
  const clean = normalizePassword(password);
  const problem = passwordProblem(clean);
  if (problem) {
    const error = new Error(problem);
    error.code = 'weak_password';
    throw error;
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveBits(clean, salt, DESK_LOCK_ITERATIONS);
  return {
    v: 1,
    iterations: DESK_LOCK_ITERATIONS,
    salt: bytesToHex(salt),
    hash: bytesToHex(hash),
  };
}

export async function unlockDesk(password, record) {
  const parsed = parseDeskLock(record);
  const clean = normalizePassword(password);
  if (!parsed || clean.length === 0) return false;
  const salt = hexToBytes(parsed.salt);
  const expected = hexToBytes(parsed.hash);
  const actual = await deriveBits(clean, salt, parsed.iterations);
  return sameBytes(actual, expected);
}

export function readDeskLock(storage, ownerId) {
  const key = deskLockStorageKey(ownerId);
  if (!key || !storage || typeof storage.getItem !== 'function') return null;
  try {
    return parseDeskLock(storage.getItem(key));
  } catch {
    return null;
  }
}

export function writeDeskLock(storage, ownerId, record) {
  const key = deskLockStorageKey(ownerId);
  const parsed = parseDeskLock(record);
  if (!key || !parsed || !storage || typeof storage.setItem !== 'function') return false;
  const body = JSON.stringify(parsed);
  try {
    storage.setItem(key, body);
    return storage.getItem?.(key) === body;
  } catch {
    return false;
  }
}

export function deskSessionUntil(now, windowMs = DESK_LOCK_IDLE_MS) {
  if (!Number.isFinite(now) || !Number.isFinite(windowMs) || windowMs <= 0) return 0;
  return now + windowMs;
}

export function parseDeskSession(value, now) {
  let record = value;
  if (typeof value === 'string') {
    try {
      record = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!record || typeof record !== 'object' || record.v !== 1) return null;
  const until = record.until;
  if (!Number.isFinite(until)) return null;
  if (!Number.isFinite(now) || now >= until) return null;
  return { v: 1, until };
}

export function readDeskSession(storage, ownerId, now) {
  const key = deskOpenStorageKey(ownerId);
  if (!key || !storage || typeof storage.getItem !== 'function') return null;
  try {
    return parseDeskSession(storage.getItem(key), now);
  } catch {
    return null;
  }
}

export function writeDeskSession(storage, ownerId, until) {
  const key = deskOpenStorageKey(ownerId);
  if (!key || !Number.isFinite(until) || until <= 0 || !storage || typeof storage.setItem !== 'function') return false;
  const body = JSON.stringify({ v: 1, until });
  try {
    storage.setItem(key, body);
    return storage.getItem?.(key) === body;
  } catch {
    return false;
  }
}

export function clearDeskSession(storage, ownerId) {
  const key = deskOpenStorageKey(ownerId);
  if (!key || !storage || typeof storage.removeItem !== 'function') return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** Shift+L locks the wallet. Shift+U opens the unlock prompt. */
export function walletHotkey(event) {
  if (!event || event.shiftKey !== true || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return '';
  if (event.code === 'KeyL') return 'lock';
  if (event.code === 'KeyU') return 'unlock';
  return '';
}

export function hotkeyTypingTarget(target) {
  if (!target || typeof target !== 'object') return false;
  if (target.isContentEditable) return true;
  const tag = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function idleLockDue(lastActivityAt, now, idleMs = DESK_LOCK_IDLE_MS) {
  if (!Number.isFinite(lastActivityAt) || !Number.isFinite(now)) return false;
  if (!Number.isFinite(idleMs) || idleMs < 0) return false;
  return now - lastActivityAt >= idleMs;
}
