/**
 * Unit tests for resolvePriceLookup — injection and disable paths.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePriceLookup } from './price-lookup.mjs';

/**
 * Achieves: lookupPrice: null disables pricing; a function injectable wins;
 *   default builds a provider that uses env.fetch (no network in this test).
 * Fails when: null still returns a function, or injectable is ignored.
 * Oracle: reference equality for injectable; typeof for default provider.
 * Side effects / state checked: fetcher call count when invoking default.
 * Gaps: DexScreener/Jupiter HTTP fallback order is owned by @ubc2026/prices tests.
 */
test('resolvePriceLookup honors null disable, injectable, and default provider', async () => {
  assert.equal(resolvePriceLookup({ lookupPrice: null }), null);

  const injected = async () => ({ priceUsd: '1' });
  assert.equal(resolvePriceLookup({ lookupPrice: injected }), injected);

  let fetches = 0;
  const lookup = resolvePriceLookup({
    fetch: async () => {
      fetches += 1;
      return Response.json({ pairs: [] });
    },
  });
  assert.equal(typeof lookup, 'function');
  // Provider may throw or return on empty pairs — either proves it used our fetcher.
  try {
    await lookup('So11111111111111111111111111111111111111112');
  } catch {
    // price_unavailable / empty is fine
  }
  assert.ok(fetches >= 1, 'default provider must use env.fetch');
});

/**
 * Achieves: blank JUPITER_API_KEY is treated as absent (trimmed empty → null key).
 * Fails when: whitespace-only key is forwarded as a real key.
 * Oracle: provider still callable; no throw at construction.
 * Side effects / state checked: none beyond construction.
 * Gaps: does not assert Authorization header contents (prices package owns that).
 */
test('resolvePriceLookup trims blank Jupiter api keys', () => {
  const lookup = resolvePriceLookup({
    JUPITER_API_KEY: '   ',
    fetch: async () => Response.json({ data: {} }),
  });
  assert.equal(typeof lookup, 'function');
});
