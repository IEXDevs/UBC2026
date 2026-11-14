import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDemoShellState } from './demo-state.mjs';
import { groupConnectors, withSharedLinks } from './connectors.mjs';

test('connectors stay one shared set and group like a catalog', () => {
  const state = getDemoShellState();
  assert.ok(state.connectors.every(item => item.botId == null));
  assert.ok(state.connectors.filter(item => item.builtin).every(item => item.linked));
  const rows = withSharedLinks(state.connectors, ['github']);
  assert.equal(rows.find(item => item.id === 'github').linked, true);
  assert.equal(rows.find(item => item.id === 'slack').linked, false);
  const idle = groupConnectors(rows, '');
  assert.ok(idle.linked.some(item => item.id === 'solana'));
  assert.ok(idle.linked.some(item => item.id === 'github'));
  assert.deepEqual(idle.available.map(item => item.id), ['gmail', 'slack', 'notion', 'gcal']);
  const found = groupConnectors(rows, 'git');
  assert.deepEqual(found.available.map(item => item.id), []);
  assert.deepEqual(found.linked.map(item => item.id), ['github']);
});
