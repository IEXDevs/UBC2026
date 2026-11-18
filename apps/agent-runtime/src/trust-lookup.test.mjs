/**
 * Unit tests for resolveTrustLookup — injection, disable, and the Jupiter search call.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTrustLookup } from './trust-lookup.mjs';

const MINT = 'So11111111111111111111111111111111111111112';

/**
 * Achieves: trustLookup: null disables the provider; an injected function wins;
 *   the default calls Jupiter Tokens API v2 search and does not keep the API key.
 * Fails when: null still returns a function, the injectable is ignored, or the
 *   search URL/header is wrong.
 * Oracle: reference equality for the injectable; jup.ag tokens/v2 search URL.
 * Side effects / state checked: fetcher call count and x-api-key header.
 * Gaps: score penalties live in @ubc2026/trust-score.
 */
test('resolveTrustLookup honors null, an injectable, and Jupiter search', async () => {
  assert.equal(resolveTrustLookup({ trustLookup: null }), null);

  const injected = async () => ({ score: '800', source: 'jupiter-tokens-v2' });
  assert.equal(resolveTrustLookup({ trustLookup: injected }), injected);

  const calls = [];
  const lookup = resolveTrustLookup({
    JUPITER_API_KEY: 'jupiter-test-key',
    fetch: async (url, options) => {
      calls.push({ url: String(url), key: options?.headers?.['x-api-key'] ?? null });
      return Response.json([{
        id: MINT,
        organicScore: 80,
        isVerified: true,
        audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true },
      }]);
    },
  });
  const result = await lookup(MINT);
  assert.equal(result.score, '800');
  assert.equal(result.source, 'jupiter-tokens-v2');
  assert.equal(result.decision.state, 'allowed');
  assert.equal(result.decision.threshold, '400');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/api\.jup\.ag\/tokens\/v2\/search\?query=/);
  assert.equal(calls[0].key, 'jupiter-test-key');
  assert.equal(JSON.stringify(result).includes('jupiter-test-key'), false);
});

/**
 * Achieves: a blank Jupiter key is omitted, and a failed search does not invent a score.
 * Fails when: whitespace is sent as a key, or a failed response still returns a score.
 * Oracle: header absent; provider error code.
 * Side effects / state checked: fetcher headers.
 * Gaps: none.
 */
test('resolveTrustLookup drops a blank key and refuses a failed Jupiter response', async () => {
  let header;
  const lookup = resolveTrustLookup({
    JUPITER_API_KEY: '   ',
    fetch: async (_url, options) => {
      header = options?.headers?.['x-api-key'];
      return new Response('no', { status: 503 });
    },
  });
  await assert.rejects(lookup(MINT), (error) => error.code === 'provider_failed');
  assert.equal(header, undefined);
});
