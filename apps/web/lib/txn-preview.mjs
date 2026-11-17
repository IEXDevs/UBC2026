/**
 * Transaction preview and log rows. No signing.
 */
import { formatBaseUnits, solscanTxUrl } from './money-views.mjs';

const SIG = /^[1-9A-HJ-NP-Za-km-z]{32,88}$/;
const CLUSTER = new Set(['mainnet', 'devnet', 'testnet']);

export function sendPreview({ from, to, amountLabel }) {
  return {
    kind: 'send',
    title: `Send ${amountLabel}`,
    lines: [
      { label: 'From', value: from || 'Agent wallet' },
      { label: 'To', value: to || '' },
      { label: 'Amount', value: amountLabel },
      { label: 'Network', value: 'devnet execution, mainnet pricing' },
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
      { label: 'Network', value: 'devnet execution, mainnet pricing' },
    ],
  };
}

export function signatureOf(detail) {
  if (!detail || typeof detail !== 'object') return null;
  for (const key of ['txSignature', 'signature', 'tx']) {
    const value = detail[key];
    if (typeof value === 'string' && SIG.test(value)) return value;
  }
  return null;
}

function clusterOf(value) {
  return typeof value === 'string' && CLUSTER.has(value) ? value : 'devnet';
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

export function logRows({ receipts = [], payments = [], transfers = [], activity = [] } = {}) {
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
        line('Network', cluster),
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
        line('Network', 'Platform ledger · devnet execution, mainnet pricing'),
      ].filter(Boolean),
      solscanUrl: null,
    });
  }
  for (const item of activity) {
    if (!item?.id) continue;
    const detail = item.detail && typeof item.detail === 'object' ? item.detail : {};
    const signature = signatureOf(detail);
    const cluster = clusterOf(detail.cluster);
    rows.push({
      id: item.id,
      at: item.at || 0,
      title: [item.action, item.status].filter(Boolean).join(' · ') || 'Activity',
      lines: [
        line('Agent', item.botId),
        line('Source', item.source),
        line('Signature', signature),
      ].filter(Boolean),
      solscanUrl: solscanTxUrl(signature, cluster),
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
