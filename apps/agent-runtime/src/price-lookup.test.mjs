import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePriceLookup } from './price-lookup.mjs';

/**
 * Rigor audit — resolvePriceLookup injection rules
 * Achieves: null disables lookup; function inject wins; otherwise a provider is created.
 * Fails when: null still builds a provider or inject is ignored.
 * Oracle: documented env.lookupPrice contract.
 * Side effects: none (no network when inject/null).
 * Gaps: live DexScreener/Jupiter covered in @ubc2026/prices tests.
 */
test('resolvePriceLookup honors null disable and function inject', () => {
  assert.equal(resolvePriceLookup({ lookupPrice: null }), null);
  const fn = async () => 1;
  assert.equal(resolvePriceLookup({ lookupPrice: fn }), fn);
  const provider = resolvePriceLookup({ fetch: async () => new Response('{}') });
  assert.equal(typeof provider, 'function');
});
