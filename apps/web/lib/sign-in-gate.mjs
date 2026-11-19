/**
 * Privy keeps a local session in localStorage until its server sets an HttpOnly
 * cookie. The page cannot read that cookie. `privy-session` is only the flag
 * that the cookie exists. A missing local copy is not a logout while Privy is
 * still refreshing.
 *
 * The sign-in page is only for a finished check that found no session.
 */
import { hasServerSessionCookie } from './privy-cookie-session.mjs';

const STORED_SESSION_KEY = /^privy(?::[\w-]+)?:(?:token|pat|refresh_token|id[_-]?token)$/;

export function hasStoredPrivySession(storage) {
  if (!storage || typeof storage.getItem !== 'function') return false;
  try {
    if (typeof storage.length === 'number' && typeof storage.key === 'function') {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!STORED_SESSION_KEY.test(String(key || ''))) continue;
        const value = storage.getItem(key);
        if (typeof value === 'string' && value.trim() && value.trim() !== 'null') return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** Local secret or the HttpOnly session flag. The flag is not the token. */
export function hasRestorablePrivySession(storage, cookieHeader = '') {
  return hasStoredPrivySession(storage) || hasServerSessionCookie(cookieHeader);
}

export function showSessionHold({ privyConfigured, ready }) {
  return privyConfigured === true && ready !== true;
}

export function showSignInGate({ privyConfigured, ready, authenticated }) {
  if (privyConfigured !== true) return false;
  if (ready !== true) return false;
  return authenticated !== true;
}

/**
 * Desk preview without Privy. Requires DEV_PREVIEW=1 and a non-production build.
 * Production inlines the flag off, so the bypass button cannot render there.
 * `next dev` keeps the flag when the shell already exported NODE_ENV=production.
 */
export function publicDevPreviewValue({
  nodeEnv = process.env.NODE_ENV,
  argv = process.argv,
  devPreview = '',
} = {}) {
  const nextDev = Array.isArray(argv) && argv.includes('dev');
  if (nodeEnv === 'production' && !nextDev) return '';
  return devPreview === '1' ? '1' : '';
}

export function developerPreviewAllowed({
  nodeEnv = process.env.NODE_ENV,
  devPreview = process.env.NEXT_PUBLIC_DEV_PREVIEW,
} = {}) {
  if (nodeEnv === 'production') return false;
  return devPreview === '1';
}

/** Runtime worker binding. A production bundle does not inline this. */
export function hostedDevPreview(value) {
  return value === '1';
}
