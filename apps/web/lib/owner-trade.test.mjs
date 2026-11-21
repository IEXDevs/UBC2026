import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureOwnerTradeLoop, ownerAsksForOneTrade, pendingSwapHold } from './owner-trade.mjs';
import { matchingToolGrant } from './spend-permission.mjs';

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
  assert.equal(calls[1].args.goal, 'try finding and doing one trade right now\nGeneral goal for background context only: beat inflation');
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

test('the desk uses the queued amount and id to open the existing swap confirmation', () => {
  const intent = { botId: 'bot_1', asset: 'USDC', outputAsset: 'SOL', amount: '1000000', idempotencyKey: `loop_swap_${crypto.randomUUID()}` };
  const hold = pendingSwapHold('bot_1', intent);
  assert.equal(hold.kind, 'modal');
  assert.equal(hold.idempotencyKey, intent.idempotencyKey);
  assert.equal(hold.args.outputAsset, intent.outputAsset);
  assert.equal(matchingToolGrant([hold], hold.name, hold.args), hold);
  assert.equal(pendingSwapHold('bot_2', intent), null);
});
