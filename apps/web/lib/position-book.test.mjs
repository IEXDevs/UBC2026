import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDemoShellState } from './demo-state.mjs';
import { walletGlance } from './money-views.mjs';
import { bookFrame, layoutPositionBook, stepBubbleFollow } from './position-book.mjs';

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
