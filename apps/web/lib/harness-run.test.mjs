import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planConnectorUse, resolveDeskConnectors } from './connector-access.mjs';
import { toolAccessRequest } from './spend-permission.mjs';
import {
  claimVoiceLock,
  refreshVoiceLock,
  releaseVoiceLock,
  voiceLockHolder,
} from './voice-lock.mjs';
import {
  clearSubagentResults,
  readSubagentResults,
} from './subagent-board.mjs';
import {
  dispatchHarness,
  prepareOwnerTurn,
  runDelegatedAgent,
  stampSpendPermission,
} from './harness-run.mjs';

function memory() {
  const bag = new Map();
  return {
    getItem: (key) => (bag.has(key) ? bag.get(key) : null),
    setItem: (key, value) => bag.set(key, String(value)),
    removeItem: (key) => bag.delete(key),
  };
}

test('bound spend approval stamping defaults only the bot ID and preserves the matching idempotency key', () => {
  const botId = 'bot_current';
  const args = { action: 'pay', asset: 'SOL', amount: '1000000000', destination: '11111111111111111111111111111111' };
  for (const grantHasBot of [false, true]) {
    const hold = toolAccessRequest('ask', 'request_spend', { ...args, ...(grantHasBot ? { botId } : {}) });
    const options = { botId, permissionMode: 'ask', confirmSpend: true, grants: [hold] };
    const approved = stampSpendPermission('request_spend', args, options);
    assert.equal(approved.botId, botId);
    assert.equal(approved.confirmed, true);
    assert.equal(approved.idempotencyKey, hold.idempotencyKey);
    for (const change of [{ botId: 'bot_other' }, { amount: '2000000000' }, { destination: '22222222222222222222222222222222' }]) {
      const rejected = stampSpendPermission('request_spend', { ...args, ...change }, options);
      assert.equal(rejected.confirmed, undefined);
      assert.equal(rejected.idempotencyKey, undefined);
    }
  }
});

test('a non-USDC spend uses the idempotency key from its matching approval', () => {
  const sol = { botId: 'bot_test', action: 'pay', asset: 'SOL', amount: '1000000000', handle: 'alice' };
  const hold = toolAccessRequest('full', 'request_spend', sol);
  const options = { permissionMode: 'full', confirmSpend: true, grants: [hold] };
  const approved = stampSpendPermission('request_spend', { ...sol, idempotencyKey: 'model-supplied' }, options);
  assert.equal(approved.confirmed, true);
  assert.equal(approved.idempotencyKey, hold.idempotencyKey);
  const changed = stampSpendPermission('request_spend', { ...sol, amount: '2000000000' }, options);
  assert.equal(changed.confirmed, undefined);
  assert.equal(changed.idempotencyKey, undefined);
});

/**
 * Achieves: built-in connectors stay on, and a linked app can be used automatically.
 * Fails when: vercel is on without a link, or firecrawl drops off the desk.
 * Oracle: resolveDeskConnectors([]) and planConnectorUse.
 * Side effects: none.
 */
test('connected apps stay shared and firecrawl is always on', () => {
  const desk = resolveDeskConnectors(['vercel', 'nope', 'vercel']);
  assert.ok(desk.some(row => row.id === 'firecrawl'));
  assert.ok(desk.some(row => row.id === 'vercel'));
  assert.equal(desk.filter(row => row.id === 'vercel').length, 1);
  assert.equal(desk.some(row => row.id === 'nope'), false);
  const plan = planConnectorUse(['vercel'], { connectorId: 'vercel', query: 'preview' });
  assert.equal(plan.tool, 'web_search');
  assert.match(plan.args.query, /site:vercel\.com/);
  assert.equal(planConnectorUse([], { connectorId: 'slack' }).error, 'connector_off');
});

/**
 * Achieves: a second voice call is refused while the first agent still holds the lock.
 * Fails when: agent 2 can claim during agent 1's heartbeat window.
 * Oracle: claimVoiceLock timestamps.
 * Side effects: memory storage only.
 */
test('one voice call can be live at a time', () => {
  const storage = memory();
  const first = claimVoiceLock(storage, { botId: 'bot_1', name: 'Agent 1', now: 1_000 });
  assert.equal(first.ok, true);
  const second = claimVoiceLock(storage, { botId: 'bot_2', name: 'Agent 2', now: 2_000 });
  assert.equal(second.ok, false);
  assert.equal(second.holder.name, 'Agent 1');
  assert.equal(refreshVoiceLock(storage, 'bot_2', 3_000).ok, false);
  assert.equal(voiceLockHolder(storage, 3_000).botId, 'bot_1');
  assert.equal(releaseVoiceLock(storage, 'bot_1').ok, true);
  assert.equal(claimVoiceLock(storage, { botId: 'bot_2', name: 'Agent 2', now: 4_000 }).ok, true);
});

/**
 * Achieves: slash skills run without a plugin gate, a subagent is recorded, and a second delegate is refused.
 * Fails when: /vercel asks to connect an app, or a subagent can delegate again.
 * Oracle: prepareOwnerTurn and runDelegatedAgent with a fake completion.
 * Side effects: module subagent board, cleared at the start.
 */
test('skills and subagents use the connected apps and stop at one handoff', async () => {
  clearSubagentResults();
  const vercel = prepareOwnerTurn('/vercel check the preview', ['vercel']);
  assert.equal(vercel.skillId, 'vercel');
  assert.equal(vercel.message, 'check the preview');
  assert.doesNotMatch(vercel.instruction, /connectors page|Connected apps|use_connector/);
  const ready = prepareOwnerTurn('/goal ship the header', ['vercel']);
  assert.equal(ready.skillId, 'goal');
  assert.equal(ready.message, 'ship the header');
  const idle = prepareOwnerTurn('just chat', []);
  assert.equal(idle.skillId, '');
  assert.doesNotMatch(idle.instruction, /Skill \/domain-modeling/);
  const called = prepareOwnerTurn('/domain-modeling name the wallet', []);
  assert.equal(called.skillId, 'domain-modeling');
  assert.equal(called.message, 'name the wallet');
  assert.match(called.instruction, /Skill \/domain-modeling/);
  assert.match(called.instruction, /Local time:/);
  assert.match(called.instruction, /Place is not set/);
  const placed = prepareOwnerTurn('weather near me', [], {
    timeZone: 'America/Chicago',
    place: 'Austin, Texas',
    locale: 'en-US',
  }, new Date('2026-11-19T16:33:00.000Z'));
  assert.match(placed.instruction, /Place: Austin, Texas/);
  assert.match(placed.instruction, /November 19, 2026/);
  assert.match(placed.instruction, /Language: en-US/);

  const used = await dispatchHarness('use_connector', { connectorId: 'github', query: 'issues' }, {
    connectors: ['github'],
    invokeRaw: async () => ({ results: ['https://github.com/example'] }),
  });
  assert.equal(used, null);

  const delegated = await runDelegatedAgent({
    ownerId: 'user_1',
    botId: 'bot_1',
    connectors: ['github'],
    depth: 0,
    complete: async () => ({ text: 'Found the repo.' }),
    invokeRaw: async () => ({ ok: true }),
  }, { task: 'look at the repo', skill: 'github' });
  assert.equal(delegated.ok, true);
  assert.equal(readSubagentResults('user_1', 'bot_1')[0].reply, 'Found the repo.');

  const nested = await dispatchHarness('delegate_task', { task: 'again' }, {
    ownerId: 'user_1',
    botId: 'bot_1',
    connectors: [],
    depth: 1,
    complete: async () => ({ text: 'no' }),
    invokeRaw: async () => ({}),
  });
  assert.equal(nested.error, 'delegate_depth');

  const review = stampSpendPermission('request_spend', { amount: '10', reviewCap: '999' }, {
    permissionMode: 'review',
    reviewCap: '25000000',
    confirmSpend: false,
  });
  assert.equal(review.reviewCap, '25000000');
  assert.equal(review.confirmed, undefined);
  const ask = stampSpendPermission('request_spend', { amount: '10' }, {
    permissionMode: 'ask',
    confirmSpend: true,
  });
  assert.equal(ask.confirmed, true);
  assert.equal(ask.permission, 'ask');
  assert.equal(ask.reviewCap, '30000000');
  const fullOver = stampSpendPermission('request_spend', { amount: '40000000' }, {
    permissionMode: 'full',
    confirmSpend: true,
  });
  assert.equal(fullOver.confirmed, true);
  assert.equal(fullOver.reviewCap, '30000000');
  const fullUnder = stampSpendPermission('request_spend', { amount: '5000000' }, {
    permissionMode: 'full',
    reviewCap: '25000000',
    confirmSpend: true,
  });
  assert.equal(fullUnder.confirmed, undefined);
  assert.equal(fullUnder.reviewCap, '25000000');
});

test(`plain-word card asks auto-attach the laso playbook without a slash command`, () => {
  const attached = prepareOwnerTurn(`make me a laso card for $10 dominos`, []);
  assert.equal(attached.skillId, `laso-cards`);
  assert.equal(attached.autoSkill, true);
  assert.equal(attached.message, `make me a laso card for $10 dominos`);
  assert.match(attached.instruction, /Skill \/laso-cards/);
  assert.match(attached.instruction, /attached automatically/);
  const plain = prepareOwnerTurn(`just chat`, []);
  assert.equal(plain.skillId, ``);
  assert.equal(plain.autoSkill, undefined);
  const slashed = prepareOwnerTurn(`/laso-cards make me a card`, []);
  assert.equal(slashed.skillId, `laso-cards`);
  assert.equal(slashed.autoSkill, undefined);
});
