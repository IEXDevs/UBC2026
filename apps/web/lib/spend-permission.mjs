/**
 * Owner permission for agent actions.
 * Full permissions lets the agent manage funds. Ask and review still wait
 * for the person. Every mode uses the same spend API.
 */
import { formatBaseUnits } from './money-views.mjs';

export const SPEND_PERMISSION_KEY = 'maelstrom.spendPermission';
export const REVIEW_THRESHOLD_KEY = 'maelstrom.reviewThreshold';

export function acceptanceStorageKey(ownerId) {
  return typeof ownerId === 'string' && ownerId.trim() ? `maelstrom.acceptance.${ownerId.trim()}` : '';
}

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

/** Ask and review wait for the person. Full permissions manages funds. */
export function transactionNeedsPerson(id) {
  return parsePermission(id) !== 'full';
}

export function managesFunds(id) {
  return parsePermission(id) === 'full';
}

export function readStoredPermission(storage) {
  try {
    return parsePermission(storage?.getItem?.(SPEND_PERMISSION_KEY));
  } catch {
    return 'ask';
  }
}

/** Whole dollars or up to 6 decimal places, as USDC base units. Zero is refused. */
export function dollarsToBaseUnits(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,6})?$/.test(raw)) return null;
  const [whole, frac = ''] = raw.split('.');
  const joined = `${whole}${frac.padEnd(6, '0')}`.replace(/^0+(?=\d)/, '');
  if (joined === '0' || !AMOUNT.test(joined)) return null;
  return joined;
}

export function readReviewThreshold(storage) {
  try {
    const value = storage?.getItem?.(REVIEW_THRESHOLD_KEY);
    return typeof value === 'string' && AMOUNT.test(value) && value !== '0' ? value : null;
  } catch {
    return null;
  }
}

export function readAcceptanceAck(storage, ownerId) {
  const key = acceptanceStorageKey(ownerId);
  if (!storage || !key) return false;
  try {
    return storage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function writeAcceptance(storage, ownerId, { permission, reviewCap } = {}) {
  const key = acceptanceStorageKey(ownerId);
  const cap = typeof reviewCap === 'string' && AMOUNT.test(reviewCap) && reviewCap !== '0' ? reviewCap : null;
  if (!storage || !key || !cap) throw new Error('acceptance');
  const mode = parsePermission(permission);
  storage.setItem(SPEND_PERMISSION_KEY, mode);
  storage.setItem(REVIEW_THRESHOLD_KEY, cap);
  storage.setItem(key, '1');
  return { permission: mode, reviewCap: cap };
}

export function permissionInstruction(id) {
  const mode = parsePermission(id);
  const shared = 'Fund movements go through the permissioned spend API. Order is trust, verify, wallet freeze, bot policy, approval, then sign on Solana devnet. A mainnet price quote never authorizes a transaction.';
  if (mode === 'full') {
    return `Permission is full. The owner let you manage funds. Do not ask whether they are going to buy, sell, spend, or pay. Infer the action and call the spend API. Money still waits for the owner to unlock the wallet and slide to confirm. ${shared}`;
  }
  if (mode === 'review') {
    return `Permission is review by AI. At or under the owner's review threshold, continue after the server check. Above that threshold, state what would change and wait. If the fund action is ambiguous, ask whether they mean buy, sell, spend, or pay. ${shared}`;
  }
  return `Permission is ask every time. Ask the owner before a trade or a spend. If it is ambiguous, ask whether they mean buy, sell, spend, or pay. ${shared}`;
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
