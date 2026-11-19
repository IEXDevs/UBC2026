import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PRIVY_REFRESH_COOKIE,
  bodyWithStoredRefresh,
  privyUpstreamUrl,
  proxyPrivyAuth,
  readRefreshCookie,
  sealPrivyAuthBody,
} from './privy-auth-proxy.mjs';

const REFRESH = 'refresh-token-value';
const NEXT = 'rotated-refresh-token';
const ACCESS = 'header.payload.signature';

function requestFor(url, { method = 'POST', cookie = '', body = '', headers = {} } = {}) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', cookie, ...headers },
    body: method === 'GET' ? undefined : body,
  });
}

/**
 * Achieves: verifies the refresh token is removed from the body the page receives.
 * Fails when: refresh_token stays in the JSON or the access token is dropped.
 * Oracle: sealed body has the access token and no refresh_token.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('the refresh token is removed from the body the page receives', () => {
  const sealed = sealPrivyAuthBody(JSON.stringify({
    token: ACCESS,
    refresh_token: REFRESH,
    user: { id: 'did:privy:abc' },
  }));
  assert.equal(sealed.refreshToken, REFRESH);
  const body = JSON.parse(sealed.bodyText);
  assert.equal(body.token, ACCESS);
  assert.equal(body.user.id, 'did:privy:abc');
  assert.equal(Object.hasOwn(body, 'refresh_token'), false);
  assert.equal(privyUpstreamUrl('/api/v1/sessions', '?a=1'), 'https://auth.privy.io/api/v1/sessions?a=1');
  assert.equal(privyUpstreamUrl('/api/v1/../secrets'), '');
});

/**
 * Achieves: verifies a later refresh uses the HttpOnly cookie and not page storage.
 * Fails when: the cookie is missing, readable, or ignored in favor of an empty body.
 * Oracle: Set-Cookie is HttpOnly, the response body has no refresh token, and the next POST sends the cookie value.
 * Side effects / state checked: fake fetch only.
 * Gaps: does not call auth.privy.io.
 */
test('a later refresh uses the HttpOnly cookie and not page storage', async () => {
  const seen = [];
  const login = await proxyPrivyAuth(
    requestFor('https://maelstrom.iexdevs.com/api/privy-auth/api/v1/passwordless/authenticate', {
      body: JSON.stringify({ email: 'a@b.c', code: '123456' }),
    }),
    '/api/v1/passwordless/authenticate',
    async (url, init) => {
      seen.push({ url, body: init.body });
      return new Response(JSON.stringify({ token: ACCESS, refresh_token: REFRESH }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  );
  const setCookie = login.headers.get('set-cookie') || '';
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, new RegExp(`${PRIVY_REFRESH_COOKIE}=`));
  assert.equal(setCookie.includes(REFRESH), true);
  const loginBody = await login.json();
  assert.equal(loginBody.token, ACCESS);
  assert.equal(Object.hasOwn(loginBody, 'refresh_token'), false);
  assert.equal(readRefreshCookie(setCookie), REFRESH);

  const refresh = await proxyPrivyAuth(
    requestFor('https://maelstrom.iexdevs.com/api/privy-auth/api/v1/sessions', {
      cookie: setCookie,
      body: '{}',
    }),
    '/api/v1/sessions',
    async (url, init) => {
      seen.push({ url, body: init.body });
      return new Response(JSON.stringify({ token: ACCESS, refresh_token: NEXT }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  );
  assert.equal(JSON.parse(seen[1].body).refresh_token, REFRESH);
  assert.equal(seen[1].url, 'https://auth.privy.io/api/v1/sessions');
  const again = await refresh.json();
  assert.equal(again.token, ACCESS);
  assert.equal(Object.hasOwn(again, 'refresh_token'), false);
  assert.equal(readRefreshCookie(refresh.headers.get('set-cookie')), NEXT);
  assert.equal(bodyWithStoredRefresh('/api/v1/sessions', 'POST', '{"refresh_token":"stale"}', setCookie).includes(REFRESH), true);
  assert.equal(bodyWithStoredRefresh('/api/v1/sessions', 'POST', '{"refresh_token":"stale"}', setCookie).includes('stale'), false);
});

/**
 * Achieves: verifies logout clears the refresh cookie.
 * Fails when: the cookie is left in place after logout.
 * Oracle: Set-Cookie Max-Age=0.
 * Side effects / state checked: fake fetch only.
 * Gaps: none.
 */
test('logout clears the refresh cookie', async () => {
  const response = await proxyPrivyAuth(
    requestFor('https://dev.maelstrom.iexdevs.com/api/privy-auth/api/v1/sessions/logout', {
      cookie: `${PRIVY_REFRESH_COOKIE}=${encodeURIComponent(REFRESH)}`,
      body: '{}',
    }),
    '/api/v1/sessions/logout',
    async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  assert.match(response.headers.get('set-cookie') || '', /Max-Age=0/);
});
