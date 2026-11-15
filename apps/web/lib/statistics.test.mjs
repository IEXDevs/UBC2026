import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDemoShellState } from './demo-state.mjs';
import { statisticsView, voiceMinutes } from './statistics.mjs';

test('statistics keeps voice minutes with the owner rollup', () => {
  assert.equal(voiceMinutes(0), 0);
  assert.equal(voiceMinutes(90_000), 1.5);
  const view = statisticsView({ bots: getDemoShellState().bots, ownerId: 'own_1', voiceMs: 120_000 });
  assert.equal(view.ownerRows[0].label, 'Mins on voice');
  assert.equal(view.ownerRows[0].value, 2);
  assert.equal(view.agents[0].label, 'Meteora');
  assert.equal(view.agents[0].rows.find(row => row.key === 'decisions').value, 2);
  assert.match(view.note, /devnet execution, mainnet pricing/);
  assert.equal(view.source, 'local');
});
