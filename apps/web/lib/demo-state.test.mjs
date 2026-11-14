import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDemoShellState } from './demo-state.mjs';

test('demo shell exposes locked panes and three builtin templates', () => {
  const state = getDemoShellState();
  assert.equal(state.product, 'Maelstrom');
  assert.equal(state.ownerId, null);
  assert.ok(state.panes.includes('Payments'));
  assert.equal(state.bots.length, 3);
  assert.equal(state.templates.length, 3);
  assert.ok(state.templates.every(t => t.deletable === false));
});
