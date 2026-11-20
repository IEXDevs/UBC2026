import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDemoShellState, panePlaceholder } from './demo-state.mjs';

/**
 * Achieves: verifies demo shell product chrome, three bots, builtin connectors, and pane copy.
 * Fails when: product/ownerId/panes drift, bot/template counts change, or Overview/Security copy flips.
 * Oracle: Maelstrom + null owner; panes Main/Positions/History; five named builtins; templates undeletable.
 * Side effects / state checked: N/A (pure fixture).
 * Gaps: none for fixture shape; live runtime bots are covered elsewhere.
 */
test('demo shell exposes locked panes and three builtin templates', () => {
  const state = getDemoShellState();
  assert.equal(state.product, 'Maelstrom');
  assert.equal(state.ownerId, null);
  assert.deepEqual(state.panes, ['Main', 'Positions', 'History']);
  assert.equal(state.bots.length, 3);
  assert.deepEqual(
    state.connectors.filter(item => item.builtin).map(item => item.name),
    ['Solana', 'Privy', 'Firecrawl', 'Browser Run', 'x402'],
  );
  assert.ok(state.connectors.every(item => item.botId == null));
  assert.equal(state.templates.length, 3);
  assert.ok(state.templates.every(t => t.deletable === false));
  assert.deepEqual(panePlaceholder('Overview'), { title: 'Overview', body: 'Owner metrics.' });
  assert.deepEqual(panePlaceholder('Security'), { title: 'Security', body: 'Kill switch and freezes.' });
  for (const name of ['Payments', 'Positions', 'Wallets']) {
    assert.deepEqual(panePlaceholder(name), { title: name, body: 'Empty.' });
  }
  assert.deepEqual(panePlaceholder('UnknownPane'), { title: 'UnknownPane', body: 'Empty.' });
});
