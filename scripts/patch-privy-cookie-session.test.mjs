import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { patchPrivyCookieSession } from './patch-privy-cookie-session.mjs';

const ESM = 'node_modules/@privy-io/react-auth/dist/esm/use-sign-transaction-internal-Cx-lKGKG.mjs';
const CJS = 'node_modules/@privy-io/react-auth/dist/cjs/use-sign-transaction-internal-DbS_YZ_u.js';

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
    assert.doesNotMatch(patched, /useServerCookies===\!0\)return null/);
    assert.match(patched, /_httpOnlyTokens/);
    assert.match(patched, /mightHaveServerCookies\|\|this\.client\?\.useServerCookies/);
    assert.doesNotMatch(patched, /useServerCookies&&this\.session\.mightHaveServerCookies&&!this\.session\.getToken/);
    assert.match(patched, /useServerCookies&&!this\.session\.getToken\((?:Ln|Se)\.PRIVY\)|useServerCookies&&!this\.session\.getToken\(n\)/);
    assert.doesNotMatch(patched, /\?\(B\.put\(f,e\),this\.writeCookie/);
    assert.doesNotMatch(patched, /\?\(s\.s\.put\(i\.REFRESH_TOKEN_STORAGE_KEY,e\),this\.writeCookie/);
  }
});
