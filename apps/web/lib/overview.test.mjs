import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBotStats,
  buildOverview,
  emptyMetric,
  formatPnlMicroUsdc,
  metricsUrl,
  pickOwnerRollup,
} from './overview.mjs';
import { getDemoShellState } from './demo-state.mjs';

/*
 * Achieves: verifies metrics URL stays on the runtime origin and rejects empty/javascript bases.
 * Fails when: javascript: or empty base produce a URL, or /api/metrics path drifts.
 * Oracle: https runtime → .../api/metrics; '' and javascript:alert(1) → null.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('metrics URL stays on the runtime origin', () => {
  assert.equal(metricsUrl('https://runtime.example/agent/'), 'https://runtime.example/agent/api/metrics');
  assert.equal(metricsUrl('javascript:alert(1)'), null);
  assert.equal(metricsUrl(''), null);
});

/*
 * Achieves: verifies overview builds owner cards from demo bots.
 * Fails when: overview builds owner cards from demo bots breaks (e.g. expected 3, 7, 'local').
 * Oracle: assert.equal(overview.botCount, 3); assert.equal(overview.cards.length, 7); assert.equal(overview.source, 'local'); assert.ok(overview.cards.every((c)
 * Side effects / state checked: N/A.
 * Gaps: tied to demo fixture counts.
 */
test('overview builds owner cards from demo bots', () => {
  const state = getDemoShellState();
  const overview = buildOverview({ bots: state.bots, ownerId: 'own_1' });
  assert.equal(overview.botCount, 3);
  assert.equal(overview.cards.length, 7);
  assert.equal(overview.source, 'local');
  assert.ok(overview.cards.every((c) => typeof c.value === 'number'));
});

/*
 * Achieves: verifies each bot carries its own stats.
 * Fails when: each bot carries its own stats breaks (e.g. expected state.bots[0].name, 7, 2).
 * Oracle: assert.equal(meteora.name, state.bots[0].name); assert.equal(meteora.cards.length, 7); assert.equal(meteora.cards.find((card) => card.key === 'decisions').value, 2); assert.equal(guard.cards.find((card) => card.key === 'mismatchesCaught').value, 1)
 * Side effects / state checked: N/A.
 * Gaps: tied to demo fixture counts.
 */
test('each bot carries its own stats', () => {
  const state = getDemoShellState();
  const meteora = buildBotStats(state.bots[0]);
  const guard = buildBotStats(state.bots[2]);
  assert.equal(meteora.name, state.bots[0].name);
  assert.equal(meteora.cards.length, 7);
  assert.equal(meteora.cards.find((card) => card.key === 'decisions').value, 2);
  assert.equal(guard.cards.find((card) => card.key === 'mismatchesCaught').value, 1);
});

/*
 * Achieves: verifies pickOwnerRollup validates remote payload and formats pnl.
 * Fails when: pickOwnerRollup validates remote payload and formats pnl breaks (e.g. expected 4, '−2.5 USDC', '0 USDC'); failure/null paths flip.
 * Oracle: assert.equal(rollup.decisions, 4); assert.equal(formatPnlMicroUsdc(rollup.pnlMicroUsdc), '−2.5 USDC'); assert.equal(formatPnlMicroUsdc(emptyMetric().pnlMicroUsdc), '0 USDC'); assert.equal(pickOwnerRollup({ stub: true }, 'own_1')
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('pickOwnerRollup validates remote payload and formats pnl', () => {
  const rollup = pickOwnerRollup({
    items: [{
      id: 'metric_1',
      ownerId: 'own_1',
      botId: null,
      decisions: 4,
      transactionsExecuted: 2,
      mismatchesCaught: 1,
      transactionsBlocked: 0,
      approvalsRequested: 3,
      approvalsGranted: 1,
      x402Payments: 1,
      pnlMicroUsdc: '-2500000',
    }],
  }, 'own_1');
  assert.equal(rollup.decisions, 4);
  assert.equal(formatPnlMicroUsdc(rollup.pnlMicroUsdc), '−2.5 USDC');
  assert.equal(formatPnlMicroUsdc(emptyMetric().pnlMicroUsdc), '0 USDC');
  assert.equal(pickOwnerRollup({ stub: true }, 'own_1'), null);
});
