import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clearPrivySessionBackups,
  ensurePrivySessionKeys,
  installPrivySessionMirror,
  mirrorPrivyStorageWrite,
  restorePrivySessionIfMissing,
  MAELSTROM_ACTIVE_USER_KEY,
  PRIVY_ACTIVE_USER_KEY,
  userIdFromPrivyToken,
} from './privy-session.mjs';
import {
  MAELSTROM_CUSTOMER_KEY,
  MAELSTROM_REFRESH_KEY,
  MAELSTROM_TOKEN_KEY,
  PRIVY_ACCESS_TOKEN_KEY,
  PRIVY_CUSTOMER_TOKEN_KEY,
  PRIVY_REFRESH_TOKEN_KEY,
} from './accept-terms-auth.mjs';

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(String(key), String(value)); },
    removeItem(key) { map.delete(String(key)); },
  };
}

function jwtWithSub(sub) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `${header}.${payload}.sig`;
}

const PAT = 'aaaa.bbbb.cccc';
const REFRESH = 'refresh-token-value-1';
const USER = 'did:privy:user1';
const REAL_PAT = jwtWithSub(USER);

test('mirrorPrivyStorageWrite backs up pat and refresh without touching unrelated keys', () => {
  const storage = memoryStorage();
  assert.equal(mirrorPrivyStorageWrite(PRIVY_ACCESS_TOKEN_KEY, JSON.stringify(PAT), [storage]), true);
  assert.equal(storage.getItem(MAELSTROM_TOKEN_KEY), PAT);
  assert.equal(mirrorPrivyStorageWrite(PRIVY_REFRESH_TOKEN_KEY, JSON.stringify(REFRESH), [storage]), true);
  assert.equal(storage.getItem(MAELSTROM_REFRESH_KEY), REFRESH);
  assert.equal(mirrorPrivyStorageWrite('maelstrom.profile.x', 'nope', [storage]), false);
});

test('restorePrivySessionIfMissing fills empty Privy keys from backups', () => {
  const storage = memoryStorage({
    [MAELSTROM_TOKEN_KEY]: PAT,
    [MAELSTROM_REFRESH_KEY]: REFRESH,
  });
  const first = restorePrivySessionIfMissing(storage);
  assert.equal(first.restored, true);
  assert.equal(JSON.parse(storage.getItem(PRIVY_ACCESS_TOKEN_KEY)), PAT);
  assert.equal(JSON.parse(storage.getItem(PRIVY_REFRESH_TOKEN_KEY)), REFRESH);

  storage.setItem(PRIVY_ACCESS_TOKEN_KEY, JSON.stringify('other.other.other'));
  const second = restorePrivySessionIfMissing(storage);
  assert.equal(JSON.parse(storage.getItem(PRIVY_ACCESS_TOKEN_KEY)), 'other.other.other');
  assert.equal(second.keys.includes(PRIVY_ACCESS_TOKEN_KEY), false);
});

test('restore gap-fills missing refresh even when pat is already present', () => {
  const storage = memoryStorage({
    [PRIVY_ACCESS_TOKEN_KEY]: JSON.stringify(PAT),
    [MAELSTROM_REFRESH_KEY]: REFRESH,
    [MAELSTROM_TOKEN_KEY]: PAT,
  });
  const result = restorePrivySessionIfMissing(storage);
  assert.equal(result.restored, true);
  assert.equal(JSON.parse(storage.getItem(PRIVY_REFRESH_TOKEN_KEY)), REFRESH);
  assert.equal(JSON.parse(storage.getItem(PRIVY_ACCESS_TOKEN_KEY)), PAT);
});

test('restore writes user-prefixed keys and active-user from JWT sub', () => {
  const storage = memoryStorage({
    [MAELSTROM_TOKEN_KEY]: REAL_PAT,
    [MAELSTROM_CUSTOMER_KEY]: REAL_PAT,
    [MAELSTROM_REFRESH_KEY]: REFRESH,
  });
  assert.equal(userIdFromPrivyToken(REAL_PAT), USER);
  const result = restorePrivySessionIfMissing(storage);
  assert.equal(result.restored, true);
  assert.equal(JSON.parse(storage.getItem(PRIVY_ACCESS_TOKEN_KEY)), REAL_PAT);
  assert.equal(JSON.parse(storage.getItem(`privy:${USER}:pat`)), REAL_PAT);
  assert.equal(JSON.parse(storage.getItem(`privy:${USER}:refresh_token`)), REFRESH);
  assert.equal(JSON.parse(storage.getItem(PRIVY_ACTIVE_USER_KEY)), USER);
  assert.equal(storage.getItem(MAELSTROM_ACTIVE_USER_KEY), USER);
});

test('ensurePrivySessionKeys is an alias for gap-fill restore', () => {
  const storage = memoryStorage({
    [PRIVY_CUSTOMER_TOKEN_KEY]: JSON.stringify(PAT),
    [MAELSTROM_REFRESH_KEY]: REFRESH,
  });
  const result = ensurePrivySessionKeys(storage);
  assert.equal(JSON.parse(storage.getItem(PRIVY_REFRESH_TOKEN_KEY)), REFRESH);
  assert.equal(result.restored, true);
});

test('installPrivySessionMirror observes setItem and does not block removeItem', () => {
  const target = { localStorage: memoryStorage(), sessionStorage: memoryStorage() };
  installPrivySessionMirror(target);
  target.localStorage.setItem(PRIVY_ACCESS_TOKEN_KEY, JSON.stringify(PAT));
  assert.equal(target.localStorage.getItem(MAELSTROM_TOKEN_KEY), PAT);
  target.localStorage.removeItem(PRIVY_ACCESS_TOKEN_KEY);
  assert.equal(target.localStorage.getItem(PRIVY_ACCESS_TOKEN_KEY), null);
  clearPrivySessionBackups(target.localStorage, target.sessionStorage);
  assert.equal(target.localStorage.getItem(MAELSTROM_TOKEN_KEY), null);
  assert.equal(target.localStorage.getItem(MAELSTROM_ACTIVE_USER_KEY), null);
});
