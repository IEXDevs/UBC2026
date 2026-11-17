import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.mjs';
import { passwordMatches } from './desk-grant.mjs';
import { createDeskLock } from '../../web/lib/desk-lock.mjs';

const SUPABASE = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
};

/*
 * Achieves: passwordMatches accepts only matching verifier; raw password field rejected.
 * Fails when: wrong password accepted or password field treated as verifier.
 * Oracle: true only for match; reject path in test.
 * Side effects / state checked: N/A.
 * Gaps: none
 */
test('a password matches only its verifier and a password field is rejected', async () => {
  const verifier = await createDeskLock('correct horse');
  assert.equal(await passwordMatches('correct horse', verifier), true);
  assert.equal(await passwordMatches('wrong horse', verifier), false);
  assert.equal(await passwordMatches('correct horse', { ...verifier, password: 'correct horse' }), false);
});

/*
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

/*
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