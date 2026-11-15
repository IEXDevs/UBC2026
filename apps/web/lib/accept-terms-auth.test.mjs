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
  restorePrivySession,
  allowPrivyLogout,
  MAELSTROM_TOKEN_KEY,
  MAELSTROM_REFRESH_KEY,
} from './accept-terms-auth.mjs';

const TOKEN = 'header.payload.signature';
const REFRESH = 'refresh-token-value';

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
  assert.equal(isPrivyTokenStorageKey('privy:clxxx:token'), true);
  assert.equal(isPrivyTokenStorageKey('privy:refresh_token'), false);
});

test('terms Accept keeps a bearer after a blocked session wipe', async () => {
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
  storage.setItem('privy:refresh_token', JSON.stringify(REFRESH));
  // Privy destroyLocalState tries to delete session keys; we keep them.
  storage.removeItem('privy:pat');
  storage.removeItem('privy:refresh_token');
  assert.equal(unwrap(storage.getItem('privy:pat')), TOKEN);
  assert.equal(unwrap(storage.getItem('privy:refresh_token')), REFRESH);

  await target.fetch(new Request('https://auth.privy.io/api/v1/users/me/accept_terms', {
    method: 'POST',
    body: '{}',
  }));
  assert.equal(seen[0].authorization, `Bearer ${TOKEN}`);
  assert.equal(session.getItem(MAELSTROM_TOKEN_KEY), TOKEN);
  assert.equal(session.getItem(MAELSTROM_REFRESH_KEY), REFRESH);
});

function unwrap(value) {
  if (typeof value !== 'string') return '';
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'string' ? parsed : value;
  } catch {
    return value;
  }
}

test('explicit logout is allowed to clear Privy session keys', () => {
  const storage = memoryStorage({
    'privy:pat': JSON.stringify(TOKEN),
    'privy:refresh_token': JSON.stringify(REFRESH),
  });
  const target = {
    Request,
    localStorage: storage,
    sessionStorage: memoryStorage(),
    fetch: async () => new Response('{}'),
  };
  installAcceptTermsAuth(target);
  allowPrivyLogout(target, true);
  storage.removeItem('privy:pat');
  storage.removeItem('privy:refresh_token');
  allowPrivyLogout(target, false);
  assert.equal(storage.getItem('privy:pat'), null);
  assert.equal(storage.getItem('privy:refresh_token'), null);
});

test('clear keeps Privy session keys so refresh still restores login', () => {
  const storage = memoryStorage({
    'privy:pat': JSON.stringify(TOKEN),
    'privy:refresh_token': JSON.stringify(REFRESH),
    other: 'gone',
  });
  const target = {
    Request,
    localStorage: storage,
    sessionStorage: memoryStorage(),
    fetch: async () => new Response('{}'),
  };
  installAcceptTermsAuth(target);
  storage.clear();
  assert.equal(storage.getItem('other'), null);
  assert.equal(unwrap(storage.getItem('privy:pat')), TOKEN);
  assert.equal(unwrap(storage.getItem('privy:refresh_token')), REFRESH);
  assert.equal(storage.getItem(MAELSTROM_TOKEN_KEY), TOKEN);
});

test('restorePrivySession rehydrates missing Privy keys from backups', () => {
  const storage = memoryStorage({
    [MAELSTROM_TOKEN_KEY]: TOKEN,
    [MAELSTROM_REFRESH_KEY]: REFRESH,
  });
  const auth = createAcceptTermsAuth();
  auth.remember(TOKEN);
  auth.rememberRefresh(REFRESH);
  assert.equal(restorePrivySession(storage, auth), true);
  assert.equal(unwrap(storage.getItem('privy:pat')), TOKEN);
  assert.equal(unwrap(storage.getItem('privy:refresh_token')), REFRESH);
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
          refresh_token: REFRESH,
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
  assert.equal(unwrap(storage.getItem('privy:pat')), TOKEN);
  assert.equal(unwrap(storage.getItem('privy:refresh_token')), REFRESH);
  await target.fetch('https://auth.privy.io/api/v1/users/me/accept_terms', {
    method: 'POST',
    body: '{}',
  });
  assert.equal(seen[0], `Bearer ${TOKEN}`);
});

test('empty Bearer headers are replaced on accept_terms', async () => {
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
  assert.equal(authorizationNeedsToken(new Headers({ authorization: 'Bearer ' })), true);
  await target.fetch('https://auth.privy.io/api/v1/users/me/accept_terms', {
    method: 'POST',
    headers: { authorization: 'Bearer ' },
  });
  assert.equal(seen[0], `Bearer ${TOKEN}`);
});

test('an existing valid authorization header is left alone', async () => {
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
  assert.equal(readPrivyAccessToken(storage), TOKEN);
  await target.fetch('https://auth.privy.io/api/v1/users/me/accept_terms', {
    method: 'POST',
    headers: { authorization: 'Bearer already.have.one' },
  });
  assert.equal(seen[0], 'Bearer already.have.one');
});

test('rememberTokensFromPayload reads nested session bodies', () => {
  const auth = createAcceptTermsAuth();
  rememberTokensFromPayload(auth, { data: { privy_access_token: TOKEN, refresh_token: REFRESH } });
  assert.equal(auth.current(null), TOKEN);
  assert.equal(auth.currentRefresh(null), REFRESH);
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

test('resolveAcceptTermsToken reads the installed cache', () => {
  const storage = memoryStorage({ 'privy:pat': JSON.stringify(TOKEN) });
  const target = {
    Request,
    localStorage: storage,
    sessionStorage: memoryStorage(),
    fetch: async () => new Response('{}'),
  };
  installAcceptTermsAuth(target);
  assert.equal(resolveAcceptTermsToken(target), TOKEN);
});
