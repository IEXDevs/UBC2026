import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChatToolInvoker } from './chat-tools.mjs';
import { resumeAssetSpend, sealAssetSpendHold } from './chat-spend-confirmation.mjs';
import { stampSpendPermission } from './harness-run.mjs';
import { toolAccessRequest } from './spend-permission.mjs';

const ownerId = 'did:privy:owner1';
const botId = 'bot_sol';
const context = { ownerId, botId, secret: 'test-only-chat-key' };
const args = {
  action: 'pay', amount: '1000000000', asset: 'SOL', botId,
  destination: '11111111111111111111111111111111', handle: 'hi', quoteCluster: 'devnet',
};
const signature = '5'.repeat(64);

test('a slide submits the original SOL payment directly and returns its Solscan receipt', async () => {
  const hold = sealAssetSpendHold(toolAccessRequest('full', 'request_spend', args), context, 1000);
  const confirmed = JSON.parse(JSON.stringify(hold));
  const calls = [];
  const invoke = createChatToolInvoker({
    ownerId, botId, runtimeBase: 'https://runtime.example',
    fetcher: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return Response.json({ ok: true, signed: true, cluster: 'devnet', signature });
    },
  });
  const reply = await resumeAssetSpend(confirmed, context, (name, inputs) => invoke(
    name,
    stampSpendPermission(name, inputs, { permissionMode: 'full', confirmSpend: true, grants: [confirmed] }),
  ), 2000);
  assert.deepEqual(calls, [{
    url: 'https://runtime.example/api/spend',
    body: { ...args, idempotencyKey: hold.idempotencyKey, confirmed: true, permission: 'full', reviewCap: '30000000' },
  }]);
  assert.equal(reply.hold, undefined);
  assert.equal(reply.text, `Sent. https://solscan.io/tx/${signature}?cluster=devnet`);
});

test('a changed, expired, or unsigned payment confirmation never invokes the spend tool', async () => {
  const unsigned = toolAccessRequest('ask', 'request_spend', args);
  const hold = sealAssetSpendHold(unsigned, context, 1000);
  const cases = [
    [unsigned, context, 2000],
    [hold, context, hold.expiresAt],
    [hold, { ...context, ownerId: 'did:privy:other' }, 2000],
    [hold, { ...context, botId: 'bot_other' }, 2000],
    [{ ...hold, args: { ...args, amount: '2000000000' } }, context, 2000],
    [{ ...hold, args: { ...args, handle: 'other' } }, context, 2000],
    [{ ...hold, args: { ...args, quoteCluster: undefined } }, context, 2000],
  ];
  let invoked = 0;
  for (const [candidate, scope, time] of cases) {
    const reply = await resumeAssetSpend(candidate, scope, () => { invoked += 1; }, time);
    assert.match(reply.text, /invalid or expired/i);
    assert.equal(reply.hold, undefined);
  }
  assert.equal(invoked, 0);
});

test('a runtime rejection ends the confirmed turn and shows the reason', async () => {
  const hold = sealAssetSpendHold(toolAccessRequest('ask', 'request_spend', args), context, 1000);
  const reply = await resumeAssetSpend(hold, context, async () => ({
    error: 'approval-needed', reason: 'per-transaction', signed: false,
  }), 2000);
  assert.equal(reply.hold, undefined);
  assert.match(reply.activity[0].error, /per-transfer limit/);
});
