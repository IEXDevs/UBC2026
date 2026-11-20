import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canReleaseChatMessage, modelFreeCommand, needsChatModel } from './model-free-command.mjs';
import { releaseQueued } from './message-queue.mjs';

test('hiding every model does not disable the existing direct-payment commands', () => {
  assert.equal(modelFreeCommand('send 2 USDC to @alice'), 'platform-send');
  assert.equal(modelFreeCommand('send 1 SOL to @alice'), 'sol-send');
  assert.equal(needsChatModel('send 2 USDC to @alice'), false);
  assert.equal(needsChatModel('send 1 SOL to @alice'), false);
  assert.equal(needsChatModel('Explain SOL transfers'), true);
  assert.equal(needsChatModel('Summarize my activity'), true);
  assert.equal(needsChatModel('send 1 SOL to @alice\ninvoice.pdf'), true);
  assert.equal(needsChatModel('send 2 USDC to @alice\ninvoice.pdf'), true);
  assert.equal(needsChatModel('Buy a token', [{ name: 'request_spend', kind: 'modal', proof: 'synthetic-server-proof' }]), false);
  assert.equal(needsChatModel('Buy a token', [{ name: 'request_spend' }]), true);
});

test('model visibility and pending payments pause the queue without consuming messages', () => {
  const prompts = [{ id: 'a', text: 'Summarize my activity' }, { id: 'b', text: 'Explain the result' }];
  const release = (queue, state) => releaseQueued(queue, { canRelease: item => canReleaseChatMessage(item.text, state) });
  assert.deepEqual(release(prompts, { hasModel: false }), { next: null, queue: prompts });
  assert.equal(release(prompts, { hasModel: true }).next, prompts[0]);
  const payments = [{ id: 'c', text: 'send 2 USDC to @alice' }, { id: 'd', text: 'send 3 USDC to @bob' }];
  assert.deepEqual(release(payments, { hasModel: false, paymentPending: true }), { next: null, queue: payments });
  assert.equal(release(payments, { hasModel: false, paymentPending: false }).next, payments[0]);
});
