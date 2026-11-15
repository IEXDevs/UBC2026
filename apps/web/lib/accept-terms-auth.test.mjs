import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  installAcceptTermsAuth,
  isAcceptTermsRequest,
  isPrivyAccessToken,
  isPrivyTokenStorageKey,
  authorizationNeedsToken,
  readPrivyAccessToken,
  rememberTokensFromPayload,
  createAcceptTermsAuth,
  postAcceptTerms,
  resolveAcceptTermsToken,
  resolvePrivyRefreshToken,
  MAELSTROM_TOKEN_KEY,
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
  storage.removeItem('privy:pat');
  await target.fetch(new Request('https://auth.privy.io/api/v1/users/me/accept_terms', {
    method: 'POST',
    body: '{}',
  }));
  assert.equal(seen[0].authorization, `Bearer ${TOKEN}`);
  assert.equal(session.getItem(MAELSTROM_TOKEN_KEY), TOKEN);

  await target.fetch('https://auth.privy.io/api/v1/sessions', { method: 'POST' });
  assert.equal(seen[1].authorization, null);
});

test('removeItem alone still snapshots the token for Accept', async () => {
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

  await target.fetch('https://auth.privy.io/api/v1/users/me/accept_terms', {
    method: 'POST',
    headers: new Headers({ 'privy-app-id': 'app' }),
    body: '{}',
  });
  assert.equal(seen[0], `Bearer ${TOKEN}`);
});

test('clear keeps the Maelstrom backup token', async () => {
  const storage = memoryStorage({ 'privy:pat': JSON.stringify(TOKEN) });
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
  storage.clear();
  assert.equal(storage.getItem('privy:pat'), null);
  assert.equal(storage.getItem(MAELSTROM_TOKEN_KEY), TOKEN);
  await target.fetch('https://auth.privy.io/api/v1/users/me/accept_terms', {
    method: 'POST',
    body: '{}',
  });
  assert.equal(seen[0], `Bearer ${TOKEN}`);
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

test('rememberTokensFromPayload keeps the session token, not the customer token', () => {
  const auth = createAcceptTermsAuth();
  rememberTokensFromPayload(auth, {
    data: { token: 'customer.access.jwt', privy_access_token: TOKEN },
  });
  assert.equal(auth.current(null), TOKEN);
  rememberTokensFromPayload(auth, { token: 'other.customer.jwt' });
  assert.equal(auth.current(null), TOKEN);
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
