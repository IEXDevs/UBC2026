import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createAgentRemoval } from './agent-removal.mjs';

test('removing an agent hides its card immediately and waits for its pending save', async () => {
  let hidden = new Map();
  let deleted = false;
  const removal = createAgentRemoval(next => { hidden = next; });
  let resolveSave;
  const save = new Promise(resolve => { resolveSave = resolve; });
  const saved = removal.save('alice', 'bot_1', () => save);
  const removed = removal.remove('alice', 'bot_1', async () => {
    deleted = true;
    return { ok: true };
  });
  assert.equal(hidden.get('alice')?.has('bot_1'), true);
  assert.equal(hidden.has('bob'), false);
  assert.equal(deleted, false);
  assert.deepEqual(await removal.save('alice', 'bot_1', () => assert.fail('recreated deleted agent')), {
    ok: false, error: 'agent_removed',
  });
  resolveSave({ ok: true });
  await saved;
  assert.deepEqual(await removed, { ok: true });
  assert.equal(deleted, true);
  assert.equal(hidden.get('alice')?.has('bot_1'), true);
});

test('a rejected delete restores the original agent and allows a retry', async () => {
  let hidden = new Map();
  const removal = createAgentRemoval(next => { hidden = next; });
  const attempt = removal.remove('alice', 'bot_1', async () => ({ ok: false }));
  assert.equal(hidden.get('alice')?.has('bot_1'), true);
  assert.deepEqual(await attempt, { ok: false });
  assert.equal(hidden.has('alice'), false);
  assert.deepEqual(await removal.remove('alice', 'bot_1', async () => ({ ok: true })), { ok: true });
});

test('the desk filters removed agents out of the merged local and remote cards', () => {
  const page = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');
  assert.match(page, /createAgentRemoval\(setRemovedAgents\)/);
  assert.match(page, /const removedIds = removedAgents.get\(ownerId\)/);
  assert.match(page, /return order.filter\(id => !removedIds\?\.has\(id\)\)\.map/);
  assert.match(page, /const removal = agentRemoval.remove\(ownerId, id,/);
});
