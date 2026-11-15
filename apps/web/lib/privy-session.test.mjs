import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clearPrivySessionBackups,
  ensurePrivyRefreshOnly,
  getAccessTokenWouldDestroy,
  installPrivySessionMirror,
  mirrorPrivyStorageWrite,
  restorePrivySessionIfMissing,
  safePrivyAccessToken,
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

test('mirrorPrivyStorageWrite backs up pat and refresh', () => {
  const storage = memoryStorage();
  assert.equal(mirrorPrivyStorageWrite(PRIVY_ACCESS_TOKEN_KEY, JSON.stringify(PAT), [storage]), true);
  assert.equal(storage.getItem(MAELSTROM_TOKEN_KEY), PAT);
  assert.equal(mirrorPrivyStorageWrite(PRIVY_REFRESH_TOKEN_KEY, JSON.stringify(REFRESH), [storage]), true);
  assert.equal(storage.getItem(MAELSTROM_REFRESH_KEY), REFRESH);
});

test('cold-boot restore fills empty Privy keys from backups when refresh exists', () => {
  const storage = memoryStorage({
    [MAELSTROM_TOKEN_KEY]: PAT,
    [MAELSTROM_REFRESH_KEY]: REFRESH,
  });
  const first = restorePrivySessionIfMissing(storage);
  assert.equal(first.restored, true);
  assert.equal(JSON.parse(storage.getItem(PRIVY_ACCESS_TOKEN_KEY)), PAT);
  assert.equal(JSON.parse(storage.getItem(PRIVY_REFRESH_TOKEN_KEY)), REFRESH);
});

test('cold-boot restore refuses half sessions without refresh', () => {
  const storage = memoryStorage({ [MAELSTROM_TOKEN_KEY]: PAT });
  assert.equal(restorePrivySessionIfMissing(storage).restored, false);
  assert.equal(storage.getItem(PRIVY_ACCESS_TOKEN_KEY), null);
});

test('ensurePrivyRefreshOnly fills missing refresh when access is live', () => {
  const storage = memoryStorage({
    [PRIVY_ACCESS_TOKEN_KEY]: JSON.stringify(PAT),
    [MAELSTROM_REFRESH_KEY]: REFRESH,
  });
  assert.equal(getAccessTokenWouldDestroy(storage), true);
  assert.equal(ensurePrivyRefreshOnly(storage).restored, true);
  assert.equal(getAccessTokenWouldDestroy(storage), false);
  assert.equal(JSON.parse(storage.getItem(PRIVY_REFRESH_TOKEN_KEY)), REFRESH);
});

test('safePrivyAccessToken does not call Privy when that would wipe the session', async () => {
  const storage = memoryStorage({
    [PRIVY_CUSTOMER_TOKEN_KEY]: JSON.stringify(PAT),
    [MAELSTROM_REFRESH_KEY]: '',
  });
  let called = false;
  const token = await safePrivyAccessToken(async () => {
    called = true;
    return 'should-not-run';
  }, storage);
  assert.equal(called, false);
  assert.equal(token, PAT);
});

test('safePrivyAccessToken uses Privy when refresh is present', async () => {
  const storage = memoryStorage({
    [PRIVY_CUSTOMER_TOKEN_KEY]: JSON.stringify(PAT),
    [PRIVY_REFRESH_TOKEN_KEY]: JSON.stringify(REFRESH),
  });
  const token = await safePrivyAccessToken(async () => 'from-privy', storage);
  assert.equal(token, 'from-privy');
});

test('deleting refresh while access is live puts it back from backup', () => {
  const target = { localStorage: memoryStorage(), sessionStorage: memoryStorage() };
  installPrivySessionMirror(target);
  target.localStorage.setItem(PRIVY_ACCESS_TOKEN_KEY, JSON.stringify(PAT));
  target.localStorage.setItem(PRIVY_REFRESH_TOKEN_KEY, JSON.stringify(REFRESH));
  assert.equal(target.localStorage.getItem(MAELSTROM_REFRESH_KEY), REFRESH);

  target.localStorage.removeItem(PRIVY_REFRESH_TOKEN_KEY);
  assert.equal(JSON.parse(target.localStorage.getItem(PRIVY_REFRESH_TOKEN_KEY)), REFRESH);
  assert.equal(JSON.parse(target.localStorage.getItem(PRIVY_ACCESS_TOKEN_KEY)), PAT);
});

test('logout can clear refresh after backups are cleared', () => {
  const target = { localStorage: memoryStorage(), sessionStorage: memoryStorage() };
  installPrivySessionMirror(target);
  target.localStorage.setItem(PRIVY_ACCESS_TOKEN_KEY, JSON.stringify(PAT));
  target.localStorage.setItem(PRIVY_REFRESH_TOKEN_KEY, JSON.stringify(REFRESH));
  clearPrivySessionBackups(target.localStorage, target.sessionStorage);
  target.localStorage.removeItem(PRIVY_REFRESH_TOKEN_KEY);
  target.localStorage.removeItem(PRIVY_ACCESS_TOKEN_KEY);
  assert.equal(target.localStorage.getItem(PRIVY_REFRESH_TOKEN_KEY), null);
  assert.equal(target.localStorage.getItem(PRIVY_ACCESS_TOKEN_KEY), null);
});

test('restore sets active-user from JWT sub', () => {
  const storage = memoryStorage({
    [MAELSTROM_TOKEN_KEY]: REAL_PAT,
    [MAELSTROM_CUSTOMER_KEY]: REAL_PAT,
    [MAELSTROM_REFRESH_KEY]: REFRESH,
  });
  assert.equal(userIdFromPrivyToken(REAL_PAT), USER);
  assert.equal(restorePrivySessionIfMissing(storage).restored, true);
  assert.equal(JSON.parse(storage.getItem(PRIVY_ACTIVE_USER_KEY)), USER);
  assert.equal(storage.getItem(MAELSTROM_ACTIVE_USER_KEY), USER);
});
