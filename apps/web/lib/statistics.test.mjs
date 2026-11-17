import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDemoShellState } from './demo-state.mjs';
import { profileStats, statisticsView, voiceMinutes } from './statistics.mjs';

/*
 * Achieves: verifies owner statistics rollup includes voice minutes and local demo agent rows.
 * Fails when: ms→minutes wrong, Mins on voice missing, or source is not local for demo bots.
 * Oracle: 90_000ms→1.5; 120_000ms→2 mins; first agent Meteora with decisions=2.
 * Side effects / state checked: N/A.
 * Gaps: none for view builder.
 */
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

/*
 * Achieves: verifies profile stats count voice, messages, tokens, spend, and net flow.
 * Fails when: voice formatting wrong, user-only messages miscounted, or spend/pnl ignore demo payments.
 * Oracle: 12400ms→12s; 1 user message; token estimate 4 or explicit 128; spent/pnl from demo payments.
 * Side effects / state checked: N/A.
 * Gaps: none for profileStats arithmetic against demo fixtures.
 */
test('profile stats count talk seconds, messages, tokens, spend, and net flow', () => {
  const rows = profileStats({
    voiceMs: 12_400,
    talks: { bot_meteora: [{ role: 'user', text: 'hello there' }, { role: 'agent', text: 'hi' }] },
    payments: getDemoShellState().payments,
  });
  assert.equal(rows.find(row => row.key === 'voice').value, '12s');
  assert.equal(rows.find(row => row.key === 'messages').value, '1');
  assert.equal(rows.find(row => row.key === 'tokens').value, '4');
  const reported = profileStats({
    talks: { bot_meteora: [{ role: 'agent', text: 'hi', tokens: 128 }] },
  });
  assert.equal(reported.find(row => row.key === 'tokens').value, '128');
  assert.equal(rows.find(row => row.key === 'spent').value, '10.01 USDC');
  assert.equal(rows.find(row => row.key === 'pnl').value, '−7.76 USDC');
});
