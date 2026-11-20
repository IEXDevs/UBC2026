import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cachedPortfolio, rememberPortfolio } from './portfolio-cache.mjs';

/**
 * Achieves: a portfolio can be shown again without waiting on the next read.
 * Fails when: a remembered book is dropped, or a blank key is stored.
 * Oracle: cachedPortfolio returns the same object; empty keys stay null.
 * Side effects / state checked: module map.
 * Gaps: does not expire entries.
 */
test('portfolio cache returns the last book for a key', () => {
  const book = { cluster: 'mainnet-beta', wallets: [] };
  assert.equal(cachedPortfolio(''), null);
  rememberPortfolio('owner-1', book);
  assert.equal(cachedPortfolio('owner-1'), book);
  rememberPortfolio('', book);
  assert.equal(cachedPortfolio(''), null);
});
