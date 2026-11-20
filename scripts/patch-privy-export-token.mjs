/**
 * Privy’s key-export iframe sends the hash token as Authorization on
 * auth.privy.io POST /v1/wallets/authenticate. That call rejects an access
 * token with "Invalid JWT token". Agent wallets are user-owned server
 * wallets, and the exchange accepts the identity token.
 *
 * The export screen’s client is the legacy client. Its getAccessToken()
 * returns the Privy session token first, and it has no _privyInternal.
 * Refresh the user and send the identity token from that response.
 */

const IDENTITY = 'y.updateUserAndIdToken().then(()=>y.maelstromIdentityToken||y.getCustomerAccessToken()).then(r)';
const IDENTITY_CJS = 'u.updateUserAndIdToken().then(()=>u.maelstromIdentityToken||u.getCustomerAccessToken()).then(i)';

const REPLACEMENTS = Object.freeze([
  [
    '(y._privyInternal?.getAccessTokenInternal?.()??y.getAccessToken()).then(r)',
    IDENTITY,
  ],
  [
    'y.getAccessToken().then(r)',
    IDENTITY,
  ],
  [
    '(u._privyInternal?.getAccessTokenInternal?.()??u.getAccessToken()).then(i)',
    IDENTITY_CJS,
  ],
  [
    'u.getAccessToken().then(i)',
    IDENTITY_CJS,
  ],
  [
    'return this.session.updateIdentityToken(e.identity_token),A(e.user)',
    'return this.session.updateIdentityToken(e.identity_token),this.maelstromIdentityToken=e.identity_token,A(e.user)',
  ],
  [
    'return this.session.updateIdentityToken(e.identity_token),i.convertUserResponseToUser(e.user)',
    'return this.session.updateIdentityToken(e.identity_token),this.maelstromIdentityToken=e.identity_token,i.convertUserResponseToUser(e.user)',
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
