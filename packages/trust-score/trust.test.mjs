import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  evaluateTrust,
  createTrustScoreProvider,
  createJupiterTrustProvider,
  createFileTrustStorage,
  scoreFromJupiterToken,
  normalizeScore,
} from './trust.mjs';

const mint = 'So11111111111111111111111111111111111111112';

/**
 * Achieves: normalizeScore accepts ints/digit strings in range and rejects >1000 or decimals.
 * Fails when: Out-of-range or fractional scores normalize instead of throw.
 * Oracle: Trust score domain 0–1000 integer strings.
 * Side effects: none
 * Gaps: none meaningful
 */
test('scores normalize to integer strings from 0 to 1000', () => {
  assert.equal(normalizeScore(400), '400');
  assert.equal(normalizeScore('0'), '0');
  assert.equal(normalizeScore(1000), '1000');
  assert.equal(normalizeScore('1000'), '1000');
  assert.throws(() => normalizeScore(1001));
  assert.throws(() => normalizeScore(-1));
  assert.throws(() => normalizeScore('4.5'));
});

/**
 * Achieves: Scores at or above the default threshold return allowed without confirmation.
 * Fails when: Score 400 still requires confirmation, or high scores are blocked.
 * Oracle: Default threshold 400 gate (inclusive).
 * Side effects: none
 * Gaps: none meaningful
 */
test('high trust scores are allowed without confirmation', () => {
  assert.deepEqual(evaluateTrust({ score: '800' }), {
    state: 'allowed',
    score: '800',
    threshold: '400',
    requiresConfirmation: false,
  });
  assert.deepEqual(evaluateTrust({ score: '400' }), {
    state: 'allowed',
    score: '400',
    threshold: '400',
    requiresConfirmation: false,
  });
  assert.equal(evaluateTrust({ score: '399' }).state, 'confirmation-required');
});

/**
 * Achieves: Below-threshold scores require confirmation; confirmed=true yields allowed-with-confirmation.
 * Fails when: Low scores auto-allow, or confirmed still blocked.
 * Oracle: evaluateTrust confirmation state machine.
 * Side effects: none
 * Gaps: Does not cover custom thresholds here.
 */
test('low trust scores require an explicit user confirmation', () => {
  const decision = evaluateTrust({ score: '120' });
  assert.equal(decision.state, 'confirmation-required');
  assert.equal(decision.prompt, 'This has a low trust score, are you sure you want to buy?');
  assert.equal(evaluateTrust({ score: '120', confirmed: true }).state, 'allowed-with-confirmation');
});

/**
 * Achieves: Configured provider returns score+decision; bad mint and missing config fail with stable codes.
 * Fails when: Bad mints succeed or missing config returns a default score.
 * Oracle: Trust provider configuration + mint validation.
 * Side effects: Injected fetcher.
 * Gaps: Does not assert Authorization header shape.
 */
test('provider validates mint and sanitizes upstream failures', async () => {
  const lookup = createTrustScoreProvider({
    endpoint: 'https://trust.example/score',
    apiKey: 'secret',
    fetcher: async () => Response.json({ mint, score: 750, source: 'lab' }),
  });
  const result = await lookup(mint);
  assert.equal(result.score, '750');
  assert.equal(result.decision.state, 'allowed');
  await assert.rejects(lookup('bad'), { code: 'invalid_mint' });
  await assert.rejects(createTrustScoreProvider({})(mint), { code: 'trust_not_configured' });
});

/**
 * Achieves: Upstream mint mismatch or non-numeric score → invalid_provider_response.
 * Fails when: Mismatched/malformed payloads are accepted.
 * Oracle: Provider response validation.
 * Side effects: Injected fetcher.
 * Gaps: none meaningful
 */
test('provider rejects mismatched mint or malformed score payloads', async () => {
  const badMint = createTrustScoreProvider({
    endpoint: 'https://trust.example/score',
    apiKey: 'secret',
    fetcher: async () => Response.json({ mint: 'other', score: 10 }),
  });
  await assert.rejects(badMint(mint), { code: 'invalid_provider_response' });
  const badScore = createTrustScoreProvider({
    endpoint: 'https://trust.example/score',
    apiKey: 'secret',
    fetcher: async () => Response.json({ mint, score: 'high' }),
  });
  await assert.rejects(badScore(mint), { code: 'invalid_provider_response' });
});

/**
 * Achieves: 429 and thrown fetch errors become sanitized codes/messages without secret bodies.
 * Fails when: Upstream bodies or thrown messages containing secrets surface to callers.
 * Oracle: Error sanitization contract for trust providers.
 * Side effects: Injected fetcher.
 * Gaps: Does not cover non-429 HTTP failure mapping.
 */
test('rate limits and network failures do not leak secrets', async () => {
  await assert.rejects(
    createTrustScoreProvider({
      endpoint: 'https://trust.example/score',
      apiKey: 'secret',
      fetcher: async () => new Response('secret-body', { status: 429 }),
    })(mint),
    { code: 'provider_rate_limited', status: 429 },
  );
  await assert.rejects(
    createTrustScoreProvider({
      endpoint: 'https://trust.example/score',
      apiKey: 'secret',
      fetcher: async () => { throw new Error('secret'); },
    })(mint),
    { message: 'provider_unavailable' },
  );
});

/**
 * Achieves: Organic score scales to 0–1000 with audit ceilings for sus / mint authority.
 * Fails when: Ceilings not applied or scale wrong (80→800).
 * Oracle: Jupiter tokens v2 organicScore/audit mapping.
 * Side effects: none
 * Gaps: Does not enumerate every audit flag combination.
 */
test('Jupiter organic score maps to 0-1000 with audit ceilings', () => {
  assert.equal(scoreFromJupiterToken({ organicScore: 80, isVerified: true, audit: {} }), '800');
  assert.equal(
    scoreFromJupiterToken({
      organicScore: 90,
      isVerified: false,
      audit: { isSus: true },
    }),
    '100',
  );
  assert.equal(
    scoreFromJupiterToken({
      organicScore: 95,
      isVerified: false,
      audit: { mintAuthorityDisabled: false },
    }),
    '250',
  );
});

/**
 * Achieves: Search endpoint is called with API key; score/source/decision returned without cache field on miss path defaults.
 * Fails when: Wrong endpoint/header or missing decision.
 * Oracle: Jupiter tokens search API.
 * Side effects: Injected fetcher.
 * Gaps: Does not cover empty search results.
 */
test('Jupiter trust provider searches by mint and returns gate decision', async () => {
  const lookup = createJupiterTrustProvider({
    apiKey: 'jup-key',
    fetcher: async (url, options) => {
      assert.match(url, /\/search\?query=/);
      assert.equal(options.headers['x-api-key'], 'jup-key');
      return Response.json([{
        id: mint,
        organicScore: 70,
        isVerified: true,
        audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true },
      }]);
    },
  });
  const result = await lookup(mint);
  assert.equal(result.score, '700');
  assert.equal(result.source, 'jupiter-tokens-v2');
  assert.equal(result.decision.state, 'allowed');
  assert.equal(result.cache, undefined);
});

/**
 * Achieves: File cache hits across instances skip fetch; threshold re-applied on hit; API keys never written; TTL refresh refetches.
 * Fails when: Cache miss always, keys leak to disk, or stale threshold stuck in stored decision.
 * Oracle: Durable per-mint cache + threshold re-evaluation on read.
 * Side effects: Writes temp file under os.tmpdir and deletes it.
 * Gaps: Does not cover Cloudflare KV in this test.
 */
test('Jupiter trust results stay cached per mint across provider instances', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ubc-trust-'));
  const file = join(dir, 'tokens.json');
  const clock = { t: 1_700_000_000_000 };
  let calls = 0;
  const token = {
    id: mint,
    organicScore: 55,
    isVerified: true,
    audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 10 },
  };
  const fetcher = async () => {
    calls += 1;
    return Response.json([token]);
  };
  try {
    const first = createJupiterTrustProvider({
      apiKey: 'jup-key',
      cacheStorage: createFileTrustStorage(file),
      cacheTtlMs: 60_000,
      now: () => clock.t,
      fetcher,
    });
    const miss = await first(mint);
    assert.equal(miss.cache, 'miss');
    assert.equal(miss.score, '550');
    assert.equal(miss.decision.state, 'allowed');
    assert.equal(calls, 1);

    const reloaded = createJupiterTrustProvider({
      apiKey: 'other-key',
      cacheStorage: createFileTrustStorage(file),
      cacheTtlMs: 60_000,
      now: () => clock.t,
      threshold: '600',
      fetcher: async () => { calls += 1; throw new Error('should not fetch'); },
    });
    const hit = await reloaded(mint);
    assert.equal(calls, 1);
    assert.equal(hit.cache, 'hit');
    assert.equal(hit.score, '550');
    assert.equal(hit.fetchedAt, miss.fetchedAt);
    assert.equal(hit.decision.state, 'confirmation-required');
    assert.equal(hit.decision.threshold, '600');

    const body = await readFile(file, 'utf8');
    assert.equal(body.includes('jup-key'), false);
    assert.equal(body.includes('other-key'), false);

    clock.t += 60_000;
    const refreshed = createJupiterTrustProvider({
      cacheStorage: createFileTrustStorage(file),
      cacheTtlMs: 60_000,
      now: () => clock.t,
      fetcher,
    });
    const again = await refreshed(mint);
    assert.equal(again.cache, 'miss');
    assert.equal(calls, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * Achieves: Storage get failures become cache_unavailable without path leakage; incomplete storage config throws.
 * Fails when: Filesystem paths or secrets appear in error messages.
 * Oracle: TrustError sanitization for cache backends.
 * Side effects: none
 * Gaps: none meaningful
 */
test('trust cache failures do not leak storage details', async () => {
  const lookup = createJupiterTrustProvider({
    cacheStorage: {
      async get() { throw new Error('/secret/trust-cache.json'); },
      async put() {},
    },
    fetcher: async () => { throw new Error('unused'); },
  });
  await assert.rejects(lookup(mint), (error) => error.code === 'cache_unavailable' && !String(error.message).includes('secret'));
  assert.throws(
    () => createJupiterTrustProvider({ cacheStorage: {} }),
    (error) => error.code === 'cache_unavailable',
  );
});

/**
 * Achieves: ProviderError/TrustError exports carry code/status; invalid mint becomes ProviderError.
 * Fails when: Wrong class thrown, or status defaults incorrectly.
 * Oracle: errors.mjs constructors + createTrustScoreProvider invalid_mint path.
 * Side effects: none (no network).
 * Gaps: adaptCloudflareKv / durable cache covered in cache.test.mjs.
 */
test('ProviderError and TrustError are exported with code/status semantics', async () => {
  const { ProviderError, TrustError, createTrustScoreProvider } = await import('./trust.mjs');
  const providerErr = new ProviderError('provider_failed', 502);
  assert.equal(providerErr instanceof Error, true);
  assert.equal(providerErr.code, 'provider_failed');
  assert.equal(providerErr.status, 502);
  assert.equal(new ProviderError('x').status, 502);
  assert.equal(new TrustError('bad').name, 'Error');
  const lookup = createTrustScoreProvider({ endpoint: 'https://trust.test', apiKey: 'k', fetcher: async () => assert.fail('no call') });
  await assert.rejects(lookup('!!!'), (error) => error instanceof ProviderError && error.code === 'invalid_mint' && error.status === 400);
  await assert.rejects(
    createTrustScoreProvider({ endpoint: '', apiKey: '' })(mint),
    (error) => error instanceof ProviderError && error.code === 'trust_not_configured' && error.status === 503,
  );
});
