import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const foundations = readFileSync(new URL('./migrations/20261114000000_foundations.sql', import.meta.url), 'utf8');
const policy = readFileSync(new URL('./migrations/20261114020000_policy_ledger.sql', import.meta.url), 'utf8');

test('schema.sql is foundations plus the policy ledger migration', () => {
  const expected = foundations.endsWith('\n') ? foundations + policy : `${foundations}\n${policy}`;
  assert.equal(schema, expected);
});

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
  assert.match(schema, /budget_reservations/);
  assert.match(schema, /for update/);
  assert.match(schema, /idempotency_key/);
  assert.doesNotMatch(schema, /sk_live|service_role_key\s*=\s*'[^']+'/);
});
