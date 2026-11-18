import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const foundations = readFileSync(new URL('./migrations/20261114000000_foundations.sql', import.meta.url), 'utf8');
const files = readFileSync(new URL('./migrations/20261118160000_owner_files.sql', import.meta.url), 'utf8');

test('an owner can read their file row and not another owner row', async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(foundations);
  await db.exec(files);
  await db.exec(`
    insert into users (id, privy_user_id) values ('alice', 'privy_alice'), ('bob', 'privy_bob');
    insert into owner_files (secret_hash, owner_id, account_code, name, mime_type, size_bytes, drive_url)
    values
      ('${'ab'.repeat(32)}', 'alice', '1234567890123456', 'notes.txt', 'text/plain', 12, 'https://drive.google.com/file/d/aliceFileId/view'),
      ('${'cd'.repeat(32)}', 'bob', '6543210987654321', 'bob.txt', 'text/plain', 4, 'https://drive.google.com/file/d/bobFileId/view');
  `);
  await db.query(`select set_config('request.jwt.claims', '{"owner_id":"alice"}', false)`);
  await db.exec('set role authenticated');
  const visible = await db.query('select name from owner_files order by name');
  assert.deepEqual(visible.rows.map(row => row.name), ['notes.txt']);
  await assert.rejects(db.query('select drive_url from owner_files'));
  await db.exec('reset role');
});
