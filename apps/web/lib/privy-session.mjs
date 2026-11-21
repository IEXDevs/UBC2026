/**
 * Minimal Privy session helpers.
 *
 * Persistence is 100% Privy's job (localStorage keys below). We do not
 * mirror, backup, restore, or wrap Storage.
 *
 * The only app-side rule: never call Privy getAccessToken() when an access
 * token is present without refresh_token or a privy-session cookie — that
 * path calls destroyLocalState() and deletes the local session.
 * An empty store is different. The open tab keeps the access token in memory
 * and the refresh token in the HttpOnly cookie, so Privy is the only copy.
 */

import { hasServerSessionCookie } from './privy-cookie-session.mjs';

export const PRIVY_PAT_KEY = 'privy:pat';
export const PRIVY_TOKEN_KEY = 'privy:token';
export const PRIVY_REFRESH_KEY = 'privy:refresh_token';

function unwrap(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('"') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'string') return parsed.trim();
    } catch {
      /* raw string */
    }
  }
  return trimmed;
}

function readKey(storage, key) {
  if (!storage || typeof storage.getItem !== 'function') return '';
  try {
    return unwrap(storage.getItem(key));
  } catch {
    return '';
  }
}

function looksLikeJwt(token) {
  if (!token || token.length > 8192 || /\s/.test(token)) return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every(Boolean);
}

function looksLikeRefresh(token) {
  return Boolean(token && token !== 'deprecated' && token.length >= 8 && token.length <= 8192 && !/\s/.test(token));
}

/** Live customer or Privy access JWT from localStorage. */
export function readStoredAccessToken(storage) {
  const customer = readKey(storage, PRIVY_TOKEN_KEY);
  if (looksLikeJwt(customer)) return customer;
  const pat = readKey(storage, PRIVY_PAT_KEY);
  return looksLikeJwt(pat) ? pat : '';
}

export function readStoredRefreshToken(storage) {
  const refresh = readKey(storage, PRIVY_REFRESH_KEY);
  return looksLikeRefresh(refresh) ? refresh : '';
}

/** Wait briefly for Privy to finish writing refresh_token after login. */
export async function waitForPrivyRefresh(storage = globalThis.localStorage, timeoutMs = 1500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (readStoredRefreshToken(storage)) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return Boolean(readStoredRefreshToken(storage));
}

/**
 * Prefer Privy's getAccessToken when a refresh token or an HttpOnly session
 * cookie is present. An access token with neither is left alone — calling
 * Privy then deletes the local session.
 */
export async function getPrivyAccessToken(getAccessToken, storage = globalThis.localStorage, cookieHeader) {
  const cookie = typeof cookieHeader === 'string'
    ? cookieHeader
    : (typeof document === 'undefined' ? '' : document.cookie);
  let stored = readStoredAccessToken(storage);
  let refresh = readStoredRefreshToken(storage);
  const serverSession = hasServerSessionCookie(cookie);

  // Right after OAuth, access can land a tick before refresh. Wait briefly.
  if (stored && !refresh && !serverSession) {
    await waitForPrivyRefresh(storage);
    stored = readStoredAccessToken(storage);
    refresh = readStoredRefreshToken(storage);
  }

  // A stored access token with no refresh credential must be left alone.
  // An empty store still asks Privy: the token may be in memory, or the
  // HttpOnly cookie can refresh it. cookieWriteBehavior "never" does not
  // write privy-session itself; the auth proxy sets that marker.
  if (!refresh && !serverSession && stored) {
    return stored;
  }

  if (typeof getAccessToken !== 'function') {
    return stored;
  }

  try {
    const token = await getAccessToken();
    if (typeof token === 'string' && token.trim()) return token.trim();
  } catch (err) {
    console.error('[privy-session] getAccessToken threw error:', err);
  }
  return readStoredAccessToken(storage) || stored;
}
