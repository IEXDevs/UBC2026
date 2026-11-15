import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clearPrivySessionBackups,
  installPrivySessionMirror,
  mirrorPrivyStorageWrite,
  restorePrivySessionIfMissing,
} from './privy-session.mjs';
import {
  MAELSTROM_REFRESH_KEY,
  MAELSTROM_TOKEN_KEY,
  PRIVY_ACCESS_TOKEN_KEY,
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

const PAT = 'aaaa.bbbb.cccc';
const REFRESH = 'refresh-token-value-1';

test('mirrorPrivyStorageWrite backs up pat and refresh without touching unrelated keys', () => {
  const storage = memoryStorage();
  assert.equal(mirrorPrivyStorageWrite(PRIVY_ACCESS_TOKEN_KEY, JSON.stringify(PAT), [storage]), true);
  assert.equal(storage.getItem(MAELSTROM_TOKEN_KEY), PAT);
  assert.equal(mirrorPrivyStorageWrite(PRIVY_REFRESH_TOKEN_KEY, JSON.stringify(REFRESH), [storage]), true);
  assert.equal(storage.getItem(MAELSTROM_REFRESH_KEY), REFRESH);
  assert.equal(mirrorPrivyStorageWrite('maelstrom.profile.x', 'nope', [storage]), false);
});

test('restorePrivySessionIfMissing only fills empty Privy keys from backups', () => {
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
  assert.equal(second.restored, false);
  assert.equal(JSON.parse(storage.getItem(PRIVY_ACCESS_TOKEN_KEY)), 'other.other.other');
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
});
