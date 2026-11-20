/**
 * Browser calls for the desk verifier and the spend grant.
 * The password is sent once on unlock and is not written to storage.
 */
import { parseSpendAuthorizationSignature } from '@ubc2026/contracts';
import {
  readDeskGrant,
  readDeskSession,
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

export async function readDeskLockState(fetchImpl, { ownerId, token, signal } = {}) {
  const url = shellRuntimeUrl('/api/desk');
  if (!url || !ownerId) return { ok: false, locked: false };
  const response = await fetchImpl(url, { headers: headers(ownerId, token), cache: 'no-store', signal });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, locked: false, error: body?.error || 'desk_lock_failed' };
  if (body?.source === 'unconfigured' || typeof body?.locked !== 'boolean') {
    return { ok: false, locked: false, error: 'desk_lock_unavailable' };
  }
  return { ok: true, locked: body.locked };
}

function privySessionId(token, ownerId) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some(part => !part)) return '';
    const claims = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return claims?.iss === 'privy.io' && claims.sub === ownerId
      && typeof claims.sid === 'string' && /^[^\s]{1,256}$/.test(claims.sid) ? claims.sid : '';
  } catch {
    return '';
  }
}

/** Resume a desk only in the tab and Privy session that unlocked it. */
export async function restoreDeskEntry({ localStorage, sessionStorage, ownerId, getAccessToken, now = Date.now }) {
  const at = now();
  const session = readDeskSession(localStorage, ownerId, at);
  const grant = readDeskGrant(sessionStorage, ownerId, at);
  if (!session || !grant?.sessionId) return 0;
  const token = await getAccessToken();
  const until = Math.min(session.until, grant.until);
  return until > now() && privySessionId(token, ownerId) === grant.sessionId ? until : 0;
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
  writeDeskLock(localStorage, input.ownerId, input.verifier);
  return registered;
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

/** Check the current account verifier. A password reset on another device takes effect here. */
export async function acceptEnteredPassword({
  fetchImpl,
  ownerId,
  token,
  password,
  sessionStorage,
  shouldAccept = () => true,
} = {}) {
  if (!shouldAccept()) return { ok: false, error: 'unlock_cancelled' };
  const opened = await openDeskGrant(fetchImpl, { ownerId, token, password });
  if (!shouldAccept()) return { ok: false, error: 'unlock_cancelled' };
  if (!opened.ok) return opened;
  if (!(opened.until > Date.now())
    || !writeDeskGrant(sessionStorage, ownerId, opened.grant, opened.until, privySessionId(token, ownerId) || undefined)) {
    return { ok: false, error: 'desk_grant_unavailable' };
  }
  return { ok: true, until: opened.until };
}
