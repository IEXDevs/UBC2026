import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lasoPreparationArgs, lasoPurchaseHold, pendingLasoConfirmation } from './laso-chat.mjs';
import { sealAssetSpendHold, resumeAssetSpend } from './chat-spend-confirmation.mjs';
import { createChatToolInvoker, serializeToolResult } from './chat-tools.mjs';
import { completeTextChat } from './text-chat.mjs';

const context = { ownerId: 'owner_1', botId: 'bot_1', secret: 'offline-test-key' };
const args = { botId: context.botId, provider: 'laso', amountUsd: '10' };
const prepared = { provider: 'laso', lasoTicket: `payload.${'a'.repeat(64)}`, proposal: { outflow: '10000000' } };

test('Laso preparation preserves the requested amount and directly produces an x402 confirmation', () => {
  assert.equal(lasoPreparationArgs({ ...args, amountUsd: 5 }, 'get a Laso card for 10 USDC').amountUsd, '10');
  assert.equal(lasoPreparationArgs(args, 'get a Laso card').amountUsd, '10');
  const hold = lasoPurchaseHold(args, JSON.stringify(prepared));
  assert.equal(hold.args.action, 'x402');
  assert.equal(hold.args.amount, '10000000');
  assert.equal(hold.args.lasoTicket, prepared.lasoTicket);
  assert.equal(hold.args.destination, undefined);
  assert.match(hold.label, /Buy a Laso.*\$10/);
  for (const bad of [null, '', '{}', 'not json', { error: 'unavailable' }, { ...prepared, lasoTicket: '' }, { ...prepared, proposal: { outflow: '5000000' } }]) {
    assert.equal(lasoPurchaseHold(args, bad), null);
  }
});

test('yes and okay approved reuse the same sealed ticket; expiry and another owner cannot', async () => {
  const hold = sealAssetSpendHold(lasoPurchaseHold(args, prepared), context, 1000);
  const pending = { ...context, hold };
  for (const message of ['yes', 'okay approved', 'Yes!']) {
    assert.equal(pendingLasoConfirmation(pending, message, context, 2000), hold);
  }
  for (const message of ['', 'no', 'yes but make it 20 USDC']) {
    assert.equal(pendingLasoConfirmation(pending, message, context, 2000), null);
  }
  assert.equal(pendingLasoConfirmation(pending, 'yes', { ...context, ownerId: 'other' }, 2000), null);
  assert.equal(pendingLasoConfirmation(pending, 'yes', context, hold.expiresAt), null);
  let calls = 0;
  await resumeAssetSpend(hold, context, async (name, inputs) => {
    calls++;
    assert.equal(name, 'request_spend');
    assert.equal(inputs.lasoTicket, prepared.lasoTicket);
    return { error: 'simulation_failed', signed: false, simulationReason: 'insufficient_funds' };
  }, 2000);
  assert.equal(calls, 1);
});

test('Laso chat dispatch forwards the owner amount despite a smaller model amount and blocks ordinary spend', async () => {
  let calls = 0;
  const invoke = createChatToolInvoker({ ...context, ownerMessage: 'get a Laso card for 10 USDC', runtimeBase: 'https://runtime.invalid', fetcher: async (_url, init) => {
    calls++;
    assert.equal(JSON.parse(init.body).amountUsd, '10');
    return Response.json(prepared);
  } });
  await invoke('prepare_shopping', { ...args, amountUsd: 5 });
  assert.equal((await invoke('request_spend', { action: 'spend', destination: 'payTo' })).error, 'laso_requires_x402');
  assert.equal(calls, 1);
});

test('the model preparation path returns its hold without another model reply or verification call', async () => {
  let calls = 0;
  const reply = await completeTextChat({
    modelApiKey: 'LLM_1607358788850350_testsecretvalue', message: 'get a Laso card for 10 USDC',
    tools: [{ type: 'function', function: { name: 'prepare_shopping', parameters: { type: 'object' } } }],
    fetcher: async () => {
      calls++;
      assert.equal(calls, 1);
      return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [
        { id: 'prepare', type: 'function', function: { name: 'prepare_shopping', arguments: JSON.stringify({ ...args, amountUsd: 5 }) } },
      ] } }] });
    },
    invokeTool: async (name, inputs) => {
      assert.equal(name, 'prepare_shopping');
      assert.equal(inputs.amountUsd, '10');
      return JSON.stringify(prepared);
    },
  });
  assert.equal(reply.hold.args.action, 'x402');
  assert.equal(reply.hold.args.lasoTicket, prepared.lasoTicket);
  assert.equal(calls, 1);
});

test('a named Laso reloadable request prepares the default card even if the model omits or misnames the provider', async () => {
  for (const provider of [undefined, 'reloadable']) {
    let modelCalls = 0;
    let runtimeCalls = 0;
    const invoke = createChatToolInvoker({ ...context, ownerMessage: 'get me a laso finance reloadable card', runtimeBase: 'https://runtime.invalid', fetcher: async (_url, init) => {
      runtimeCalls++;
      assert.deepEqual(JSON.parse(init.body), { provider: 'laso' });
      return Response.json({ ...prepared, botId: context.botId, proposal: { outflow: '5000000' } });
    } });
    const reply = await completeTextChat({
      modelApiKey: 'LLM_1607358788850350_testsecretvalue', message: 'get me a laso finance reloadable card',
      tools: [{ type: 'function', function: { name: 'prepare_shopping', parameters: { type: 'object' } } }],
      fetcher: async () => {
        assert.equal(++modelCalls, 1);
        return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [
          { id: 'prepare', type: 'function', function: { name: 'prepare_shopping', arguments: JSON.stringify({ provider, type: 'reloadable' }) } },
        ] } }] });
      },
      invokeTool: async (name, inputs) => serializeToolResult(await invoke(name, inputs)),
    });
    assert.equal(reply.hold.args.action, 'x402');
    assert.equal(reply.hold.args.amount, '5000000');
    assert.equal(reply.hold.args.botId, context.botId);
    assert.equal(modelCalls, 1);
    assert.equal(runtimeCalls, 1);
  }
});

test('Laso tool failures and empty results return a preparation error without a follow-up model call', async () => {
  for (const failure of [null, '{}', { error: 'invalid_amount' }, { ok: false }, new Error('offline')]) {
    let calls = 0;
    const reply = await completeTextChat({
      modelApiKey: 'LLM_1607358788850350_testsecretvalue', message: 'get me a laso finance reloadable card',
      tools: [{ type: 'function', function: { name: 'prepare_shopping', parameters: { type: 'object' } } }],
      fetcher: async () => {
        assert.equal(++calls, 1);
        return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [
          { id: 'prepare', type: 'function', function: { name: 'prepare_shopping', arguments: JSON.stringify(args) } },
        ] } }] });
      },
      invokeTool: async () => { if (failure instanceof Error) throw failure; return failure; },
    });
    assert.equal(reply.hold, undefined);
    assert.match(reply.text, /could not prepare the Laso card/);
    assert.doesNotMatch(reply.text, /model call failed/);
    assert.equal(calls, 1);
  }
});
