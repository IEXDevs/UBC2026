/**
 * Privy keeps the session in localStorage (`privy:token`, `privy:pat`,
 * `privy:refresh_token`). Its cookie mirror is for a same-origin server.
 * Privy never reads those cookies back, so a missing cookie is not a logout.
 *
 * The sign-in page is only for a finished check that found no session.
 * While Privy is still reading storage, a refresh must not paint the login page.
 */
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
 * Production inlines the flag off, so the button cannot render there.
 */
export function developerPreviewAllowed({
  nodeEnv = process.env.NODE_ENV,
  devPreview = process.env.NEXT_PUBLIC_DEV_PREVIEW,
} = {}) {
  if (nodeEnv === 'production') return false;
  return devPreview === '1';
}
