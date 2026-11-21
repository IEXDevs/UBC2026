import { signSelectedWalletTransaction, waitForBrowserSigner } from './wallet-signing.mjs';
import { shellRuntimeUrl } from './runtime-data.mjs';
import { swapFailure } from './swap-failure.mjs';
import { privySignerId, serverSignerFailure } from './privy-signers.mjs';

function failed(result) {
  const failure = swapFailure(result);
  return { ...result, ok: false, signed: false, failure, reply: failure.message };
}

export async function executeClientSignedSwap({ spend, swapTicket, signer, readSigner, delegation, attachSwapSigner,
  ownerId, accessToken, deskGrant, signal, fetchImpl = fetch } = {}) {
  if (spend?.action !== 'swap' || !swapTicket) return failed({ error: 'invalid_spend' });
  const headers = {
    'content-type': 'application/json',
    ...(ownerId ? { 'x-owner-id': ownerId } : {}),
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    ...(deskGrant ? { 'x-desk-grant': deskGrant } : {}),
  };
  if (delegation) {
    const { walletAddress, signerId, expiresAt } = delegation;
    if (spend.permission !== 'full' || typeof attachSwapSigner !== 'function' || !accessToken || !deskGrant
        || typeof walletAddress !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress)
        || !privySignerId(signerId) || !Number.isSafeInteger(expiresAt)) return failed({ error: 'swap_signer_missing' });
    if (signal?.aborted) return failed({ error: 'aborted' });
    if (expiresAt <= Date.now()) return failed({ error: 'swap_quote_expired' });
    try {
      await attachSwapSigner({ address: walletAddress, signerId });
    } catch (error) {
      const result = failed({ error: 'swap_signer_missing' });
      const { message, status } = serverSignerFailure(error);
      return { ...result, reply: `${result.reply} ${message}${status ? ` Privy returned HTTP ${status}.` : ''}` };
    }
    if (signal?.aborted) return failed({ error: 'aborted' });
    if (expiresAt <= Date.now()) return failed({ error: 'swap_quote_expired' });
    try {
      const response = await fetchImpl(shellRuntimeUrl('/api/spend'), {
        method: 'POST', headers, signal, cache: 'no-store',
        body: JSON.stringify({ ...spend, swapTicket, confirmed: false, autoSwap: true, spendAuthorization: undefined, swapAuthorization: undefined }),
      });
      const result = await response.json();
      return result?.signed === true ? { ...result, ok: true } : failed(result);
    } catch { return failed({ error: signal?.aborted ? 'aborted' : 'broadcast_failed' }); }
  }
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
