/**
 * Supabase REST helpers for the agent-runtime Worker.
 * Uses the service role when present. Returns null / empty when not configured
 * so offline tests stay secret-free.
 */
import { directoryFailureCode } from '@ubc2026/contracts';

export function supabaseConfig(env) {
  const rawUrl = env?.SUPABASE_URL;
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') return null;
  if (typeof key !== 'string' || key.trim() === '') return null;
  let url;
  try { url = new URL(rawUrl); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  return { origin: url.origin, key: key.trim() };
}

export function supabaseHeaders(key, extra = {}) {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    accept: 'application/json',
    ...extra,
  };
}

export async function supabaseGet(env, path, fetcher = fetch) {
  const config = supabaseConfig(env);
  if (!config) return { configured: false, rows: null, status: 0 };
  let response;
  try {
    response = await fetcher(`${config.origin}/rest/v1/${path}`, {
      method: 'GET',
      headers: supabaseHeaders(config.key),
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { configured: true, rows: null, status: 0 };
  }
  if (!response.ok) {
    let parsed = null;
    try { parsed = await response.json(); } catch { parsed = null; }
    const code = directoryFailureCode(response.status, parsed);
    return { configured: true, rows: null, status: response.status, ...(code ? { code } : {}) };
  }
  try {
    const rows = await response.json();
    return { configured: true, rows: Array.isArray(rows) ? rows : null, status: response.status };
  } catch {
    return { configured: true, rows: null, status: response.status };
  }
}

export async function supabaseWrite(env, {
  path,
  method = 'POST',
  body,
  prefer = 'return=representation',
  fetcher = fetch,
} = {}) {
  const config = supabaseConfig(env);
  if (!config) return { configured: false, rows: null, status: 0 };
  let response;
  try {
    response = await fetcher(`${config.origin}/rest/v1/${path}`, {
      method,
      headers: supabaseHeaders(config.key, {
        'content-type': 'application/json',
        prefer,
      }),
      body: body == null ? undefined : JSON.stringify(body),
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { configured: true, rows: null, status: 0, ok: false };
  }
  let parsed = null;
  try { parsed = await response.json(); } catch { parsed = null; }
  const rows = Array.isArray(parsed) ? parsed : parsed == null ? null : [parsed];
  const code = response.ok ? '' : directoryFailureCode(response.status, parsed);
  return { configured: true, rows, status: response.status, ok: response.ok, ...(code ? { code } : {}) };
}

/** Postgres RPC caller for createSupabaseLedger. */
export function createSupabaseRpc(env, fetcher = fetch) {
  const config = supabaseConfig(env);
  if (!config) return null;
  return async (fn, payload) => {
    const response = await fetcher(`${config.origin}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: supabaseHeaders(config.key, { 'content-type': 'application/json' }),
      body: JSON.stringify(payload ?? {}),
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const error = new Error(`rpc_${fn}_${response.status}`);
      error.code = `rpc_${fn}_failed`;
      error.status = response.status;
      error.body = text.slice(0, 500);
      throw error;
    }
    return response.json();
  };
}

export function amountText(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^(0|[1-9][0-9]{0,39})$/.test(value)) return value;
  return '0';
}

export function mapWalletRow(row) {
  if (!row || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    kind: row.kind,
    label: row.label,
    address: row.address,
    provider: row.provider || 'privy',
    frozen: row.frozen === true,
    spendable: row.spendable !== false && !String(row.id).startsWith('linked_'),
    privyWalletId: row.spendable === false || String(row.id).startsWith('linked_') ? undefined : row.id,
    createdAt: row.created_at ?? null,
  };
}

export function mapBotRow(row) {
  if (!row || typeof row.id !== 'string') return null;
  const cap = {
    mode: row.cap_mode,
    asset: row.cap_asset,
  };
  if (row.max_outflow != null) cap.maxOutflow = amountText(row.max_outflow);
  if (row.max_per_transaction != null) cap.maxPerTransaction = amountText(row.max_per_transaction);
  if (row.max_loss != null) cap.maxLoss = amountText(row.max_loss);
  return {
    id: row.id,
    ownerId: row.owner_id,
    walletId: row.wallet_id,
    name: row.name,
    goal: row.goal,
    type: row.type,
    approvalMode: row.approval_mode,
    autoApproveCap: row.auto_approve_cap == null ? undefined : amountText(row.auto_approve_cap),
    templateId: row.template_id ?? undefined,
    enabled: row.enabled !== false,
    frozen: row.frozen === true,
    policyVersion: Number.isSafeInteger(row.policy_version) ? row.policy_version : 1,
    cap,
    createdAt: row.created_at ?? null,
  };
}

export function mapLedgerRow(row, botId) {
  return {
    botId: botId || row?.bot_id || '',
    asset: typeof row?.asset === 'string' ? row.asset : 'USDC',
    spent: amountText(row?.spent),
    reserved: amountText(row?.reserved),
    realizedLoss: amountText(row?.realized_loss),
  };
}

export async function loadOwnerLoopContext(env, { botId, ownerId }, fetcher = fetch) {
  if (!botId || !ownerId) return null;
  const botResult = await supabaseGet(
    env,
    `bots?id=eq.${encodeURIComponent(botId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=*`,
    fetcher,
  );
  const bot = mapBotRow(botResult.rows?.[0]);
  if (!bot) return null;
  const walletResult = await supabaseGet(
    env,
    `wallets?id=eq.${encodeURIComponent(bot.walletId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=*`,
    fetcher,
  );
  const wallet = mapWalletRow(walletResult.rows?.[0]);
  if (!wallet) return null;
  const ledgerResult = await supabaseGet(
    env,
    `spend_ledgers?bot_id=eq.${encodeURIComponent(botId)}&select=*`,
    fetcher,
  );
  const ledger = mapLedgerRow(ledgerResult.rows?.[0], botId);
  return { bot, wallet, ledger };
}
