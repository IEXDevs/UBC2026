import { txReceiptFromResult } from './tx-receipt.mjs';

export function browserSpendReply(result, swap = false) {
  const receipt = txReceiptFromResult(result);
  return { ok: true, reply: receipt ? (swap ? `Swap submitted. ${receipt.url}` : receipt.text)
    : result?.reply || 'The payment did not complete. Check the spend details before trying again.' };
}

export async function completeChatSwap(result, execute, credentials) {
  if (!result?.clientSwap) return result;
  if (credentials.signal?.aborted) return { ok: false, error: 'aborted' };
  const swapped = typeof execute === 'function'
    ? await execute({ ...result.clientSwap, ...credentials })
    : { ok: false, reply: 'Connect your wallet to approve the swap.' };
  return credentials.signal?.aborted ? { ok: false, error: 'aborted' } : browserSpendReply(swapped, true);
}

export async function submitChatMove({ hold, permission, reviewCap, ownerId, getAccessToken, readGrant,
  sign, unlock, signal, fetchImpl = fetch, now = Date.now } = {}) {
  const stopped = () => signal?.aborted;
  const failure = error => ({ ok: true, reply: error === 'aborted' ? 'Payment cancelled.'
    : 'The send did not complete. Check the spend details before trying again.' });
  if (stopped()) return { ok: false, error: 'aborted' };
  async function post(phase, moveAuthorization, signedTransaction, retry = true) {
    const accessToken = await getAccessToken?.();
    if (stopped()) return { error: 'aborted' };
    const response = await fetchImpl('/api/wallets/move', {
      method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-owner-id': ownerId,
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), 'x-desk-grant': readGrant?.() || '' },
      body: JSON.stringify({ phase, moveAuthorization, signedTransaction,
        chatSpend: { message: 'Confirm the approved send.', permission, reviewCap, grants: [hold] } }),
    });
    const result = await response.json();
    if (result.error === 'desk_locked' && retry && unlock && !stopped() && await unlock(signal)) {
      return post(phase, moveAuthorization, signedTransaction, false);
    }
    return result;
  }
  try {
    const prepared = await post('prepare');
    const challenge = prepared.moveAuthorization;
    if (!challenge) return prepared.reply ? prepared : failure(prepared.error);
    if (stopped()) return { ok: false, error: 'aborted' };
    if (!Number.isSafeInteger(challenge.expiresAt) || challenge.expiresAt <= now()
        || typeof challenge.walletAddress !== 'string' || !challenge.walletAddress
        || typeof challenge.transaction !== 'string' || challenge.transaction.length < 80
        || challenge.transaction.length > 1644) return failure();
    const signed = await sign({ walletAddress: challenge.walletAddress,
      transaction: Uint8Array.from(atob(challenge.transaction), char => char.charCodeAt(0)) });
    if (stopped()) return { ok: false, error: 'aborted' };
    if (challenge.expiresAt <= now() || !(signed instanceof Uint8Array) || signed.length > 1232 || signed.length <= 64) return failure();
    const result = await post('broadcast', challenge, btoa(String.fromCharCode(...signed)));
    return result.reply ? result : failure(result.error);
  } catch { return stopped() ? { ok: false, error: 'aborted' } : failure(); }
}
