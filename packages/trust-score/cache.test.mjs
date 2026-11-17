import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TrustError } from './errors.mjs';
import {
  adaptCloudflareKv,
  createDurableTokenCache,
  createMemoryTrustStorage,
  DEFAULT_TRUST_CACHE_TTL_MS,
} from './cache.mjs';

const mint = 'So11111111111111111111111111111111111111112';

/**
 * Achieves: Cache get/set is per-mint and expires exactly at ttl boundary.
 * Fails when: Cross-mint bleed, or expired entries remain readable.
 * Oracle: DEFAULT_TRUST_CACHE_TTL_MS + durable record expiry.
 * Side effects: In-memory storage + fake clock.
 * Gaps: Does not cover concurrent set races.
 */
test('durable cache keeps one record per mint until ttl', async () => {
  const clock = { t: 1_000 };
  const cache = createDurableTokenCache({
    storage: createMemoryTrustStorage(),
    ttlMs: 500,
    now: () => clock.t,
  });
  await cache.set(mint, { mint, score: '700', source: 'jupiter-tokens-v2' });
  const other = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  assert.equal(await cache.get(other), null);
  assert.equal((await cache.get(mint)).score, '700');
  clock.t = 1_500;
  assert.equal(await cache.get(mint), null);
  assert.equal(DEFAULT_TRUST_CACHE_TTL_MS, 60 * 60 * 1000);
});

/**
 * Achieves: Persisted value drops decision/cache fields and sets expiresAt=now+ttl.
 * Fails when: Gate decisions are stored as source of truth for later threshold changes.
 * Oracle: Cache must store score facts only so threshold can be re-evaluated.
 * Side effects: In-memory storage.
 * Gaps: none meaningful
 */
test('cache stores the trust record without the gate decision', async () => {
  const storage = createMemoryTrustStorage();
  const cache = createDurableTokenCache({ storage, now: () => 50, ttlMs: 10 });
  await cache.set(mint, {
    mint,
    score: '700',
    source: 'jupiter-tokens-v2',
    decision: { state: 'allowed' },
    cache: 'miss',
  });
  const stored = await storage.get(`trust:${mint}`);
  assert.equal(stored.value.decision, undefined);
  assert.equal(stored.value.cache, undefined);
  assert.equal(stored.expiresAt, 60);
});

/**
 * Achieves: Mint-mismatched stored records are deleted; ttlMs=0 construction throws.
 * Fails when: Corrupt entries are returned as hits, or zero ttl is allowed.
 * Oracle: TrustError on bad cache config + corrupt drop policy.
 * Side effects: In-memory storage.
 * Gaps: Does not cover partially JSON-corrupt Cloudflare values.
 */
test('corrupt and expired entries are dropped', async () => {
  const storage = createMemoryTrustStorage();
  await storage.put(`trust:${mint}`, { mint, expiresAt: 10, value: { mint: 'other' } });
  const cache = createDurableTokenCache({ storage, now: () => 5, ttlMs: 10 });
  assert.equal(await cache.get(mint), null);
  assert.equal(await storage.get(`trust:${mint}`), null);
  assert.throws(() => createDurableTokenCache({ ttlMs: 0 }), TrustError);
});

/**
 * Achieves: adaptCloudflareKv put uses expirationTtl and get returns parsed trust records.
 * Fails when: TTL option omitted or JSON round-trip loses score.
 * Oracle: Cloudflare KV get/put JSON API.
 * Side effects: Fake KV map.
 * Gaps: Does not cover KV size/limit errors.
 */
test('Cloudflare KV adapter round-trips JSON and sets expiration', async () => {
  const saved = new Map();
  let putOptions;
  const kv = {
    async get(key, type) {
      const raw = saved.get(key);
      if (raw == null) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value, options) {
      saved.set(key, value);
      putOptions = options;
    },
    async delete(key) { saved.delete(key); },
  };
  const storage = adaptCloudflareKv(kv, { expirationTtl: 3600 });
  const cache = createDurableTokenCache({ storage, now: () => 10, ttlMs: 1000 });
  await cache.set(mint, { mint, score: '10', source: 'jupiter-tokens-v2' });
  assert.deepEqual(putOptions, { expirationTtl: 3600 });
  assert.equal((await cache.get(mint)).score, '10');
  assert.equal(saved.get(`trust:${mint}`).includes('10'), true);
});
