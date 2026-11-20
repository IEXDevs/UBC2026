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

/** Session draft for the onboarding sheet. Not account state: it holds an in-progress amount. */
export function acceptanceDraftKey(ownerId) {
  const id = typeof ownerId === 'string' ? ownerId.trim() : '';
  return id ? `maelstrom.acceptanceDraft.${id}` : '';
}

export function readAcceptanceDraft(storage, ownerId) {
  const empty = { permission: 'ask', dollars: '', touched: false };
  const key = acceptanceDraftKey(ownerId);
  if (!storage || !key) return empty;
  try {
    const parsed = JSON.parse(storage.getItem(key) || 'null');
    if (!parsed || parsed.touched !== true) return empty;
    const dollars = typeof parsed.dollars === 'string' ? parsed.dollars.slice(0, 20) : '';
    return { permission: parsePermission(parsed.permission), dollars, touched: true };
  } catch {
    return empty;
  }
}

export function writeAcceptanceDraft(storage, ownerId, { permission, dollars } = {}) {
  const key = acceptanceDraftKey(ownerId);
  if (!storage || !key) return false;
  storage.setItem(key, JSON.stringify({
    permission: parsePermission(permission),
    dollars: typeof dollars === 'string' ? dollars.slice(0, 20) : '',
    touched: true,
  }));
  return true;
}

export function clearAcceptanceDraft(storage, ownerId) {
  const key = acceptanceDraftKey(ownerId);
  if (!storage || !key) return;
  try { storage.removeItem(key); } catch { /* the saved acceptance still stands */ }
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

/** Whole USDC dollars string for the Review by AI editor, from stored base units. */
export function reviewCapToDollars(baseUnits) {
  if (typeof baseUnits !== 'string' || !AMOUNT.test(baseUnits) || baseUnits === '0') return '';
  const padded = baseUnits.padStart(7, '0');
  const whole = padded.slice(0, -6).replace(/^0+(?=\d)/, '') || '0';
  const frac = padded.slice(-6).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

export function writeReviewCap(storage, reviewCap) {
  const cap = typeof reviewCap === 'string' && AMOUNT.test(reviewCap) && reviewCap !== '0' ? reviewCap : null;
  if (!storage || !cap) throw new Error('review_cap');
  storage.setItem(REVIEW_THRESHOLD_KEY, cap);
  return cap;
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

const FUND_TOOLS = new Set(['request_spend', 'sns_send', 'prepare_shopping']);

export function isFundTool(name) {
  return FUND_TOOLS.has(name);
}

const ACCESS_COPY = Object.freeze({
  prepare_shopping: 'Prepare a purchase',
});

function plainArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  const next = {};
  for (const key of Object.keys(args).slice(0, 8)) {
    const value = args[key];
    if (typeof value === 'string') next[key] = value.slice(0, 200);
    else if (value === true || value === false) next[key] = value;
  }
  return next;
}

function stable(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const next = {};
  for (const key of Object.keys(value).sort()) next[key] = stable(value[key]);
  return next;
}

function accessDetail(name, args) {
  const amount = typeof args?.amount === 'string' ? args.amount.trim() : '';
  const handle = typeof args?.handle === 'string' ? args.handle.replace(/^@/, '').trim() : '';
  if (name === 'request_spend' || name === 'sns_send') {
    const who = handle ? ` to @${handle}` : '';
    return amount ? `Move ${amount} USDC${who}` : `Move funds${who}`;
  }
  return ACCESS_COPY[name] || `Use ${name}`;
}

/** Ask mode requires the confirmation slide for fund tools. */
export function toolAccessKind(mode, name) {
  return isFundTool(name) && mode === 'ask' ? 'modal' : null;
}

export function toolAccessRequest(mode, name, args = {}) {
  const kind = toolAccessKind(mode, name);
  if (!kind) return null;
  const label = accessDetail(name, plainArgs(args));
  return {
    kind,
    name,
    args: plainArgs(args),
    label,
    prompt: `${label}. Slide to confirm.`,
  };
}

export function grantCovers(grants, name, args) {
  if (!Array.isArray(grants)) return false;
  const want = JSON.stringify(stable(plainArgs(args)));
  return grants.some(grant => grant?.name === name && JSON.stringify(stable(plainArgs(grant.args))) === want);
}

export function permissionInstruction(id) {
  const mode = parsePermission(id);
  const quiet = ' This is for you, not the owner. Do not repeat the check order. Do not say that trust, verify, the budget reserve, or signing did not run, unless the owner asks whether money moved.';
  const shared = `Fund movements go through the permissioned spend API. Order is trust, verify, wallet freeze, bot policy, approval, then sign on Solana devnet. A mainnet price quote never authorizes a transaction.${quiet}`;
  if (mode === 'full') {
    return `Permissions are fully granted. The owner let you manage funds. Do not ask whether they are going to buy, sell, spend, or pay. Follow your goal, and Infer the action and call the spend API. Fund movements go through the platform gate, and the permissioned spend API. Order is trust, verify, wallet freeze, bot policy, approval, then sign on Solana devnet. A mainnet price quote never authorizes a transaction.${quiet}`;
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
