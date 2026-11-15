import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shoppingComparisonView } from './shopping-comparison.mjs';

test('shows the quality-ranked proposal and keeps the ask', () => {
  const view = shoppingComparisonView({
    provider: 'sandbox',
    next: 'await-owner-approval',
    pick: { comparison: 'price-and-quality', reason: 'best quality per sandbox price (800/1000)' },
    proposal: { id: 'prop_bot_solid', outflow: '4000' },
    ranked: [
      { id: 'solid', name: 'Solid sticker', price: '4000', quality: '800' },
      { id: 'cheap', name: 'Thin sticker', price: '1000', quality: '100' },
    ],
  });
  assert.equal(view.title, 'Price and quality');
  assert.equal(view.rows[0].role, 'proposal');
  assert.equal(view.rows[0].id, 'solid');
  assert.equal(view.rows[0].quality, '800');
  assert.equal(view.rows[1].role, 'compared');
  assert.match(view.ask, /Ask before buy/);
  assert.equal(view.next, 'await-owner-approval');
  assert.equal(view.outflow, '4000');
});

test('a price-only catalog still lists the cheapest proposal', () => {
  const view = shoppingComparisonView({
    pick: { comparison: 'price', reason: 'lowest sandbox price' },
    ranked: [{ id: 'b', name: 'B', price: '1000' }],
    proposal: { id: 'prop_b', outflow: '1000' },
  });
  assert.equal(view.title, 'Lowest price');
  assert.equal(view.rows[0].quality, null);
  assert.equal(view.rows[0].role, 'proposal');
});

test('Laso challenges are not a catalog comparison', () => {
  assert.equal(shoppingComparisonView({ provider: 'laso', next: 'await-owner-mainnet-approval' }), null);
});
