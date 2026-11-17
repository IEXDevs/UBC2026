/**
 * Persist paper position checks through the Supabase service role.
 * Caller must pass a verified ownerId (from the bot row / cron plan), never a
 * client-supplied claim alone. Service role bypasses RLS — every write filters
 * and stamps owner_id from that verified value, and re-checks bots.owner_id.
 */
import { redactForLog } from './activity-log.mjs';
import { supabaseConfig, supabaseGet, supabaseWrite } from './supabase-rest.mjs';

const OWNER = /^[a-zA-Z0-9:_-]{1,128}$/;
const BOT = /^[a-zA-Z0-9:_-]{1,128}$/;
const AMOUNT = /^(0|[1-9][0-9]{0,39})$/;
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function slimCheckDetail(check) {
  const positions = Array.isArray(check?.positions)
    ? check.positions.slice(0, 30).map(row => ({
      mint: typeof row?.mint === 'string' ? row.mint.slice(0, 64) : null,
      amount: typeof row?.amount === 'string' && AMOUNT.test(row.amount) ? row.amount : null,
      decimals: Number.isSafeInteger(row?.decimals) ? row.decimals : null,
      markMicroUsd: typeof row?.markMicroUsd === 'string' ? row.markMicroUsd : null,
      entryMicroUsd: typeof row?.entryMicroUsd === 'string' ? row.entryMicroUsd : null,
      quoteSource: typeof row?.quoteSource === 'string' ? row.quoteSource.slice(0, 64) : null,
    }))
    : [];
  return redactForLog({
    paper: true,
    label: typeof check?.label === 'string' ? check.label.slice(0, 80) : null,
    flag: typeof check?.flag === 'string' ? check.flag.slice(0, 64) : null,
    status: typeof check?.status === 'string' ? check.status.slice(0, 64) : null,
    positionCount: positions.length,
    // Amounts are trading state, not secrets — still omit tokens/headers if present.
    positions,
    balanceOk: check?.balance?.ok === true,
  });
}

/**
 * Upsert open paper lots for an owner-scoped bot. Replaces open rows for that bot.
 */
export async function persistPositionCheck(env, { ownerId, botId, check, positions } = {}) {
  if (!OWNER.test(ownerId) || !BOT.test(botId)) return { wrote: false, reason: 'invalid_ids' };
  if (!supabaseConfig(env)) return { wrote: false, reason: 'unconfigured' };
  const fetcher = env.fetch ?? fetch;
  const owned = await supabaseGet(
    env,
    `bots?id=eq.${encodeURIComponent(botId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=id`,
    fetcher,
  );
  if (owned.configured && !owned.rows?.length) {
    return { wrote: false, reason: 'owner_mismatch' };
  }
  const at = Number.isSafeInteger(check?.at) ? check.at : Date.now();
  const detail = slimCheckDetail(check);
  const checkRow = {
    owner_id: ownerId,
    bot_id: botId,
    at,
    reason: check?.reason === 'stream-drop-recheck' ? 'stream-drop-recheck' : (check?.reason === 'owner' ? 'owner' : 'cron-hourly'),
    status: typeof check?.status === 'string' ? check.status.slice(0, 64) : 'checked',
    flag: typeof check?.flag === 'string' ? check.flag.slice(0, 64) : 'clear',
    unrealized_loss_micro_usd: typeof check?.unrealizedLossMicroUsd === 'string'
      && AMOUNT.test(check.unrealizedLossMicroUsd)
      ? check.unrealizedLossMicroUsd
      : '0',
    max_loss: typeof check?.maxLoss === 'string' && AMOUNT.test(check.maxLoss) ? check.maxLoss : null,
    detail,
  };
  await supabaseWrite(env, {
    path: 'position_checks',
    method: 'POST',
    body: checkRow,
    prefer: 'return=minimal',
    fetcher,
  });

  const listed = Array.isArray(positions) ? positions.slice(0, 30) : [];
  for (const row of listed) {
    const mint = typeof row?.mint === 'string' && MINT.test(row.mint) ? row.mint : null;
    const amount = typeof row?.amount === 'string' && AMOUNT.test(row.amount) ? row.amount : null;
    if (!mint || !amount) continue;
    const id = `pos:${botId}:${mint}`;
    const decimals = Number.isSafeInteger(row?.decimals) && row.decimals >= 0 && row.decimals <= 18
      ? row.decimals
      : 6;
    const entry = typeof row?.entryMicroUsd === 'string' && AMOUNT.test(row.entryMicroUsd)
      ? row.entryMicroUsd
      : '0';
    await supabaseWrite(env, {
      path: 'paper_positions?on_conflict=id',
      method: 'POST',
      body: {
        id,
        owner_id: ownerId,
        bot_id: botId,
        mint,
        symbol: typeof row?.symbol === 'string' ? row.symbol.slice(0, 16) : null,
        kind: typeof row?.kind === 'string' ? row.kind.slice(0, 32) : null,
        decimals,
        quantity: amount,
        entry_micro_usdc: entry,
        realized_micro_usdc: '0',
        status: 'open',
        mode: 'paper',
        cluster: 'devnet',
        opened_at: at,
        updated_at: at,
        label: 'devnet execution, mainnet pricing',
      },
      prefer: 'resolution=merge-duplicates,return=minimal',
      fetcher,
    });
  }
  return { wrote: true };
}
