import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localHandleLookup, localProfileResponse, useLocalProfileDirectory } from './profile-directory.mjs';

const KEY = 'service-role-test-value';
const ENV = {
  SUPABASE_URL: 'https://directory.example',
  SUPABASE_SERVICE_ROLE_KEY: KEY,
};

function claim(body = { displayName: 'jimothy67', handle: 'Alex01' }, ownerId = 'did:privy:user_1') {
  return new Request('https://app.local/api/profiles/me', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-owner-id': ownerId },
    body: JSON.stringify(body),
  });
}

function ownerFrom(href) {
  const raw = new URL(String(href)).searchParams.get('owner_id') || '';
  const value = raw.replace(/^eq\./, '');
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replaceAll('""', '"');
  return value;
}

test('profile editing patches only the owner metadata and ignores a stale handle', async () => {
  let row = { handle: 'canonical', display_name: 'Old', avatar_url: null };
  const writes = [];
  const response = await localProfileResponse(claim({ editOnly: true, handle: 'stale', displayName: 'Updated' }), {
    env: ENV,
    fetcher: async (url, init) => {
      assert.equal(new URL(url).searchParams.get('owner_id'), 'eq.did:privy:user_1');
      if (init.method === 'PATCH') {
        const patch = JSON.parse(init.body);
        writes.push(patch);
        assert.equal('handle' in patch, false);
        assert.equal('owner_id' in patch, false);
        row = { ...row, ...patch };
      } else assert.equal(init.method, 'GET');
      return Response.json([row]);
    },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).profile.handle, 'canonical');
  assert.equal(writes[0].display_name, 'Updated');
});

test('an edit cannot claim a handle for an account with no directory row', async () => {
  let writes = 0;
  const response = await localProfileResponse(claim({ editOnly: true, handle: 'sid', displayName: 'Sid' }), {
    env: ENV, fetcher: async (_url, init) => { if (init.method !== 'GET') writes += 1; return Response.json([]); },
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'profile_not_registered');
  assert.equal(writes, 0);
});

/**
 * Achieves: verifies a handle claim writes the directory and keeps the service role out of the response.
 * Fails when: a handle claim writes the directory and keeps the service role out of the response breaks (e.g. expected 200, 'supabase', 'alex01'); failure/null paths flip.
 * Oracle: assert.equal(response.status, 200); assert.equal(body.source, 'supabase'); assert.equal(body.profile.handle, 'alex01'); assert.equal(body.profile.displayName, 'jimothy67'); assert.equal(calls[0].url, 'https://directory.example/rest/v1/users?on_conflict=id'); assert.equal(calls[0].body.privy_user_id, 'did:privy:user_1')
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
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

/**
 * Achieves: verifies a handle lookup refuses a name another owner already stored.
 * Fails when: a handle lookup refuses a name another owner already stored breaks (e.g. expected 200, false, true).
 * Oracle: assert.equal(response.status, 200); assert.equal((await response.json()).recipient.missing, false); assert.equal((await open.json()).recipient.missing, true); assert.equal(ownBody.recipient.missing, false); assert.equal(ownBody.recipient.self, true); assert.equal(ownBody.recipient.handle, 'royce')
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
test('a handle lookup refuses a name another owner already stored', async () => {
  const response = await localHandleLookup(new Request('https://app.local/api/profiles/lookup?q=%40Alex', {
    headers: { 'x-owner-id': 'did:privy:user_2' },
  }), {
    env: ENV,
    fetcher: async () => Response.json([{ owner_id: 'did:privy:user_1', handle: 'alex', display_name: 'alex@example.test' }]),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.recipient.missing, false);
  assert.equal(body.recipient.displayName, '@alex');
  assert.equal(JSON.stringify(body).includes('alex@example.test'), false);
  const open = await localHandleLookup(new Request('https://app.local/api/profiles/lookup?q=%40sid', {
    headers: { 'x-owner-id': 'did:privy:user_2' },
  }), {
    env: ENV,
    fetcher: async () => Response.json([]),
  });
  assert.equal((await open.json()).recipient.missing, true);
  const own = await localHandleLookup(new Request('https://app.local/api/profiles/lookup?q=%40royce', {
    headers: { 'x-owner-id': 'did:privy:user_1' },
  }), {
    env: ENV,
    fetcher: async () => Response.json([{ owner_id: 'did:privy:user_1', handle: 'royce', display_name: 'Royce' }]),
  });
  const ownBody = await own.json();
  assert.equal(ownBody.recipient.missing, false);
  assert.equal(ownBody.recipient.self, true);
  assert.equal(ownBody.recipient.handle, 'royce');
});

/**
 * Achieves: a spoken lookup lowercases a weird handle to letters and numbers.
 * Fails when: the directory is queried with the raw sentence or the underscore.
 * Oracle: the filter is handle.eq.alexsmith and the stored row is still returned.
 * Side effects: none beyond the fake fetcher.
 */
test('a spoken lookup lowercases the handle to letters and numbers', async () => {
  let href = '';
  const response = await localHandleLookup(new Request(`https://app.local/api/profiles/lookup?q=${encodeURIComponent("look up @Alex_Smith's wallet")}`, {
    headers: { 'x-owner-id': 'did:privy:user_2' },
  }), {
    env: ENV,
    fetcher: async (url) => {
      href = String(url);
      return Response.json([{ owner_id: 'did:privy:user_1', handle: 'alex_smith', display_name: 'Alex' }]);
    },
  });
  assert.equal(response.status, 200);
  assert.match(href, /handle\.eq\.alexsmith/);
  const body = await response.json();
  assert.equal(body.recipient.missing, false);
  assert.equal(body.recipient.handle, 'alex_smith');
});

/**
 * Achieves: verifies a taken handle stays a conflict and does not look like a saved claim.
 * Fails when: a taken handle stays a conflict and does not look like a saved claim breaks (e.g. expected 409, { error: 'handle_taken' }).
 * Oracle: assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: 'handle_taken' })
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
test('a taken handle stays a conflict and does not look like a saved claim', async () => {
  const response = await localProfileResponse(claim(), {
    env: ENV,
    fetcher: async (url) => new Response('{}', { status: url.includes('profiles') ? 409 : 201 }),
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'handle_taken' });
});

/**
 * Achieves: verifies a claim insert is still there on a fresh read by owner id.
 * Fails when: a claim insert is still there on a fresh read by owner id breaks (e.g. expected 200, 'alex01', 'jimothy67').
 * Oracle: assert.equal(response.status, 200); assert.equal(body.profile.handle, 'alex01'); assert.equal(body.profile.displayName, 'jimothy67'); assert.equal(users.has('did:privy:user_1'), true)
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
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
      const row = profiles.get(ownerFrom(href));
      return Response.json(row ? [row] : []);
    },
  });
  assert.equal(response.status, 200);
  const read = await localProfileResponse(new Request('https://app.local/api/profiles/me', {
    headers: { 'x-owner-id': 'did:privy:user_1' },
  }), {
    env: ENV,
    fetcher: async (url) => {
      const row = profiles.get(ownerFrom(url));
      return Response.json(row ? [row] : []);
    },
  });
  const body = await read.json();
  assert.equal(body.profile.handle, 'alex01');
  assert.equal(body.profile.displayName, 'jimothy67');
  assert.equal(users.has('did:privy:user_1'), true);
});

/**
 * Achieves: verifies a failed user insert returns the database code and does not claim success.
 * Fails when: a failed user insert returns the database code and does not claim success breaks (e.g. expected 502, '23503').
 * Oracle: assert.equal(response.status, 502); assert.equal((await response.json()).error, '23503')
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
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

/**
 * Achieves: verifies a Privy DID confirm read matches the owner without quoting the eq value.
 * Fails when: a Privy DID confirm read matches the owner without quoting the eq value breaks (e.g. expected 200, 'alex', 'ada@example.com').
 * Oracle: assert.equal(response.status, 200); assert.equal(body.profile.handle, 'alex'); assert.equal(body.profile.displayName, 'ada@example.com'); assert.equal(profiles.get('did:privy:user_1').handle, 'alex')
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
test('a Privy DID confirm read matches the owner without quoting the eq value', async () => {
  const profiles = new Map();
  const response = await localProfileResponse(claim({
    displayName: 'ada@example.com',
    handle: 'alex',
  }), {
    env: ENV,
    fetcher: async (url, init) => {
      const href = String(url);
      const method = init.method || 'GET';
      if (href.includes('/users')) return new Response('', { status: 201 });
      if (method === 'POST' && href.includes('/profiles')) {
        const body = JSON.parse(init.body);
        profiles.set(body.owner_id, body);
        return Response.json([body], { status: 201 });
      }
      const filter = new URL(href).searchParams.get('owner_id') || '';
      // Real PostgREST eq keeps quotes as part of the value, so a quoted DID matches nothing.
      if (filter.includes('"')) return Response.json([]);
      const row = profiles.get(ownerFrom(href));
      return Response.json(row ? [row] : []);
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.profile.handle, 'alex');
  assert.equal(body.profile.displayName, 'ada@example.com');
  assert.equal(profiles.get('did:privy:user_1').handle, 'alex');
});

/**
 * Achieves: verifies a rejected directory call keeps the HTTP status and drops the provider body.
 * Fails when: a rejected directory call keeps the HTTP status and drops the provider body breaks (e.g. expected 502, 'supabase_http_401', false).
 * Oracle: assert.equal(response.status, 502); assert.equal(body.error, 'supabase_http_401'); assert.equal(JSON.stringify(body).includes('service-role-secret'), false); assert.equal(JSON.stringify(body).includes('Invalid API key'), false)
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
test('a rejected directory call keeps the HTTP status and drops the provider body', async () => {
  const response = await localProfileResponse(claim(), {
    env: ENV,
    fetcher: async () => Response.json({ message: 'Invalid API key', hint: 'service-role-secret' }, { status: 401 }),
  });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error, 'supabase_http_401');
  assert.equal(JSON.stringify(body).includes('service-role-secret'), false);
  assert.equal(JSON.stringify(body).includes('Invalid API key'), false);
});

/**
 * Achieves: verifies a thrown directory fetch and an empty confirm stay closed and drop the provider body.
 * Fails when: a thrown directory fetch and an empty confirm stay closed and drop the provider body breaks (e.g. expected 502, 'profile_directory_unreachable', false).
 * Oracle: assert.equal(thrown.status, 502); assert.equal(thrownBody.error, 'profile_directory_unreachable'); assert.equal(JSON.stringify(thrownBody).includes('secret-value'), false); assert.equal(lookup.status, 502); assert.equal((await lookup.json()).error, 'profile_read_failed'); assert.equal(empty.status, 502)
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
test('a thrown directory fetch and an empty confirm stay closed and drop the provider body', async () => {
  const thrown = await localProfileResponse(claim({ displayName: 'ada@example.com', handle: 'alex' }), {
    env: ENV,
    fetcher: async () => { throw new Error('down secret-value'); },
  });
  assert.equal(thrown.status, 502);
  const thrownBody = await thrown.json();
  assert.equal(thrownBody.error, 'profile_directory_unreachable');
  assert.equal(JSON.stringify(thrownBody).includes('secret-value'), false);
  const lookup = await localHandleLookup(new Request('https://app.local/api/profiles/lookup?q=%40alex', {
    headers: { 'x-owner-id': 'did:privy:user_1' },
  }), {
    env: ENV,
    fetcher: async () => { throw new Error('down secret-value'); },
  });
  assert.equal(lookup.status, 502);
  assert.equal((await lookup.json()).error, 'profile_read_failed');
  const empty = await localProfileResponse(claim({ displayName: 'ada@example.com', handle: 'alex' }), {
    env: ENV,
    fetcher: async (url, init = {}) => {
      const href = String(url);
      if (href.includes('/users')) return new Response('', { status: 201 });
      if ((init.method || 'GET') === 'POST') return Response.json([{ handle: 'alex' }], { status: 201 });
      return Response.json([]);
    },
  });
  assert.equal(empty.status, 502);
  assert.equal((await empty.json()).error, 'profile_not_confirmed');
});

/**
 * Achieves: verifies a directory write is used when the service role is set.
 * Fails when: a directory write is used when the service role is set breaks (e.g. expected true, SUPABASE_SERVICE_ROLE_KEY: '' }, useLocalProfileDirectory(ENV) !== true); failure/null paths flip.
 * Oracle: assert.equal(useLocalProfileDirectory(ENV), true); assert.equal(useLocalProfileDirectory({ SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: '' })
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('a directory write is used when the service role is set', () => {
  assert.equal(useLocalProfileDirectory(ENV), true);
  assert.equal(useLocalProfileDirectory({ SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: '' }), false);
});

/**
 * Achieves: verifies a missing directory config does not pretend the claim was saved.
 * Fails when: a missing directory config does not pretend the claim was saved breaks (e.g. expected 503, 'directory_unconfigured', false).
 * Oracle: assert.equal(response.status, 503); assert.equal((await response.json()).error, 'directory_unconfigured'); assert.equal(called, false)
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
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
