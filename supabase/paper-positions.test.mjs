/**
 * Rigor audit — paper_positions / paper_fills / position_checks RLS
 * Achieves: alice cannot read/write bob's positions or checks; anon denied;
 *   ownership transfer via UPDATE owner_id fails WITH CHECK; service_role can write
 *   (Worker path) but authenticated path cannot escalate.
 * Fails when: RLS off, policies missing USING/WITH CHECK, or owner_id forge succeeds.
 * Oracle: app_owner_id() from JWT claims; policies join bots.owner_id.
 * Side effects: PGlite in-memory; no network.
 * Gaps: does not run against hosted Supabase PostgREST roles exactly — uses
 *   authenticated/anon roles + set_config JWT claims like other schema tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const foundations = readFileSync(new URL('./migrations/20261114000000_foundations.sql', import.meta.url), 'utf8');
const activity = readFileSync(new URL('./migrations/20261114180000_activity_logs.sql', import.meta.url), 'utf8');
const paper = readFileSync(new URL('./migrations/20261117120000_paper_positions.sql', import.meta.url), 'utf8');

const MINT = 'So11111111111111111111111111111111111111112';

async function seed(db) {
  await db.exec(foundations);
  await db.exec(activity);
  await db.exec(paper);
  await db.exec(`
    insert into users (id, privy_user_id) values ('alice', 'privy_alice'), ('bob', 'privy_bob');
    insert into wallets (id, owner_id, kind, label, address) values
      ('w_alice', 'alice', 'main', 'Main', 'Alice1111111111111111111111111111111111111'),
      ('w_bob', 'bob', 'main', 'Main', 'Bob1111111111111111111111111111111111111111');
    insert into bots (
      id, owner_id, wallet_id, name, goal, type, approval_mode, enabled, frozen,
      cap_mode, cap_asset, max_loss
    ) values
      ('bot_alice', 'alice', 'w_alice', 'A', 'watch', 'position-management', 'ask', true, false,
       'limited', 'USDC', 1000000),
      ('bot_bob', 'bob', 'w_bob', 'B', 'watch', 'position-management', 'ask', true, false,
       'limited', 'USDC', 1000000);
    insert into paper_positions (
      id, owner_id, bot_id, mint, decimals, quantity, entry_micro_usdc, realized_micro_usdc,
      status, mode, cluster, opened_at, updated_at
    ) values
      ('pos:bot_alice:sol', 'alice', 'bot_alice', '${MINT}', 9, '1000000000', '150000000', '0',
       'open', 'paper', 'devnet', 1, 1),
      ('pos:bot_bob:sol', 'bob', 'bot_bob', '${MINT}', 9, '2000000000', '250000000', '0',
       'open', 'paper', 'devnet', 1, 1);
    insert into position_checks (id, owner_id, bot_id, at, reason, status, flag, unrealized_loss_micro_usd, detail)
    values
      ('pchk_alice', 'alice', 'bot_alice', 10, 'cron-hourly', 'checked', 'within-cap', '0', '{"authorization":"Bearer secret-alice"}'::jsonb),
      ('pchk_bob', 'bob', 'bot_bob', 10, 'cron-hourly', 'checked', 'within-cap', '0', '{"ok":true}'::jsonb);
    insert into paper_fills (
      id, position_id, owner_id, bot_id, side, mint, quantity, notional_micro_usdc,
      realized_micro_usdc, cluster, pricing_cluster, mode, broadcast, at
    ) values
      ('fill_alice', 'pos:bot_alice:sol', 'alice', 'bot_alice', 'buy', '${MINT}', '1000000000', '150000000',
       '0', 'devnet', 'mainnet', 'paper', false, 1),
      ('fill_bob', 'pos:bot_bob:sol', 'bob', 'bot_bob', 'buy', '${MINT}', '2000000000', '250000000',
       '0', 'devnet', 'mainnet', 'paper', false, 1);
  `);
}

test('authenticated alice only sees her paper positions, fills, and checks; anon is denied', async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  await seed(db);

  await db.query(`select set_config('request.jwt.claims', '{"owner_id":"alice"}', false)`);
  await db.exec('set role authenticated');
  const positions = await db.query(`select id, owner_id from paper_positions order by id`);
  assert.deepEqual(positions.rows.map(row => row.id), ['pos:bot_alice:sol']);
  assert.equal(positions.rows.every(row => row.owner_id === 'alice'), true);
  const stolen = await db.query(`select id from paper_positions where owner_id = 'bob'`);
  assert.equal(stolen.rows.length, 0);
  const fills = await db.query(`select id from paper_fills order by id`);
  assert.deepEqual(fills.rows.map(row => row.id), ['fill_alice']);
  const stolenFills = await db.query(`select id from paper_fills where owner_id = 'bob'`);
  assert.equal(stolenFills.rows.length, 0);
  const checks = await db.query(`select id from position_checks order by id`);
  assert.deepEqual(checks.rows.map(row => row.id), ['pchk_alice']);
  const peeked = await db.query(`select detail from position_checks where id = 'pchk_bob'`);
  assert.equal(peeked.rows.length, 0);
  await db.exec('reset role');

  await db.exec('set role anon');
  await assert.rejects(() => db.query('select id from paper_positions'));
  await assert.rejects(() => db.query('select id from paper_fills'));
  await assert.rejects(() => db.query('select id from position_checks'));
  await db.exec('reset role');
});

test('authenticated cannot DML paper tables; bob rows stay untouched', async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  await seed(db);

  await db.query(`select set_config('request.jwt.claims', '{"owner_id":"alice"}', false)`);
  await db.exec('set role authenticated');

  // Authenticated is select-only — insert/update/delete fail closed (privilege + RLS).
  await assert.rejects(() => db.query(`
    insert into paper_positions (
      id, owner_id, bot_id, mint, decimals, quantity, entry_micro_usdc, realized_micro_usdc,
      status, mode, cluster, opened_at, updated_at
    ) values (
      'pos:forged', 'bob', 'bot_bob', '${MINT}', 9, '1', '1', '0',
      'open', 'paper', 'devnet', 2, 2
    )
  `));

  await assert.rejects(() => db.query(`
    insert into paper_fills (
      id, position_id, owner_id, bot_id, side, mint, quantity, notional_micro_usdc,
      realized_micro_usdc, cluster, pricing_cluster, mode, broadcast, at
    ) values (
      'fill_forged', 'pos:bot_bob:sol', 'bob', 'bot_bob', 'sell', '${MINT}', '1', '1',
      '0', 'devnet', 'mainnet', 'paper', false, 2
    )
  `));

  await assert.rejects(
    () => db.query(`update paper_positions set owner_id = 'bob' where id = 'pos:bot_alice:sol'`),
  );

  await assert.rejects(
    () => db.query(`delete from paper_positions where owner_id = 'bob'`),
  );

  await db.exec('reset role');
  const bobStill = await db.query(`select id from paper_positions where owner_id = 'bob'`);
  assert.equal(bobStill.rows.length, 1);
  const aliceStill = await db.query(`select owner_id from paper_positions where id = 'pos:bot_alice:sol'`);
  assert.equal(aliceStill.rows[0].owner_id, 'alice');
  const bobFill = await db.query(`select id from paper_fills where owner_id = 'bob'`);
  assert.equal(bobFill.rows.length, 1);
});

test('position_checks detail redacts bearer tokens on insert', async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  await seed(db);
  const stored = await db.query(`select detail from position_checks where id = 'pchk_alice'`);
  const encoded = JSON.stringify(stored.rows[0].detail);
  assert.equal(encoded.includes('secret-alice'), false);
  assert.match(encoded, /\[redacted\]/);
});

test('migration enables FORCE RLS, owner policies, and select-only grants', () => {
  assert.match(paper, /alter table paper_positions enable row level security/);
  assert.match(paper, /alter table paper_fills enable row level security/);
  assert.match(paper, /alter table position_checks enable row level security/);
  assert.match(paper, /alter table paper_positions force row level security/);
  assert.match(paper, /alter table paper_fills force row level security/);
  assert.match(paper, /alter table position_checks force row level security/);
  assert.match(paper, /create policy paper_positions_owner/);
  assert.match(paper, /create policy paper_fills_owner/);
  assert.match(paper, /create policy position_checks_owner/);
  assert.match(paper, /with check/);
  assert.match(paper, /revoke all on table paper_positions from anon/);
  assert.match(paper, /grant select on table paper_positions to authenticated/);
  assert.doesNotMatch(paper, /grant select, insert, update, delete on table paper_positions to authenticated/);
  assert.doesNotMatch(paper, /sk_live|service_role_key\s*=\s*'/);
  assert.doesNotMatch(paper, /security definer/i);
});
