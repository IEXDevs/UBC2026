import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the billing address stays closed at the bottom of the cards sheet', () => {
  const source = readFileSync(new URL('../components/LasoCardsSheet.js', import.meta.url), 'utf8');
  const cards = source.indexOf('cards.map');
  const fold = source.indexOf('className="laso-billing-fold"');
  assert.ok(cards > 0 && fold > cards);
  assert.match(source, /<details className="laso-billing-fold">/);
  assert.match(source, /<strong>Billing address<\/strong>/);
  assert.match(source, /<ChevronDown /);
  assert.doesNotMatch(source, /<details[^>]*\sopen/);
});
