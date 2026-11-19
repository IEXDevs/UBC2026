import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.mjs';
import {
  parseRecoveryIssue,
  parseRecoveryVault,
  parseStateBatch,
  parseStateItem,
} from './account-state.mjs';

const VAULT = Object.freeze({ v: 1, iterations: 100000, salt: 'aa'.repeat(16), iv: 'bb'.repeat(12), ct: 'cc'.repeat(40) });
const VERIFIER = Object.freeze({ salt: 'dd'.repeat(16), iterations: 100000, hash: 'ee'.repeat(32) });

test('account reads and seed issuance fail closed when the database schema or access is missing', async () => {
  const failures = [
    [404, 'PGRST205', 'account_state_schema_missing'],
    [404, '42P01', 'account_state_schema_missing'],
    [400, '42703', 'account_state_schema_missing'],
    [403, '42501', 'account_state_access_failed'],
    [503, 'PGRST002', 'account_state_unavailable'],
  ];
  for (const [status, code, expected] of failures) {
    const env = envFor({ fetcher: (_url, init) => {
      assert.equal(init.method, 'GET');
      return Response.json({ code, message: 'private provider error' }, { status });
    } });
    const responses = await Promise.all([
      call(env, '/api/state'),
      call(env, '/api/recovery'),
      call(env, '/api/recovery', { method: 'POST', body: { vault: VAULT, verifier: VERIFIER } }),
    ]);
    for (const response of responses) {
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: expected });
    }
  }
});

/** In-memory stand-in for the Supabase tables these routes touch. */
function database() {
  const state = new Map();
  const recovery = new Map();
  const prefers = [];
  const calls = [];
  async function fetcher(url, init = {}) {
    const target = new URL(String(url));
    const table = target.pathname.replace('/rest/v1/', '');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    const owner = (target.searchParams.get('owner_id') || '').replace('eq.', '');
    calls.push({ table, method });
    if (table === 'users') return Response.json([], { status: 201 });
    if (table === 'owner_state') {
      if (method === 'GET') {
        const rows = [...state.entries()]
          .filter(([key]) => key.startsWith(`${owner}|`))
          .map(([key, row]) => ({ name: key.split('|')[1], ...row }));
        return Response.json(rows);
      }
      if (method === 'DELETE') {
        state.delete(`${owner}|${(target.searchParams.get('name') || '').replace('eq.', '')}`);
        return new Response(null, { status: 204 });
      }
      prefers.push(init.headers.prefer);
      for (const row of body) {
        const key = `${row.owner_id}|${row.name}`;
        if (state.has(key) && /ignore-duplicates/.test(init.headers.prefer)) continue;
        state.set(key, { value: row.value, updated_at: row.updated_at });
      }
      return new Response(null, { status: 201 });
    }
    if (table === 'owner_recovery') {
      if (method === 'GET') return Response.json(recovery.has(owner) ? [recovery.get(owner)] : []);
      if (method === 'POST') {
        if (recovery.has(body.owner_id)) return Response.json({ code: '23505' }, { status: 409 });
        recovery.set(body.owner_id, body);
        return new Response(null, { status: 201 });
      }
      if (method === 'PATCH') {
        const row = recovery.get(owner);
        if (!row || row.status !== 'issued') return new Response(null, { status: 204 });
        recovery.set(owner, { ...row, ...body });
        return new Response(null, { status: 204 });
      }
    }
    return Response.json({ error: 'unexpected' }, { status: 500 });
  }
  return { fetcher, state, recovery, prefers, calls };
}

function envFor(db) {
  return {
    PRODUCT: 'Maelstrom',
    CLUSTER: 'devnet',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: db.fetcher,
  };
}

function call(env, path, { method = 'GET', owner = 'alice', body } = {}) {
  return worker.fetch(new Request(`https://runtime${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(owner ? { 'x-owner-id': owner } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
}

/**
 * Achieves: state items accept only mirrored names and never a secret-shaped field.
 * Fails when: a file secret, provider key, seed field, or a malformed account id is accepted.
 * Oracle: parser returns null for each rejected fixture and the item for each valid one.
 * Side effects / state checked: none.
 * Gaps: Supabase writes are covered by the route tests below.
 */
test('state items reject unknown names, secret fields, and a bad account id', () => {
  assert.deepEqual(parseStateItem({ name: 'roster', value: '{"order":[]}' }), { name: 'roster', value: '{"order":[]}' });
  assert.deepEqual(parseStateItem({ name: 'talks', value: null }), { name: 'talks', value: null });
  assert.equal(parseStateItem({ name: 'files', value: '{}' }), null);
  assert.equal(parseStateItem({ name: 'providers', value: '[]' }), null);
  assert.equal(parseStateItem({ name: 'roster', value: '{"seedPhrase":"abandon"}' }), null);
  assert.equal(parseStateItem({ name: 'talks', value: '{"bot":[{"mnemonic":"x"}]}' }), null);
  assert.equal(parseStateItem({ name: 'accountCode', value: '12ab' }), null);
  assert.equal(parseStateItem({ name: 'accountCode', value: '1234567890123456' }).value, '1234567890123456');
  assert.equal(parseStateItem({ name: 'roster', value: 'x'.repeat(900_001) }), null);
  assert.equal(parseStateBatch({ items: [] }), null);
  assert.equal(parseStateBatch({ items: [{ name: 'roster', value: '1' }, { name: 'roster', value: '2' }] }), null);
  assert.equal(parseStateBatch({ items: [{ name: 'roster', value: '1' }, { name: 'looks', value: '2' }] }).length, 2);
});

/**
 * Achieves: the vault is ciphertext only and a phrase field is refused at the door.
 * Fails when: an extra field such as words or phrase passes, or a short ciphertext passes.
 * Oracle: exact key set { v, iterations, salt, iv, ct } and hex lengths.
 * Side effects / state checked: none.
 * Gaps: none.
 */
test('the recovery vault accepts ciphertext only', () => {
  assert.deepEqual(parseRecoveryVault(VAULT), VAULT);
  assert.equal(parseRecoveryVault({ ...VAULT, words: 'abandon abandon' }), null);
  assert.equal(parseRecoveryVault({ ...VAULT, phrase: 'x' }), null);
  assert.equal(parseRecoveryVault({ ...VAULT, ct: 'cc' }), null);
  assert.equal(parseRecoveryVault({ ...VAULT, iterations: 5 }), null);
  assert.equal(parseRecoveryIssue({ vault: VAULT, verifier: VERIFIER }).verifier.hash, VERIFIER.hash);
  assert.equal(parseRecoveryIssue({ vault: VAULT, verifier: { ...VERIFIER, password: 'x' } }), null);
  assert.equal(parseRecoveryIssue({ vault: VAULT }), null);
});

/**
 * Achieves: one seed per account. Issued returns the same vault, a second issue is refused,
 * a wrong proof fails, a right proof confirms and deletes the vault, and a later issue is still refused.
 * Fails when: a second vault replaces the first, confirm leaves the vault, or the verifier hash is returned.
 * Oracle: status codes and bodies at each step; the stored row after confirm.
 * Side effects / state checked: in-memory owner_recovery row.
 * Gaps: Cross-owner isolation is the next test.
 */
test('an account keeps one seed: same vault until confirmed, then only a verifier', async () => {
  const db = database();
  const env = envFor(db);
  const none = await (await call(env, '/api/recovery')).json();
  assert.equal(none.state, 'none');

  const issued = await call(env, '/api/recovery', { method: 'POST', body: { vault: VAULT, verifier: VERIFIER } });
  assert.equal(issued.status, 200);

  const again = await call(env, '/api/recovery', {
    method: 'POST',
    body: { vault: { ...VAULT, ct: 'ff'.repeat(40) }, verifier: VERIFIER },
  });
  assert.equal(again.status, 409);
  assert.equal((await again.json()).state, 'issued');

  const other = await (await call(env, '/api/recovery')).json();
  assert.equal(other.state, 'issued');
  assert.deepEqual(other.vault, VAULT);
  assert.deepEqual(other.verifier, { salt: VERIFIER.salt, iterations: VERIFIER.iterations });
  assert.equal(JSON.stringify(other).includes(VERIFIER.hash), false);

  const wrong = await call(env, '/api/recovery/verify', { method: 'POST', body: { proof: '00'.repeat(32), confirm: true } });
  assert.equal(wrong.status, 401);
  assert.equal(db.recovery.get('alice').status, 'issued');

  const confirmed = await call(env, '/api/recovery/verify', { method: 'POST', body: { proof: VERIFIER.hash, confirm: true } });
  assert.equal(confirmed.status, 200);
  assert.equal((await confirmed.json()).state, 'confirmed');
  assert.equal(db.recovery.get('alice').vault, null);

  const after = await (await call(env, '/api/recovery')).json();
  assert.equal(after.state, 'confirmed');
  assert.equal('vault' in after, false);

  const refused = await call(env, '/api/recovery', { method: 'POST', body: { vault: VAULT, verifier: VERIFIER } });
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).state, 'confirmed');

  const restore = await call(env, '/api/recovery/verify', { method: 'POST', body: { proof: VERIFIER.hash } });
  assert.equal(restore.status, 200);
  assert.equal((await restore.json()).state, 'confirmed');
});

/**
 * Achieves: a phrase field, a missing verifier, and another owner cannot touch this seed.
 * Fails when: a plaintext words field is stored, or owner B sees owner A's vault.
 * Oracle: 400 for malformed bodies; owner B status is none.
 * Side effects / state checked: in-memory owner_recovery rows.
 * Gaps: none.
 */
test('recovery refuses plaintext fields and stays inside one owner', async () => {
  const db = database();
  const env = envFor(db);
  const bad = await call(env, '/api/recovery', {
    method: 'POST',
    body: { vault: { ...VAULT, words: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' }, verifier: VERIFIER },
  });
  assert.equal(bad.status, 400);
  assert.equal(db.recovery.size, 0);

  await call(env, '/api/recovery', { method: 'POST', body: { vault: VAULT, verifier: VERIFIER } });
  const bob = await (await call(env, '/api/recovery', { owner: 'bob' })).json();
  assert.equal(bob.state, 'none');
  const missing = await call(env, '/api/recovery/verify', { method: 'POST', owner: 'bob', body: { proof: VERIFIER.hash } });
  assert.equal(missing.status, 404);
});

/**
 * Achieves: desk state written on one browser is listed for the same owner on another.
 * Fails when: a value is lost, another owner reads it, or the account id is overwritten after it is set.
 * Oracle: list body equals what was written; accountCode keeps its first value.
 * Side effects / state checked: in-memory owner_state rows and the Prefer header on the account id write.
 * Gaps: Debounce and hydrate order are in web/lib/account-state.test.mjs.
 */
test('state written once is listed for the owner and the account id is write-once', async () => {
  const db = database();
  const env = envFor(db);
  const written = await call(env, '/api/state', {
    method: 'POST',
    body: { items: [
      { name: 'roster', value: '{"order":["a"],"extra":[]}' },
      { name: 'accountCode', value: '1234567890123456' },
    ] },
  });
  assert.equal(written.status, 200);
  assert.deepEqual((await written.json()).saved.sort(), ['accountCode', 'roster']);
  assert.equal(db.prefers.some(value => /ignore-duplicates/.test(value)), true);

  await call(env, '/api/state', { method: 'POST', body: { items: [{ name: 'accountCode', value: '6543210987654321' }] } });
  const listed = await (await call(env, '/api/state')).json();
  const byName = Object.fromEntries(listed.items.map(item => [item.name, item.value]));
  assert.equal(byName.accountCode, '1234567890123456');
  assert.equal(byName.roster, '{"order":["a"],"extra":[]}');

  const bob = await (await call(env, '/api/state', { owner: 'bob' })).json();
  assert.deepEqual(bob.items, []);

  await call(env, '/api/state', { method: 'POST', body: { items: [{ name: 'roster', value: null }] } });
  const after = await (await call(env, '/api/state')).json();
  assert.equal(after.items.some(item => item.name === 'roster'), false);
});

/**
 * Achieves: bad bodies and missing owners are refused; an unconfigured store reads empty and refuses writes.
 * Fails when: a secret-shaped body is stored, anonymous calls succeed, or an unconfigured write pretends to save.
 * Oracle: 400 / 401 / 503 and the unconfigured read shape.
 * Side effects / state checked: no Supabase call for the rejected requests.
 * Gaps: none.
 */
test('state and recovery routes reject bad bodies, anonymous calls, and unconfigured writes', async () => {
  const db = database();
  const env = envFor(db);
  assert.equal((await call(env, '/api/state', { method: 'POST', body: { items: [{ name: 'files', value: '{}' }] } })).status, 400);
  assert.equal((await call(env, '/api/state', { method: 'POST', body: { items: [{ name: 'looks', value: '{"apiKey":"x"}' }] } })).status, 400);
  assert.equal((await call(env, '/api/state', { owner: '' })).status, 401);
  assert.equal((await call(env, '/api/recovery', { owner: '' })).status, 401);
  assert.equal((await call(env, '/api/recovery/verify', { method: 'POST', owner: '', body: { proof: VERIFIER.hash } })).status, 401);
  // The Worker's own request log is the only table touched. No state, recovery, or user row.
  assert.deepEqual(db.calls.filter(item => item.table !== 'activity_logs'), []);

  const bare = { PRODUCT: 'Maelstrom', CLUSTER: 'devnet' };
  const read = await (await call(bare, '/api/recovery')).json();
  assert.equal(read.source, 'unconfigured');
  assert.equal(read.state, 'none');
  const stateRead = await (await call(bare, '/api/state')).json();
  assert.deepEqual(stateRead.items, []);
  assert.equal((await call(bare, '/api/state', { method: 'POST', body: { items: [{ name: 'roster', value: '{}' }] } })).status, 503);
  assert.equal((await call(bare, '/api/recovery', { method: 'POST', body: { vault: VAULT, verifier: VERIFIER } })).status, 503);
});
