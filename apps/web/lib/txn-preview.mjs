import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
/**
 * Transaction preview and log rows. No signing.
 */
import { formatBaseUnits, solscanTxUrl } from './money-views.mjs';
import { timelineSummary } from './bot-experience.mjs';

const CLUSTER = new Set(['mainnet', SOLANA_CLUSTER, 'testnet']);
const MONEY_EVENTS = new Map([
  ['payment.x402', 'Payment'],
  ['tx.submitted', 'Transaction submitted'],
  ['tx.confirmed', 'Transaction confirmed'],
  ['funds.grabbed', 'Funds returned'],
]);

export function sendPreview({ from, to, amountLabel }) {
  return {
    kind: 'send',
    title: `Send ${amountLabel}`,
    lines: [
      { label: 'From', value: from || 'Agent wallet' },
      { label: 'To', value: to || '' },
      { label: 'Amount', value: amountLabel },
    ],
  };
}

export function swapPreview({ pay, receive, from, to }) {
  return {
    kind: 'swap',
    title: `Swap ${pay} ${from}`,
    lines: [
      { label: 'Pay', value: `${pay} ${from}` },
      { label: 'Receive', value: receive ? `${receive} ${to}` : 'Quoted when you slide' },
      { label: 'Route', value: 'Jupiter' },
    ],
  };
}

function clusterOf(value) {
  return typeof value === 'string' && CLUSTER.has(value) ? value : SOLANA_CLUSTER;
}

function line(label, value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return { label, value: value.trim() };
}

export function formatLogTime(at) {
  const date = typeof at === 'number' ? new Date(at) : new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `${months[date.getUTCMonth()]} ${day}, ${date.getUTCFullYear()} ${hour}:${minute} UTC`;
}

export function logRows({ receipts = [], payments = [], transfers = [], history = [], events = [] } = {}) {
  const rows = [];
  for (const receipt of receipts) {
    if (!receipt?.id) continue;
    const cluster = clusterOf(receipt.cluster);
    rows.push({
      id: receipt.id,
      at: receipt.at || Date.now(),
      title: receipt.title || 'Transaction',
      lines: Array.isArray(receipt.lines) ? receipt.lines.filter(Boolean) : [],
      solscanUrl: solscanTxUrl(receipt.signature, cluster),
    });
  }
  for (const payment of payments) {
    if (!payment?.id) continue;
    const cluster = clusterOf(payment.cluster);
    const amount = typeof payment.amount === 'string' ? payment.amount : '';
    let amountLabel = amount;
    try { if (amount) amountLabel = `${formatBaseUnits(amount)} ${payment.asset || 'USDC'}`; } catch { /* keep raw */ }
    rows.push({
      id: payment.id,
      at: payment.createdAt || payment.at || 0,
      title: `${payment.direction === 'paid' ? 'Paid' : 'Received'} ${amountLabel}`,
      lines: [
        line('Counterparty', payment.counterparty),
        line('Protocol', payment.protocol),
        line('Signature', payment.txSignature),
      ].filter(Boolean),
      solscanUrl: solscanTxUrl(payment.txSignature, cluster),
    });
  }
  for (const transfer of transfers) {
    if (!transfer?.id) continue;
    let amountLabel = transfer.amount;
    try { amountLabel = `${formatBaseUnits(transfer.amount)} USDC`; } catch { /* keep raw */ }
    const direction = transfer.direction === 'in' ? 'Received' : 'Sent';
    rows.push({
      id: transfer.id,
      at: transfer.createdAt || transfer.at || 0,
      title: `${direction} ${amountLabel}`,
      lines: [
        line('Handle', transfer.handle ? `@${String(transfer.handle).replace(/^@/, '')}` : ''),
        line('Method', 'Platform ledger'),
      ].filter(Boolean),
      solscanUrl: null,
    });
  }
  const linkedTransactions = new Set(rows.map(row => row.solscanUrl).filter(Boolean));
  for (const transaction of history) {
    const solscanUrl = solscanTxUrl(transaction?.signature, clusterOf(transaction?.cluster));
    if (!transaction?.id || !solscanUrl || linkedTransactions.has(solscanUrl)) continue;
    linkedTransactions.add(solscanUrl);
    rows.push({
      id: transaction.id,
      at: transaction.at,
      title: transaction.title,
      lines: transaction.lines,
      solscanUrl,
    });
  }
  for (const event of events) {
    const title = MONEY_EVENTS.get(event?.kind);
    if (typeof event?.id !== 'string' || !event.id || !title) continue;
    // The QuickNode mainnet-beta stream uses the transaction signature as the event ID.
    const solscanUrl = event.kind === 'tx.confirmed' && event.id.startsWith('stream:')
      ? solscanTxUrl(event.id.slice('stream:'.length), SOLANA_CLUSTER)
      : null;
    if (solscanUrl && linkedTransactions.has(solscanUrl)) continue;
    rows.push({
      id: event.id,
      at: event.at || 0,
      title,
      lines: [
        line('Details', typeof event.summary === 'string' ? timelineSummary(event) : ''),
        line('Agent', event.botId),
      ].filter(Boolean),
      solscanUrl,
    });
  }
  const seen = new Set();
  return rows
    .filter(row => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    })
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
