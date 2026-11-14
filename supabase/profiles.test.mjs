import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const foundations = readFileSync(new URL('./migrations/20261114000000_foundations.sql', import.meta.url), 'utf8');
const profiles = readFileSync(new URL('./migrations/20261114200000_profiles.sql', import.meta.url), 'utf8');

test('a handle is unique and only its owner can change it', async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(foundations);
  await db.exec(profiles);
  await db.exec(`
    insert into users (id, privy_user_id) values ('alice', 'privy_alice'), ('bob', 'privy_bob');
    insert into profiles (owner_id, handle, display_name) values
      ('alice', 'alex', 'Alex'),
      ('bob', 'bob', 'Bob');
  `);
  await assert.rejects(() => db.query(
    `insert into profiles (owner_id, handle, display_name) values ('alice', 'bob', 'Taken')`,
  ));

  await db.query(`select set_config('request.jwt.claims', '{"owner_id":"alice"}', false)`);
  await db.exec('set role authenticated');
  const visible = await db.query(`select handle from profiles order by handle`);
  assert.deepEqual(visible.rows.map(row => row.handle), ['alex', 'bob']);
  const stolen = await db.query(`update profiles set handle = 'stolen' where owner_id = 'bob'`);
  assert.equal(stolen.affectedRows ?? stolen.rowCount ?? 0, 0);
  await db.query(`update profiles set display_name = 'Alex R' where owner_id = 'alice'`);
  await db.exec('reset role');
  const renamed = await db.query(`select display_name from profiles where owner_id = 'alice'`);
  assert.equal(renamed.rows[0].display_name, 'Alex R');
});
