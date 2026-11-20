/**
 * Browser calls for the desk verifier and the spend grant.
 * The password is sent once on unlock and is not written to storage.
 */
import {
  unlockDesk,
  writeDeskGrant,
} from './desk-lock.mjs';
import { shellRuntimeUrl } from './runtime-data.mjs';

export async function submitChatSpend({ send, unlock, signal }) {
  const result = await send();
  if (result?.error !== 'desk_locked' || !unlock || signal.aborted) return result;
  const unlocked = await unlock(signal);
  if (signal.aborted) return { ok: false, error: 'aborted' };
  return unlocked ? send() : { ok: false, error: 'unlock_cancelled' };
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
