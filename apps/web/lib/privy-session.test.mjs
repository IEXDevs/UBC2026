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

/**
 * Achieves: verifies readStoredAccessToken prefers privy:token then privy:pat.
 * Fails when: readStoredAccessToken prefers privy:token then privy:pat breaks (e.g. expected PAT, 'xxxx.yyyy.zzzz').
 * Oracle: assert.equal(readStoredAccessToken(storage), PAT); assert.equal(readStoredAccessToken(storage), 'xxxx.yyyy.zzzz')
 * Side effects / state checked: in-memory storage double writes/reads.
 * Gaps: none.
 */
test('readStoredAccessToken prefers privy:token then privy:pat', () => {
  const storage = memoryStorage({
    [PRIVY_TOKEN_KEY]: JSON.stringify(PAT),
    [PRIVY_PAT_KEY]: JSON.stringify('xxxx.yyyy.zzzz'),
  });
  assert.equal(readStoredAccessToken(storage), PAT);
  storage.removeItem(PRIVY_TOKEN_KEY);
  assert.equal(readStoredAccessToken(storage), 'xxxx.yyyy.zzzz');
});

/**
 * Achieves: verifies readStoredRefreshToken reads privy:refresh_token.
 * Fails when: readStoredRefreshToken reads privy:refresh_token breaks (e.g. expected REFRESH).
 * Oracle: assert.equal(readStoredRefreshToken(storage), REFRESH)
 * Side effects / state checked: in-memory storage double writes/reads.
 * Gaps: none.
 */
test('readStoredRefreshToken reads privy:refresh_token', () => {
  const storage = memoryStorage({
    [PRIVY_REFRESH_KEY]: JSON.stringify(REFRESH),
  });
  assert.equal(readStoredRefreshToken(storage), REFRESH);
});

/**
 * Achieves: verifies getPrivyAccessToken skips Privy when refresh is missing so storage is not wiped.
 * Fails when: getPrivyAccessToken skips Privy when refresh is missing so storage is not wiped breaks (e.g. expected false, PAT, called !== false).
 * Oracle: assert.equal(called, false); assert.equal(token, PAT)
 * Side effects / state checked: in-memory storage double writes/reads.
 * Gaps: none.
 */
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

/**
 * Achieves: verifies getPrivyAccessToken waits for refresh that arrives right after access.
 * Fails when: getPrivyAccessToken waits for refresh that arrives right after access breaks (e.g. expected 'from-privy').
 * Oracle: assert.equal(token, 'from-privy')
 * Side effects / state checked: in-memory storage double writes/reads.
 * Gaps: none.
 */
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

/**
 * Achieves: verifies getPrivyAccessToken uses Privy when refresh is present.
 * Fails when: getPrivyAccessToken uses Privy when refresh is present breaks (e.g. expected 'from-privy').
 * Oracle: assert.equal(token, 'from-privy')
 * Side effects / state checked: in-memory storage double writes/reads.
 * Gaps: none.
 */
test('getPrivyAccessToken uses Privy when refresh is present', async () => {
  const storage = memoryStorage({
    [PRIVY_TOKEN_KEY]: JSON.stringify(PAT),
    [PRIVY_REFRESH_KEY]: JSON.stringify(REFRESH),
  });
  const token = await getPrivyAccessToken(async () => 'from-privy', storage);
  assert.equal(token, 'from-privy');
});

/**
 * Achieves: verifies getPrivyAccessToken falls back to storage if Privy throws.
 * Fails when: getPrivyAccessToken falls back to storage if Privy throws breaks (e.g. expected PAT).
 * Oracle: assert.equal(token, PAT)
 * Side effects / state checked: in-memory storage double writes/reads.
 * Gaps: none.
 */
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

/**
 * Achieves: verifies an HttpOnly session cookie may refresh without a local refresh token.
 * Fails when: privy-session is ignored, or a readable privy-token marker is treated as that session.
 * Oracle: getAccessToken runs for privy-session=1 and is skipped for privy-token=t.
 * Side effects / state checked: in-memory storage double writes/reads.
 * Gaps: none.
 */
test('an HttpOnly session cookie may refresh without a local refresh token', async () => {
  const storage = memoryStorage();
  let called = false;
  const token = await getPrivyAccessToken(async () => {
    called = true;
    return 'from-cookie';
  }, storage, 'privy-session=1');
  assert.equal(called, true);
  assert.equal(token, 'from-cookie');

  let markerCalled = false;
  const kept = await getPrivyAccessToken(async () => {
    markerCalled = true;
    return 'nope';
  }, storage, 'privy-token=t');
  assert.equal(markerCalled, false);
  assert.equal(kept, '');
});
