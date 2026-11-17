import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shoppingComparisonView } from './shopping-comparison.mjs';

/**
 * Achieves: verifies quality-ranked shopping view marks the proposal row and keeps the ask/next/outflow.
 * Fails when: first row is not the proposal, quality dropped, or ask/next missing.
 * Oracle: title Price and quality; rows[0] proposal solid quality 800; ask matches Ask before buy.
 * Side effects / state checked: N/A.
 * Gaps: none for sandbox quality ranking view.
 */
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

/**
 * Achieves: verifies price-only catalogs still surface a proposal without inventing quality.
 * Fails when: title is not Lowest price, or quality becomes a fake number.
 * Oracle: quality null; role proposal.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
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

/**
 * Achieves: verifies Laso challenges are not rendered as catalog comparisons.
 * Fails when: laso provider returns a comparison view object.
 * Oracle: shoppingComparisonView({ provider:'laso', ... }) === null.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('Laso challenges are not a catalog comparison', () => {
  assert.equal(shoppingComparisonView({ provider: 'laso', next: 'await-owner-mainnet-approval' }), null);
});
