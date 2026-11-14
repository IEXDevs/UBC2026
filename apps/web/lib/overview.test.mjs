import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOverview,
  emptyMetric,
  formatPnlMicroUsdc,
  metricsUrl,
  pickOwnerRollup,
} from './overview.mjs';
import { getDemoShellState } from './demo-state.mjs';

test('metrics URL stays on the runtime origin', () => {
  assert.equal(metricsUrl('https://runtime.example/agent/'), 'https://runtime.example/agent/api/metrics');
  assert.equal(metricsUrl('javascript:alert(1)'), null);
});

test('overview builds owner cards from demo bots', () => {
  const state = getDemoShellState();
  const overview = buildOverview({ bots: state.bots, ownerId: 'own_1' });
  assert.equal(overview.botCount, 3);
  assert.equal(overview.cards.length, 7);
  assert.equal(overview.source, 'local');
  assert.ok(overview.cards.every((c) => typeof c.value === 'number'));
});

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
