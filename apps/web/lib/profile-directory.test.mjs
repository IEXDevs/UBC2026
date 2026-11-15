import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localProfileResponse, useLocalProfileDirectory } from './profile-directory.mjs';

const KEY = 'service-role-test-value';
const ENV = {
  SUPABASE_URL: 'https://directory.example',
  SUPABASE_SERVICE_ROLE_KEY: KEY,
};

function claim(body = { displayName: 'jimothy67', handle: 'Alex01' }) {
  return new Request('https://app.local/api/profiles/me', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'did:privy:user_1' },
    body: JSON.stringify(body),
  });
}

test('a handle claim writes the directory and keeps the service role out of the response', async () => {
  const calls = [];
  const response = await localProfileResponse(claim(), {
    env: ENV,
    fetcher: async (url, init) => {
      calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null, auth: init.headers.authorization });
      return new Response(JSON.stringify([{ handle: 'alex01' }]), { status: 201 });
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.source, 'supabase');
  assert.equal(body.profile.handle, 'alex01');
  assert.equal(body.profile.displayName, 'jimothy67');
  assert.equal(calls[0].url, 'https://directory.example/rest/v1/users?on_conflict=id');
  assert.equal(calls[0].body.privy_user_id, 'did:privy:user_1');
  assert.equal(calls[1].url, 'https://directory.example/rest/v1/profiles?on_conflict=owner_id');
  assert.equal(calls[1].body.handle, 'alex01');
  assert.equal(calls[1].body.display_name, 'jimothy67');
  assert.equal(JSON.stringify(body).includes(KEY), false);
  assert.equal(calls.every(call => call.auth === `Bearer ${KEY}`), true);
});

test('a taken handle stays a conflict and does not look like a saved claim', async () => {
  const response = await localProfileResponse(claim(), {
    env: ENV,
    fetcher: async (url) => new Response('{}', { status: url.includes('profiles') ? 409 : 201 }),
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'handle_taken' });
});

test('a claim insert is still there on a fresh read by owner id', async () => {
  const users = new Map();
  const profiles = new Map();
  const response = await localProfileResponse(claim(), {
    env: ENV,
    fetcher: async (url, init) => {
      const href = String(url);
      const method = init.method || 'GET';
      if (href.includes('/users')) {
        const body = JSON.parse(init.body);
        users.set(body.id, body);
        return new Response('', { status: 201 });
      }
      if (method === 'POST' && href.includes('/profiles')) {
        const body = JSON.parse(init.body);
        profiles.set(body.owner_id, body);
        return new Response(JSON.stringify([body]), { status: 201 });
      }
      const owner = new URL(href).searchParams.get('owner_id')?.replace(/^eq\./, '');
      const row = profiles.get(decodeURIComponent(owner || ''));
      return Response.json(row ? [row] : []);
    },
  });
  assert.equal(response.status, 200);
  const read = await localProfileResponse(new Request('https://app.local/api/profiles/me', {
    headers: { 'x-owner-id': 'did:privy:user_1' },
  }), {
    env: ENV,
    fetcher: async (url) => {
      const owner = new URL(String(url)).searchParams.get('owner_id')?.replace(/^eq\./, '');
      const row = profiles.get(decodeURIComponent(owner || ''));
      return Response.json(row ? [row] : []);
    },
  });
  const body = await read.json();
  assert.equal(body.profile.handle, 'alex01');
  assert.equal(body.profile.displayName, 'jimothy67');
  assert.equal(users.has('did:privy:user_1'), true);
});

test('a failed user insert returns the database code and does not claim success', async () => {
  const response = await localProfileResponse(claim(), {
    env: ENV,
    fetcher: async (url) => {
      if (String(url).includes('/users')) {
        return Response.json({ code: '23503' }, { status: 409 });
      }
      return new Response('', { status: 201 });
    },
  });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, '23503');
});

test('a directory write is used when the service role is set', () => {
  assert.equal(useLocalProfileDirectory(ENV), true);
  assert.equal(useLocalProfileDirectory({ SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: '' }), false);
});

test('a missing directory config does not pretend the claim was saved', async () => {
  let called = false;
  const response = await localProfileResponse(claim(), {
    env: { SUPABASE_URL: 'https://directory.example', SUPABASE_SERVICE_ROLE_KEY: '' },
    fetcher: async () => { called = true; return new Response('{}', { status: 201 }); },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'directory_unconfigured');
  assert.equal(called, false);
});
