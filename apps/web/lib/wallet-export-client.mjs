/**
 * Ask the Worker to export one owner wallet.
 * The response is HPKE ciphertext. This module does not decrypt it.
 */
import { shellRuntimeUrl } from './runtime-data.mjs';

export async function requestWalletExport(fetchImpl, {
  ownerId,
  walletId,
  token,
  grant,
  recipientPublicKey,
} = {}) {
  const url = shellRuntimeUrl(`/api/wallets/${walletId}/export`);
  if (!url || !ownerId || !walletId || !recipientPublicKey) return { ok: false, error: 'runtime' };
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-owner-id': ownerId,
      ...(typeof token === 'string' && token ? { authorization: `Bearer ${token}` } : {}),
      ...(typeof grant === 'string' && grant ? { 'x-desk-grant': grant } : {}),
    },
    body: JSON.stringify({ recipientPublicKey }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.encryptionType !== 'HPKE' || typeof body.ciphertext !== 'string') {
    return { ok: false, error: typeof body?.error === 'string' ? body.error : 'export_failed' };
  }
  return {
    ok: true,
    encapsulatedKey: body.encapsulatedKey,
    ciphertext: body.ciphertext,
  };
}
