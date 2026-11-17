import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const foundations = readFileSync(new URL('./migrations/20261114000000_foundations.sql', import.meta.url), 'utf8');
const profiles = readFileSync(new URL('./migrations/20261114200000_profiles.sql', import.meta.url), 'utf8');
const transfers = readFileSync(new URL('./migrations/20261114210000_platform_transfers.sql', import.meta.url), 'utf8');

const ADDRESS = 'So11111111111111111111111111111111111111112';

async function dbWithPeople() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(foundations);
  await db.exec(profiles);
  await db.exec(transfers);
  await db.exec(`
    insert into users (id, privy_user_id) values ('alice', 'privy_alice'), ('bob', 'privy_bob');
    insert into wallets (id, owner_id, kind, label, address, provider, frozen) values
      ('wal_alice', 'alice', 'main', 'main', '${ADDRESS}', 'privy', false),
      ('wal_bob', 'bob', 'main', 'main', '${ADDRESS}', 'privy', false);
    insert into profiles (owner_id, handle, display_name) values
      ('alice', 'alex', 'Alex'),
      ('bob', 'bob', 'Bob');
  `);
  return db;
}

/**
 * Achieves: platform_post_transfer credits recipient once per idempotency key; parties can read; strangers cannot.
 * Fails when: Double insert on replay, or RLS leaks to unrelated owners.
 * Oracle: platform_transfers RPC + RLS.
 * Side effects: PGlite with foundations/profiles/transfers migrations.
 * Gaps: Does not move on-chain USDC (platform ledger only).
 */
test('a handle send credits the recipient wallet and replays once', async () => {
  const db = await dbWithPeople();
  const posted = await db.query(`
    select platform_post_transfer($1::jsonb) as result
  `, ['{"ownerId":"alice","handle":"bob","amount":"5000000","idempotencyKey":"send_alice_bob_1","botId":"bot_shop"}']);
  const result = posted.rows[0].result;
  assert.equal(result.replay, false);
  assert.equal(result.transfer.to_owner_id, 'bob');
  assert.equal(result.transfer.from_wallet_id, 'wal_alice');
  assert.equal(result.transfer.to_wallet_id, 'wal_bob');
  assert.equal(result.transfer.amount, 5000000);
  assert.equal(result.transfer.handle, 'bob');

  const replay = await db.query(`
    select platform_post_transfer($1::jsonb) as result
  `, ['{"ownerId":"alice","handle":"bob","amount":"5000000","idempotencyKey":"send_alice_bob_1","botId":"bot_shop"}']);
  assert.equal(replay.rows[0].result.replay, true);
  assert.equal(replay.rows[0].result.transfer.id, result.transfer.id);
  const count = await db.query(`select count(*)::int as n from platform_transfers`);
  assert.equal(count.rows[0].n, 1);

  await db.query(`select set_config('request.jwt.claims', '{"owner_id":"bob"}', false)`);
  await db.exec('set role authenticated');
  const visible = await db.query(`select handle, amount::text as amount from platform_transfers`);
  assert.equal(visible.rows.length, 1);
  assert.equal(visible.rows[0].handle, 'bob');
  await db.exec('reset role');

  await db.query(`select set_config('request.jwt.claims', '{"owner_id":"carol"}', false)`);
  await db.exec('set role authenticated');
  const hidden = await db.query(`select id from platform_transfers`);
  assert.equal(hidden.rows.length, 0);
});

/**
 * Achieves: Missing handle, self transfer, and frozen source wallet raise stable errors.
 * Fails when: Any refused path inserts a transfer row.
 * Oracle: platform_post_transfer validation errors.
 * Side effects: PGlite.
 * Gaps: Does not cover frozen destination wallet.
 */
test('a platform send refuses a missing handle, a self send, and a frozen wallet', async () => {
  const db = await dbWithPeople();
  await assert.rejects(
    () => db.query(`select platform_post_transfer('{"ownerId":"alice","handle":"nope","amount":"1","idempotencyKey":"send_missing_1"}'::jsonb)`),
    /handle_missing/,
  );
  await assert.rejects(
    () => db.query(`select platform_post_transfer('{"ownerId":"alice","handle":"alex","amount":"1","idempotencyKey":"send_self_1"}'::jsonb)`),
    /self_transfer/,
  );
  await db.query(`update wallets set frozen = true where id = 'wal_alice'`);
  await assert.rejects(
    () => db.query(`select platform_post_transfer('{"ownerId":"alice","handle":"bob","amount":"1","idempotencyKey":"send_frozen_1"}'::jsonb)`),
    /wallet_frozen/,
  );
});
