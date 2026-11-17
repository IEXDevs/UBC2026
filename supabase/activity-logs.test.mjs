import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const foundations = readFileSync(new URL('./migrations/20261114000000_foundations.sql', import.meta.url), 'utf8');
const activity = readFileSync(new URL('./migrations/20261114180000_activity_logs.sql', import.meta.url), 'utf8');
const grants = readFileSync(new URL('./migrations/20261114190000_service_role_grants.sql', import.meta.url), 'utf8');
const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/**
 * Achieves: service_role grants migration includes ALL on tables and EXECUTE on functions.
 * Fails when: Grants omitted or narrowed so Worker writes fail.
 * Oracle: 20261114190000_service_role_grants.sql text contract.
 * Side effects: Reads migration file.
 * Gaps: Does not execute grants against a live Supabase project.
 */
test('service role can use the tables the Worker writes', () => {
  assert.match(grants, /grant all privileges on all tables in schema public to service_role/);
  assert.match(grants, /grant execute on all functions in schema public to service_role/);
});

/**
 * Achieves: Insert trigger redacts seed/privateKey/long blobs; RLS shows only owner rows; authenticated cannot insert; anon denied.
 * Fails when: Secrets persist, cross-owner reads succeed, or clients can insert forged logs.
 * Oracle: activity_logs redaction + RLS policies.
 * Side effects: PGlite with pgcrypto; applies migrations.
 * Gaps: Does not cover service_role write path end-to-end.
 */
test('activity logs redact secrets and hide other owners', async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(foundations);
  await db.exec(activity);

  await db.query(
    `insert into activity_logs (id, owner_id, bot_id, source, action, status, detail)
     values
      ('log_11111111-1111-1111-1111-111111111111', 'alice', 'bot_1', 'http', 'POST /bots/bot_1/wake', 200, $1::jsonb),
      ('log_22222222-2222-2222-2222-222222222222', 'bob', 'bot_2', 'http', 'GET /api/logs', 200, '{"ok":true}'::jsonb)`,
    [JSON.stringify({
      goal: `fund ${SEED} please`,
      privateKey: 'do-not-store',
      address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      amount: '10',
      blob: '2'.repeat(88),
    })],
  );

  const stored = await db.query(`select detail from activity_logs where owner_id = 'alice'`);
  const detail = stored.rows[0].detail;
  const encoded = JSON.stringify(detail);
  assert.equal(encoded.includes(SEED), false);
  assert.equal(encoded.includes('do-not-store'), false);
  assert.equal(encoded.includes('2'.repeat(20)), false);
  assert.match(encoded, /fund/);
  assert.match(encoded, /please/);
  assert.match(detail.address, /4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU/);
  assert.equal(String(detail.amount), '10');

  await db.query(`select set_config('request.jwt.claims', '{"owner_id":"alice"}', false)`);
  await db.exec('set role authenticated');
  const visible = await db.query(`select owner_id from activity_logs order by owner_id`);
  assert.deepEqual(visible.rows.map(row => row.owner_id), ['alice']);
  const peeked = await db.query(`select id from activity_logs where owner_id = 'bob'`);
  assert.equal(peeked.rows.length, 0);
  await assert.rejects(
    () => db.query(`insert into activity_logs (id, owner_id, source, action) values ('log_33333333-3333-3333-3333-333333333333', 'alice', 'http', 'forged')`),
  );
  await db.exec('reset role');

  await db.exec('set role anon');
  await assert.rejects(() => db.query('select id from activity_logs'));
  await db.exec('reset role');
});
