/**
 * Browser calls for the desk verifier and the spend grant.
 * The password is sent once on unlock and is not written to storage.
 */
import { parseSpendAuthorizationSignature } from '@ubc2026/contracts';
import {
  unlockDesk,
  writeDeskGrant,
  writeDeskLock,
} from './desk-lock.mjs';
import { shellRuntimeUrl } from './runtime-data.mjs';

export async function submitChatSpend({ send, unlock, signal, authorize }) {
  async function sendWithDeskGrant(spendAuthorization) {
    const result = await send(spendAuthorization);
    if (result?.error !== 'desk_locked' || !unlock || signal.aborted) return result;
    const unlocked = await unlock(signal);
    if (signal.aborted) return { ok: false, error: 'aborted' };
    return unlocked ? send(spendAuthorization) : { ok: false, error: 'unlock_cancelled' };
  }

  const result = await sendWithDeskGrant(authorize ? 'prepare' : undefined);
  if (!result?.spendAuthorization || !authorize) return result;
  const { payload, ...binding } = result.spendAuthorization;
  if (signal.aborted) return { ok: false, error: 'aborted' };
  if (binding.expiresAt <= Date.now()) return { ok: false, error: 'spend_authorization_expired' };
  let signature;
  try {
    const bytes = Uint8Array.from(atob(payload), char => char.charCodeAt(0));
    ({ signature } = await authorize(bytes));
  } catch {
    return { ok: false, error: signal.aborted ? 'aborted' : 'browser_wallet_authorization_failed' };
  }
  if (signal.aborted) return { ok: false, error: 'aborted' };
  if (binding.expiresAt <= Date.now()) return { ok: false, error: 'spend_authorization_expired' };
  const authorization = parseSpendAuthorizationSignature({ ...binding, signature });
  return authorization
    ? sendWithDeskGrant(authorization)
    : { ok: false, error: 'browser_wallet_authorization_failed' };
}

function headers(ownerId, token) {
  return {
    'content-type': 'application/json',
    'x-owner-id': ownerId,
    ...(typeof token === 'string' && token ? { authorization: `Bearer ${token}` } : {}),
  };
}

export async function readDeskLockState(fetchImpl, { ownerId, token } = {}) {
  const url = shellRuntimeUrl('/api/desk');
  if (!url || !ownerId) return { ok: false, locked: false };
  const response = await fetchImpl(url, { headers: headers(ownerId, token) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, locked: false, error: body.error || 'desk_lock_failed' };
  return { ok: true, locked: body.locked === true };
}

export async function registerDeskVerifier(fetchImpl, { ownerId, token, verifier, replace = false, proof = '' } = {}) {
  const url = shellRuntimeUrl('/api/desk/lock');
  if (!url || !ownerId || !verifier) return { ok: false, error: 'runtime' };
  if (replace === true && !/^[0-9a-f]{64}$/i.test(proof)) return { ok: false, error: 'recovery_required' };
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: headers(ownerId, token),
    body: JSON.stringify({
      salt: verifier.salt,
      hash: verifier.hash,
      iterations: verifier.iterations,
      ...(replace === true ? { replace: true, proof: proof.toLowerCase() } : {}),
    }),
  });
  if (response.status === 409) return { ok: true, exists: true };
  if (!response.ok) return { ok: false, error: 'desk_lock_failed' };
  return { ok: true };
}

export async function saveDeskVerifier(fetchImpl, { localStorage, ...input }) {
  const registered = await registerDeskVerifier(fetchImpl, input);
  if (!registered.ok || registered.exists) return registered;
  return { ok: writeDeskLock(localStorage, input.ownerId, input.verifier) };
}

export async function openDeskGrant(fetchImpl, { ownerId, token, password } = {}) {
  const url = shellRuntimeUrl('/api/desk/unlock');
  if (!url || !ownerId || typeof password !== 'string') return { ok: false, error: 'runtime' };
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: headers(ownerId, token),
    body: JSON.stringify({ password }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.grant !== 'string') {
    return { ok: false, error: body.error || 'desk_locked' };
  }
  return { ok: true, grant: body.grant, until: body.until };
}

/**
 * Enter Password. The browser copy is checked first. A mismatch stays
 * "wrong password". A different account verifier is not replaced here.
 * Replacing the wallet password requires the seed proof on the lock route.
 */
export async function acceptEnteredPassword({
  fetchImpl,
  ownerId,
  token,
  password,
  record,
  localStorage,
  sessionStorage,
  shouldAccept = () => true,
} = {}) {
  if (record) {
    const matches = await unlockDesk(password, record);
    if (!matches) return { ok: false, error: 'wrong_password' };
  }
  if (!shouldAccept()) return { ok: false, error: 'unlock_cancelled' };
  const opened = await openDeskGrant(fetchImpl, { ownerId, token, password });
  if (!shouldAccept()) return { ok: false, error: 'unlock_cancelled' };
  if (!opened.ok || !writeDeskGrant(sessionStorage, ownerId, opened.grant, opened.until)) {
    return { ok: false, error: opened.error || 'desk_locked' };
  }
  return { ok: true };
}
