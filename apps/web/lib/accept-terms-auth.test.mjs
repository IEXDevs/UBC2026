import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowPrivyLogout,
  clearAcceptTermsBackups,
  installAcceptTermsAuth,
  isAcceptTermsRequest,
  isPrivyAccessToken,
  isPrivyTokenStorageKey,
  authorizationNeedsToken,
  readPrivyAccessToken,
  rememberTokensFromPayload,
  createAcceptTermsAuth,
  acceptFailureShouldContinue,
  postAcceptTerms,
  resolveAcceptTermsToken,
  resolvePrivyRefreshToken,
  restorePrivySession,
  withPrivyLogout,
  MAELSTROM_TOKEN_KEY,
  MAELSTROM_CUSTOMER_KEY,
  MAELSTROM_REFRESH_KEY,
  SESSIONS_URL,
} from './accept-terms-auth.mjs';

const TOKEN = 'header.payload.signature';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    get length() {
      return Object.keys(data).length;
    },
    key(index) {
      return Object.keys(data)[index] ?? null;
    },
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    },
    clear() {
      for (const key of Object.keys(data)) delete data[key];
    },
  };
}

test('only the Privy terms POST is treated as the accept-terms request', () => {
  assert.equal(isAcceptTermsRequest('https://auth.privy.io/api/v1/users/me/accept_terms', 'POST'), true);
  assert.equal(isAcceptTermsRequest('/api/v1/users/me/accept_terms', 'POST'), true);
  assert.equal(isAcceptTermsRequest('https://auth.privy.io/api/v1/users/me/accept_terms', 'GET'), false);
  assert.equal(isAcceptTermsRequest('https://auth.privy.io/api/v1/sessions', 'POST'), false);
  assert.equal(isAcceptTermsRequest('https://example.com/api/v1/users/me/accept_terms', 'POST'), false);
  assert.equal(isPrivyAccessToken(TOKEN), true);
  assert.equal(isPrivyAccessToken(`"${TOKEN}"`), true);
  assert.equal(isPrivyAccessToken('not a token'), false);
  assert.equal(isPrivyTokenStorageKey('privy:pat'), true);
  assert.equal(isPrivyTokenStorageKey('privy:clxxx:pat'), true);
  assert.equal(isPrivyTokenStorageKey('privy:token'), false);
  assert.equal(isPrivyTokenStorageKey('privy:clxxx:token'), false);
  assert.equal(isPrivyTokenStorageKey('privy:refresh_token'), false);
});

test('terms Accept keeps a bearer after the SDK clears storage', async () => {
  const storage = memoryStorage();
  const session = memoryStorage();
  const seen = [];
  const target = {
    Request,
    localStorage: storage,
    sessionStorage: session,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      seen.push({
        url: request.url,
        authorization: request.headers.get('authorization'),
      });
      return new Response('{}', { status: 200 });
    },
  };
  installAcceptTermsAuth(target);
  storage.setItem('privy:pat', JSON.stringify(TOKEN));
  // OAuth/login must be allowed to delete session keys; backups still supply Accept.
  storage.removeItem('privy:pat');
  assert.equal(storage.getItem('privy:pat'), null);
  assert.equal(storage.getItem(MAELSTROM_TOKEN_KEY), TOKEN);
  await target.fetch(new Request('https://auth.privy.io/api/v1/users/me/accept_terms', {
    method: 'POST',
    body: '{}',
  }));
  assert.equal(seen[0].authorization, `Bearer ${TOKEN}`);
  assert.equal(session.getItem(MAELSTROM_TOKEN_KEY), TOKEN);

  await target.fetch('https://auth.privy.io/api/v1/sessions', { method: 'POST' });
  assert.equal(seen[1].authorization, null);
});

test('removeItem clears live keys but Accept still uses the Maelstrom backup', async () => {
  const storage = memoryStorage({ 'privy:clapp:pat': JSON.stringify(TOKEN) });
  const seen = [];
  const target = {
    Request,
    localStorage: storage,
    sessionStorage: memoryStorage(),
    fetch: async (input, init) => {
      seen.push(new Request(input, init).headers.get('authorization'));
      return new Response('{}');
    },
  };
  installAcceptTermsAuth(target);
  assert.equal(readPrivyAccessToken(storage), TOKEN);
  storage.removeItem('privy:clapp:pat');
  assert.equal(storage.getItem('privy:clapp:pat'), null);
  assert.equal(storage.getItem(MAELSTROM_TOKEN_KEY), TOKEN);

  await target.fetch('https://auth.privy.io/api/v1/users/me/accept_terms', {
    method: 'POST',
    headers: new Headers({ 'privy-app-id': 'app' }),
    body: '{}',
  });
  assert.equal(seen[0], `Bearer ${TOKEN}`);
});

test('explicit logout clears Maelstrom backups via withPrivyLogout', async () => {
  const storage = memoryStorage({
    'privy:pat': JSON.stringify(TOKEN),
    'privy:refresh_token': JSON.stringify('refresh-1'),
  });
  const target = {
    Request,
    localStorage: storage,
    sessionStorage: memoryStorage(),
    fetch: async () => new Response('{}'),
  };
  installAcceptTermsAuth(target);
  storage.setItem('privy:pat', JSON.stringify(TOKEN));
  assert.equal(storage.getItem(MAELSTROM_TOKEN_KEY), TOKEN);
  await withPrivyLogout(target, async () => {
    storage.removeItem('privy:pat');
    storage.removeItem('privy:refresh_token');
  });
  assert.equal(storage.getItem('privy:pat'), null);
  assert.equal(storage.getItem('privy:refresh_token'), null);
  assert.equal(storage.getItem(MAELSTROM_TOKEN_KEY), null);
  assert.equal(storage.getItem(MAELSTROM_REFRESH_KEY), null);
});

test('clear leaves Privy in charge; in-memory Accept cache still works', async () => {
  const storage = memoryStorage();
  const session = memoryStorage();
  const seen = [];
  const target = {
    Request,
    localStorage: storage,
    sessionStorage: session,
    fetch: async (input, init) => {
      seen.push(new Request(input, init).headers.get('authorization'));
      return new Response('{}');
    },
  };
  installAcceptTermsAuth(target);
  storage.setItem('privy:pat', JSON.stringify(TOKEN));
  storage.setItem('other', 'gone');
  storage.clear();
  assert.equal(storage.getItem('other'), null);
  assert.equal(storage.getItem('privy:pat'), null);
  // Maelstrom keys may be gone after a raw clear; memory cache still injects.
  await target.fetch('https://auth.privy.io/api/v1/users/me/accept_terms', {
    method: 'POST',
    body: '{}',
  });
  assert.equal(seen[0], `Bearer ${TOKEN}`);
});

test('OAuth can rotate session keys without our removeItem hooks', () => {
  const storage = memoryStorage({
    'privy:pat': JSON.stringify(TOKEN),
    'privy:token': JSON.stringify('old.customer.tok'),
  });
  const target = {
    Request,
    localStorage: storage,
    sessionStorage: memoryStorage(),
    fetch: async () => new Response('{}'),
  };
  installAcceptTermsAuth(target);
  const nextPat = 'next.payload.sig';
  const nextCustomer = 'next.customer.tok';
  storage.removeItem('privy:pat');
  storage.removeItem('privy:token');
  assert.equal(storage.getItem('privy:pat'), null);
  assert.equal(storage.getItem('privy:token'), null);
  storage.setItem('privy:pat', JSON.stringify(nextPat));
  storage.setItem('privy:token', JSON.stringify(nextCustomer));
  assert.equal(readPrivyAccessToken(storage), nextPat);
  assert.equal(storage.getItem(MAELSTROM_TOKEN_KEY), nextPat);
});

test('install does not rewrite missing privy keys from stale backups', () => {
  const storage = memoryStorage({
    [MAELSTROM_TOKEN_KEY]: TOKEN,
    [MAELSTROM_CUSTOMER_KEY]: 'customer.access.tok',
    [MAELSTROM_REFRESH_KEY]: 'refresh-1',
  });
  const target = {
    Request,
    localStorage: storage,
    sessionStorage: memoryStorage(),
    fetch: async () => new Response('{}'),
  };
  installAcceptTermsAuth(target);
  assert.equal(storage.getItem('privy:pat'), null);
  assert.equal(storage.getItem('privy:token'), null);
  assert.equal(storage.getItem('privy:refresh_token'), null);
  clearAcceptTermsBackups(target);
});

test('restorePrivySession rehydrates missing Privy keys from backups', () => {
  const storage = memoryStorage({
    [MAELSTROM_TOKEN_KEY]: TOKEN,
    [MAELSTROM_REFRESH_KEY]: 'refresh-1',
  });
  const auth = createAcceptTermsAuth();
  auth.remember(TOKEN);
  auth.rememberRefresh('refresh-1');
  assert.equal(restorePrivySession(storage, auth), true);
  assert.equal(JSON.parse(storage.getItem('privy:pat')), TOKEN);
  assert.equal(JSON.parse(storage.getItem('privy:refresh_token')), 'refresh-1');
});

test('auth.privy.io JSON responses refill the token cache', async () => {
  const storage = memoryStorage();
  const seen = [];
  const target = {
    Request,
    localStorage: storage,
    sessionStorage: memoryStorage(),
    fetch: async (input, init) => {
      const url = String(input);
      if (url.includes('/sessions')) {
        return new Response(JSON.stringify({
          token: 'a.b.c',
          privy_access_token: TOKEN,
          refresh_token: 'refresh',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      seen.push(new Request(input, init).headers.get('authorization'));
      return new Response('{}');
    },
  };
  installAcceptTermsAuth(target);
  await target.fetch('https://auth.privy.io/api/v1/sessions', {
    method: 'POST',
    body: '{}',
  });
  storage.removeItem('privy:pat');
  storage.removeItem('privy:token');
  await target.fetch('https://auth.privy.io/api/v1/users/me/accept_terms', {
    method: 'POST',
    body: '{}',
  });
  assert.equal(seen[0], `Bearer ${TOKEN}`);
});

test('empty Bearer headers are replaced on accept_terms', async () => {
  const storage = memoryStorage({ 'privy:pat': JSON.stringify(TOKEN) });
  const seen = [];
  const target = {
    Request,
    localStorage: storage,
    sessionStorage: memoryStorage(),
    fetch: async (input, init) => {
      seen.push(new Request(input, init).headers.get('authorization'));
      return new Response('{}');
    },
  };
  installAcceptTermsAuth(target);
  assert.equal(authorizationNeedsToken(new Headers({ authorization: 'Bearer ' })), true);
  await target.fetch('https://auth.privy.io/api/v1/users/me/accept_terms', {
    method: 'POST',
    headers: { authorization: 'Bearer ' },
  });
  assert.equal(seen[0], `Bearer ${TOKEN}`);
});

test('a customer bearer on accept_terms is replaced with the session token', async () => {
  const storage = memoryStorage({
    'privy:pat': JSON.stringify(TOKEN),
    'privy:token': JSON.stringify('customer.access.jwt'),
  });
  const seen = [];
  const target = {
    Request,
    localStorage: storage,
    sessionStorage: memoryStorage(),
    fetch: async (input, init) => {
      seen.push(new Request(input, init).headers.get('authorization'));
      return new Response('{}');
    },
  };
  installAcceptTermsAuth(target);
  assert.equal(readPrivyAccessToken(storage), TOKEN);
  await target.fetch('https://auth.privy.io/api/v1/users/me/accept_terms', {
    method: 'POST',
    headers: { authorization: 'Bearer already.have.one' },
  });
  assert.equal(seen[0], `Bearer ${TOKEN}`);
});

test('the session bearer is left in place when it is already set', async () => {
  const storage = memoryStorage({ 'privy:pat': JSON.stringify(TOKEN) });
  const seen = [];
  const target = {
    Request,
    localStorage: storage,
    sessionStorage: memoryStorage(),
    fetch: async (input, init) => {
      seen.push(new Request(input, init).headers.get('authorization'));
      return new Response('{}');
    },
  };
  installAcceptTermsAuth(target);
  await target.fetch('https://auth.privy.io/api/v1/users/me/accept_terms', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(seen[0], `Bearer ${TOKEN}`);
});

test('the customer access token is not sent as the accept_terms bearer', async () => {
  const storage = memoryStorage({ 'privy:token': JSON.stringify(TOKEN) });
  const seen = [];
  const target = {
    Request,
    localStorage: storage,
    sessionStorage: memoryStorage(),
    fetch: async (input, init) => {
      seen.push(new Request(input, init).headers.get('authorization'));
      return new Response('{}');
    },
  };
  installAcceptTermsAuth(target);
  assert.equal(readPrivyAccessToken(storage), '');
  await target.fetch('https://auth.privy.io/api/v1/users/me/accept_terms', {
    method: 'POST',
    headers: { 'privy-app-id': 'app' },
    body: '{}',
  });
  assert.equal(seen[0], null);
});

test('a wiped session is minted from the refresh token before accept_terms', async () => {
  const storage = memoryStorage({
    'privy:refresh_token': JSON.stringify('refresh-1'),
  });
  const seen = [];
  const target = {
    Request,
    localStorage: storage,
    sessionStorage: memoryStorage(),
    fetch: async (input, init) => {
      const request = new Request(input, init);
      if (request.url === SESSIONS_URL) {
        assert.equal(await request.json().then((body) => body.refresh_token), 'refresh-1');
        return new Response(JSON.stringify({
          token: 'customer.access.jwt',
          privy_access_token: TOKEN,
          refresh_token: 'refresh-2',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      seen.push(request.headers.get('authorization'));
      return new Response('{}', { status: 200 });
    },
  };
  installAcceptTermsAuth(target);
  await target.fetch('https://auth.privy.io/api/v1/users/me/accept_terms', {
    method: 'POST',
    headers: { 'privy-app-id': 'app_123', authorization: 'Bearer customer.access.jwt' },
    body: '{}',
  });
  assert.equal(seen[0], `Bearer ${TOKEN}`);
  assert.equal(resolvePrivyRefreshToken(target), 'refresh-2');
  assert.equal(storage.getItem(MAELSTROM_REFRESH_KEY), 'refresh-2');
});

test('rememberTokensFromPayload keeps session and customer tokens separate', () => {
  const auth = createAcceptTermsAuth();
  rememberTokensFromPayload(auth, {
    data: { token: 'customer.access.jwt', privy_access_token: TOKEN },
  });
  assert.equal(auth.current(null), TOKEN);
  assert.equal(auth.customerToken(null), 'customer.access.jwt');
  rememberTokensFromPayload(auth, { token: 'other.customer.jwt' });
  assert.equal(auth.current(null), TOKEN);
  assert.equal(auth.customerToken(null), 'other.customer.jwt');
});

test('a wipe leaves privy keys gone so refresh can use Privy storage as-is', () => {
  const storage = memoryStorage();
  const target = {
    Request,
    localStorage: storage,
    sessionStorage: memoryStorage(),
    fetch: async () => new Response('{}'),
  };
  installAcceptTermsAuth(target);
  const customer = 'customer.access.tok';
  storage.setItem('privy:pat', JSON.stringify(TOKEN));
  storage.setItem('privy:token', JSON.stringify(customer));
  storage.setItem('privy:refresh_token', JSON.stringify('refresh-1'));
  storage.removeItem('privy:pat');
  storage.removeItem('privy:token');
  storage.removeItem('privy:refresh_token');
  // We must not force-restore privy:* after deletes — that broke page refresh.
  assert.equal(storage.getItem('privy:pat'), null);
  assert.equal(storage.getItem('privy:token'), null);
  assert.equal(storage.getItem('privy:refresh_token'), null);
  assert.equal(storage.getItem(MAELSTROM_TOKEN_KEY), TOKEN);
  assert.equal(storage.getItem(MAELSTROM_CUSTOMER_KEY), customer);
});

test('postAcceptTerms sends bearer and app id', async () => {
  const seen = [];
  const result = await postAcceptTerms({
    token: TOKEN,
    appId: 'app_123',
    clientId: 'client_9',
    fetchImpl: async (url, init) => {
      seen.push({ url, headers: init.headers, body: init.body });
      return new Response('{}', { status: 200 });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(seen[0].url, 'https://auth.privy.io/api/v1/users/me/accept_terms');
  assert.equal(seen[0].headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(seen[0].headers['privy-app-id'], 'app_123');
  assert.equal(seen[0].headers['privy-client-id'], 'client_9');
  assert.equal(seen[0].headers['privy-client'], 'react-auth:3.51.4');
});

test('postAcceptTerms mints a session bearer from the refresh token', async () => {
  const seen = [];
  const result = await postAcceptTerms({
    token: '',
    refreshToken: 'refresh-1',
    appId: 'app_123',
    fetchImpl: async (url, init) => {
      seen.push({ url, authorization: init.headers.authorization, body: init.body });
      if (String(url).endsWith('/api/v1/sessions')) {
        return new Response(JSON.stringify({ privy_access_token: TOKEN }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(seen[0].url, SESSIONS_URL);
  assert.equal(seen[0].authorization, undefined);
  assert.equal(JSON.parse(seen[0].body).refresh_token, 'refresh-1');
  assert.equal(seen[1].authorization, `Bearer ${TOKEN}`);
});

test('postAcceptTerms fails closed without a token', async () => {
  const result = await postAcceptTerms({
    token: '',
    appId: 'app_123',
    fetchImpl: async () => {
      throw new Error('should not fetch');
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'token_missing');
});

test('fetch captured before install still gets the session bearer', async () => {
  const seen = [];
  const native = async (input, init) => {
    seen.push(new Request(input, init).headers.get('authorization'));
    return new Response('{}', { status: 200 });
  };
  let hook = null;
  const captured = (input, init) => (typeof hook === 'function' ? hook(input, init) : native(input, init));
  const storage = memoryStorage({ 'privy:pat': JSON.stringify(TOKEN) });
  const target = {
    Request,
    localStorage: storage,
    sessionStorage: memoryStorage(),
    fetch: captured,
    __maelstromNativeFetch: native,
  };
  Object.defineProperty(target, '__maelstromFetchHook', {
    configurable: true,
    get() { return hook; },
    set(value) { hook = value; },
  });
  installAcceptTermsAuth(target);
  await captured('https://auth.privy.io/api/v1/users/me/accept_terms', {
    method: 'POST',
    body: '{}',
  });
  assert.equal(seen[0], `Bearer ${TOKEN}`);
});

test('an expired session token does not call accept_terms and login can continue', async () => {
  const expired = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url')}.sig`;
  let called = false;
  const result = await postAcceptTerms({
    token: expired,
    appId: 'app_123',
    fetchImpl: async () => {
      called = true;
      return new Response('{}', { status: 200 });
    },
  });
  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(acceptFailureShouldContinue(result), true);
  assert.equal(acceptFailureShouldContinue({ ok: false, status: 401, error: 'Missing auth token.' }), true);
  assert.equal(acceptFailureShouldContinue({ ok: false, status: 500, error: 'accept_failed' }), false);
  assert.equal(acceptFailureShouldContinue({ ok: true, status: 200, error: '' }), false);
});

test('resolveAcceptTermsToken reads the installed cache', () => {
  const storage = memoryStorage({ 'privy:pat': JSON.stringify(TOKEN) });
  const target = {
    Request,
    localStorage: storage,
    sessionStorage: memoryStorage(),
    fetch: async () => new Response('{}'),
  };
  installAcceptTermsAuth(target);
  storage.removeItem('privy:pat');
  assert.equal(resolveAcceptTermsToken(target), TOKEN);
});
