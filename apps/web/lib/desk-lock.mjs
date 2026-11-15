/**
 * Site unlock for a signed-in session.
 * The password verifier lives in local storage. The unlocked flag does not,
 * so a reload asks again. Spend checks read that in-memory flag.
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
  if (!id || id.length > 200) return '';
  return `maelstrom.desk-lock.${id}`;
}

export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < DESK_LOCK_MIN_LENGTH) {
    return `Use at least ${DESK_LOCK_MIN_LENGTH} characters.`;
  }
  if (password.length > 128) return 'Use 128 characters or fewer.';
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
  const problem = passwordProblem(password);
  if (problem) {
    const error = new Error(problem);
    error.code = 'weak_password';
    throw error;
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveBits(password, salt, DESK_LOCK_ITERATIONS);
  return {
    v: 1,
    iterations: DESK_LOCK_ITERATIONS,
    salt: bytesToHex(salt),
    hash: bytesToHex(hash),
  };
}

export async function unlockDesk(password, record) {
  const parsed = parseDeskLock(record);
  if (!parsed || typeof password !== 'string' || password.length === 0) return false;
  const salt = hexToBytes(parsed.salt);
  const expected = hexToBytes(parsed.hash);
  const actual = await deriveBits(password, salt, parsed.iterations);
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
  storage.setItem(key, JSON.stringify(parsed));
  return true;
}

export function idleLockDue(lastActivityAt, now, idleMs = DESK_LOCK_IDLE_MS) {
  if (!Number.isFinite(lastActivityAt) || !Number.isFinite(now)) return false;
  if (!Number.isFinite(idleMs) || idleMs < 0) return false;
  return now - lastActivityAt >= idleMs;
}
