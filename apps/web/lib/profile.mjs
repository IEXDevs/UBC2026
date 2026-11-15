/** Sidebar label. A handle wins over the display name. */
import { shortAddress } from './money-views.mjs';

const ERROR_CODE = /^[a-z0-9_]{1,64}$/i;

function savedClaim(profile) {
  const handle = typeof profile?.handle === 'string' ? profile.handle.trim() : '';
  const displayName = typeof profile?.displayName === 'string' ? profile.displayName.trim() : '';
  if (!handle || !displayName) return null;
  return profile;
}

/**
 * Apply GET /api/profiles/me to a claim already stored in the browser.
 * A Supabase directory with no handle must not erase that claim.
 * persist: write the server profile, keep the local one, or clear an empty slot.
 */
export function profileAfterDirectoryRead(local, body) {
  const saved = savedClaim(local);
  if (typeof body?.profile?.handle === 'string' && body.profile.handle.trim()) {
    return { profile: body.profile, persist: 'write' };
  }
  if (body?.source === 'supabase') {
    if (saved) return { profile: saved, persist: 'keep' };
    return { profile: null, persist: 'clear' };
  }
  return { profile: saved, persist: 'keep' };
}

/** Claim-screen note. Status and error code only — never a provider body. */
export function claimSaveNote(error) {
  const raw = typeof error?.code === 'string' ? error.code : (typeof error?.error === 'string' ? error.error : '');
  if (raw === 'handle_taken') return 'That handle is already taken.';
  const code = ERROR_CODE.test(raw) ? raw : 'profile_save_failed';
  const status = Number.isInteger(error?.status) ? error.status : null;
  const detail = status == null ? code : `${status} ${code}`;
  return `The directory did not update (${detail}). Try the claim again.`;
}

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
