import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { patchPrivyCookieSession } from './patch-privy-cookie-session.mjs';

const ESM = 'node_modules/@privy-io/react-auth/dist/esm/use-sign-transaction-internal-Cx-lKGKG.mjs';
const CJS = 'node_modules/@privy-io/react-auth/dist/cjs/use-sign-transaction-internal-DbS_YZ_u.js';

test('the refresh request needs a session marker or an actual refresh token', () => {
  for (const file of [ESM, CJS]) {
    const patched = patchPrivyCookieSession(readFileSync(file, 'utf8'));
    const guard = patched.match(/if\(!\(e&&t\|\|this\.mightHaveServerCookies[^)]*\)\)return null/)?.[0];
    assert.ok(guard);
    const shouldRefresh = new Function('e', 't', `${guard};return true;`);
    const client = { useServerCookies: true };
    assert.equal(shouldRefresh.call({ client }, null, null), null);
    assert.equal(shouldRefresh.call({ client }, 'access', null), null);
    assert.equal(shouldRefresh.call({ client }, null, 'legacy'), true);
    assert.equal(shouldRefresh.call({ client, mightHaveServerCookies: true }, null, null), true);
    assert.equal(shouldRefresh.call({ client: {} }, 'access', 'refresh'), true);
  }
});

/**
 * Achieves: verifies cookie mode does not persist the session secrets in localStorage.
 * Fails when: the refresh token is still written with B.put or s.s.put while useServerCookies is on.
 * Oracle: patched source guards both puts and keeps the access token in _httpOnlyTokens.
 * Side effects / state checked: reads the installed Privy bundle; does not write it.
 * Gaps: does not execute the minified SDK.
 */
test('cookie mode does not persist the session secrets in localStorage', () => {
  for (const file of [ESM, CJS]) {
    const patched = patchPrivyCookieSession(readFileSync(file, 'utf8'));
    assert.equal(patched, patchPrivyCookieSession(patched));
    assert.match(patched, /useServerCookies===\!0\?B\.del\(f\):B\.put\(f,e\)|useServerCookies===\!0\?s\.s\.del\(i\.REFRESH_TOKEN_STORAGE_KEY\):s\.s\.put\(i\.REFRESH_TOKEN_STORAGE_KEY,e\)/);
    assert.match(patched, /_httpOnlyTokens\[m\]=e,B\.del\(m\)|_httpOnlyTokens\[i\.CUSTOMER_ACCESS_TOKEN_STORAGE_KEY\]=e,s\.s\.del\(i\.CUSTOMER_ACCESS_TOKEN_STORAGE_KEY\)/);
    assert.match(patched, /location\.origin\+"\/api\/privy-auth"/);
    assert.match(patched, /useServerCookies===\!0\)return null/);
    assert.match(patched, /function maelstromTakeRefresh\(\)/);
    assert.match(patched, /maelstromRefreshHold=maelstromTakeRefresh\(\)/);
    assert.match(patched, /maelstromRefreshHold=null/);
    assert.equal(patched.includes('get refreshToken(){try{let e=B.get(f)'), false);
    assert.equal(patched.includes('get refreshToken(){try{let e=s.s.get(i.REFRESH_TOKEN_STORAGE_KEY)'), false);
    assert.match(patched, /_httpOnlyTokens/);
    assert.match(patched, /mightHaveServerCookies\|\|this\.client\?\.useServerCookies/);
    assert.doesNotMatch(patched, /useServerCookies&&this\.session\.mightHaveServerCookies&&!this\.session\.getToken/);
    assert.match(patched, /useServerCookies&&!this\.session\.getToken\((?:Ln|Se)\.PRIVY\)|useServerCookies&&!this\.session\.getToken\(n\)/);
    assert.doesNotMatch(patched, /\?\(B\.put\(f,e\),this\.writeCookie/);
    assert.doesNotMatch(patched, /\?\(s\.s\.put\(i\.REFRESH_TOKEN_STORAGE_KEY,e\),this\.writeCookie/);
  }
});

/**
 * Achieves: verifies the embedded-wallet iframe stays on auth.privy.io.
 * Fails when: apiUrl is also the iframe origin, so the document is requested from /api/privy-auth and 404s.
 * Oracle: origin expressions keep auth.privy.io for the proxy and pass other apiUrls through.
 * Side effects / state checked: reads the installed Privy bundle; does not write it.
 * Gaps: does not load the iframe.
 */
test('embedded wallet iframe stays on auth.privy.io when api calls use the proxy', () => {
  const fixture = 'src:ir({origin:a.apiUrl,path:"/apps/x/embedded-wallets"}),export:ir({origin:t.apiUrl})';
  const patched = patchPrivyCookieSession(fixture);
  assert.equal(patched, patchPrivyCookieSession(patched));
  assert.match(patched, /origin:String\(a\.apiUrl\)\.endsWith\("\/api\/privy-auth"\)\?"https:\/\/auth\.privy\.io":a\.apiUrl/);
  assert.match(patched, /origin:String\(t\.apiUrl\)\.endsWith\("\/api\/privy-auth"\)\?"https:\/\/auth\.privy\.io":t\.apiUrl/);
  assert.doesNotMatch(patched, /origin:a\.apiUrl[,}]/);

  const esm = readFileSync('node_modules/@privy-io/react-auth/dist/esm/index-v4wm3JQ7.mjs', 'utf8');
  const cjs = readFileSync('node_modules/@privy-io/react-auth/dist/cjs/index-Bb2fk2aX.js', 'utf8');
  for (const source of [esm, cjs]) {
    const next = patchPrivyCookieSession(source);
    assert.equal(next, patchPrivyCookieSession(next));
    assert.match(next, /\?"https:\/\/auth\.privy\.io":/);
    assert.doesNotMatch(next, /origin:[A-Za-z_$][\w$]*\.apiUrl[,}]/);
  }
});
