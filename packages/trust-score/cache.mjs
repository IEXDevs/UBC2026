import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TrustError } from './errors.mjs';

const fail = message => { throw new TrustError(message); };

/** Default hold for a per-mint trust record. Trading horizons are hourly, not tick-by-tick. */
export const DEFAULT_TRUST_CACHE_TTL_MS = 60 * 60 * 1000;

function assertTtl(ttlMs) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) fail('Trust cache ttlMs must be a positive integer');
}

function assertNow(now) {
  if (!Number.isSafeInteger(now)) fail('Trust cache clock must return a safe integer');
  return now;
}

/**
 * Per-mint trust cache. `storage` is durable when its get/put survive a new process
 * (JSON file, Cloudflare KV, or Durable Object storage). Keys are `trust:<mint>`.
 * Expired and corrupt entries are misses.
 */
export function createDurableTokenCache({
  storage,
  ttlMs = DEFAULT_TRUST_CACHE_TTL_MS,
  now = () => Date.now(),
  keyPrefix = 'trust:',
} = {}) {
  if (!storage || typeof storage.get !== 'function' || typeof storage.put !== 'function') {
    fail('Durable token cache requires storage with get and put');
  }
  assertTtl(ttlMs);
  if (typeof keyPrefix !== 'string' || keyPrefix.length < 1 || keyPrefix.length > 64) fail('Invalid trust cache key prefix');

  function keyFor(mint) {
    return `${keyPrefix}${mint}`;
  }

  return {
    ttlMs,
    async get(mint) {
      let entry;
      try {
        entry = await storage.get(keyFor(mint));
      } catch {
        fail('cache_unavailable');
      }
      const clock = assertNow(now());
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      if (entry.mint !== mint || typeof entry.expiresAt !== 'number' || entry.expiresAt <= clock) {
        await drop(storage, keyFor(mint));
        return null;
      }
      if (!entry.value || typeof entry.value !== 'object' || entry.value.mint !== mint) {
        await drop(storage, keyFor(mint));
        return null;
      }
      return entry.value;
    },
    async set(mint, value) {
      if (!value || typeof value !== 'object' || value.mint !== mint) fail('Trust cache value must match the mint');
      const storedAt = assertNow(now());
      const { cache: _cacheStatus, decision: _decision, ...rest } = value;
      const entry = {
        mint,
        storedAt,
        expiresAt: storedAt + ttlMs,
        value: rest,
      };
      try {
        await storage.put(keyFor(mint), entry);
      } catch (error) {
        if (error instanceof TrustError) throw error;
        fail('cache_unavailable');
      }
      return rest;
    },
  };
}

async function drop(storage, key) {
  if (typeof storage.delete !== 'function') return;
  try {
    await storage.delete(key);
  } catch {
    fail('cache_unavailable');
  }
}

/** Process-local object store with the same get/put/delete shape as Durable Object storage. */
export function createMemoryTrustStorage() {
  const map = new Map();
  return {
    async get(key) {
      return map.has(key) ? structuredClone(map.get(key)) : null;
    },
    async put(key, value) {
      map.set(key, structuredClone(value));
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

/**
 * JSON file store. Writes are serialized and replaced atomically.
 * The file holds trust records only — never API keys.
 */
export function createFileTrustStorage(filePath) {
  if (typeof filePath !== 'string' || filePath.length < 1) fail('Trust cache file path is required');
  let chain = Promise.resolve();
  const enqueue = work => {
    const run = chain.then(work, work);
    chain = run.then(() => {}, () => {});
    return run;
  };

  async function readAll() {
    try {
      const text = await readFile(filePath, 'utf8');
      const data = JSON.parse(text);
      if (!data || typeof data !== 'object' || Array.isArray(data)) fail('cache_unavailable');
      return data;
    } catch (error) {
      if (error instanceof TrustError) throw error;
      if (error && error.code === 'ENOENT') return {};
      fail('cache_unavailable');
    }
  }

  async function writeAll(data) {
    await mkdir(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data), 'utf8');
    await rename(tmp, filePath);
  }

  return {
    async get(key) {
      return enqueue(async () => {
        const all = await readAll();
        return Object.prototype.hasOwnProperty.call(all, key) ? all[key] : null;
      });
    },
    async put(key, value) {
      return enqueue(async () => {
        const all = await readAll();
        all[key] = value;
        try {
          await writeAll(all);
        } catch (error) {
          if (error instanceof TrustError) throw error;
          fail('cache_unavailable');
        }
      });
    },
    async delete(key) {
      return enqueue(async () => {
        const all = await readAll();
        delete all[key];
        try {
          await writeAll(all);
        } catch (error) {
          if (error instanceof TrustError) throw error;
          fail('cache_unavailable');
        }
      });
    },
  };
}

/**
 * Cloudflare KV namespace adapter. `expirationTtl` is seconds (KV minimum is 60).
 * Our cache still checks `expiresAt` so a shorter TTL is honored on read.
 */
export function adaptCloudflareKv(kv, { expirationTtl } = {}) {
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') {
    fail('Cloudflare KV binding is required');
  }
  if (expirationTtl != null && (!Number.isSafeInteger(expirationTtl) || expirationTtl < 60)) {
    fail('KV expirationTtl must be an integer of at least 60 seconds');
  }
  return {
    async get(key) {
      const value = await kv.get(key, 'json');
      return value ?? null;
    },
    async put(key, value) {
      const options = expirationTtl ? { expirationTtl } : undefined;
      await kv.put(key, JSON.stringify(value), options);
    },
    async delete(key) {
      if (typeof kv.delete === 'function') await kv.delete(key);
    },
  };
}
