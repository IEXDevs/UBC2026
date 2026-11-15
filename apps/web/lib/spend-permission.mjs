/**
 * Owner permission for agent actions. A transaction always waits for the person,
 * no matter which mode is selected.
 */
import { formatBaseUnits } from './money-views.mjs';

export const SPEND_PERMISSION_KEY = 'maelstrom.spendPermission';

export const PERMISSIONS = Object.freeze([
  Object.freeze({ id: 'ask', label: 'Ask every time', color: '#3dbe6a' }),
  Object.freeze({ id: 'review', label: 'Review by AI', color: '#e6b325' }),
  Object.freeze({ id: 'full', label: 'Full permissions', color: '#e10600' }),
]);

const AMOUNT = /^(0|[1-9][0-9]{0,39})$/;

export function parsePermission(value) {
  return PERMISSIONS.some(item => item.id === value) ? value : 'ask';
}

export function permissionById(id) {
  return PERMISSIONS.find(item => item.id === parsePermission(id));
}

/** Transactions are never auto-sent. */
export function transactionNeedsPerson() {
  return true;
}

export function permissionInstruction(id) {
  const mode = parsePermission(id);
  const shared = 'A transaction, trade, or transfer is never sent until the owner confirms a summary of the net changes.';
  if (mode === 'full') {
    return `Permission is full. You may research, browse, and prepare actions without asking. ${shared}`;
  }
  if (mode === 'review') {
    return `Permission is review by AI. Research freely, then state what you would change and wait before any trade or state change. ${shared}`;
  }
  return `Permission is ask every time. Ask the owner before a trade, a spend, or any action that changes state. ${shared}`;
}

function units(value) {
  return typeof value === 'string' && AMOUNT.test(value) ? value : null;
}

function signedUnits(amount, direction) {
  const clean = units(amount);
  if (!clean) return null;
  const negative = direction === 'out' || direction === 'paid';
  return `${negative ? '−' : '+'}${formatBaseUnits(clean)}`;
}

/**
 * Lines the owner sees before a transaction. `legs` are { symbol, amount, direction }.
 * A plain send is one outflow.
 */
export function netChangeSummary({ amount, asset = 'USDC', handle = '', legs } = {}) {
  const rows = Array.isArray(legs) && legs.length > 0
    ? legs.map(leg => ({
      label: typeof leg.symbol === 'string' && leg.symbol ? leg.symbol : asset,
      signed: signedUnits(typeof leg.amount === 'string' ? leg.amount : String(leg.delta || '').replace(/^-/, ''), leg.direction || (String(leg.delta || '').startsWith('-') ? 'out' : 'in')),
    })).filter(row => row.signed)
    : [{ label: asset, signed: signedUnits(amount, 'out') }].filter(row => row.signed);
  let net = 0n;
  const source = Array.isArray(legs) && legs.length > 0 ? legs : [{ amount, direction: 'out', symbol: asset }];
  for (const leg of source) {
    const raw = typeof leg.amount === 'string' ? leg.amount : String(leg.delta || '').replace(/^-/, '');
    const clean = units(raw);
    if (!clean || (leg.symbol && leg.symbol !== 'USDC' && leg.symbol !== asset)) continue;
    const negative = leg.direction === 'out' || leg.direction === 'paid' || String(leg.delta || '').startsWith('-');
    net += negative ? -BigInt(clean) : BigInt(clean);
  }
  const negative = net < 0n;
  const body = formatBaseUnits((negative ? -net : net).toString());
  return {
    title: handle ? `Send to @${handle}` : 'Transaction',
    lines: rows,
    net: `${negative ? '−' : net === 0n ? '' : '+'}${body} ${asset}`,
  };
}
