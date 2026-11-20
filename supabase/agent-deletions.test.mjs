import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

test('deleted agent IDs reject stale upserts without affecting another owner or a new ID', async t => {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  await db.exec('create role service_role nologin bypassrls');
  for (const name of [
    '20261114000000_foundations',
    '20261114020000_policy_ledger',
    '20261114050000_stream_events',
    '20261114180000_activity_logs',
    '20261114190000_service_role_grants',
    '20261119010000_agent_deletions',
  ]) {
    await db.exec(readFileSync(new URL(`./migrations/${name}.sql`, import.meta.url), 'utf8'));
  }

  await db.exec(`
    insert into users (id, privy_user_id) values ('alice', 'alice'), ('bob', 'bob');
    insert into wallets (id, owner_id, kind, label, address) values ('w1', 'alice', 'main', 'Main', 'address_1');
    set role service_role;
  `);
  const upsert = id => db.query(`
    insert into bots (id, owner_id, wallet_id, name, goal, type, approval_mode, cap_mode, cap_asset)
    values ($1, 'alice', 'w1', 'Tester', 'Watch', 'trading', 'ask', 'unlimited', 'USDC')
    on conflict (id) do update set name = excluded.name
  `, [id]);
  await upsert('bot_live');
  await assert.rejects(db.exec("update bots set owner_id = 'bob' where id = 'bot_live'"), { code: '23505' });
  await db.exec(`
    insert into spend_ledgers (bot_id, asset) values ('bot_live', 'USDC');
    select delete_owner_agent('bob', 'bot_live');
  `);
  assert.deepEqual((await db.query('select id from bots')).rows, [{ id: 'bot_live' }]);
  await upsert('bot_live');

  await db.exec(`
    select delete_owner_agent('alice', 'bot_live');
    select delete_owner_agent('alice', 'bot_live');
    select delete_owner_agent('alice', 'bot_local_only');
  `);
  assert.deepEqual((await db.query('select bot_id from spend_ledgers')).rows, []);
  assert.deepEqual((await db.query('select id from bots')).rows, []);
  await assert.rejects(upsert('bot_live'), { code: 'PT410' });
  await assert.rejects(upsert('bot_local_only'), { code: 'PT410' });
  await upsert('bot_new');
  assert.deepEqual((await db.query('select id from bots')).rows, [{ id: 'bot_new' }]);

  const deleted = async owner => (await db.query('select ids from list_deleted_owner_agents($1)', [owner])).rows[0].ids.sort();
  assert.deepEqual(await deleted('alice'), ['bot_live', 'bot_local_only']);
  assert.deepEqual(await deleted('bob'), ['bot_live']);

  await db.exec('reset role; set role authenticated;');
  await assert.rejects(db.query("select * from list_deleted_owner_agents('alice')"), { code: '42501' });
  await assert.rejects(db.query("select delete_owner_agent('alice', 'bot_new')"), { code: '42501' });
});
