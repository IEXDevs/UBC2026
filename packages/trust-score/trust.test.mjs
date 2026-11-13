import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTrust, createTrustScoreProvider, normalizeScore } from './trust.mjs';

const mint = 'So11111111111111111111111111111111111111112';

test('scores normalize to integer strings from 0 to 1000', () => {
  assert.equal(normalizeScore(400), '400');
  assert.equal(normalizeScore('0'), '0');
  assert.throws(() => normalizeScore(1001));
  assert.throws(() => normalizeScore('4.5'));
});

test('high trust scores are allowed without confirmation', () => {
  assert.deepEqual(evaluateTrust({ score: '800' }), {
    state: 'allowed',
    score: '800',
    threshold: '400',
    requiresConfirmation: false,
  });
});

test('low trust scores require an explicit user confirmation', () => {
  const decision = evaluateTrust({ score: '120' });
  assert.equal(decision.state, 'confirmation-required');
  assert.equal(decision.prompt, 'This has a low trust score, are you sure you want to buy?');
  assert.equal(evaluateTrust({ score: '120', confirmed: true }).state, 'allowed-with-confirmation');
});

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
