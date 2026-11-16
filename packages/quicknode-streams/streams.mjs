/**
 * QuickNode Streams helpers for Maelstrom (Isaac / chunk 5A).
 * HMAC verify → normalize → dedupe → Supabase persist → wallet→bot wake → KV sync → backfill.
 * Network I/O only via injected stores / fetch.
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
export const EVENT_TYPES = Object.freeze(['deposit', 'withdrawal', 'x402-in', 'x402-out', 'memo', 'swap', 'unknown']);
const QN_KV_BASE = 'https://api.quicknode.com/kv/rest/v1';

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
 * verify → parse → dedupe → optional persist → wake targets (+ optional 4A loop kick).
 *
 * resolveBotIds(event) may return string ids or { botId, ownerId, ... } objects.
 * afterWake({ botId, ownerId, event, reason }) runs after each wake is queued (runtime uses this for DO /wake+/loop).
 */
export async function handleQuickNodeWebhook({
  secret,
  headers,
  rawBody,
  dedupeStore,
  persistEvent = null,
  resolveBotIds = async (event) => (event.botId ? [event.botId] : []),
  afterWake = null,
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
    const resolved = await resolveBotIds(event);
    for (const entry of resolved || []) {
      const botId = typeof entry === 'string' ? entry : entry?.botId;
      const ownerId = typeof entry === 'string' ? null : (entry?.ownerId ?? null);
      if (!botId || typeof botId !== 'string') continue;
      const wake = { botId, ownerId, reason: 'quicknode-stream', event, bot: typeof entry === 'object' ? entry : null };
      if (typeof afterWake === 'function') {
        wake.after = await afterWake(wake);
      }
      wakes.push(wake);
    }
    accepted.push(event);
  }

  return { ok: true, accepted, duplicates, wakes };
}

/**
 * QuickNode Key-Value Store list client (Streams filter membership).
 * Docs: POST/PATCH/DELETE under https://api.quicknode.com/kv/rest/v1/lists/{key}
 */
export function createQuickNodeKvClient({ apiKey, listKey, fetchImpl = fetch, baseUrl = QN_KV_BASE } = {}) {
  if (!apiKey || typeof apiKey !== 'string') fail('missing_qn_api_key', 500);
  if (!listKey || typeof listKey !== 'string') fail('missing_qn_list_key', 500);
  const headers = { 'content-type': 'application/json', 'x-api-key': apiKey };

  async function req(method, path, body) {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    if (!res.ok) fail(`qn_kv_${res.status}`, res.status >= 500 ? 502 : 400);
    return json;
  }

  return {
    listKey,
    async list() {
      const data = await req('GET', `/lists/${encodeURIComponent(listKey)}`);
      const items = Array.isArray(data)
        ? data
        : Array.isArray(data?.items)
          ? data.items
          : Array.isArray(data?.data)
            ? data.data
            : Array.isArray(data?.data?.items)
              ? data.data.items
              : [];
      return items.map(item => (typeof item === 'string' ? item : '')).filter(Boolean);
    },
    async add(address) {
      if (!base58.test(address)) fail('invalid_wallet');
      await req('POST', `/lists/${encodeURIComponent(listKey)}/items`, { item: address });
      return { address, synced: true };
    },
    async remove(address) {
      await req('DELETE', `/lists/${encodeURIComponent(listKey)}/items/${encodeURIComponent(address)}`);
      return { address, removed: true };
    },
    async patch({ addItems = [], removeItems = [] } = {}) {
      for (const a of addItems) if (!base58.test(a)) fail('invalid_wallet');
      if (!addItems.length && !removeItems.length) return { added: 0, removed: 0 };
      await req('PATCH', `/lists/${encodeURIComponent(listKey)}`, { addItems, removeItems });
      return { added: addItems.length, removed: removeItems.length };
    },
  };
}

/** Apply a wallet set to memory or QuickNode KV (uses planWalletKvSync). */
export async function syncWalletsToKv({ wallets, walletKv, existing } = {}) {
  if (!walletKv) fail('missing_wallet_kv', 500);
  const current = existing ?? (await walletKv.list());
  const plan = planWalletKvSync({ wallets, existing: current });
  if (typeof walletKv.patch === 'function' && (plan.add.length || plan.remove.length)) {
    await walletKv.patch({ addItems: plan.add, removeItems: plan.remove });
  } else {
    for (const a of plan.add) await walletKv.add(a);
    for (const a of plan.remove) await walletKv.remove(a);
  }
  return { ...plan, synced: true };
}

/**
 * Supabase-backed stream store (PostgREST via fetch).
 * Tables: stream_events, wallets, bots, timeline_events.
 */
export function createSupabaseStreamStore({ url, serviceKey, fetchImpl = fetch } = {}) {
  if (!url || !serviceKey) fail('missing_supabase', 500);
  const base = String(url).replace(/\/$/, '');
  const headers = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    'content-type': 'application/json',
    prefer: 'return=representation',
  };

  async function rest(path, { method = 'GET', body, prefer } = {}) {
    const res = await fetchImpl(`${base}/rest/v1/${path}`, {
      method,
      headers: prefer ? { ...headers, prefer } : headers,
      body: body == null ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (!res.ok) fail(`supabase_${res.status}`, res.status >= 500 ? 502 : 400);
    return json;
  }

  return {
    async has(signature) {
      const rows = await rest(`stream_events?signature=eq.${encodeURIComponent(signature)}&select=signature`);
      return Array.isArray(rows) && rows.length > 0;
    },
    async put(signature, meta) {
      return { signature, ...meta };
    },
    async persistEvent(event) {
      await rest('stream_events', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=representation',
        body: {
          signature: event.signature,
          wallet: event.wallet,
          bot_id: event.botId || null,
          owner_id: event.ownerId || null,
          event_type: event.type,
          amount: event.amount,
          token: event.token,
          slot: event.slot,
          cluster: event.cluster || 'devnet',
          raw: event,
        },
      });
      return { persisted: true };
    },
    async resolveBotsForWallet(eventOrWallet) {
      const wallet = typeof eventOrWallet === 'string' ? eventOrWallet : eventOrWallet?.wallet;
      if (!wallet) return [];
      const wallets = await rest(
        `wallets?address=eq.${encodeURIComponent(wallet)}&select=id,owner_id,address,frozen`,
      );
      if (!Array.isArray(wallets) || !wallets.length) {
        const botId = typeof eventOrWallet === 'object' ? eventOrWallet?.botId : null;
        return botId ? [{ botId, ownerId: null }] : [];
      }
      const out = [];
      for (const w of wallets) {
        if (w.frozen) continue;
        const bots = await rest(
          `bots?wallet_id=eq.${encodeURIComponent(w.id)}&enabled=eq.true&frozen=eq.false&select=id,owner_id,name,type,goal,wallet_id,approval_mode,policy_version,cap`,
        );
        for (const b of bots || []) {
          out.push({
            botId: b.id,
            ownerId: b.owner_id,
            walletId: w.id,
            walletAddress: w.address,
            name: b.name,
            type: b.type,
            goal: b.goal,
            approvalMode: b.approval_mode,
            policyVersion: b.policy_version,
            cap: b.cap,
          });
        }
      }
      return out;
    },
    async listWalletAddresses() {
      const rows = await rest('wallets?select=address&frozen=eq.false');
      return (rows || []).map((r) => r.address).filter(Boolean);
    },
    async appendTimeline(event, bot) {
      if (!bot?.botId || !bot?.ownerId) return null;
      return rest('timeline_events', {
        method: 'POST',
        body: {
          id: `stream:${event.signature}`,
          bot_id: bot.botId,
          owner_id: bot.ownerId,
          kind: 'tx.confirmed',
          summary: `Stream ${event.type} · ${event.wallet.slice(0, 8)}…`,
          at: new Date().toISOString(),
        },
      });
    },
  };
}

/**
 * Replay historical rows through normalize → dedupe → persist → wake (no HMAC).
 * Use after planBackfill / RPC fetch when Stream 1 missed a window.
 */
export async function runStreamBackfill({
  rows = [],
  dedupeStore,
  persistEvent = null,
  resolveBotIds = async (event) => (event.botId ? [event.botId] : []),
  afterWake = null,
} = {}) {
  if (!dedupeStore) fail('missing_dedupe', 500);
  const events = Array.isArray(rows) ? rows.map(normalizeStreamEvent) : [];
  const accepted = [];
  const duplicates = [];
  const wakes = [];

  for (const event of events) {
    if (await dedupeStore.has(event.signature)) {
      duplicates.push(event.signature);
      continue;
    }
    await dedupeStore.put(event.signature, { at: Date.now(), wallet: event.wallet, type: event.type, backfill: true });
    if (typeof persistEvent === 'function') await persistEvent(event);
    const resolved = await resolveBotIds(event);
    for (const entry of resolved || []) {
      const botId = typeof entry === 'string' ? entry : entry?.botId;
      const ownerId = typeof entry === 'string' ? null : (entry?.ownerId ?? null);
      if (!botId) continue;
      const wake = { botId, ownerId, reason: 'quicknode-backfill', event, bot: typeof entry === 'object' ? entry : null };
      if (typeof afterWake === 'function') wake.after = await afterWake(wake);
      wakes.push(wake);
    }
    accepted.push(event);
  }

  return { ok: true, accepted, duplicates, wakes, planHint: 'Same path as live webhook after planBackfill + RPC/Stream export' };
}

/** Cloudflare KV → dedupe store adapter (`has` / `put`). */
export function createKvDedupeStore(ns, { ttlSeconds = 60 * 60 * 24 * 14, prefix = 'sig:' } = {}) {
  if (!ns) fail('missing_kv', 500);
  return {
    async has(signature) {
      return (await ns.get(`${prefix}${signature}`)) != null;
    },
    async put(signature, meta) {
      await ns.put(`${prefix}${signature}`, JSON.stringify(meta ?? { at: Date.now() }), {
        expirationTtl: ttlSeconds,
      });
    },
  };
}

/** Circle devnet USDC mint. Public address, not a secret. */
export const DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

const PAYMENT_DIRECTIONS = Object.freeze({ 'x402-in': 'earned', 'x402-out': 'paid' });
const OUTFLOW_TYPES = new Set(['x402-out', 'withdrawal']);

function integerAmount(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^(0|[1-9][0-9]{0,39})$/.test(trimmed)) return trimmed;
  if (/^(0|[1-9][0-9]{0,39})\.0+$/.test(trimmed)) return trimmed.slice(0, trimmed.indexOf('.'));
  return null;
}

/** Map a stream token to a ledger asset. Missing tokens stay missing. */
export function streamAsset(token) {
  if (token == null) return null;
  const value = String(token).trim();
  if (!value || value.length > 64) return null;
  if (value === 'USDC' || value === DEVNET_USDC_MINT) return 'USDC';
  return value;
}

function eventType(event) {
  return event?.type || event?.event_type || null;
}

function attributeBot(event, bots) {
  const explicit = event?.botId || event?.bot_id;
  if (typeof explicit === 'string' && explicit) return explicit;
  const matches = (bots || [])
    .filter(bot => bot && (bot.walletAddress === event?.wallet || bot.address === event?.wallet))
    .map(bot => bot.id || bot.botId)
    .filter(id => typeof id === 'string' && id)
    .sort();
  return matches[0] || null;
}

/**
 * Payment-feed rows from QuickNode stream events.
 * x402 in/out only, and only when the event already carries an amount, asset, signature, and bot.
 * An empty event list stays an empty feed.
 */
export function streamConfirmedPayments(events, { bots = [] } = {}) {
  if (!Array.isArray(events)) return [];
  const rows = [];
  const seen = new Set();
  for (const event of events) {
    const direction = PAYMENT_DIRECTIONS[eventType(event)];
    if (!direction) continue;
    const signature = typeof event?.signature === 'string' ? event.signature : '';
    if (!signature || signature.length > 128 || seen.has(signature)) continue;
    const amount = integerAmount(event.amount);
    const asset = streamAsset(event.token ?? event.asset);
    const botId = attributeBot(event, bots);
    const cluster = event?.cluster === 'testnet' ? 'testnet' : event?.cluster === 'devnet' ? 'devnet' : null;
    const counterparty = typeof event?.counterparty === 'string' && event.counterparty.trim()
      ? event.counterparty.trim()
      : event?.wallet;
    if (!amount || !asset || !botId || !cluster || typeof counterparty !== 'string' || !counterparty) continue;
    seen.add(signature);
    rows.push({
      id: `stream:${signature}`,
      botId,
      direction,
      protocol: 'x402',
      amount,
      asset,
      counterparty,
      cluster,
      txSignature: signature,
      streamConfirmed: true,
      badge: 'confirmed',
    });
  }
  return rows;
}

/**
 * Match on-chain outflows to bot-policy spent + reserved.
 * No outflow to check → checked false. Unreadable ledger amounts do not freeze.
 * Chain movement above the ledger is unapproved spend.
 */
export function walletLedgerCrossCheck({ events = [], ledgers = [] } = {}) {
  const byAsset = new Map();
  const seen = new Set();
  for (const event of Array.isArray(events) ? events : []) {
    if (!OUTFLOW_TYPES.has(eventType(event))) continue;
    const signature = typeof event?.signature === 'string' ? event.signature : '';
    if (signature) {
      if (seen.has(signature)) continue;
      seen.add(signature);
    }
    const asset = streamAsset(event.token ?? event.asset);
    const amount = integerAmount(event.amount);
    if (!asset || !amount) continue;
    byAsset.set(asset, (byAsset.get(asset) || 0n) + BigInt(amount));
  }
  if (byAsset.size === 0) {
    return { checked: false, ok: true, alert: null, freeze: false, excess: '0' };
  }

  for (const [asset, chain] of byAsset) {
    const rows = (Array.isArray(ledgers) ? ledgers : []).filter(row => streamAsset(row?.asset) === asset);
    let allowed = 0n;
    for (const row of rows) {
      const spent = integerAmount(row.spent);
      const reserved = integerAmount(row.reserved);
      if (spent == null || reserved == null) {
        return {
          checked: true,
          ok: true,
          alert: null,
          freeze: false,
          excess: '0',
          reason: 'ledger_unreadable',
          asset,
        };
      }
      allowed += BigInt(spent) + BigInt(reserved);
    }
    if (chain > allowed) {
      return {
        checked: true,
        ok: false,
        alert: 'unapproved_spend',
        freeze: true,
        excess: (chain - allowed).toString(),
        asset,
        chainOutflow: chain.toString(),
        allowed: allowed.toString(),
      };
    }
  }
  return { checked: true, ok: true, alert: null, freeze: false, excess: '0' };
}

/** Per-wallet alerts. Wallets with no countable outflow are omitted. */
export function spendLedgerCrossCheck({ events = [], wallets = [], ledgers = [] } = {}) {
  const alerts = [];
  for (const wallet of Array.isArray(wallets) ? wallets : []) {
    if (!wallet?.id || !wallet.address) continue;
    const botIds = new Set((wallet.botIds || []).filter(id => typeof id === 'string'));
    const mine = (Array.isArray(events) ? events : []).filter(event => {
      if (event?.wallet === wallet.address) return true;
      const botId = event?.botId || event?.bot_id;
      return typeof botId === 'string' && botIds.has(botId);
    });
    const walletLedgers = (Array.isArray(ledgers) ? ledgers : []).filter(row => {
      const botId = row?.botId || row?.bot_id;
      return typeof botId === 'string' && botIds.has(botId);
    });
    const decision = walletLedgerCrossCheck({ events: mine, ledgers: walletLedgers });
    if (decision.alert !== 'unapproved_spend') continue;
    alerts.push({
      walletId: wallet.id,
      address: wallet.address,
      alert: decision.alert,
      freeze: true,
      excess: decision.excess,
      asset: decision.asset,
      chainOutflow: decision.chainOutflow,
      allowed: decision.allowed,
    });
  }
  return alerts;
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
    '- **KV sync:** `syncWalletsToKv` / `POST /internal/streams/sync-wallets` pushes Privy wallet addresses into the QN list (no Stream redeploy)',
    '- **Backfill:** `planBackfill` + `runStreamBackfill` / `POST /internal/streams/backfill` replays missed slots through the same normalize→dedupe→persist→wake→loop path',
    '- **Why:** Core wake path for deposits, x402 settlement, grab-back, and spend-ledger cross-checks — not a bolt-on poller. Hourly Cron is the fallback only.',
  ].join('\n');
}
