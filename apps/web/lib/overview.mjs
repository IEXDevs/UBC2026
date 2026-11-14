/**
 * Overview dashboard model (Isaac / 7C).
 * Owner rollup + per-bot status. Presentation only — no secrets, no signing.
 */
import { validateMetric } from '@ubc2026/contracts';

export const OVERVIEW_METRIC_KEYS = Object.freeze([
  'decisions',
  'transactionsExecuted',
  'mismatchesCaught',
  'transactionsBlocked',
  'approvalsRequested',
  'approvalsGranted',
  'x402Payments',
]);

const LABELS = Object.freeze({
  decisions: 'Decisions',
  transactionsExecuted: 'Tx executed',
  mismatchesCaught: 'Mismatches caught',
  transactionsBlocked: 'Tx blocked',
  approvalsRequested: 'Approvals asked',
  approvalsGranted: 'Approvals granted',
  x402Payments: 'x402 payments',
});

export function metricsUrl(runtimeBase) {
  if (typeof runtimeBase !== 'string' || runtimeBase === '') return null;
  let base;
  try { base = new URL(runtimeBase); } catch { return null; }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;
  const root = `${base.origin}${base.pathname.replace(/\/$/, '')}`;
  return `${root}/api/metrics`;
}

export function emptyMetric(ownerId = 'demo_owner') {
  return {
    id: 'metric_rollup',
    ownerId,
    botId: null,
    decisions: 0,
    transactionsExecuted: 0,
    mismatchesCaught: 0,
    transactionsBlocked: 0,
    approvalsRequested: 0,
    approvalsGranted: 0,
    x402Payments: 0,
    pnlMicroUsdc: '0',
  };
}

/** Normalize a remote /api/metrics payload (single rollup or { items: [...] }). */
export function pickOwnerRollup(payload, ownerId) {
  const items = Array.isArray(payload?.items) ? payload.items
    : Array.isArray(payload) ? payload
      : payload && typeof payload === 'object' && payload.id ? [payload]
        : [];
  for (const item of items) {
    if (!item || item.botId != null) continue;
    try {
      return validateMetric({
        ...emptyMetric(ownerId),
        ...item,
        ownerId: item.ownerId || ownerId,
        botId: null,
        pnlMicroUsdc: item.pnlMicroUsdc ?? item.pnl_micro_usdc ?? '0',
        transactionsExecuted: item.transactionsExecuted ?? item.transactions_executed ?? 0,
        mismatchesCaught: item.mismatchesCaught ?? item.mismatches_caught ?? 0,
        transactionsBlocked: item.transactionsBlocked ?? item.transactions_blocked ?? 0,
        approvalsRequested: item.approvalsRequested ?? item.approvals_requested ?? 0,
        approvalsGranted: item.approvalsGranted ?? item.approvals_granted ?? 0,
        x402Payments: item.x402Payments ?? item.x402_payments ?? 0,
      });
    } catch {
      continue;
    }
  }
  return null;
}

function tallyBot(bot, metric) {
  const preview = bot?.experience?.preview;
  if (preview?.state === 'approval-needed') {
    metric.approvalsRequested += 1;
    metric.decisions += 1;
  }
  const events = bot?.experience?.events ?? [];
  for (const event of events) {
    if (event?.kind === 'tx.confirmed') metric.transactionsExecuted += 1;
    if (event?.kind === 'verify.mismatch') metric.mismatchesCaught += 1;
    if (event?.kind === 'payment.x402') metric.x402Payments += 1;
    if (event?.kind === 'approval.granted') metric.approvalsGranted += 1;
    if (event?.kind === 'tool.call' || event?.kind === 'run.checkpoint') metric.decisions += 1;
  }
  return metric;
}

/** Stats for one bot, from its own preview and timeline. */
export function buildBotStats(bot) {
  const metric = tallyBot(bot, emptyMetric(bot?.id ?? 'bot'));
  return {
    name: bot?.name ?? '',
    status: bot?.status ?? '',
    type: bot?.type ?? '',
    cards: OVERVIEW_METRIC_KEYS.map((key) => ({
      key,
      label: LABELS[key],
      value: metric[key] ?? 0,
    })),
  };
}

export function formatPnlMicroUsdc(pnlMicroUsdc) {
  if (typeof pnlMicroUsdc !== 'string' || !/^-?(0|[1-9][0-9]{0,39})$/.test(pnlMicroUsdc)) return '—';
  const negative = pnlMicroUsdc.startsWith('-');
  const raw = negative ? pnlMicroUsdc.slice(1) : pnlMicroUsdc;
  const whole = BigInt(raw);
  const major = whole / 1_000_000n;
  const minor = (whole % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  const body = minor ? `${major}.${minor}` : `${major}`;
  return `${negative ? '−' : ''}${body} USDC`;
}

/**
 * Build the Overview view model from local bots + optional remote rollup.
 * Demo metrics are derived from bot experience previews so the pane is never blank.
 */
export function buildOverview({ bots = [], ownerId = 'demo_owner', remoteMetric = null } = {}) {
  const list = Array.isArray(bots) ? bots : [];
  const byStatus = { watching: 0, idle: 0, paused: 0, enabled: 0, draft: 0, other: 0 };
  for (const bot of list) {
    const key = byStatus[bot.status] != null ? bot.status : 'other';
    byStatus[key] += 1;
  }

  let metric = remoteMetric;
  if (!metric) {
    metric = emptyMetric(ownerId);
    for (const bot of list) tallyBot(bot, metric);
  }

  const cards = OVERVIEW_METRIC_KEYS.map((key) => ({
    key,
    label: LABELS[key],
    value: metric[key] ?? 0,
  }));

  return {
    title: 'Overview',
    subtitle: 'Owner rollup across every bot — decisions, gates, and spends.',
    ownerId,
    botCount: list.length,
    byStatus,
    bots: list.map((bot) => ({
      id: bot.id,
      name: bot.name,
      type: bot.type,
      status: bot.status,
      goal: bot.goal,
    })),
    cards,
    pnlLabel: formatPnlMicroUsdc(metric.pnlMicroUsdc),
    source: remoteMetric ? 'runtime' : 'local',
  };
}
