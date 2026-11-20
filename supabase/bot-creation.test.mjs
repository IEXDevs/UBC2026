import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const owner = 'user_1';
const now = 1_700_000_000_000;
const mainAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const extraAddress = 'So11111111111111111111111111111111111111112';

function parseResult(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function call(db, fn, payload) {
  const result = await db.query(`select ${fn}($1::jsonb) as result`, [JSON.stringify(payload)]);
  return parseResult(result.rows[0].result);
}

async function seed(db) {
  await db.query(`insert into users (id, privy_user_id) values ('user_1', 'privy_user_1'), ('user_2', 'privy_user_2')`);
  await db.query(
    `insert into wallets (id, owner_id, kind, label, address, provider, frozen) values
      ('w_main', 'user_1', 'main', 'Main', $1, 'privy', false),
      ('w_add', 'user_1', 'additional', 'Trading sleeve', $2, 'privy', false),
      ('w_frozen', 'user_1', 'additional', 'Frozen sleeve', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'privy', true),
      ('w_other', 'user_2', 'main', 'Main', $1, 'privy', false)`,
    [mainAddress, extraAddress],
  );
}

const cap = { mode: 'limited', asset: 'USDC', maxOutflow: '50000000', maxPerTransaction: '5000000' };

function draft(overrides = {}) {
  return {
    id: 'bot_apy',
    ownerId: owner,
    name: 'APY hunter',
    goal: 'Hunt blue-chip yield',
    type: 'trading',
    walletId: 'w_main',
    approvalMode: 'ask',
    templateId: 'builtin:trading',
    cap,
    now,
    ...overrides,
  };
}

/**
 * Achieves: Builtin templates are locked; drafts force enabled=false; frozen/foreign wallets refused; enable_bot is idempotent; JWT owner enforced.
 * Fails when: Builtins deletable, enabled=true drafts, or cross-owner create succeeds.
 * Oracle: schema.sql bot template + create_bot_draft/enable_bot RPCs.
 * Side effects: PGlite with full schema.sql.
 * Gaps: Does not cover concurrent enable races.
 */
test('postgres keeps three locked templates and creates disabled bots', async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(schema);
  try {
    await seed(db);
    const listed = await call(db, 'list_templates', { ownerId: owner });
    assert.deepEqual(listed.map(template => template.id), [
      'builtin:trading',
      'builtin:shopping',
      'builtin:position-management',
    ]);
    assert.ok(listed.every(template => template.builtin && template.deletable === false));

    await assert.rejects(
      () => call(db, 'delete_user_template', { ownerId: owner, templateId: 'builtin:trading' }),
      /Locked templates cannot be deleted/,
    );
    await assert.rejects(
      () => db.query(`delete from bot_templates where id = 'builtin:shopping'`),
      /Locked templates cannot be deleted or hidden/,
    );
    await assert.rejects(
      () => db.query(`update bot_templates set name = 'Hidden' where id = 'builtin:position-management'`),
      /Locked templates cannot be deleted or hidden/,
    );

    const created = await call(db, 'create_user_template', {
      id: 'tpl_apy',
      ownerId: owner,
      name: 'APY hunter',
      goal: 'Hunt blue-chip yield',
      type: 'trading',
      approvalMode: 'capped-automatic',
      autoApproveCap: '1000000',
      cap,
    });
    assert.equal(created.deletable, true);
    const withUser = await call(db, 'list_templates', { ownerId: owner });
    assert.equal(withUser.length, 4);
    assert.deepEqual(await call(db, 'list_templates', { ownerId: 'user_2' }).then(rows => rows.map(row => row.id)), [
      'builtin:trading',
      'builtin:shopping',
      'builtin:position-management',
    ]);
    assert.deepEqual(await call(db, 'delete_user_template', { ownerId: owner, templateId: 'tpl_apy' }), {
      deleted: true,
      id: 'tpl_apy',
    });

    await assert.rejects(
      () => call(db, 'create_bot_draft', draft({ type: undefined, walletId: undefined, cap: undefined, approvalMode: undefined })),
      /Creation needs type, wallet, caps, approval-mode/,
    );
    await assert.rejects(() => call(db, 'create_bot_draft', draft({ walletId: 'w_frozen' })), /Cannot assign a frozen wallet/);
    await assert.rejects(() => call(db, 'create_bot_draft', draft({ walletId: 'w_other' })), /Wallet owner must match bot owner/);

    const bot = await call(db, 'create_bot_draft', draft({ enabled: true }));
    assert.equal(bot.state, 'draft');
    assert.equal(bot.enabled, false);
    assert.equal(bot.walletId, 'w_main');
    const row = await db.query(`select enabled, template_id, approval_mode from bots where id = 'bot_apy'`);
    assert.equal(row.rows[0].enabled, false);
    assert.equal(row.rows[0].template_id, 'builtin:trading');
    assert.equal(row.rows[0].approval_mode, 'ask');

    const position = await call(db, 'create_bot_draft', draft({
      id: 'bot_guard',
      type: 'position-management',
      walletId: 'w_add',
      templateId: 'builtin:position-management',
      cap: { mode: 'limited', asset: 'USDC', maxLoss: '10000000' },
    }));
    assert.equal(position.type, 'position-management');
    assert.equal(position.walletId, 'w_add');

    const free = await call(db, 'create_bot_draft', draft({
      id: 'bot_free',
      type: 'shopping',
      approvalMode: 'fully-automatic',
      templateId: null,
      cap: { mode: 'unlimited', asset: 'USDC' },
    }));
    assert.equal(free.capMode, 'unlimited');
    assert.equal(free.approvalMode, 'fully-automatic');

    const enabled = await call(db, 'enable_bot', { ownerId: owner, botId: 'bot_apy', now });
    assert.equal(enabled.enabled, true);
    assert.equal(enabled.changed, true);
    const again = await call(db, 'enable_bot', { ownerId: owner, botId: 'bot_apy', now });
    assert.equal(again.changed, false);
    const still = await db.query(`select enabled from bots where id = 'bot_free'`);
    assert.equal(still.rows[0].enabled, false);

    await db.query(`select set_config('request.jwt.claims', '{"owner_id":"user_2"}', false)`);
    await assert.rejects(() => call(db, 'create_bot_draft', draft({ id: 'bot_nope' })), /forbidden/);
  } finally {
    await db.close();
  }
});
