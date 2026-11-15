/**
 * Profile statistics. Voice time is measured on this device.
 * Spend counts come from the same owner rollup as the runtime metrics route.
 */
import { buildBotStats, buildOverview } from './overview.mjs';

export function voiceMinutes(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round((ms / 60000) * 10) / 10;
}

export function statisticsView({ bots = [], ownerId = 'demo_owner', remoteMetric = null, voiceMs = 0 } = {}) {
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
      ? 'Counted from the agent runtime. devnet execution, mainnet pricing.'
      : 'Counted from activity stored for these agents. devnet execution, mainnet pricing.',
    ownerRows,
    agents,
  };
}
