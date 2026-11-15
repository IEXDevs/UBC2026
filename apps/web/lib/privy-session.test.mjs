import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getPrivyAccessToken,
  PRIVY_PAT_KEY,
  PRIVY_REFRESH_KEY,
  PRIVY_TOKEN_KEY,
  readStoredAccessToken,
  readStoredRefreshToken,
} from './privy-session.mjs';

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(String(key), String(value)); },
    removeItem(key) { map.delete(String(key)); },
  };
}

const PAT = 'aaaa.bbbb.cccc';
const REFRESH = 'refresh-token-value-1';

test('readStoredAccessToken prefers privy:token then privy:pat', () => {
  const storage = memoryStorage({
    [PRIVY_TOKEN_KEY]: JSON.stringify(PAT),
    [PRIVY_PAT_KEY]: JSON.stringify('xxxx.yyyy.zzzz'),
  });
  assert.equal(readStoredAccessToken(storage), PAT);
  storage.removeItem(PRIVY_TOKEN_KEY);
  assert.equal(readStoredAccessToken(storage), 'xxxx.yyyy.zzzz');
});

test('readStoredRefreshToken reads privy:refresh_token', () => {
  const storage = memoryStorage({
    [PRIVY_REFRESH_KEY]: JSON.stringify(REFRESH),
  });
  assert.equal(readStoredRefreshToken(storage), REFRESH);
});

test('getPrivyAccessToken skips Privy when refresh is missing so storage is not wiped', async () => {
  const storage = memoryStorage({
    [PRIVY_TOKEN_KEY]: JSON.stringify(PAT),
  });
  let called = false;
  const token = await getPrivyAccessToken(async () => {
    called = true;
    return 'should-not-run';
  }, storage);
  assert.equal(called, false);
  assert.equal(token, PAT);
}, { timeout: 5000 });

test('getPrivyAccessToken waits for refresh that arrives right after access', async () => {
  const storage = memoryStorage({
    [PRIVY_TOKEN_KEY]: JSON.stringify(PAT),
  });
  setTimeout(() => {
    storage.setItem(PRIVY_REFRESH_KEY, JSON.stringify(REFRESH));
  }, 80);
  const token = await getPrivyAccessToken(async () => 'from-privy', storage);
  assert.equal(token, 'from-privy');
});

test('getPrivyAccessToken uses Privy when refresh is present', async () => {
  const storage = memoryStorage({
    [PRIVY_TOKEN_KEY]: JSON.stringify(PAT),
    [PRIVY_REFRESH_KEY]: JSON.stringify(REFRESH),
  });
  const token = await getPrivyAccessToken(async () => 'from-privy', storage);
  assert.equal(token, 'from-privy');
});

test('getPrivyAccessToken falls back to storage if Privy throws', async () => {
  const storage = memoryStorage({
    [PRIVY_TOKEN_KEY]: JSON.stringify(PAT),
    [PRIVY_REFRESH_KEY]: JSON.stringify(REFRESH),
  });
  const token = await getPrivyAccessToken(async () => {
    throw new Error('network');
  }, storage);
  assert.equal(token, PAT);
});
