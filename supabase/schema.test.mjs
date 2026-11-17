import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const foundations = readFileSync(new URL('./migrations/20261114000000_foundations.sql', import.meta.url), 'utf8');
const policy = readFileSync(new URL('./migrations/20261114020000_policy_ledger.sql', import.meta.url), 'utf8');
const templates = readFileSync(new URL('./migrations/20261114040000_bot_templates.sql', import.meta.url), 'utf8');

function concat(parts) {
  return parts.reduce((sql, part) => (sql.endsWith('\n') ? sql + part : `${sql}\n${part}`));
}

/**
 * Achieves: Committed schema.sql equals concatenation of the three phase-1 migrations.
 * Fails when: schema.sql drifts from migrations.
 * Oracle: Byte equality of concat(foundations, policy, templates).
 * Side effects: Reads SQL files.
 * Gaps: Later migrations are intentionally outside schema.sql.
 */
test('schema.sql is foundations, the policy ledger, and bot templates', () => {
  assert.equal(schema, concat([foundations, policy, templates]));
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
