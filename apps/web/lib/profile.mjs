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
  if (saved || (typeof local?.handle === 'string' && local.handle.trim())) {
    return { profile: saved || local, persist: 'keep' };
  }
  if (body?.source === 'supabase') return { profile: null, persist: 'clear' };
  return { profile: null, persist: 'keep' };
}

/**
 * A 200 is a saved claim only when the response includes the stored handle.
 * An echoed handle with source unconfigured, or a body with no handle, is not stored.
 */
export function profileSaveResult(status, body, claimedHandle = '') {
  const code = typeof body?.error === 'string' && ERROR_CODE.test(body.error) ? body.error : '';
  if (code === 'profile_not_registered') return { ok: false, error: code, status };
  if (status === 409 || code === 'handle_taken') return { ok: false, error: 'handle_taken', status };
  if (!Number.isInteger(status) || status < 200 || status >= 300) {
    return { ok: false, error: code || 'profile_save_failed', status: Number.isInteger(status) ? status : 502 };
  }
  const handle = typeof body?.profile?.handle === 'string' ? body.profile.handle.trim() : '';
  const expected = typeof claimedHandle === 'string' ? claimedHandle.trim() : '';
  if (!handle || (expected && handle !== expected) || body?.source === 'unconfigured' || body?.ok === false) {
    return { ok: false, error: code || 'profile_save_failed', status };
  }
  return {
    ok: true,
    status,
    profile: {
      handle,
      displayName: typeof body.profile.displayName === 'string' && body.profile.displayName.trim()
        ? body.profile.displayName
        : '',
      avatarUrl: body.profile.avatarUrl || null,
    },
  };
}

/** Claim-screen note. Status and error code only — never a provider body. */
/** A directory row for this handle belongs to someone else. The caller's own row is still theirs. */
export function handleAlreadyClaimed(body) {
  const recipient = body?.recipient;
  if (!recipient || recipient.kind !== 'handle' || recipient.self === true) return false;
  return recipient.missing === false;
}

/** Live claim check. `open` may submit. `taken` and `error` keep the button closed. */
export function claimLookupVerdict(status, body) {
  if (status === 503 && body?.error === 'runtime_unconfigured') return 'open';
  if (!Number.isInteger(status) || status < 200 || status >= 300) return 'error';
  if (handleAlreadyClaimed(body)) return 'taken';
  return 'open';
}

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

/** Profile edits keep their draft on failure; never claim an unconfirmed save. */
export function profileSaveNote(error) {
  const raw = error?.code || error?.error || '';
  if (error?.status === 401 || raw === 'owner_required' || raw === 'login_required') return 'Your session expired. Sign in again to save your profile.';
  if (raw === 'handle_taken') return 'This handle is already registered to another account. Your changes were not saved.';
  if (raw === 'profile_not_registered') return 'No profile is registered to this sign-in. Sign in with the account that claimed your handle.';
  if (raw === 'photo_storage_failed') return 'Your name was saved, but the photo could not be stored. Allow browser storage and try again.';
  if (raw === 'account_changed') return 'The signed-in account changed. Reopen your profile to try again.';
  const code = typeof raw === 'string' && ERROR_CODE.test(raw) ? raw : '';
  const detail = [Number.isInteger(error?.status) ? error.status : '', code].filter(Boolean).join(' ');
  return detail ? `Your changes were not saved (${detail}). Try again.` : 'Could not reach the profile directory. Your changes were not saved. Try again.';
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
    if (where) return `${recipient.domain} (${where})`;
    if (recipient.error) return 'Failed.';
    return recipient.domain;
  }
  if (recipient.missing) return `@${recipient.handle} is not on Maelstrom`;
  if (!recipient.address && recipient.self !== true) return `@${recipient.handle} does not have a wallet yet.`;
  const who = recipient.displayName || `@${recipient.handle}`;
  const where = shortAddress(recipient.address);
  return where ? `${who} (${where})` : who;
}

/** Platform ledger sends need a found handle with a wallet address. */
export function sendHandleReady(recipient) {
  if (!recipient || recipient.kind !== 'handle' || recipient.missing) return false;
  return typeof recipient.address === 'string' && recipient.address.length > 0;
}

/** Status line under Send To while a handle is resolved. */
export function sendHandleHint(recipient, { looking = false, handle = '' } = {}) {
  const name = typeof handle === 'string' && handle
    ? handle.replace(/^@/, '')
    : (typeof recipient?.handle === 'string' ? recipient.handle : '');
  if (looking) return name ? `Looking up @${name}.` : 'Looking up that handle.';
  if (!recipient) return name ? `@${name} is not on Maelstrom` : '';
  if (recipient.missing === false && !recipient.address) {
    return `@${recipient.handle || name} does not have a wallet yet.`;
  }
  return recipientHint(recipient);
}
