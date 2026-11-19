/**
 * Server view of Privy's session cookie.
 * `privy-token=t` is a client marker, not a credential. A real access token
 * is the HttpOnly cookie value, which page JavaScript cannot read.
 * `privy-session` is the non-secret flag that a refresh cookie exists.
 */

export function hasServerSessionCookie(cookieHeader) {
  const header = typeof cookieHeader === 'string' ? cookieHeader : '';
  const match = /(?:^|;\s*)privy-session=([^;]*)/.exec(header);
  const value = match?.[1]?.trim() ?? '';
  return value.length > 0 && value !== 'null';
}

export function readPrivyTokenCookie(cookieHeader) {
  const header = typeof cookieHeader === 'string' ? cookieHeader : '';
  const match = /(?:^|;\s*)privy-token=([^;]*)/.exec(header);
  if (!match) return '';
  let value = match[1].trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    /* keep the raw value */
  }
  if (!value || value === 't' || value.length > 8192 || /\s/.test(value)) return '';
  const parts = value.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return '';
  return value;
}

export function accessTokenFromRequest(request) {
  const header = request?.headers?.get?.('authorization') ?? '';
  const bearer = /^Bearer\s+(\S+)/i.exec(header)?.[1]?.trim() ?? '';
  if (bearer && bearer !== 't') return bearer;
  return readPrivyTokenCookie(request?.headers?.get?.('cookie') ?? '');
}
