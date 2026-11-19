/**
 * Minimum on-screen dwell for success confirmations.
 * Seed backup and email-code acceptance use the longer hold.
 * Errors are sticky elsewhere and are not timed here.
 */

export const CONFIRM_HOLD_MS = 2000;
export const SEED_CONFIRM_HOLD_MS = 3000;
export const EMAIL_ACCEPTED_HOLD_MS = 3000;

export function confirmHoldMs(kind = 'default') {
  if (kind === 'seed') return SEED_CONFIRM_HOLD_MS;
  if (kind === 'email') return EMAIL_ACCEPTED_HOLD_MS;
  return CONFIRM_HOLD_MS;
}

/** Plain-string toasts that report a failure stay until dismissed. */
export function looksLikeError(text) {
  return /\b(could not|couldn't|did not|didn't|failed|failure|error|locked|denied|rejected|need[s]?\b|too many|unable|cannot|can't|sign in to|rate limit)/i.test(String(text || ''));
}

/** Non-error toasts must stay up at least this long before auto-dismiss. */
export function toastDurationMs(requested, { error = false } = {}) {
  if (error) return Number.POSITIVE_INFINITY;
  const n = Number(requested);
  if (Number.isFinite(n) && n > 0) return Math.max(CONFIRM_HOLD_MS, Math.floor(n));
  return Math.max(CONFIRM_HOLD_MS, 4000);
}
