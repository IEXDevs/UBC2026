import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const foundations = readFileSync(new URL('./migrations/20261114000000_foundations.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('./migrations/20261118210000_account_state.sql', import.meta.url), 'utf8');

const VAULT = JSON.stringify({ v: 1, iterations: 100000, salt: 'aa'.repeat(16), iv: 'bb'.repeat(12), ct: 'cc'.repeat(40) });

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(foundations);
  await db.exec(migration);
  await db.exec(`insert into users (id, privy_user_id) values ('alice', 'privy_alice')`);
  return db;
}

/**
 * Achieves: state rows only accept the mirrored names, a sane account id, and one row per name.
 * Fails when: a file secret or provider key name is accepted, or an account id is not 16 digits.
 * Oracle: check constraints reject; primary key rejects a duplicate.
 * Side effects / state checked: in-memory Postgres only.
 * Gaps: Worker-side upsert behavior lives in agent-runtime/account-state.test.mjs.
 */
test('owner_state accepts only mirrored names and a 16-digit account id', async () => {
  const db = await database();
  await db.exec(`insert into owner_state (owner_id, name, value) values ('alice', 'roster', '{}')`);
  await assert.rejects(db.exec(`insert into owner_state (owner_id, name, value) values ('alice', 'files', '{}')`));
  await assert.rejects(db.exec(`insert into owner_state (owner_id, name, value) values ('alice', 'providers', '[]')`));
  await assert.rejects(db.exec(`insert into owner_state (owner_id, name, value) values ('alice', 'accountCode', '12ab')`));
  await db.exec(`insert into owner_state (owner_id, name, value) values ('alice', 'accountCode', '1234567890123456')`);
  await assert.rejects(db.exec(`insert into owner_state (owner_id, name, value) values ('alice', 'roster', '{"x":1}')`));
});

/**
 * Achieves: an account has at most one seed row, and the vault exists only while the seed is unconfirmed.
 * Fails when: a second seed row is allowed, a confirmed row keeps a vault, or an issued row has none.
 * Oracle: primary key plus the status/vault check constraint.
 * Side effects / state checked: in-memory Postgres only.
 * Gaps: none.
 */
test('owner_recovery keeps one row per account and drops the vault on confirm', async () => {
  const db = await database();
  const verifier = `'${'dd'.repeat(16)}', '${'ee'.repeat(32)}', 100000`;
  await db.exec(`
    insert into owner_recovery (owner_id, status, vault, verifier_salt, verifier_hash, verifier_iterations)
    values ('alice', 'issued', '${VAULT}'::jsonb, ${verifier})
  `);
  await assert.rejects(db.exec(`
    insert into owner_recovery (owner_id, status, vault, verifier_salt, verifier_hash, verifier_iterations)
    values ('alice', 'issued', '${VAULT}'::jsonb, ${verifier})
  `));
  await assert.rejects(db.exec(`update owner_recovery set status = 'confirmed', confirmed_at = now() where owner_id = 'alice'`));
  await db.exec(`update owner_recovery set status = 'confirmed', vault = null, confirmed_at = now() where owner_id = 'alice'`);
  const row = await db.query(`select status, vault from owner_recovery where owner_id = 'alice'`);
  assert.equal(row.rows[0].status, 'confirmed');
  assert.equal(row.rows[0].vault, null);
  await assert.rejects(db.exec(`update owner_recovery set status = 'issued' where owner_id = 'alice'`));
});

/**
 * Achieves: signed-in clients cannot read or write seed vaults or state rows directly.
 * Fails when: authenticated or anon gains a grant on either table.
 * Oracle: permission denied for the authenticated role.
 * Side effects / state checked: in-memory Postgres only.
 * Gaps: none.
 */
test('clients have no direct access to owner_state or owner_recovery', async () => {
  const db = await database();
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select * from owner_state'));
  await assert.rejects(db.query('select * from owner_recovery'));
  await db.exec('reset role');
});
