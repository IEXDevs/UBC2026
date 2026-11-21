import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDemoShellState } from './demo-state.mjs';
import { walletGlance } from './money-views.mjs';
import { bookFrame, layoutPositionBook, positionSceneKey, stepBubbleFollow } from './position-book.mjs';

/**
 * Achieves: verifies position book layout clusters venues, wires account/spoke links, and cash glance excludes borrow.
 * Fails when: demo card labels/summary drift, Kamino not clustered vs Drift, walletGlance includes borrow, or nodes leave frame.
 * Oracle: demo shell → 5 venues / 7 positions / pnl 6.02 USDC; glance balanceLabel '25 USDC'; venues logos under /venues/.
 * Side effects / state checked: layout derived from getDemoShellState(); no mutation of demo state asserted.
 * Gaps: depends on demo fixture numbers — fixture churn fails this test intentionally.
 */
test('the position book clusters venues and keeps borrow out of the cash glance', () => {
  const state = getDemoShellState();
  const book = layoutPositionBook(state.positions, state.bots, state.wallets);
  assert.equal(book.cards[0].amountLabel, '25 USDC');
  assert.equal(book.cards[0].pnlLabel, '-1.5 USDC');
  assert.equal(book.cards[0].apyLabel, '4.12%');
  assert.equal(book.summary.venues, 5);
  assert.equal(book.summary.count, 7);
  assert.equal(book.summary.pnlLabel, '6.02 USDC');
  const kamino = book.cards.filter(card => card.venue === 'Kamino');
  const drift = book.cards.find(card => card.venue === 'Drift');
  assert.equal(book.links.filter(link => link.kind === 'account' && link.walletId === 'wallet_main').length, 4);
  assert.equal(book.links.filter(link => link.kind === 'account' && link.walletId === 'wallet_shop').length, 2);
  assert.equal(book.links.filter(link => link.kind === 'shared').length, 1);
  assert.equal(book.accounts.length, 6);
  const mainWeb = book.webs.find(web => web.id === 'wallet_main');
  assert.ok(mainWeb.nodes.includes('wallet_main'));
  assert.ok(mainWeb.nodes.includes('wallet_main_Kamino'));
  assert.ok(book.wallets[0].y > book.accounts[0].y);
  assert.ok(book.accounts[0].y > book.cards.find(card => card.venue === 'Kamino').y);
  assert.equal(book.links.filter(link => link.kind === 'spoke').length, 7);
  assert.ok(book.links.filter(link => link.kind === 'spoke').every(link => link.cardId));
  assert.ok(book.venues.every(venue => venue.logo.startsWith('/venues/')));
  assert.equal(kamino.length, 2);
  assert.ok(Math.abs(kamino[0].x - kamino[1].x) < Math.abs(kamino[0].x - drift.x));
  assert.equal(walletGlance(state.wallets, state.positions).balanceLabel, '25 USDC');
  const frame = bookFrame(book);
  for (const wallet of book.wallets) {
    assert.ok(wallet.x > frame.minX && wallet.x < frame.maxX);
    assert.ok(wallet.y > frame.minY && wallet.y < frame.maxY);
  }
  for (const venue of book.venues) {
    assert.ok(venue.x > frame.minX && venue.x < frame.maxX);
  }
});

/**
 * Achieves: verifies bubble follow trails nearer nodes first, settles offsets, and leaves pinned/unlinked nodes alone.
 * Fails when: neighbor moves ≤ farther, pin/null-lag nodes move, or settle never reaches remain < 1.
 * Oracle: after one 16ms step neighbor in (4,30); after 140 steps b≈-20 c≈80; a/z unchanged.
 * Side effects / state checked: nodes array mutated in place by stepBubbleFollow.
 * Gaps: physics tolerances only — not pixel-perfect to UI spring constants beyond lag fields.
 */
test('linked nodes trail a drag and farther ones follow behind', () => {
  const nodes = [
    { id: 'a', x: -120, y: 0, pin: true, lag: 0, ox: 0, oy: 0 },
    { id: 'b', x: 100, y: 0, pin: false, lag: 1, ox: 100, oy: 0 },
    { id: 'c', x: 200, y: 0, pin: false, lag: 2, ox: 200, oy: 0 },
    { id: 'z', x: 800, y: 0, pin: false, lag: null, ox: 0, oy: 0 },
  ];
  stepBubbleFollow(nodes, 16);
  const neighbor = 100 - nodes[1].x;
  const farther = 200 - nodes[2].x;
  assert.ok(neighbor > 4 && neighbor < 30, `neighbor should trail, moved ${neighbor}`);
  assert.ok(farther > 0 && farther < neighbor, `farther node should be behind, moved ${farther}`);
  assert.equal(nodes[0].x, -120);
  assert.equal(nodes[3].x, 800);
  let remain = 1;
  for (let i = 0; i < 140; i += 1) remain = stepBubbleFollow(nodes, 16);
  assert.ok(remain < 1, `follow should settle, remain ${remain}`);
  assert.ok(Math.abs(nodes[1].x - (-20)) < 1.5, `b caught up, got ${nodes[1].x}`);
  assert.ok(Math.abs(nodes[2].x - 80) < 1.5, `c caught up behind b, got ${nodes[2].x}`);
  assert.equal(nodes[3].x, 800);
  assert.equal(nodes[0].x, -120);
});

test('wallets without positions keep their cards apart', () => {
  const wallets = [
    { id: 'wallet_a', label: 'Preview', address: 'A'.repeat(44) },
    { id: 'wallet_b', label: 'Shop', address: 'B'.repeat(44) },
  ];
  const book = layoutPositionBook([], [], wallets);
  const [left, right] = book.wallets;
  assert.ok(right.x - left.x >= 240, `wallet roots ${right.x - left.x}px apart`);
});

test('the graph links each agent to its wallet and puts unassigned agents on Main', () => {
  const wallets = [
    { id: 'main', kind: 'main', label: 'Main' },
    { id: 'shop', kind: 'additional', label: 'Shop' },
  ];
  const bots = [
    { id: 'bot_ada', name: 'Ada', walletId: 'shop' },
    { id: 'bot_lee', name: 'Lee' },
    { id: 'bot_sam', name: 'Sam', walletId: 'unavailable' },
  ];
  const book = layoutPositionBook([], bots, wallets);
  assert.deepEqual(book.agents.map(agent => [agent.id, agent.walletId]), [['agent:bot_lee', 'main'], ['agent:bot_ada', 'shop']]);
  assert.deepEqual(book.links.map(link => [link.kind, link.fromId, link.toId]), [
    ['agent', 'main', 'agent:bot_lee'], ['agent', 'shop', 'agent:bot_ada'],
  ]);
  for (const agent of book.agents) {
    const wallet = book.wallets.find(item => item.id === agent.walletId);
    assert.ok(agent.y > wallet.y + wallet.height / 2);
    assert.ok(bookFrame(book).maxY >= agent.y + agent.height / 2);
  }
  const reassigned = layoutPositionBook([], [{ ...bots[0], walletId: 'main' }, ...bots.slice(1)], wallets);
  assert.notEqual(positionSceneKey(book), positionSceneKey(reassigned));
});

test('a single large holding leaves room for its outline at every edge', () => {
  const book = layoutPositionBook([], [], [{ id: 'main', label: 'Main' }], [
    { walletId: 'main', asset: 'SOL', notionalMicroUsdc: '100000000' },
  ]);
  const wallet = book.wallets[0];
  const [{ x, y, r }] = wallet.bubbles;
  assert.ok(x - r >= 2 && x + r <= wallet.bubbleWidth - 2);
  assert.ok(y - r >= 2 && y + r <= wallet.bubbleHeight - 2);
});

test('a price refresh updates holdings without changing the scene when geometry matches', () => {
  const wallets = [{ id: 'main', label: 'Main' }];
  const sol = { id: 'sol', walletId: 'main', asset: 'SOL', amount: '1000000000', decimals: 9 };
  const initial = layoutPositionBook([], [], wallets, [{ ...sol, notionalMicroUsdc: '100000000' }]);
  const refreshed = layoutPositionBook([], [], wallets, [{ ...sol, notionalMicroUsdc: '110000000' }]);
  const added = layoutPositionBook([], [], [...wallets, { id: 'extra', label: 'Extra' }]);
  assert.equal(positionSceneKey(initial), positionSceneKey(refreshed));
  assert.notEqual(positionSceneKey(initial), positionSceneKey(added));
  assert.equal(initial.wallets[0].bubbles[0].valueLabel, '$100');
  assert.equal(refreshed.wallets[0].bubbles[0].valueLabel, '$110');
});
