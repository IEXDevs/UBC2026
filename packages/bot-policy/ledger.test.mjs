import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryLedger, createSupabaseLedger, PolicyError } from './ledger.mjs';
import { ledgerCases, proposal, shoppingFixture } from './ledger-cases.mjs';

/**
 * Memory-ledger case runner. Each case object in ledger-cases.mjs carries an
 * Achieves / Fails when / Oracle / Side effects / Gaps block comment immediately
 * above its `name` field — that is the rigor record for the generated test().
 */
for (const spec of ledgerCases) {
  test(spec.name, async () => {
    assert.equal(typeof spec.name, 'string');
    assert.equal(typeof spec.run, 'function');
    const ledger = createMemoryLedger();
    await spec.run(ledger, assert);
  });
}

/**
 * Achieves: Two concurrent reserves against one remaining budget yield exactly one reserved and one over-budget.
 * Fails when: Both reserve, or reserved total exceeds the remaining cap.
 * Oracle: Independent Promise.all race; snapshot.reserved === '60' (58+2 fee) after exactly one win.
 * Side effects: in-memory ledger reserved balance + reservation rows.
 * Gaps: Does not prove DB-level row locks (Supabase RPC owns that); this proves the memory mutex semantics.
 */
test('concurrent reserves cannot share one remaining budget', async () => {
  const ledger = createMemoryLedger();
  await ledger.reset(shoppingFixture({ approvalMode: 'fully-automatic', cap: { maxPerTransaction: '80' } }));
  const input = idempotencyKey => ({
    ownerId: 'user_1',
    now: 1000,
    idempotencyKey,
    proposal: proposal({ id: idempotencyKey, outflow: '58' }),
  });
  const [left, right] = await Promise.all([
    ledger.reserveBudget(input('idem_a')),
    ledger.reserveBudget(input('idem_b')),
  ]);
  assert.deepEqual([left.state, right.state].sort(), ['over-budget', 'reserved']);
  assert.equal((await ledger.snapshot()).ledgers[0].reserved, '60');
});

/**
 * Achieves: Supabase ledger adapter forwards pause/stop/reserve to named RPCs and rejects a null client.
 * Fails when: Wrong RPC names, payloads dropped, or null factory succeeds.
 * Oracle: Call spy fn names policy_pause_bot / policy_stop_all / policy_reserve_budget; PolicyError on null.
 * Side effects: none beyond spy array (no real Supabase).
 * Gaps: RPC response schema validation is server-owned.
 */
test('supabase ledger client forwards payloads to policy RPCs', async () => {
  const calls = [];
  const ledger = createSupabaseLedger(async (fn, payload) => {
    calls.push({ fn, payload });
    return { state: 'paused', echo: payload.botId };
  });
  const paused = await ledger.pauseBot({ botId: 'bot_1', ownerId: 'user_1', now: 1 });
  const stopped = await ledger.stopAll({ ownerId: 'user_1', now: 1 });
  const reserved = await ledger.reserveBudget({ idempotencyKey: 'idem_1' });
  assert.equal(paused.echo, 'bot_1');
  assert.deepEqual(calls.map(call => call.fn), ['policy_pause_bot', 'policy_stop_all', 'policy_reserve_budget']);
  assert.equal(stopped.state, 'paused');
  assert.equal(reserved.state, 'paused');
  assert.throws(() => createSupabaseLedger(null), PolicyError);
});
