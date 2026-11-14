import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  installAcceptTermsAuth,
  isAcceptTermsRequest,
  isPrivyAccessToken,
  readPrivyAccessToken,
} from './accept-terms-auth.mjs';

const TOKEN = 'header.payload.signature';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    remove(key) {
      delete data[key];
    },
  };
}

test('only the Privy terms POST is treated as the accept-terms request', () => {
  assert.equal(isAcceptTermsRequest('https://auth.privy.io/api/v1/users/me/accept_terms', 'POST'), true);
  assert.equal(isAcceptTermsRequest('https://auth.privy.io/api/v1/users/me/accept_terms', 'GET'), false);
  assert.equal(isAcceptTermsRequest('https://auth.privy.io/api/v1/sessions', 'POST'), false);
  assert.equal(isAcceptTermsRequest('https://example.com/api/v1/users/me/accept_terms', 'POST'), false);
  assert.equal(isPrivyAccessToken(TOKEN), true);
  assert.equal(isPrivyAccessToken(`"${TOKEN}"`), true);
  assert.equal(isPrivyAccessToken('not a token'), false);
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
  // Privy JSON-encodes tokens in localStorage.
  storage.setItem('privy:pat', JSON.stringify(TOKEN));
  // getAccessToken() destroys local state, then the POST goes out with no header.
  storage.remove('privy:pat');
  await target.fetch(new Request('https://auth.privy.io/api/v1/users/me/accept_terms', {
    method: 'POST',
    body: '{}',
  }));
  assert.equal(seen[0].authorization, `Bearer ${TOKEN}`);

  await target.fetch('https://auth.privy.io/api/v1/sessions', { method: 'POST' });
  assert.equal(seen[1].authorization, null);
});

test('an existing authorization header is left alone', async () => {
  const storage = memoryStorage({ 'privy:token': JSON.stringify(TOKEN) });
  const seen = [];
  const target = {
    Request,
    localStorage: storage,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      seen.push(request.headers.get('authorization'));
      return new Response('{}');
    },
  };
  installAcceptTermsAuth(target);
  assert.equal(readPrivyAccessToken(storage), TOKEN);
  await target.fetch('https://auth.privy.io/api/v1/users/me/accept_terms', {
    method: 'POST',
    headers: { authorization: 'Bearer already-set' },
  });
  assert.equal(seen[0], 'Bearer already-set');
});
