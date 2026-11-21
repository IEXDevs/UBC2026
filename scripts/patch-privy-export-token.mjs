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

// Privy's unified wallet iframe also uses the wallet authentication exchange
// for browser signing and signer enrollment. Keep the SDK's normal credential
// first. A rejected JWT can use a fresh identity token from the same account.
async function maelstromSignWithUserSigner(client, proxy, request) {
  const accessToken = await client.getAccessToken();
  if (!accessToken) throw new Error('User must be authenticated');
  try {
    const { signature } = await proxy.signWithUserSigner({ accessToken, ...request });
    return { signature };
  } catch (error) {
    const details = [error, error?.cause, error?.data, error?.cause?.data, error?.response?.data];
    const rejectedJwt = details.some(detail => detail?.code === 'invalid_jwt'
      || /invalid jwt token provided/i.test(typeof detail === 'string' ? detail : detail?.error ?? detail?.message ?? ''));
    if (!String(client.apiUrl).endsWith('/api/privy-auth') || !rejectedJwt) throw error;

    function claims(token) {
      try {
        return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      } catch { return null; }
    }
    let identity;
    try {
      await client.updateUserAndIdToken();
      identity = client.maelstromIdentityToken;
    } catch { throw error; }
    const current = claims(accessToken);
    const refreshed = claims(identity);
    if (!current?.sub || refreshed?.sub !== current.sub || refreshed.iss !== current.iss
        || !Number.isFinite(refreshed.exp) || refreshed.exp * 1000 <= Date.now() || identity === accessToken) throw error;
    const { signature } = await proxy.signWithUserSigner({ accessToken: identity, ...request });
    return { signature };
  }
}

export function patchPrivyWalletSignerToken(source) {
  const next = String(source).replace(
    /let (\w+)=await (\w+)\.getAccessToken\(\);if\(!\1\)throw Error\("User must be authenticated"\);let\{signature:(\w+)\}=await (\w+)\.signWithUserSigner\(\{accessToken:\1,message:(\w+),targetAppId:(\w+)\}\);return\{signature:\3\}/g,
    (_match, _token, client, _signature, proxy, message, targetAppId) =>
      `return await maelstromSignWithUserSigner(${client},${proxy},{message:${message},targetAppId:${targetAppId}})`,
  );
  return next !== source && !next.includes('function maelstromSignWithUserSigner(')
    ? `${next}\n${maelstromSignWithUserSigner.toString()}\n` : next;
}
