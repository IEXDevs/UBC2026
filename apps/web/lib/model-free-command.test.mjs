import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelFreeCommand, needsChatModel } from './model-free-command.mjs';

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
