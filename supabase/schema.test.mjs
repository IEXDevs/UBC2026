import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function readSql(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
}

const schema = readSql('./schema.sql');
const foundations = readSql('./migrations/20261114000000_foundations.sql');
const policy = readSql('./migrations/20261114020000_policy_ledger.sql');
const templates = readSql('./migrations/20261114040000_bot_templates.sql');
const walletSoftDelete = readSql('./migrations/20261119000000_wallet_soft_delete.sql');
const mainnet = readSql('./migrations/20261120000000_solana_mainnet.sql');

function concat(parts) {
  return parts.reduce((sql, part) => (sql.endsWith('\n') ? sql + part : `${sql}\n${part}`));
}

/**
 * Achieves: schema.sql matches the migrations it bundles in their listed order.
 * Fails when: schema.sql drifts from migrations.
 * Oracle: Text equality after line-ending normalization.
 * Side effects: Reads SQL files.
 * Gaps: This check covers only the bundled migrations.
 */
test('schema.sql matches the three phase-1 migrations and wallet soft delete', () => {
  assert.equal(schema, concat([foundations, policy, templates, walletSoftDelete, mainnet]));
});

/**
 * Achieves: schema.sql mentions required tables, cap columns, RLS, realtime, policy RPCs, and no embedded live secrets.
 * Fails when: A required symbol disappears or a secret literal is committed.
 * Oracle: Phase-1 schema checklist.
 * Side effects: Reads schema.sql.
 * Gaps: String presence only — not executable DDL validation.
 */
test('schema covers phase 1 tables, caps, RLS, and realtime', () => {
  for (const name of [
    'users',
    'wallets',
    'bots',
    'bot_assignments',
    'spend_ledgers',
    'approvals',
    'decision_records',
    'timeline_events',
    'payments',
    'metrics',
    'bot_templates',
  ]) {
    assert.match(schema, new RegExp(`\\b${name}\\b`));
  }
  assert.match(schema, /max_outflow/);
  assert.match(schema, /max_per_transaction/);
  assert.match(schema, /max_loss/);
  assert.match(schema, /enable row level security/);
  assert.match(schema, /supabase_realtime/);
  assert.match(schema, /app_owner_id/);
  assert.match(schema, /policy_reserve_budget/);
  assert.match(schema, /policy_stop_all/);
  assert.match(schema, /policy_freeze_wallet/);
  assert.match(schema, /create_bot_draft/);
  assert.match(schema, /enable_bot/);
  assert.match(schema, /list_templates/);
  assert.match(schema, /Locked templates cannot be deleted or hidden/);
  assert.match(schema, /budget_reservations/);
  assert.match(schema, /for update/);
  assert.match(schema, /idempotency_key/);
  assert.doesNotMatch(schema, /sk_live|service_role_key\s*=\s*'[^']+'/);
});
