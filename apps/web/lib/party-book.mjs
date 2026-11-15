import { parseRecipient } from '@ubc2026/contracts';
import { formatBaseUnits } from './money-views.mjs';

const AMOUNT = /^[1-9][0-9]{0,39}$/;

export function partyFromToken(token) {
  const parsed = parseRecipient(typeof token === 'string' ? token : '');
  if (!parsed) return null;
  if (parsed.kind === 'handle') return { kind: 'handle', handle: parsed.handle, label: `@${parsed.handle}` };
  if (parsed.kind === 'sns') return { kind: 'sns', domain: parsed.domain, label: `@${parsed.domain}` };
  return null;
}

function sameParty(left, right) {
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === 'handle') return left.handle === right.handle;
  return left.domain === right.domain;
}

function units(amount) {
  return typeof amount === 'string' && AMOUNT.test(amount) ? BigInt(amount) : null;
}

export function partyBook({ party, transfers = [], payments = [] }) {
  const rows = [];
  for (const transfer of transfers) {
    const rowParty = partyFromToken(transfer?.handle ? `@${transfer.handle}` : '');
    if (!sameParty(rowParty, party)) continue;
    const amount = units(transfer.amount);
    if (amount == null || transfer.asset && transfer.asset !== 'USDC') continue;
    rows.push({
      id: transfer.id,
      direction: transfer.direction === 'in' ? 'in' : 'out',
      amount: transfer.amount,
      asset: 'USDC',
      title: rowParty.label,
      detail: transfer.direction === 'in' ? 'Received on the platform' : 'Sent on the platform',
      when: transfer.createdAt || null,
    });
  }
  for (const payment of payments) {
    const rowParty = partyFromToken(payment?.counterparty);
    if (!sameParty(rowParty, party)) continue;
    const amount = units(payment.amount);
    if (amount == null) continue;
    const incoming = payment.direction !== 'paid';
    rows.push({
      id: payment.id,
      direction: incoming ? 'in' : 'out',
      amount: payment.amount,
      asset: payment.asset || 'USDC',
      title: rowParty.label,
      detail: [payment.protocol, payment.cluster].filter(Boolean).join(' · '),
      when: payment.createdAt || null,
    });
  }
  let inbound = 0n;
  let outbound = 0n;
  for (const row of rows) {
    const amount = units(row.amount);
    if (amount == null) continue;
    if (row.direction === 'in') inbound += amount;
    else outbound += amount;
  }
  return {
    party,
    inbound: inbound.toString(),
    outbound: outbound.toString(),
    net: (inbound - outbound).toString(),
    rows,
  };
}

export function signedUsdc(amount) {
  const negative = typeof amount === 'string' && amount.startsWith('-');
  const abs = negative ? amount.slice(1) : amount;
  const shown = formatBaseUnits(abs === '0' || abs === '' ? '0' : abs);
  if (shown === '0') return '0';
  return `${negative ? '−' : '+'}${shown}`;
}

export function flowName(direction) {
  return direction === 'in' ? 'is-in' : 'is-out';
}
