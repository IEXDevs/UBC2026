import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cacheSpendConfirmation, LASO_CARD_CHOICE_PROMPT, lasoCardKind, lasoPreparationArgs, lasoPurchaseHold, lasoReloadableChecklist, lasoReloadableReply, lasoResumeDecision, pendingSpendConfirmation } from './laso-chat.mjs';
import { sealAssetSpendHold, resumeAssetSpend } from './chat-spend-confirmation.mjs';
import { createChatToolInvoker, serializeToolResult } from './chat-tools.mjs';
import { completeTextChat } from './text-chat.mjs';
import { toolAccessRequest } from './spend-permission.mjs';

const context = { ownerId: 'owner_1', botId: 'bot_1', secret: 'offline-test-key' };
const args = { botId: context.botId, provider: 'laso', amountUsd: '10' };
const prepared = { provider: 'laso', lasoTicket: `payload.${'a'.repeat(64)}`, proposal: { outflow: '10000000' } };

test('ordinary sends and swaps reopen the identical local confirmation without changing approval fields', () => {
  const sends = [
    toolAccessRequest('ask', 'request_spend', { botId: context.botId, action: 'spend', asset: 'USDC', amount: '1000000', destination: '11111111111111111111111111111111' }),
    sealAssetSpendHold(toolAccessRequest('ask', 'request_spend', { botId: context.botId, action: 'pay', asset: 'SOL', amount: '1000000000', handle: 'alice' }), context, 1000),
    sealAssetSpendHold({ ...toolAccessRequest('ask', 'request_spend', { botId: context.botId, action: 'swap', asset: 'USDC', outputAsset: 'SOL', amount: '1000000' }), swapTicket: 'offline-quote', expiresAt: 5000 }, context, 1000),
  ];
  for (const hold of sends) {
    const original = structuredClone(hold);
    const pending = cacheSpendConfirmation(null, hold, context, 1000);
    assert.ok(pending);
    for (const message of ['yes', 'ok', 'approved', 'do it', 'okay approved', 'Yes!']) {
      const reopened = pendingSpendConfirmation(pending, message, context, 2000);
      assert.equal(reopened, hold);
      assert.deepEqual(reopened, original);
      assert.equal(reopened.args.confirmed, undefined);
      assert.equal(cacheSpendConfirmation(pending, reopened, context, 2000), pending);
    }
    assert.equal(pendingSpendConfirmation(pending, 'yes', context, pending.expiresAt), null);
    assert.equal(cacheSpendConfirmation(pending, hold, context, pending.expiresAt), null);
    assert.deepEqual(hold, original);
  }
  assert.equal(sends[0].proof, undefined);
  assert.equal(sends[0].expiresAt, undefined);
});

test('pending spend recovery rejects absent, expired, unsigned bound or differently scoped confirmations', () => {
  const hold = sealAssetSpendHold(toolAccessRequest('ask', 'request_spend', {
    botId: context.botId, action: 'swap', asset: 'USDC', outputAsset: 'SOL', amount: '1000000',
  }), context, 1000);
  const pending = cacheSpendConfirmation(null, hold, context, 1000);
  for (const message of ['', 'no', 'cancel', 'yes but send 2 USDC', 'yes to someone else', 'do it tomorrow']) {
    assert.equal(pendingSpendConfirmation(pending, message, context, 2000), null);
  }
  for (const scope of [{ ...context, ownerId: 'other' }, { ...context, botId: 'other' }, { ownerId: '', botId: '' }]) {
    assert.equal(pendingSpendConfirmation(pending, 'yes', scope, 2000), null);
  }
  for (const candidate of [
    null, {}, { ...pending, ownerId: 'other' }, { ...pending, botId: 'other' },
    { ...pending, hold: { ...hold, name: 'prepare_shopping' } },
    { ...pending, hold: { ...hold, kind: 'inline' } },
    { ...pending, hold: { ...hold, args: { ...hold.args, botId: 'other' } } },
    { ...pending, hold: { ...hold, proof: '' } },
    { ...pending, hold: { ...hold, proof: undefined } },
    { ...pending, hold: { ...hold, expiresAt: undefined } },
    { ...pending, hold: { ...hold, expiresAt: 2000 } },
  ]) assert.equal(pendingSpendConfirmation(candidate, 'yes', context, 2000), null);
  assert.equal(cacheSpendConfirmation(null, null, context, 2000), null);
  assert.equal(cacheSpendConfirmation(null, { ...hold, proof: '' }, context, 2000), null);
});

test('Composer uses the shared local recovery before any model request and still requires the confirmation slide', () => {
  const composer = readFileSync(new URL('../components/Composer.js', import.meta.url), 'utf8');
  assert.match(composer, /pendingSpend\.current = cacheSpendConfirmation\(pendingSpend\.current, result\.hold,/);
  assert.match(composer, /pendingSpend\.current = null;[\s\S]*?\}, \[ownerId, botId\]\)/);
  const runChat = composer.slice(composer.indexOf('async function runChat('), composer.indexOf('async function runChat(') + 12000);
  const recovery = runChat.slice(runChat.indexOf('const pending = pendingSpendConfirmation('), runChat.indexOf('pendingSpend.current = null;'));
  assert.match(recovery, /if \(!grants\?\.length && pending\)/);
  assert.match(recovery, /await settleChat\([\s\S]*hold: pending[\s\S]*return;/);
  assert.doesNotMatch(recovery, /sendBotChat|continueChat|submitChatSpend/);
  assert.ok(runChat.indexOf('const pending = pendingSpendConfirmation(') < runChat.indexOf('needsChatModel('));
  assert.ok(runChat.indexOf('const pending = pendingSpendConfirmation(') < runChat.indexOf('sendBotChat('));
  assert.match(composer, /const accepted = [\s\S]*?await onConfirm\([\s\S]*?if \(!accepted\) \{[\s\S]*?return;[\s\S]*?await continueChat\(spoken, prior, \[result\.hold\]\)/);
  assert.match(composer, /if \(!pendingSpendConfirmation\([\s\S]*?&& needsChatModel\(spoken\)/);
});

test('Laso preparation preserves the requested amount and directly produces an x402 confirmation', () => {
  assert.equal(lasoPreparationArgs({ ...args, amountUsd: 5 }, 'get a Laso card for 10 USDC').amountUsd, '10');
  assert.equal(lasoPreparationArgs(args, 'get a Laso card').amountUsd, '10');
  assert.equal(lasoPreparationArgs(args, 'get a Laso card').lasoAction, undefined);
  assert.equal(lasoPreparationArgs(args, 'get a Laso non-reloadable USA card').lasoAction, 'setup');
  assert.equal(lasoPreparationArgs(args, 'add funds to the Laso card').lasoAction, 'modify');
  assert.equal(lasoPreparationArgs(args, 'buy a $50 amazon gift card').lasoAction, 'gift');
  assert.equal(lasoCardKind('get a Laso card'), 'undecided');
  assert.equal(lasoCardKind('get me a lasso card'), 'undecided');
  assert.equal(lasoCardKind('get me a laso finance reloadable card'), 'reloadable');
  assert.equal(lasoCardKind('buy a $50 amazon gift card'), 'gift');
  assert.equal(LASO_CARD_CHOICE_PROMPT.includes('non-reloadable USA'), true);
  assert.ok(lasoReloadableChecklist().some((step) => /verify-card-issuer-link/i.test(step)));
  assert.match(lasoReloadableReply(), /create-reloadable-card/);
  assert.equal(lasoResumeDecision({ v: 1, kind: 'gift', stage: 'waiting-owner' }, 'done, code entered'), 'verify-now');
  assert.equal(lasoResumeDecision({ v: 1, kind: 'gift', stage: 'waiting-owner' }, 'still waiting'), 'keep-waiting');
  assert.equal(lasoResumeDecision(null, 'done'), 'no-open-flow');
  const hold = lasoPurchaseHold(args, JSON.stringify(prepared));
  assert.equal(hold.args.action, 'x402');
  assert.equal(hold.args.amount, '10000000');
  assert.equal(hold.args.lasoTicket, prepared.lasoTicket);
  assert.equal(hold.args.destination, undefined);
  assert.match(hold.label, /Buy with Laso.*\$10/);
  // Fee-bearing quotes may exceed the requested face value; a short quote is rejected.
  const intlPrepared = { ...prepared, lasoAction: 'intl', proposal: { outflow: '259500000' } };
  const intlHold = lasoPurchaseHold({ ...args, amountUsd: '250', lasoAction: 'intl' }, JSON.stringify(intlPrepared));
  assert.equal(intlHold.args.amount, '259500000');
  assert.equal(lasoPurchaseHold({ ...args, amountUsd: '250', lasoAction: 'intl' }, JSON.stringify({ ...prepared, lasoAction: 'intl', proposal: { outflow: '240000000' } })), null);
  assert.equal(lasoPurchaseHold({ ...args, lasoAction: 'setup' }, JSON.stringify({ ...prepared, lasoAction: 'modify' })), null);
  for (const bad of [null, '', '{}', 'not json', { error: 'unavailable' }, { ...prepared, lasoTicket: '' }, { ...prepared, proposal: { outflow: '5000000' } }]) {
    assert.equal(lasoPurchaseHold(args, bad), null);
  }
});

test('yes and okay approved reuse the same sealed ticket; expiry and another owner cannot', async () => {
  const hold = sealAssetSpendHold(lasoPurchaseHold(args, prepared), context, 1000);
  const pending = { ...context, hold };
  for (const message of ['yes', 'okay approved', 'Yes!']) {
    assert.equal(pendingSpendConfirmation(pending, message, context, 2000), hold);
  }
  for (const message of ['', 'no', 'yes but make it 20 USDC']) {
    assert.equal(pendingSpendConfirmation(pending, message, context, 2000), null);
  }
  assert.equal(pendingSpendConfirmation(pending, 'yes', { ...context, ownerId: 'other' }, 2000), null);
  assert.equal(pendingSpendConfirmation(pending, 'yes', context, hold.expiresAt), null);
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
  const invoke = createChatToolInvoker({ ...context, ownerMessage: 'get a Laso non-reloadable USA card for 10 USDC', runtimeBase: 'https://runtime.invalid', fetcher: async (_url, init) => {
    calls++;
    assert.deepEqual(JSON.parse(init.body), { provider: 'laso', lasoAction: 'setup', amountUsd: '10' });
    return Response.json(prepared);
  } });
  await invoke('prepare_shopping', { ...args, amountUsd: 5 });
  assert.equal((await invoke('request_spend', { action: 'spend', destination: 'payTo' })).error, 'laso_requires_x402');
  assert.equal(calls, 1);
});

test('an undecided Laso card request asks reloadable or non-reloadable before quoting', async () => {
  let calls = 0;
  const invoke = createChatToolInvoker({ ...context, ownerMessage: 'get me a lasso card', runtimeBase: 'https://runtime.invalid', fetcher: async () => {
    calls++;
    return Response.json(prepared);
  } });
  const result = await invoke('prepare_shopping', { ...args, amountUsd: 10 });
  assert.equal(result.error, 'laso_card_choice_required');
  assert.match(result.hint, /Reloadable or non-reloadable USA/);
  assert.equal(calls, 0);
});

test('a reloadable Laso card request hands over the human steps instead of quoting prepaid', async () => {
  let calls = 0;
  const invoke = createChatToolInvoker({ ...context, ownerMessage: 'get me a laso finance reloadable card', runtimeBase: 'https://runtime.invalid', fetcher: async () => {
    calls++;
    return Response.json(prepared);
  } });
  const result = await invoke('prepare_shopping', { ...args, amountUsd: 10 });
  assert.equal(result.error, 'laso_reloadable_human_steps');
  assert.ok(result.steps.some((step) => /kyc/i.test(step)));
  assert.equal(calls, 0);
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

test('a named Laso reloadable request hands over the human steps even if the model omits or misnames the provider', async () => {
  for (const provider of [undefined, 'reloadable']) {
    let modelCalls = 0;
    const checkpointCalls = [];
    const invoke = createChatToolInvoker({ ...context, ownerMessage: 'get me a laso finance reloadable card', runtimeBase: 'https://runtime.invalid', fetcher: async (url, init) => {
      checkpointCalls.push(String(url));
      return Response.json({ ok: true });
    } });
    const reply = await completeTextChat({
      modelApiKey: 'LLM_1607358788850350_testsecretvalue', message: 'get me a laso finance reloadable card', botId: context.botId,
      tools: [{ type: 'function', function: { name: 'prepare_shopping', parameters: { type: 'object' } } }],
      fetcher: async () => {
        assert.equal(++modelCalls, 1);
        return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [
          { id: 'prepare', type: 'function', function: { name: 'prepare_shopping', arguments: JSON.stringify({ provider, type: 'reloadable' }) } },
        ] } }] });
      },
      invokeTool: async (name, inputs) => serializeToolResult(await invoke(name, inputs)),
    });
    assert.equal(reply.hold, undefined);
    assert.match(reply.text, /three steps first/);
    assert.match(reply.text, /verify-card-issuer-link/);
    assert.match(reply.text, /Reply done/);
    assert.equal(modelCalls, 1);
    assert.equal(checkpointCalls.length, 1);
    assert.match(checkpointCalls[0], /\/laso\/checkpoint$/);
  }
});

test('an undecided Laso card request asks the choice without a follow-up model call', async () => {
  let calls = 0;
  const checkpointCalls = [];
  const reply = await completeTextChat({
    modelApiKey: 'LLM_1607358788850350_testsecretvalue', message: 'get me a lasso card',
    tools: [{ type: 'function', function: { name: 'prepare_shopping', parameters: { type: 'object' } } }],
    fetcher: async () => {
      assert.equal(++calls, 1);
      return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [
        { id: 'prepare', type: 'function', function: { name: 'prepare_shopping', arguments: JSON.stringify(args) } },
      ] } }] });
    },
    invokeTool: async (name, inputs) => serializeToolResult(await createChatToolInvoker({
      ...context, ownerMessage: 'get me a lasso card', runtimeBase: 'https://runtime.invalid',
      fetcher: async (url) => {
        if (String(url).includes('/laso/checkpoint')) {
          checkpointCalls.push(String(url));
          return Response.json({ ok: true });
        }
        assert.fail('undecided cards must not quote');
      },
    })(name, inputs)),
  });
  assert.equal(reply.hold, undefined);
  assert.match(reply.text, /Reloadable or non-reloadable USA/);
  assert.equal(calls, 1);
  assert.equal(checkpointCalls.length, 1);
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

test('a reloadable request that only scrapes docs is nudged to prepare instead of stalling', async () => {
  let modelCalls = 0;
  const checkpointCalls = [];
  const ownerMessage = 'actually no, reloadable';
  const invoke = createChatToolInvoker({ ...context, ownerMessage, runtimeBase: 'https://runtime.invalid', fetcher: async (url) => {
    checkpointCalls.push(String(url));
    return Response.json({ ok: true });
  } });
  const tools = [
    { type: 'function', function: { name: 'web_scrape', parameters: { type: 'object' } } },
    { type: 'function', function: { name: 'prepare_shopping', parameters: { type: 'object' } } },
  ];
  const reply = await completeTextChat({
    modelApiKey: 'LLM_1607358788850350_testsecretvalue', message: ownerMessage, botId: context.botId,
    history: [{ role: 'user', content: 'hey make me a card' }, { role: 'user', content: 'non reloadable' }],
    tools,
    fetcher: async () => {
      modelCalls++;
      if (modelCalls === 1) {
        return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [
          { id: 'scrape', type: 'function', function: { name: 'web_scrape', arguments: JSON.stringify({ url: 'https://laso.finance/SKILL.md' }) } },
        ] } }] });
      }
      if (modelCalls === 2) {
        return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [
          { id: 'prepare', type: 'function', function: { name: 'prepare_shopping', arguments: JSON.stringify(args) } },
        ] } }] });
      }
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'stall' } }] });
    },
    invokeTool: async (name, inputs) => {
      if (name === 'web_scrape') return { page: { title: 'Laso docs' } };
      return serializeToolResult(await invoke(name, inputs));
    },
  });
  assert.equal(reply.hold, undefined);
  assert.match(reply.text, /three steps first/);
  assert.match(reply.text, /Reply done/);
  assert.equal(modelCalls, 2);
  assert.equal(checkpointCalls.length, 1);
});
