import { signSelectedWalletTransaction, waitForBrowserSigner } from './wallet-signing.mjs';
import { shellRuntimeUrl } from './runtime-data.mjs';
import { swapFailure } from './swap-failure.mjs';

function failed(result) {
  const failure = swapFailure(result);
  return { ...result, ok: false, signed: false, failure, reply: failure.message };
}

export async function executeClientSignedSwap({ spend, swapTicket, signer, readSigner, ownerId, accessToken, deskGrant, signal, fetchImpl = fetch } = {}) {
  if (spend?.action !== 'swap' || !swapTicket) return failed({ error: 'invalid_spend' });
  const headers = {
    'content-type': 'application/json',
    ...(ownerId ? { 'x-owner-id': ownerId } : {}),
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    ...(deskGrant ? { 'x-desk-grant': deskGrant } : {}),
  };
  async function send(swapAuthorization) {
    const response = await fetchImpl(shellRuntimeUrl('/api/spend'), {
      method: 'POST', headers, signal, cache: 'no-store',
      body: JSON.stringify({ ...spend, swapTicket, confirmed: true, autoSwap: undefined, spendAuthorization: undefined, swapAuthorization }),
    });
    const body = await response.json();
    return response.ok ? body : failed(body);
  }
  let challenge;
  try {
    const prepared = await send('prepare');
    if (!prepared.swapAuthorization) return failed(prepared);
    challenge = prepared.swapAuthorization;
    if (challenge.expiresAt <= Date.now()) return failed({ error: 'spend_authorization_expired' });
    if (typeof challenge.transaction !== 'string' || challenge.transaction.length > 1648 || !challenge.walletAddress) {
      return failed({ error: 'invalid_transaction' });
    }
  } catch { return failed({ error: signal?.aborted ? 'aborted' : 'transfer_preparation_failed' }); }
  let signed;
  try {
    if (signal?.aborted) return failed({ error: 'aborted' });
    const from = { address: challenge.walletAddress };
    const browserSigner = await waitForBrowserSigner(() => readSigner?.() ?? signer, [from]);
    if (signal?.aborted) return failed({ error: 'aborted' });
    if (challenge.expiresAt <= Date.now()) return failed({ error: 'spend_authorization_expired' });
    signed = await signSelectedWalletTransaction({
      from,
      transaction: Uint8Array.from(atob(challenge.transaction), char => char.charCodeAt(0)), signer: browserSigner,
    });
  } catch (error) {
    return failed({ error: error?.code === 'wallet_approval_cancelled' ? 'client_sign_rejected' : error?.code });
  }
  if (signal?.aborted) return failed({ error: 'aborted' });
  if (challenge.expiresAt <= Date.now()) return failed({ error: 'spend_authorization_expired' });
  try {
    const result = await send({
      blockhash: challenge.blockhash, expiresAt: challenge.expiresAt, proof: challenge.proof,
      signedTransaction: btoa(String.fromCharCode(...signed)),
    });
    return result.signed === true ? { ...result, ok: true } : failed(result);
  } catch { return failed({ error: 'broadcast_failed' }); }
}
