import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureOwnerTradeLoop, ownerAsksForOneTrade } from './owner-trade.mjs';

test('an owner trade ask wakes the loop unless a spend tool already ran', async () => {
  assert.equal(ownerAsksForOneTrade('try finding and doing one trade right now'), true);
  assert.equal(ownerAsksForOneTrade('what is the price of SOL'), false);

  const calls = [];
  const started = await ensureOwnerTradeLoop({
    message: 'try finding and doing one trade right now',
    goal: 'beat inflation',
    permission: 'full',
    activity: [{ name: 'get_price', status: 'done' }],
    invoke: async (name, args) => {
      calls.push({ name, args });
      return { ok: true, done: name === 'start_task' };
    },
  });
  assert.deepEqual(calls.map(call => call.name), ['wake_bot', 'start_task']);
  assert.equal(calls[1].args.ownerPermission, 'full');
  assert.equal(calls[1].args.goal, 'beat inflation');
  assert.equal(started.loop.done, true);

  const skipped = await ensureOwnerTradeLoop({
    message: 'try finding and doing one trade right now',
    activity: [{ name: 'request_spend', status: 'error' }],
    invoke: async () => {
      throw new Error('should not run');
    },
  });
  assert.equal(skipped, null);
});
