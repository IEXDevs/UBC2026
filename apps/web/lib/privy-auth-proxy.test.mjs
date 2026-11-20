import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PRIVY_REFRESH_COOKIE,
  PRIVY_ACCESS_COOKIE,
  PRIVY_SESSION_MARKER,
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

test('same-origin Privy SOL price GETs forward the page origin, app id and query', async () => {
  const response = await proxyPrivyAuth(requestFor(
    'https://maelstrom.iexdevs.com/api/privy-auth/api/v1/token_price?chainId=0&tokenSymbol=SOL',
    { method: 'GET', headers: { 'privy-app-id': 'test-app' } },
  ), '/api/v1/token_price', async (url, init) => {
    assert.equal(url, 'https://auth.privy.io/api/v1/token_price?chainId=0&tokenSymbol=SOL');
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    assert.equal(init.headers.get('origin'), 'https://maelstrom.iexdevs.com');
    assert.equal(init.headers.get('privy-app-id'), 'test-app');
    return Response.json({ usd: 68.88 });
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { usd: 68.88 });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.getSetCookie().length, 0);
});

test('Privy price GETs preserve an explicit origin and upstream missing-price errors', async () => {
  for (const [body, status] of [[{}, 200], [{ error: 'token price cannot be found' }, 404], [{ code: 'invalid_origin' }, 403]]) {
    const response = await proxyPrivyAuth(requestFor(
      'https://maelstrom.iexdevs.com/api/privy-auth/api/v1/token_price?chainId=0&tokenSymbol=SOL',
      { method: 'GET', headers: { origin: 'https://other.example' } },
    ), '/api/v1/token_price', async (_url, init) => {
      assert.equal(init.headers.get('origin'), 'https://other.example');
      return Response.json(body, { status });
    });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), body);
  }
});

test('Privy POSTs supply a missing page origin without replacing an explicit origin', async () => {
  for (const origin of ['', 'https://other.example']) {
    const response = await proxyPrivyAuth(requestFor(
      'https://maelstrom.iexdevs.com/api/privy-auth/api/v1/sessions',
      { body: '{}', headers: origin ? { origin } : {} },
    ), '/api/v1/sessions', async (_url, init) => {
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.get('origin'), origin || 'https://maelstrom.iexdevs.com');
      return Response.json({});
    });
    assert.equal(response.status, 200);
  }
});

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
      seen.push({ url, body: init.body, authorization: init.headers.get('authorization') });
      return new Response(JSON.stringify({ token: ACCESS, refresh_token: REFRESH }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  );
  const setCookies = login.headers.getSetCookie();
  const setCookie = setCookies.join('; ');
  assert.equal(setCookies.some((cookie) => cookie.includes('HttpOnly')), true);
  assert.equal(setCookies.some((cookie) => cookie.startsWith(`${PRIVY_REFRESH_COOKIE}=`)), true);
  assert.equal(setCookies.some((cookie) => cookie.startsWith(`${PRIVY_ACCESS_COOKIE}=`) && cookie.includes('HttpOnly; Path=/api/privy-auth; SameSite=Lax; Secure')), true);
  assert.equal(setCookies.some((cookie) => cookie.includes('Domain=')), false);
  assert.equal(setCookies.some((cookie) => cookie.startsWith(`${PRIVY_SESSION_MARKER}=1`) && !cookie.includes('HttpOnly')), true);
  assert.equal(setCookie.includes(REFRESH), true);
  const loginBody = await login.json();
  assert.equal(loginBody.token, ACCESS);
  assert.equal(Object.hasOwn(loginBody, 'refresh_token'), false);
  assert.equal(readRefreshCookie(setCookie), REFRESH);

  const refresh = await proxyPrivyAuth(
    requestFor('https://maelstrom.iexdevs.com/api/privy-auth/api/v1/sessions', {
      cookie: setCookies.map(cookie => cookie.split(';')[0]).join('; '),
      body: '{}',
    }),
    '/api/v1/sessions',
    async (url, init) => {
      seen.push({ url, body: init.body, authorization: init.headers.get('authorization') });
      return new Response(JSON.stringify({ token: ACCESS, refresh_token: NEXT }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  );
  assert.equal(JSON.parse(seen[1].body).refresh_token, REFRESH);
  assert.equal(seen[1].authorization, `Bearer ${ACCESS}`);
  assert.equal(seen[1].url, 'https://auth.privy.io/api/v1/sessions');
  const again = await refresh.json();
  assert.equal(again.token, ACCESS);
  assert.equal(Object.hasOwn(again, 'refresh_token'), false);
  assert.equal(readRefreshCookie(refresh.headers.getSetCookie().join('; ')), NEXT);
  assert.equal(refresh.headers.getSetCookie().some((cookie) => cookie.startsWith(`${PRIVY_SESSION_MARKER}=1`)), true);
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
  const cleared = response.headers.getSetCookie();
  assert.equal(cleared.filter((cookie) => /Max-Age=0/.test(cookie)).length, 3);
  assert.equal(cleared.some((cookie) => cookie.startsWith(`${PRIVY_REFRESH_COOKIE}=`)), true);
  assert.equal(cleared.some((cookie) => cookie.startsWith(`${PRIVY_SESSION_MARKER}=`)), true);
});

/**
 * Achieves: verifies a rejected refresh drops the stored token instead of replaying it.
 * Fails when: a 401 from /sessions leaves the old refresh cookie in place.
 * Oracle: both the refresh cookie and the page marker are cleared.
 * Side effects / state checked: fake fetch only.
 * Gaps: does not call auth.privy.io.
 */
test('a rejected refresh clears the stored token', async () => {
  const response = await proxyPrivyAuth(
    requestFor('https://dev.maelstrom.iexdevs.com/api/privy-auth/api/v1/sessions', {
      cookie: `${PRIVY_REFRESH_COOKIE}=${encodeURIComponent(REFRESH)}; ${PRIVY_SESSION_MARKER}=1`,
      body: '{}',
    }),
    '/api/v1/sessions',
    async () => new Response(JSON.stringify({ error: 'Missing or invalid token' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }),
  );
  const cleared = response.headers.getSetCookie();
  assert.equal(cleared.filter((cookie) => /Max-Age=0/.test(cookie)).length, 3);
});

test('OAuth authentication and linking rotate the server access credential', async () => {
  for (const path of ['/api/v1/oauth/authenticate', '/api/v1/oauth/link']) {
    const response = await proxyPrivyAuth(
      requestFor(`https://dev.maelstrom.iexdevs.com/api/privy-auth${path}`, {
        body: '{}', cookie: `${PRIVY_ACCESS_COOKIE}=${ACCESS}; ${PRIVY_REFRESH_COOKIE}=${REFRESH}`,
      }),
      path,
      async (url, init) => {
        assert.equal(init.headers.get('authorization'), `Bearer ${ACCESS}`);
        assert.equal(init.body, '{}');
        return Response.json({ token: ACCESS, refresh_token: NEXT });
      },
    );
    assert.equal(response.headers.getSetCookie().some(cookie => cookie.startsWith(`${PRIVY_ACCESS_COOKIE}=`)), true);
    assert.equal(readRefreshCookie(response.headers.getSetCookie().join('; ')), NEXT);
    assert.equal(Object.hasOwn(await response.json(), 'refresh_token'), false);
  }
});

test('absent cookies preserve bearer auth and empty or failed responses do not create credentials', async () => {
  for (const [body, status] of [['{}', 200], ['not json', 502]]) {
    const response = await proxyPrivyAuth(
      requestFor('https://dev.maelstrom.iexdevs.com/api/privy-auth/api/v1/sessions', {
        body: '{}', headers: { authorization: `Bearer ${ACCESS}` },
      }),
      '/api/v1/sessions',
      async (url, init) => {
        assert.equal(init.headers.get('authorization'), `Bearer ${ACCESS}`);
        assert.equal(init.body, '{}');
        return new Response(body, { status });
      },
    );
    assert.deepEqual(response.headers.getSetCookie(), []);
  }
});

test('OAuth callback failures preserve the session and an explicit bearer takes precedence', async () => {
  for (const path of ['/api/v1/oauth/authenticate', '/api/v1/oauth/link']) {
    const response = await proxyPrivyAuth(
      requestFor(`https://dev.maelstrom.iexdevs.com/api/privy-auth${path}`, {
        body: '{}', cookie: `${PRIVY_ACCESS_COOKIE}=${ACCESS}`,
        headers: { authorization: 'Bearer current-access-token' },
      }),
      path,
      async (url, init) => {
        assert.equal(init.headers.get('authorization'), 'Bearer current-access-token');
        return Response.json({ error: 'invalid_oauth_code' }, { status: 401 });
      },
    );
    assert.equal(response.status, 401);
    assert.deepEqual(response.headers.getSetCookie(), []);
  }
});
