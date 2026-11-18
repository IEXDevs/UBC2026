/**
 * Browser calls for the desk verifier and the spend grant.
 * The password is sent once on unlock and is not written to storage.
 */
import {
  createDeskLock,
  unlockDesk,
  writeDeskGrant,
  writeDeskLock,
} from './desk-lock.mjs';
import { shellRuntimeUrl } from './runtime-data.mjs';

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

export async function registerDeskVerifier(fetchImpl, { ownerId, token, verifier, replace = false } = {}) {
  const url = shellRuntimeUrl('/api/desk/lock');
  if (!url || !ownerId || !verifier) return { ok: false, error: 'runtime' };
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: headers(ownerId, token),
    body: JSON.stringify({
      salt: verifier.salt,
      hash: verifier.hash,
      iterations: verifier.iterations,
      ...(replace === true ? { replace: true } : {}),
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
 * Enter Password. The browser copy is checked first. When that copy matches
 * and the account verifier does not, the submitted password replaces the
 * account verifier and a grant is issued. A mismatch stays "wrong password"
 * and does not replace anything.
 */
export async function acceptEnteredPassword({
  fetchImpl,
  ownerId,
  token,
  password,
  record,
  localStorage,
  sessionStorage,
} = {}) {
  if (record) {
    const matches = await unlockDesk(password, record);
    if (!matches) return { ok: false, error: 'wrong_password' };
  }
  let opened = await openDeskGrant(fetchImpl, { ownerId, token, password });
  if (!opened.ok && record) {
    const created = await createDeskLock(password);
    const registered = await registerDeskVerifier(fetchImpl, {
      ownerId,
      token,
      verifier: created,
      replace: true,
    });
    if (!registered.ok || registered.exists || !writeDeskLock(localStorage, ownerId, created)) {
      return { ok: false, error: 'desk_lock_failed' };
    }
    opened = await openDeskGrant(fetchImpl, { ownerId, token, password });
  }
  if (!opened.ok || !writeDeskGrant(sessionStorage, ownerId, opened.grant, opened.until)) {
    return { ok: false, error: opened.error || 'desk_locked' };
  }
  return { ok: true };
}
