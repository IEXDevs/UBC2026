
import { EXECUTION_LABEL } from '@ubc2026/contracts/solana';
/**
 * Profile statistics. Voice time is measured on this device.
 * Token totals use the provider usage when a line has it, and estimate the rest.
 * Spend counts come from the owner payment and transfer rows.
 */
import { estimateTokens, formatTokens } from './context-usage.mjs';
import { formatBaseUnits } from './money-views.mjs';
import { buildBotStats, buildOverview } from './overview.mjs';

const AMOUNT = /^(0|[1-9][0-9]{0,39})$/;

function units(value) {
  return typeof value === 'string' && AMOUNT.test(value) ? BigInt(value) : 0n;
}

function usdcFlow(row) {
  if (row?.asset && row.asset !== 'USDC') return null;
  if (row?.direction === 'paid' || row?.direction === 'out') return 'out';
  if (row?.direction === 'earned' || row?.direction === 'in') return 'in';
  return null;
}

function lineTokens(line) {
  const reported = Number(line?.tokens);
  if (Number.isSafeInteger(reported) && reported > 0) return reported;
  return estimateTokens(line?.text);
}

function usdcLabel(amount, signed = false) {
  const negative = amount < 0n;
  const body = formatBaseUnits((negative ? -amount : amount).toString());
  return `${signed && negative ? '−' : ''}${body} USDC`;
}

/** Owner figures for the profile and the statistics sheet. */
export function profileStats({ voiceMs = 0, talks = {}, payments = [], transfers = [] } = {}) {
  const lines = Object.values(talks && typeof talks === 'object' ? talks : {}).flatMap(rows => (
    Array.isArray(rows) ? rows : []
  ));
  const seconds = Math.floor(Math.max(0, Number(voiceMs) || 0) / 1000);
  const messages = lines.filter(line => line?.role === 'user').length;
  const tokens = lines.reduce((sum, line) => sum + lineTokens(line), 0);
  let inflow = 0n;
  let outflow = 0n;
  for (const row of [...(Array.isArray(payments) ? payments : []), ...(Array.isArray(transfers) ? transfers : [])]) {
    const flow = usdcFlow(row);
    const amount = units(row?.amount);
    if (flow === 'in') inflow += amount;
    if (flow === 'out') outflow += amount;
  }
  return [
    { key: 'voice', label: 'Talk time', value: `${seconds}s` },
    { key: 'messages', label: 'Messages sent', value: String(messages) },
    { key: 'tokens', label: 'Tokens used', value: formatTokens(tokens) },
    { key: 'spent', label: 'Money spent', value: usdcLabel(outflow) },
    { key: 'pnl', label: 'Net PnL', value: usdcLabel(inflow - outflow, true) },
  ];
}

export function voiceMinutes(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round((ms / 60000) * 10) / 10;
}

export function statisticsView({ bots = [], ownerId = '', remoteMetric = null, voiceMs = 0 } = {}) {
  const list = Array.isArray(bots) ? bots : [];
  const overview = buildOverview({ bots: list, ownerId, remoteMetric });
  const ownerRows = [
    { key: 'voice', label: 'Mins on voice', value: voiceMinutes(voiceMs), decimals: 1 },
    ...overview.cards.map(card => ({
      key: card.key,
      label: card.label,
      value: Number(card.value) || 0,
      decimals: 0,
    })),
    { key: 'pnl', label: 'Paper PnL', text: overview.pnlLabel },
  ];
  const agents = list.map(bot => {
    const stats = buildBotStats(bot);
    return {
      id: bot.id,
      label: stats.name || bot.id,
      rows: stats.cards.map(card => ({
        key: card.key,
        label: card.label,
        value: Number(card.value) || 0,
        decimals: 0,
      })),
    };
  });
  return {
    source: overview.source,
    note: overview.source === 'runtime'
      ? `Counted from the agent runtime. ${EXECUTION_LABEL}.`
      : `Counted from activity stored for these agents. ${EXECUTION_LABEL}.`,
    ownerRows,
    agents,
  };
}
