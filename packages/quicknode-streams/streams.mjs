/**
 * QuickNode Streams helpers for Maelstrom (Isaac / chunk 5A).
 * HMAC verify → normalize → dedupe by tx signature → wallet KV sync plan → wake intent.
 * No network I/O except via injected stores/writers.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export class StreamsError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const fail = (code, status = 400) => { throw new StreamsError(code, status); };
const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVENT_TYPES = Object.freeze(['deposit', 'withdrawal', 'x402-in', 'x402-out', 'memo', 'swap', 'unknown']);

/** In-memory dedupe / KV for tests. Production: Cloudflare KV or Supabase. */
export function createMemoryDedupeStore() {
  const seen = new Map();
  return {
    async has(signature) { return seen.has(signature); },
    async put(signature, meta) { seen.set(signature, meta); },
    async list() { return [...seen.entries()].map(([signature, meta]) => ({ signature, ...meta })); },
  };
}

export function createMemoryWalletKv() {
  const wallets = new Set();
  return {
    async list() { return [...wallets]; },
    async add(address) {
      if (!base58.test(address)) fail('invalid_wallet');
      wallets.add(address);
      return { address, synced: true };
    },
    async remove(address) {
      wallets.delete(address);
      return { address, removed: true };
    },
  };
}

/**
 * Verify QuickNode Streams headers:
 * HMAC-SHA256(secret, nonce + timestamp + rawBody) as hex vs X-QN-Signature.
 */
export function verifyQuickNodeSignature({
  secret,
  nonce,
  timestamp,
  signature,
  rawBody,
  maxSkewSeconds = 300,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  if (typeof secret !== 'string' || !secret) fail('webhook_secret_required', 503);
  if (typeof nonce !== 'string' || !nonce || nonce.length > 256) fail('invalid_nonce', 401);
  if (typeof timestamp !== 'string' || !/^[0-9]{10,16}$/.test(timestamp)) fail('invalid_timestamp', 401);
  if (typeof signature !== 'string' || !signature) fail('invalid_signature', 401);
  if (typeof rawBody !== 'string') fail('raw_body_required', 401);

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > maxSkewSeconds) fail('timestamp_skew', 401);

  const expected = createHmac('sha256', secret)
    .update(nonce, 'utf8')
    .update(timestamp, 'utf8')
    .update(rawBody, 'utf8')
    .digest('hex');

  const received = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  let a;
  let b;
  try {
    a = Buffer.from(expected, 'hex');
    b = Buffer.from(received.toLowerCase(), 'hex');
  } catch {
    fail('invalid_signature', 401);
  }
  if (a.length !== b.length || !timingSafeEqual(a, b)) fail('invalid_signature', 401);
  return { ok: true, nonce, timestamp: ts };
}

export function normalizeStreamEvent(raw) {
  const source = raw?.event ?? raw ?? {};
  const signature = String(source.signature ?? source.txSignature ?? source.txid ?? '');
  if (!signature || signature.length < 32 || signature.length > 128) fail('invalid_event_signature');
  const wallet = String(source.wallet ?? source.account ?? source.owner ?? '');
  if (!base58.test(wallet)) fail('invalid_event_wallet');
  const type = EVENT_TYPES.includes(source.type) ? source.type : 'unknown';
  const amount = source.amount == null ? null : String(source.amount);
  if (amount != null && !/^(0|[1-9][0-9]{0,39})$/.test(amount)) fail('invalid_event_amount');
  const token = source.token == null ? null : String(source.token);
  const slot = source.slot == null ? null : Number(source.slot);
  if (slot != null && (!Number.isSafeInteger(slot) || slot < 0)) fail('invalid_event_slot');
  const botId = source.botId ?? source.metadata?.botId ?? null;
  return {
    signature,
    wallet,
    type,
    amount,
    token,
    slot,
    botId: typeof botId === 'string' && botId ? botId : null,
    cluster: 'devnet',
    network: 'solana-devnet',
  };
}

export function parseStreamPayload(rawBody) {
  let parsed;
  try { parsed = JSON.parse(rawBody); } catch { fail('invalid_json', 400); }
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.data) ? parsed.data
      : Array.isArray(parsed?.events) ? parsed.events
        : parsed?.matchingReceipts ? parsed.matchingReceipts
          : [parsed];
  return list.map(normalizeStreamEvent);
}

/**
 * Sync Privy wallet addresses into the QuickNode KV set used by Stream filters.
 * Returns a plan for the Stream dashboard / KV API (no live QuickNode KV call here).
 */
export function planWalletKvSync({ wallets, existing = [] }) {
  if (!Array.isArray(wallets)) fail('wallets_required');
  const next = new Set();
  for (const wallet of wallets) {
    const address = typeof wallet === 'string' ? wallet : wallet?.address;
    if (!base58.test(address ?? '')) fail('invalid_wallet');
    next.add(address);
  }
  const prev = new Set(existing.filter(addr => base58.test(addr)));
  const add = [...next].filter(addr => !prev.has(addr));
  const remove = [...prev].filter(addr => !next.has(addr));
  return {
    network: 'solana-devnet',
    dataset: 'block',
    filterNote: 'Keep txs touching KV wallet set; emit {signature,wallet,type,amount,token,slot}',
    destination: 'POST /webhooks/quicknode',
    add,
    remove,
    size: next.size,
  };
}

export function planBackfill({ wallets, fromSlot, toSlot }) {
  if (!Array.isArray(wallets) || wallets.length < 1) fail('wallets_required');
  if (!Number.isSafeInteger(fromSlot) || !Number.isSafeInteger(toSlot) || toSlot < fromSlot) {
    fail('invalid_slot_range');
  }
  return {
    network: 'solana-devnet',
    wallets: wallets.map(w => (typeof w === 'string' ? w : w.address)).filter(a => base58.test(a)),
    fromSlot,
    toSlot,
    reason: 'Replay missed Stream 1 window into the same webhook normalize→dedupe→write→wake path',
  };
}

/**
 * Full webhook handling without Cloudflare bindings:
 * verify → parse → dedupe → optional persist → wake targets.
 */
export async function handleQuickNodeWebhook({
  secret,
  headers,
  rawBody,
  dedupeStore,
  persistEvent = null,
  resolveBotIds = async (event) => (event.botId ? [event.botId] : []),
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  const nonce = headers?.['x-qn-nonce'] ?? headers?.['X-QN-Nonce'];
  const timestamp = headers?.['x-qn-timestamp'] ?? headers?.['X-QN-Timestamp'];
  const signature = headers?.['x-qn-signature'] ?? headers?.['X-QN-Signature'];

  verifyQuickNodeSignature({ secret, nonce, timestamp, signature, rawBody, nowSeconds });

  const events = parseStreamPayload(rawBody);
  const accepted = [];
  const duplicates = [];
  const wakes = [];

  for (const event of events) {
    if (await dedupeStore.has(event.signature)) {
      duplicates.push(event.signature);
      continue;
    }
    await dedupeStore.put(event.signature, { at: Date.now(), wallet: event.wallet, type: event.type });
    if (typeof persistEvent === 'function') {
      await persistEvent(event);
    }
    const botIds = await resolveBotIds(event);
    for (const botId of botIds) {
      if (typeof botId === 'string' && botId) {
        wakes.push({ botId, reason: 'quicknode-stream', event });
      }
    }
    accepted.push(event);
  }

  return { ok: true, accepted, duplicates, wakes };
}

/** README snippet for the QuickNode Streams bounty. */
export function streamsReadmeSection() {
  return [
    '## QuickNode Streams (Stream 1)',
    '',
    '- **Network:** `solana-devnet`',
    '- **Dataset:** Block (or Programs + Logs) filtered to Privy bot wallets',
    '- **Filter logic:** Keep transactions touching addresses in the QuickNode Key-Value Store wallet set; emit compact `{signature, wallet, type, amount, token, slot}`',
    '- **Destination:** Cloudflare Worker `POST /webhooks/quicknode` (HMAC via `X-QN-Nonce` / `X-QN-Timestamp` / `X-QN-Signature`)',
    '- **Why:** Core wake path for deposits, x402 settlement, grab-back, and spend-ledger cross-checks — not a bolt-on poller. Hourly Cron is the fallback only.',
  ].join('\n');
}
