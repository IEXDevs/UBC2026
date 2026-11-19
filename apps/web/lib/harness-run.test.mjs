import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planConnectorUse, resolveDeskConnectors } from './connector-access.mjs';
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
 * Achieves: /vercel waits for the connector, a subagent is recorded, and a second delegate is refused.
 * Fails when: an unlinked vercel skill runs, or a subagent can delegate again.
 * Oracle: prepareOwnerTurn and runDelegatedAgent with a fake completion.
 * Side effects: module subagent board, cleared at the start.
 */
test('skills and subagents use the connected apps and stop at one handoff', async () => {
  clearSubagentResults();
  const blocked = prepareOwnerTurn('/vercel check the preview', []);
  assert.equal(blocked.error, 'connector_off');
  assert.match(blocked.reply, /Connect vercel/);
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

  const seen = [];
  const used = await dispatchHarness('use_connector', { connectorId: 'github', query: 'issues' }, {
    connectors: ['github'],
    invokeRaw: async (name, args) => {
      seen.push({ name, args });
      return { results: ['https://github.com/example'] };
    },
  });
  assert.equal(used.routedTo, 'web_search');
  assert.equal(seen[0].name, 'web_search');

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
});
