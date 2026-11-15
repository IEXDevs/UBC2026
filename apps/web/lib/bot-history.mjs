import { solanaExplorerTxUrl } from './money-views.mjs';
import { partyFromToken } from './party-book.mjs';

const AMOUNT = /^(0|[1-9][0-9]{0,39})$/;

function units(amount) {
  return typeof amount === 'string' && AMOUNT.test(amount) ? amount : null;
}

function botName(bots, botId) {
  return bots.find(bot => bot.id === botId)?.name ?? '';
}

export function botHistoryRows({ payments = [], transfers = [], bots = [] } = {}) {
  const rows = [];
  for (const payment of payments) {
    const amount = units(payment?.amount);
    if (!amount || !payment?.id) continue;
    const direction = payment.direction === 'paid' ? 'out' : 'in';
    rows.push({
      id: payment.id,
      botId: payment.botId ?? null,
      botName: botName(bots, payment.botId),
      direction,
      amount,
      asset: payment.asset || 'USDC',
      title: payment.counterparty || 'Payment',
      detail: [botName(bots, payment.botId), payment.protocol, payment.cluster].filter(Boolean).join(' · '),
      party: partyFromToken(payment.counterparty),
      explorerUrl: solanaExplorerTxUrl(payment.txSignature, payment.cluster),
      legs: Array.isArray(payment.netLegs) ? payment.netLegs : null,
      badge: payment.streamConfirmed === true ? 'confirmed' : null,
    });
  }
  for (const transfer of transfers) {
    const amount = units(transfer?.amount);
    if (!amount || !transfer?.id) continue;
    const handle = typeof transfer.handle === 'string' ? transfer.handle : '';
    rows.push({
      id: transfer.id,
      botId: transfer.botId ?? null,
      botName: botName(bots, transfer.botId),
      direction: transfer.direction === 'in' ? 'in' : 'out',
      amount,
      asset: 'USDC',
      title: handle ? `@${handle}` : 'Platform',
      detail: botName(bots, transfer.botId) ? `${botName(bots, transfer.botId)} · Platform` : 'Platform',
      party: partyFromToken(handle ? `@${handle}` : ''),
      explorerUrl: null,
      legs: null,
    });
  }
  return rows;
}

export function filterBotHistory(rows, { botId = '', flow = 'all', minUnits = '0' } = {}) {
  const floor = units(minUnits) ?? '0';
  const minimum = BigInt(floor);
  return rows.filter(row => {
    if (botId && row.botId !== botId) return false;
    if (flow === 'in' || flow === 'out') {
      if (row.direction !== flow) return false;
    }
    if (BigInt(row.amount) < minimum) return false;
    return true;
  });
}
