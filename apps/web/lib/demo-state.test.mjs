import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDemoShellState, panePlaceholder } from './demo-state.mjs';

test('demo shell exposes locked panes and three builtin templates', () => {
  const state = getDemoShellState();
  assert.equal(state.product, 'Maelstrom');
  assert.equal(state.ownerId, null);
  assert.deepEqual(state.panes, ['Main', 'Positions', 'Plugins', 'History']);
  assert.equal(state.bots.length, 3);
  assert.deepEqual(
    state.connectors.filter(item => item.builtin).map(item => item.name),
    ['Solana', 'Privy', 'Firecrawl', 'Browser Run', 'x402'],
  );
  assert.ok(state.connectors.every(item => item.botId == null));
  assert.equal(state.templates.length, 3);
  assert.ok(state.templates.every(t => t.deletable === false));
  for (const name of state.panes) {
    assert.deepEqual(panePlaceholder(name), { title: name, body: 'Empty.' });
  }
});
