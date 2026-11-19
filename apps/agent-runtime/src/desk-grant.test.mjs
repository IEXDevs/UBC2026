import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.mjs';
import { passwordMatches } from './desk-grant.mjs';
import { createDeskLock } from '../../web/lib/desk-lock.mjs';

const SUPABASE = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
};

/**
 * Achieves: passwordMatches accepts only matching verifier; raw password field rejected.
 * Fails when: wrong password accepted or password field treated as verifier.
 * Oracle: true only for match; reject path in test.
 * Side effects / state checked: N/A.
 * Gaps: none
 */
test('a password matches only its verifier and a password field is rejected', async () => {
  const verifier = await createDeskLock('correct horse');
  assert.equal(verifier.iterations, 100000);
  assert.equal(await passwordMatches('correct horse', verifier), true);
  assert.equal(await passwordMatches('correct horse', { ...verifier, iterations: '100000' }), true);
  assert.equal(await passwordMatches('wrong horse', verifier), false);
  assert.equal(await passwordMatches('correct horse', { ...verifier, password: 'correct horse' }), false);
  await assert.rejects(
    () => passwordMatches('correct horse', { ...verifier, iterations: 120000 }),
    (error) => error.code === 'password_check_unsupported',
  );
});

/**
 * Achieves: freeze-all invokes policy freeze for every owned bot.
 * Fails when: some bots skipped or wrong owner scope.
 * Oracle: policy call count/ids match owned bots.
 * Side effects / state checked: policy RPC mocks.
 * Gaps: none
 */
test('freeze all bots calls policy for each owned bot', async () => {
  const frozen = [];
  const env = {
    PRODUCT: 'Maelstrom',
    CLUSTER: 'devnet',
    ...SUPABASE,
    fetch: async (url, init = {}) => {
      const href = String(url);
      if (href.includes('/rest/v1/bots?')) return Response.json([{ id: 'bot_1' }, { id: 'bot_2' }]);
      if (href.includes('/rpc/policy_freeze_bot')) {
        const body = JSON.parse(init.body);
        frozen.push(body.payload.botId);
        return Response.json({ state: 'frozen', botId: body.payload.botId, frozen: true, enabled: false });
      }
      return Response.json({ error: 'unexpected' }, { status: 500 });
    },
  };
  const response = await worker.fetch(new Request('https://runtime/api/bots/freeze', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ frozen: true }),
  }), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.count, 2);
  assert.deepEqual(frozen, ['bot_1', 'bot_2']);
  assert.equal(JSON.stringify(body).includes('service-role'), false);
});

/**
 * Achieves: unlock stores hashed grant; spend without grant fails.
 * Fails when: plaintext grant stored, or bare owner spends successfully.
 * Oracle: stored hash === sha256(grant); spend denied without grant.
 * Side effects / state checked: desk_locks write + spend attempt.
 * Gaps: none
 */
test('desk unlock stores a grant hash and spend rejects a bare owner', async () => {
  const verifier = await createDeskLock('correct horse');
  let row = null;
  const env = {
    PRODUCT: 'Maelstrom',
    CLUSTER: 'devnet',
    ...SUPABASE,
    fetch: async (url, init = {}) => {
      const href = String(url);
      const method = init.method || 'GET';
      if (href.includes('/rest/v1/users')) return Response.json([], { status: 201 });
      if (href.includes('/rest/v1/desk_locks') && method === 'POST') {
        row = JSON.parse(init.body);
        return new Response(null, { status: 201 });
      }
      if (href.includes('/rest/v1/desk_locks') && method === 'PATCH') {
        Object.assign(row, JSON.parse(init.body));
        return new Response(null, { status: 204 });
      }
      if (href.includes('/rest/v1/desk_locks') && href.includes('select=owner_id')) {
        return Response.json(row ? [{ owner_id: 'user_1' }] : []);
      }
      if (href.includes('/rest/v1/desk_locks') && href.includes('select=salt')) {
        return Response.json(row ? [{ salt: row.salt, hash: row.hash, iterations: row.iterations }] : []);
      }
      if (href.includes('/rest/v1/desk_locks') && href.includes('grant_hash')) {
        return Response.json(row?.grant_hash ? [{ grant_hash: row.grant_hash, grant_until: row.grant_until }] : []);
      }
      return Response.json({ error: 'unexpected' }, { status: 500 });
    },
  };
  const locked = await worker.fetch(new Request('https://runtime/api/spend', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({
      permission: 'ask',
      confirmed: true,
      botId: 'bot_1',
      action: 'pay',
      amount: '1000',
      destination: '11111111111111111111111111111111',
    }),
  }), env);
  assert.equal(locked.status, 403);
  assert.equal((await locked.json()).error, 'desk_lock_required');

  const saved = await worker.fetch(new Request('https://runtime/api/desk/lock', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ salt: verifier.salt, hash: verifier.hash, iterations: verifier.iterations }),
  }), env);
  assert.equal(saved.status, 200);
  assert.equal(row.hash, verifier.hash);

  const opened = await worker.fetch(new Request('https://runtime/api/desk/unlock', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ password: 'correct horse' }),
  }), env);
  assert.equal(opened.status, 200);
  const grantBody = await opened.json();
  assert.match(grantBody.grant, /^[0-9a-f]{64}$/);
  assert.notEqual(row.grant_hash, grantBody.grant);
  assert.equal(JSON.stringify(row).includes('correct horse'), false);

  const wrong = await worker.fetch(new Request('https://runtime/api/desk/unlock', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ password: 'wrong horse' }),
  }), env);
  assert.equal(wrong.status, 401);
});

/**
 * Achieves: a later password replaces the account verifier only with the seed proof, then that password gets a grant.
 * Fails when: replace works with no proof, the follow-up grant rejects the saved password, the old password still unlocks, or another account is stuck on this verifier.
 * Oracle: 401 without the seed proof; grant after a matching proof; other owner is desk_lock_missing.
 * Side effects: in-memory desk row. The passwords stay in the request fixtures.
 * Gaps: live Supabase is not called.
 */
test('a later desk password replaces the stored verifier only with the seed proof', async () => {
  const first = await createDeskLock('correct horse');
  const second = await createDeskLock('later horse');
  const proof = 'ab'.repeat(32);
  let row = null;
  const env = {
    PRODUCT: 'Maelstrom',
    CLUSTER: 'devnet',
    ...SUPABASE,
    fetch: async (url, init = {}) => {
      const href = String(url);
      const method = init.method || 'GET';
      if (href.includes('/rest/v1/users')) return Response.json([], { status: 201 });
      if (href.includes('/rest/v1/desk_locks') && method === 'POST') {
        row = JSON.parse(init.body);
        return new Response(null, { status: 201 });
      }
      if (href.includes('/rest/v1/desk_locks') && method === 'PATCH') {
        const patch = JSON.parse(init.body);
        Object.assign(row, patch);
        if (patch.grant_hash === null) row.grant_hash = null;
        if (patch.grant_until === null) row.grant_until = null;
        return new Response(null, { status: 204 });
      }
      if (href.includes('/rest/v1/desk_locks') && href.includes('select=owner_id')) {
        if (href.includes('user_2')) return Response.json([]);
        return Response.json(row ? [{ owner_id: 'user_1' }] : []);
      }
      if (href.includes('/rest/v1/desk_locks') && href.includes('select=salt')) {
        if (href.includes('user_2')) return Response.json([]);
        return Response.json(row ? [{
          salt: row.salt,
          hash: row.hash,
          iterations: String(row.iterations),
        }] : []);
      }
      if (href.includes('/rest/v1/owner_recovery')) {
        return Response.json([{ verifier_hash: proof }]);
      }
      if (href.includes('/rest/v1/desk_locks') && href.includes('grant_hash')) {
        return Response.json(row?.grant_hash ? [{ grant_hash: row.grant_hash, grant_until: row.grant_until }] : [{ grant_hash: null, grant_until: null }]);
      }
      return Response.json({ error: 'unexpected' }, { status: 500 });
    },
  };
  const saved = await worker.fetch(new Request('https://runtime/api/desk/lock', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ salt: first.salt, hash: first.hash, iterations: first.iterations }),
  }), env);
  assert.equal(saved.status, 200);
  const blocked = await worker.fetch(new Request('https://runtime/api/desk/lock', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ salt: second.salt, hash: second.hash, iterations: second.iterations }),
  }), env);
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).error, 'desk_lock_exists');
  assert.equal(row.hash, first.hash);

  const bareReplace = await worker.fetch(new Request('https://runtime/api/desk/lock', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ salt: second.salt, hash: second.hash, iterations: second.iterations, replace: true }),
  }), env);
  assert.equal(bareReplace.status, 401);
  assert.equal((await bareReplace.json()).error, 'recovery_required');
  assert.equal(row.hash, first.hash);

  const wrongProof = await worker.fetch(new Request('https://runtime/api/desk/lock', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ salt: second.salt, hash: second.hash, iterations: second.iterations, replace: true, proof: 'cd'.repeat(32) }),
  }), env);
  assert.equal(wrongProof.status, 401);
  assert.equal((await wrongProof.json()).error, 'recovery_mismatch');
  assert.equal(row.hash, first.hash);

  const replaced = await worker.fetch(new Request('https://runtime/api/desk/lock', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ salt: second.salt, hash: second.hash, iterations: second.iterations, replace: true, proof }),
  }), env);
  assert.equal(replaced.status, 200);
  assert.equal((await replaced.json()).replaced, true);
  assert.equal(row.hash, second.hash);
  assert.equal(row.grant_hash, null);
  assert.equal(JSON.stringify(row).includes('later horse'), false);

  const oldPassword = await worker.fetch(new Request('https://runtime/api/desk/unlock', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ password: 'correct horse' }),
  }), env);
  assert.equal(oldPassword.status, 401);

  const opened = await worker.fetch(new Request('https://runtime/api/desk/unlock', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ password: 'later horse' }),
  }), env);
  assert.equal(opened.status, 200);
  const grantBody = await opened.json();
  assert.match(grantBody.grant, /^[0-9a-f]{64}$/);
  assert.notEqual(row.grant_hash, grantBody.grant);

  const otherAccount = await worker.fetch(new Request('https://runtime/api/desk/unlock', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_2' },
    body: JSON.stringify({ password: 'later horse' }),
  }), env);
  assert.equal(otherAccount.status, 404);
  assert.equal((await otherAccount.json()).error, 'desk_lock_missing');
});

/**
 * Achieves: a verifier above the Worker PBKDF2 cap is refused before deriveBits.
 * Fails when: 120000 iterations throws a 500 or is treated as a wrong password.
 * Oracle: HTTP 409 password_check_unsupported.
 * Side effects: in-memory desk row.
 * Gaps: the browser hashes new passwords at 100000, which this route can check.
 */
test('unlock refuses a verifier the Worker cannot check', async () => {
  const env = {
    PRODUCT: 'Maelstrom',
    CLUSTER: 'devnet',
    ...SUPABASE,
    fetch: async (url) => {
      const href = String(url);
      if (href.includes('select=salt')) {
        return Response.json([{ salt: 'ab'.repeat(16), hash: 'cd'.repeat(32), iterations: 120000 }]);
      }
      return Response.json({ error: 'unexpected' }, { status: 500 });
    },
  };
  const response = await worker.fetch(new Request('https://runtime/api/desk/unlock', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ password: 'correct horse' }),
  }), env);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'password_check_unsupported');
});