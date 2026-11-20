import { SOLANA_CLUSTER, EXECUTION_LABEL } from '@ubc2026/contracts/solana';
/**
 * Chunk 5B schedules.
 * Hourly Cron reads wallet holdings. A second Cron re-checks mainnet-beta USDC
 * over RPC when QuickNode Streams has gone quiet, so a dropped stream is
 * not the only way a wallet is observed. This module does not sign or spend.
 */
import { SOLANA_USDC_MINT } from '@ubc2026/wallets/privy';
export {
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  parseTokenAccountsByMint,
  readSolanaWalletBalances,
  readSolanaUsdcBalance,
} from '@ubc2026/wallets/balances';

export const HOURLY_CRON = '0 * * * *';
export const STREAM_FALLBACK_CRON = '5,20,35,50 * * * *';
/** Silence longer than an hour means the stream is not delivering. */
export const STREAM_DROP_AFTER_MS = 60 * 60 * 1000;

const POSITION_TYPES = new Set(['trading', 'position-management']);
const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const integerAmount = /^(0|[1-9][0-9]{0,39})$/;
const USD_SCALE = 6;

export function walletAddress(bot) {
  if (!bot || typeof bot !== 'object') return null;
  const candidate = bot.address ?? bot.walletAddress ?? bot.wallet?.address ?? null;
  return typeof candidate === 'string' && base58.test(candidate) ? candidate : null;
}

export function botEligibleForPositionCheck(bot) {
  if (!bot || typeof bot.id !== 'string' || bot.id.length < 1 || bot.id.length > 128) return false;
  if (bot.enabled === false || bot.frozen === true) return false;
  if (bot.type == null) return true;
  return POSITION_TYPES.has(bot.type);
}

export function botEligibleForStreamRecheck(bot) {
  if (!bot || typeof bot.id !== 'string' || bot.id.length < 1 || bot.id.length > 128) return false;
  if (bot.enabled === false) return false;
  return walletAddress(bot) != null;
}

/**
 * A stream is dropped when we have never seen a delivery, the last delivery
 * is older than an hour, or a caller marks it down after the last success.
 */
export function isStreamDropped(health, now, thresholdMs = STREAM_DROP_AFTER_MS) {
  if (!Number.isSafeInteger(now)) return true;
  if (!health || typeof health !== 'object') return true;
  const lastEventAt = health.lastEventAt;
  if (health.status === 'down') {
    const failedAt = health.lastFailureAt;
    if (!Number.isSafeInteger(failedAt)) return true;
    if (!Number.isSafeInteger(lastEventAt) || failedAt > lastEventAt) return true;
  }
  if (!Number.isSafeInteger(lastEventAt)) return true;
  return now - lastEventAt > thresholdMs;
}

export function planScheduledWork({ bots, now, cron, health, thresholdMs = STREAM_DROP_AFTER_MS } = {}) {
  const list = Array.isArray(bots) ? bots : [];
  const hourly = cron === HOURLY_CRON;
  const fallbackTick = cron === STREAM_FALLBACK_CRON;
  const streamDropped = (hourly || fallbackTick) && isStreamDropped(health, now, thresholdMs);
  const positionChecks = hourly ? list.filter(botEligibleForPositionCheck) : [];
  const recheckBots = streamDropped ? list.filter(botEligibleForStreamRecheck) : [];
  const walletRechecks = [];
  const seen = new Set();
  for (const bot of recheckBots) {
    const address = walletAddress(bot);
    if (!address || seen.has(address)) continue;
    seen.add(address);
    walletRechecks.push({
      address,
      botIds: recheckBots.filter(item => walletAddress(item) === address).map(item => item.id),
    });
  }
  return { hourly, streamDropped, positionChecks, recheckBots, walletRechecks };
}

function parseDecimalFloor(value, scale) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) return null;
  const [whole, frac = ''] = value.split('.');
  const fraction = frac.padEnd(scale, '0').slice(0, scale);
  return BigInt(whole + fraction);
}

function microUsd(amount, decimals, priceUsd) {
  if (typeof amount !== 'string' || !integerAmount.test(amount)) return null;
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 18) return null;
  const price = parseDecimalFloor(priceUsd, USD_SCALE);
  if (price == null) return null;
  return (BigInt(amount) * price) / (10n ** BigInt(decimals));
}

function publicBalance(balance) {
  if (!balance || typeof balance !== 'object') return null;
  const address = typeof balance.address === 'string' && base58.test(balance.address) ? balance.address : null;
  const amount = typeof balance.amount === 'string' && integerAmount.test(balance.amount) ? balance.amount : null;
  const ok = balance.ok === true && amount != null;
  return {
    ok,
    code: ok ? null : (typeof balance.code === 'string' ? balance.code.slice(0, 64) : 'rpc_rejected'),
    cluster: SOLANA_CLUSTER,
    mint: ok ? SOLANA_USDC_MINT : null,
    address,
    amount: ok ? amount : null,
  };
}

function quotePrice(quote) {
  if (!quote || typeof quote !== 'object') return null;
  if (quote.error) return null;
  if (typeof quote.priceUsd !== 'string') return null;
  return quote.priceUsd;
}

/**
 * Mark wallet holdings in USD. A mark without a cost basis has no known loss.
 */
export function assessPositions({ bot, positions, quotes, balance, reason, now, available = true } = {}) {
  const at = Number.isSafeInteger(now) ? now : 0;
  const botId = typeof bot?.id === 'string' ? bot.id : '';
  const maxLoss = typeof bot?.maxLoss === 'string' && integerAmount.test(bot.maxLoss) ? BigInt(bot.maxLoss) : null;
  const listed = Array.isArray(positions) ? positions.slice(0, 30) : [];
  const rows = [];
  let loss = 0n;
  let lossKnown = true;

  for (const position of listed) {
    const mint = typeof position?.mint === 'string' && base58.test(position.mint) ? position.mint : null;
    const decimals = Number.isSafeInteger(position?.decimals) ? position.decimals : 6;
    const amount = typeof position?.amount === 'string' ? position.amount : null;
    const priceUsd = mint ? quotePrice(quotes?.[mint]) : null;
    const mark = mint && priceUsd ? microUsd(amount, decimals, priceUsd) : null;
    const entry = typeof position?.entryPriceUsd === 'string'
      ? microUsd(amount, decimals, position.entryPriceUsd)
      : null;
    if (mark == null || entry == null) lossKnown = false;
    else if (entry > mark) loss += entry - mark;
    rows.push({
      mint,
      amount: typeof amount === 'string' && integerAmount.test(amount) ? amount : null,
      decimals,
      priceUsd: mark == null ? null : priceUsd,
      markMicroUsd: mark == null ? null : mark.toString(),
      entryMicroUsd: entry == null ? null : entry.toString(),
      quoteSource: typeof quotes?.[mint]?.quoteSource === 'string' ? quotes[mint].quoteSource.slice(0, 64) : null,
      pricingCluster: mark == null ? null : 'mainnet',
    });
  }

  let flag = available ? 'clear' : 'unpriced';
  let status = available ? 'no-positions' : 'unavailable';
  if (rows.length > 0) {
    status = lossKnown ? 'checked' : 'partial';
    if (maxLoss != null && lossKnown && loss > maxLoss) flag = 'max-loss';
    else if (
      maxLoss != null
      && maxLoss > 0n
      && lossKnown
      && loss > 0n
      && loss < maxLoss
      && loss * 5n >= maxLoss * 4n
    ) flag = 'near-max-loss';
    else if (!lossKnown) flag = 'unpriced';
    else flag = 'within-cap';
  }
  if (reason === 'stream-drop-recheck') {
    status = 'recheck';
    flag = 'stream-fallback';
  }

  return {
    botId,
    at,
    reason: reason === 'stream-drop-recheck' ? 'stream-drop-recheck' : 'cron-hourly',
    paper: false,
    label: EXECUTION_LABEL,
    status,
    flag,
    unrealizedLossMicroUsd: available && lossKnown ? loss.toString() : null,
    maxLoss: maxLoss == null ? null : maxLoss.toString(),
    positions: rows,
    balance: publicBalance(balance),
  };
}

function supabaseConfig(env) {
  const rawUrl = env?.SUPABASE_URL;
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') return null;
  if (typeof key !== 'string' || key.trim() === '') return null;
  let url;
  try { url = new URL(rawUrl); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  return { origin: url.origin, key: key.trim() };
}

function supabaseHeaders(key) {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    accept: 'application/json',
  };
}

async function supabaseGet(env, path, fetcher) {
  const config = supabaseConfig(env);
  if (!config) return { configured: false, rows: null };
  let response;
  try {
    response = await fetcher(`${config.origin}/rest/v1/${path}`, {
      method: 'GET',
      headers: supabaseHeaders(config.key),
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { configured: true, rows: null };
  }
  if (!response.ok) return { configured: true, rows: null };
  try {
    const rows = await response.json();
    return { configured: true, rows: Array.isArray(rows) ? rows : null };
  } catch {
    return { configured: true, rows: null };
  }
}

function asAmount(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && integerAmount.test(value)) return value;
  return null;
}

function mapBotRow(row) {
  if (!row || typeof row.id !== 'string' || row.id.length < 1) return null;
  const wallet = Array.isArray(row.wallets) ? row.wallets[0] : row.wallets;
  return {
    id: row.id,
    goal: typeof row.goal === 'string' ? row.goal : '',
    type: typeof row.type === 'string' ? row.type : null,
    enabled: row.enabled !== false,
    frozen: row.frozen === true,
    maxLoss: asAmount(row.max_loss),
    ownerId: typeof row.owner_id === 'string' ? row.owner_id : null,
    asset: typeof row.cap_asset === 'string' ? row.cap_asset : null,
    address: typeof wallet?.address === 'string' ? wallet.address : null,
    positions: [],
  };
}

/** Enabled bots for the cron. Returns [] when Supabase is not configured. */
export async function listScheduledBotsFromSupabase(env, fetcher = fetch) {
  const result = await supabaseGet(
    env,
    'bots?enabled=eq.true&select=id,owner_id,goal,type,enabled,frozen,max_loss,cap_asset,wallets(address)',
    fetcher,
  );
  if (!result.rows) return [];
  return result.rows.map(mapBotRow).filter(Boolean);
}

/** Latest Streams delivery. `source: unconfigured` when Supabase is absent. */
export async function readStreamHealthFromSupabase(env, fetcher = fetch) {
  const result = await supabaseGet(
    env,
    'stream_events?select=processed_at&order=processed_at.desc&limit=1',
    fetcher,
  );
  if (!result.configured) return { lastEventAt: null, status: 'unknown', source: 'unconfigured' };
  const stamp = result.rows?.[0]?.processed_at;
  const lastEventAt = typeof stamp === 'string' ? Date.parse(stamp) : NaN;
  if (!Number.isSafeInteger(lastEventAt)) return { lastEventAt: null, status: 'unknown', source: 'supabase' };
  return { lastEventAt, status: 'up', source: 'supabase' };
}

