import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('./migrations/20261114000000_foundations.sql', import.meta.url), 'utf8');

test('checked-in migration matches schema.sql', () => {
  assert.equal(migration, schema);
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
  assert.doesNotMatch(schema, /sk_live|service_role_key\s*=\s*'[^']+'/);
});
