import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryLedger, createSupabaseLedger, PolicyError } from './ledger.mjs';
import { ledgerCases, proposal, shoppingFixture } from './ledger-cases.mjs';

for (const spec of ledgerCases) {
  test(spec.name, async () => {
    const ledger = createMemoryLedger();
    await spec.run(ledger, assert);
  });
}

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
