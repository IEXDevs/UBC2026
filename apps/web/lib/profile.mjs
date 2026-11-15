/** Sidebar label. A handle wins over the display name. */
import { shortAddress } from './money-views.mjs';

export function profileRailLabel({ handle, displayName, fallback = 'You' } = {}) {
  const clean = typeof handle === 'string' ? handle.trim().replace(/^@+/, '') : '';
  if (clean) return `@${clean}`;
  if (typeof displayName === 'string' && displayName.trim()) return displayName.trim();
  if (typeof fallback === 'string' && fallback.trim()) return fallback.trim();
  return 'You';
}

export function mentionIn(text) {
  if (typeof text !== 'string') return null;
  const match = text.match(/(?:^|\s)(@[A-Za-z0-9][A-Za-z0-9_.-]{0,80})/);
  return match ? match[1] : null;
}

export function recipientHint(recipient) {
  if (!recipient || typeof recipient !== 'object') return '';
  if (recipient.kind === 'sns') {
    const where = shortAddress(recipient.address);
    if (where) return `${recipient.domain}(${where})`;
    if (recipient.error) return 'Failed.';
    return recipient.domain;
  }
  if (recipient.missing) return `@${recipient.handle} is not on Maelstrom`;
  const who = recipient.displayName || `@${recipient.handle}`;
  const where = shortAddress(recipient.address);
  return where ? `${who}(${where})` : who;
}
