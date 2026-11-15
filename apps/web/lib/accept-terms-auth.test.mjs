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
  assert.equal(isPrivyTokenStorageKey('privy:clxxx:token'), true);
  assert.equal(isPrivyTokenStorageKey('privy:refresh_token'), false);
});

test('terms Accept keeps a bearer after the SDK clears storage', async () => {
  const storage = memoryStorage();
  const seen = [];
  const target = {
    Request,
    localStorage: storage,
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

  await target.fetch('https://auth.privy.io/api/v1/sessions', { method: 'POST' });
  assert.equal(seen[1].authorization, null);
});

test('removeItem alone still snapshots the token for Accept', async () => {
  const storage = memoryStorage({ 'privy:clapp:pat': JSON.stringify(TOKEN) });
  const seen = [];
  const target = {
    Request,
    localStorage: storage,
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

test('auth.privy.io JSON responses refill the token cache', async () => {
  const storage = memoryStorage();
  const seen = [];
  const target = {
    Request,
    localStorage: storage,
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
  // Simulate wipe with no removeItem hook path — empty storage, cache from response.
  storage.clear();
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
  rememberTokensFromPayload(auth, { data: { privy_access_token: TOKEN } });
  assert.equal(auth.current(null), TOKEN);
});
