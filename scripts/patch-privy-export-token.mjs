/**
 * Privy’s key-export iframe sends the access token in the URL hash to
 * auth.privy.io POST /v1/wallets/authenticate. The public getAccessToken()
 * is the customer token. Agent wallets are user-owned server wallets, and
 * that endpoint rejects the customer token ("Invalid JWT token"). The Privy
 * session token is what the exchange accepts.
 */

const REPLACEMENTS = Object.freeze([
  [
    'y.getAccessToken().then(r)',
    '(y._privyInternal?.getAccessTokenInternal?.()??y.getAccessToken()).then(r)',
  ],
  [
    'u.getAccessToken().then(i)',
    '(u._privyInternal?.getAccessTokenInternal?.()??u.getAccessToken()).then(i)',
  ],
]);

export function patchPrivyExportAccessToken(source) {
  let next = String(source);
  for (const [from, to] of REPLACEMENTS) {
    if (next.includes(to)) continue;
    next = next.replaceAll(from, to);
  }
  return next;
}
