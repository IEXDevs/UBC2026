/**
 * Rigor audit — position-persist service-role writes
 * Achieves: verified ownerId is stamped on every row; unconfigured env is a no-op;
 *   invalid ids refuse; detail payloads redact Authorization-like keys via redactForLog.
 * Fails when: client-supplied owner is accepted without id shape checks, or secret
 *   headers land in detail unredacted.
 * Oracle: persistPositionCheck stamps owner_id from argument, not from position rows.
 * Side effects: mocked supabaseWrite capture only.
 * Gaps: does not hit live PostgREST; RLS exercised in supabase/paper-positions.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { persistPositionCheck } from './position-persist.mjs';

const MINT = 'So11111111111111111111111111111111111111112';

test('persistPositionCheck refuses bad ids and skips when Supabase is unset', async () => {
  const skipped = await persistPositionCheck({}, {
    ownerId: 'alice',
    botId: 'bot_1',
    check: { paper: false, at: 1, flag: 'clear', status: 'checked', unrealizedLossMicroUsd: '0' },
  });
  assert.equal(skipped.wrote, false);
  assert.equal(skipped.reason, 'unconfigured');

  const bad = await persistPositionCheck({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  }, { ownerId: '../evil', botId: 'bot_1', check: {} });
  assert.equal(bad.wrote, false);
  assert.equal(bad.reason, 'invalid_ids');
});

test('persistPositionCheck stamps verified owner_id and redacts secret keys in detail', async () => {
  const writes = [];
  const env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
    fetch: async (url, init) => {
      const target = String(url);
      if (target.includes('/rest/v1/bots?')) {
        assert.match(target, /owner_id=eq\.alice/);
        assert.match(target, /id=eq\.bot_1/);
        return new Response(JSON.stringify([{ id: 'bot_1' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      writes.push({ url: target, body: JSON.parse(init.body) });
      return new Response('[]', { status: 201, headers: { 'content-type': 'application/json' } });
    },
  };
  const result = await persistPositionCheck(env, {
    ownerId: 'alice',
    botId: 'bot_1',
    check: {
      paper: false,
      at: 99,
      reason: 'cron-hourly',
      status: 'checked',
      flag: 'within-cap',
      unrealizedLossMicroUsd: null,
      positions: [{ mint: MINT, amount: '1', decimals: 9 }],
      authorization: 'Bearer should-not-land',
    },
  });
  assert.equal(result.wrote, true);
  assert.equal(writes.length, 1);
  const checkWrite = writes.find(row => row.url.includes('position_checks'));
  assert.equal(checkWrite.body.owner_id, 'alice');
  assert.equal(checkWrite.body.bot_id, 'bot_1');
  assert.equal(JSON.stringify(checkWrite.body).includes('service-role-secret'), false);
  assert.equal(JSON.stringify(checkWrite.body.detail).includes('should-not-land'), false);
  assert.equal(checkWrite.body.detail.paper, false);
  assert.equal(checkWrite.body.detail.lossKnown, false);
});

test('persistPositionCheck refuses when bot is not owned by the claimed owner', async () => {
  const env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    fetch: async (url) => {
      if (String(url).includes('/rest/v1/bots?')) {
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error('should not write');
    },
  };
  const result = await persistPositionCheck(env, {
    ownerId: 'alice',
    botId: 'bot_bob',
    check: { paper: false, at: 1, flag: 'clear', status: 'checked' },
  });
  assert.equal(result.wrote, false);
  assert.equal(result.reason, 'owner_mismatch');
});
