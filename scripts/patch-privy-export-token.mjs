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

// The unified wallet iframe accepts Privy's wallet access token. The generic
// access-token getter can fall back to an app login token after a session reload.
async function maelstromSignWithUserSigner(client, proxy, request) {
  const accessToken = await client.getAccessToken();
  if (!accessToken) throw new Error('User must be authenticated');
  const walletToken = String(client.apiUrl).endsWith('/api/privy-auth')
    ? await client.getPrivyAccessToken({ disableAutoRefresh: true }) : accessToken;
  if (!walletToken) {
    throw Object.assign(new Error('Privy wallet session expired. Sign out and sign back in.'), {
      code: 'wallet_signing_session_missing',
    });
  }
  const { signature } = await proxy.signWithUserSigner({ accessToken: walletToken, ...request });
  return { signature };
}

export function patchPrivyWalletSignerToken(source) {
  const next = String(source).replace(
    /let (\w+)=await (\w+)\.getAccessToken\(\);if\(!\1\)throw Error\("User must be authenticated"\);let\{signature:(\w+)\}=await (\w+)\.signWithUserSigner\(\{accessToken:\1,message:(\w+),targetAppId:(\w+)\}\);return\{signature:\3\}/g,
    (_match, _token, client, _signature, proxy, message, targetAppId) =>
      `return await maelstromSignWithUserSigner(${client},${proxy},{message:${message},targetAppId:${targetAppId}})`,
  );
  if (!next.includes('return await maelstromSignWithUserSigner(')) return next;
  const helper = `\n${maelstromSignWithUserSigner.toString()}\n`;
  const installedHelper = /\nasync function maelstromSignWithUserSigner\(client, proxy, request\) \{[\s\S]*?\n\}\n/;
  return installedHelper.test(next) ? next.replace(installedHelper, () => helper) : next + helper;
}
