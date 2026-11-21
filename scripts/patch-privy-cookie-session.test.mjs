import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PrivyApiError } from '@privy-io/js-sdk-core';
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

test('the SDK restores a wallet-only refresh and preserves that token on a login-only refresh', () => {
  for (const file of [ESM, CJS]) {
    const patched = patchPrivyCookieSession(readFileSync(file, 'utf8'));
    const start = patched.indexOf('handleTokenResponse(e){');
    const end = patched.indexOf('_storeAllTokens(e){', start);
    const helper = patched.indexOf('\nfunction maelstromStoreRefreshedAccessTokens(');
    assert.ok(start > 0 && end > start && helper > 0);
    const { handleTokenResponse } = new Function(`${patched.slice(helper)}\nreturn {${patched.slice(start, end)}};`)();
    const tokens = {};
    const session = {
      client: { useServerCookies: true },
      storeRefreshToken: token => { tokens.refresh = token; },
      storeCustomerAccessToken: token => { tokens.customer = token; },
      storePrivyAccessToken: token => { tokens.wallet = token; },
    };
    handleTokenResponse.call(session, { session_update_action: 'ignore', token: null, privy_access_token: 'wallet-jwt' });
    assert.deepEqual(tokens, { refresh: null, wallet: 'wallet-jwt' });
    handleTokenResponse.call(session, { session_update_action: 'ignore', token: 'login-jwt' });
    assert.deepEqual(tokens, { refresh: null, wallet: 'wallet-jwt', customer: 'login-jwt' });
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

const PROVIDERS = [
  ['node_modules/@privy-io/react-auth/dist/esm/index-v4wm3JQ7.mjs',
    ['h', 'r', 'xe', '$', 'MaelstromPrivyApiError'], (Client, getLegacy, ApiError) => [Client, {}, {}, getLegacy, ApiError]],
  ['node_modules/@privy-io/react-auth/dist/cjs/index-Bb2fk2aX.js',
    ['L', 'l', 'o', 'n'], (Client, getLegacy, ApiError) => [
      { default: Client, PrivyApiError: ApiError }, {}, { s: {} }, { getGlobalClient: getLegacy },
    ]],
];

function patchedWalletClient(file, names, args, getLegacy, ApiError) {
  const patched = patchPrivyCookieSession(readFileSync(file, 'utf8'));
  assert.equal(patched, patchPrivyCookieSession(patched));
  const constructor = patched.match(/maelstromWalletRpcClient\(new [^\n]*?react-auth:3\.51\.4"\}\),[^)]+\)/)?.[0];
  assert.ok(constructor, `${file}: core client must use the session bridge`);
  const bridge = patched.slice(patched.indexOf('\nfunction maelstromWalletRpcClient('));
  class Client {
    getCompiledPath(route) { return `https://auth.privy.io${route.path}?example=1`; }
    fetchPrivyRoute() { throw new Error('unauthenticated core client must not send'); }
  }
  return new Function(...names, `${bridge};return ${constructor};`)(...args(Client, getLegacy, ApiError));
}

test('unified wallet RPC uses the current session client without changing the signed URL', async () => {
  for (const [file, names, args] of PROVIDERS) {
    const requests = [];
    let token = 'in-memory-access';
    const getLegacy = () => ({ api: { baseFetch: async (path, options) => {
      const headers = new Headers(options.headers);
      if (token) headers.set('authorization', `Bearer ${token}`);
      requests.push({ url: `https://app.example/api/privy-auth${path}`, ...options, headers });
      return { data: { signed_transaction: 'mock-transaction' } };
    } } });
    const client = patchedWalletClient(file, names, args, getLegacy, Error);
    const route = { method: 'POST', path: '/api/v1/wallets/wallet-id/rpc' };
    const options = {
      body: { chain_type: 'solana', method: 'signTransaction', params: { transaction: 'mock' } },
      headers: { 'privy-authorization-signature': 'mock-signature', 'privy-request-expiry': '123' },
      signal: new AbortController().signal,
    };
    assert.equal(client.getCompiledPath(route), 'https://auth.privy.io/api/v1/wallets/wallet-id/rpc?example=1');
    assert.deepEqual(await client.fetchPrivyRoute(route, options), { data: { signed_transaction: 'mock-transaction' } });
    token = 'refreshed-in-memory-access';
    await client.fetchPrivyRoute(route, options);
    assert.equal(requests[0].url, 'https://app.example/api/privy-auth/api/v1/wallets/wallet-id/rpc?example=1');
    assert.equal(requests[0].headers.get('authorization'), 'Bearer in-memory-access');
    assert.equal(requests[1].headers.get('authorization'), 'Bearer refreshed-in-memory-access');
    assert.equal(requests[0].headers.get('privy-authorization-signature'), 'mock-signature');
    assert.equal(requests[0].headers.get('privy-request-expiry'), '123');
    assert.equal(requests[0].body, options.body);
    assert.equal(requests[0].signal, options.signal);
    token = null;
    await client.fetchPrivyRoute(route);
    assert.equal(requests[2].headers.has('authorization'), false);
    assert.equal(requests[2].body, undefined);
  }
});

test('unified wallet RPC retains core API errors for MFA retries and transport failures', async () => {
  for (const [file, names, args] of PROVIDERS) {
    for (const failure of [new Error('offline'),
      { response: { status: 401 }, data: { code: 'invalid_jwt', error: 'Invalid token' } },
      { response: { status: 403 }, data: { code: 'mfa_required', error: 'MFA required' } }]) {
      const client = patchedWalletClient(file, names, args,
        () => ({ api: { baseFetch: async () => { throw failure; } } }),
        PrivyApiError);
      await assert.rejects(client.fetchPrivyRoute({ method: 'POST', path: '/api/v1/wallets/id/rpc' }),
        error => failure.response ? error instanceof PrivyApiError
          && error.status === failure.response.status && error.code === failure.data.code
          && error.message === failure.data.error : error === failure);
    }
  }
});
