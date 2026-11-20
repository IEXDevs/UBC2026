/**
 * One seed phrase per account.
 * The browser encrypts the phrase with the onboarding password (PBKDF2 then
 * AES-GCM) before the account stores it, so the server cannot read it. The
 * phrase is shown once, in the visit that issued it. A PBKDF2 verifier of the
 * phrase lets a later browser prove the owner still has it. Nothing here is a
 * signature.
 */
import { recoveryWords } from './wallet-desk.mjs';
import { shellRuntimeUrl } from './runtime-data.mjs';

// Same ceiling the desk password uses. Workers reject PBKDF2 above 100000.
export const VAULT_ITERATIONS = 100000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toHex(bytes) {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

function phraseText(words) {
  const list = recoveryWords(words);
  return list ? list.join(' ') : null;
}

async function baseKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
}

async function vaultKey(password, salt, iterations) {
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    await baseKey(password),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Hex proof that the caller holds the phrase. Salt and count come from the verifier. */
export async function phraseProof(words, { salt, iterations = VAULT_ITERATIONS } = {}) {
  const text = phraseText(words);
  const saltBytes = fromHex(salt);
  if (!text || !saltBytes || saltBytes.length !== 16) throw new Error('proof');
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    await baseKey(text),
    256,
  );
  return toHex(bits);
}

/** Encrypts the phrase for storage and builds the verifier. Returns the account payload. */
export async function sealRecovery(words, password, random = bytes => crypto.getRandomValues(bytes)) {
  const text = phraseText(words);
  if (!text || typeof password !== 'string' || !password) throw new Error('seal');
  const salt = random(new Uint8Array(16));
  const iv = random(new Uint8Array(12));
  const key = await vaultKey(password, salt, VAULT_ITERATIONS);
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(text));
  const verifierSalt = toHex(random(new Uint8Array(16)));
  return {
    vault: { v: 1, iterations: VAULT_ITERATIONS, salt: toHex(salt), iv: toHex(iv), ct: toHex(sealed) },
    verifier: {
      salt: verifierSalt,
      iterations: VAULT_ITERATIONS,
      hash: await phraseProof(words, { salt: verifierSalt, iterations: VAULT_ITERATIONS }),
    },
  };
}

/** The words, or null when the password is wrong or the vault is damaged. */
export async function openRecovery(vault, password) {
  if (!vault || vault.v !== 1 || typeof password !== 'string' || !password) return null;
  const salt = fromHex(vault.salt);
  const iv = fromHex(vault.iv);
  const ct = fromHex(vault.ct);
  if (!salt || !iv || !ct || iv.length !== 12 || !Number.isSafeInteger(vault.iterations)) return null;
  try {
    const key = await vaultKey(password, salt, vault.iterations);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return recoveryWords(decoder.decode(plain));
  } catch {
    return null;
  }
}

function headers(ownerId, token) {
  return {
    'content-type': 'application/json',
    ...(ownerId ? { 'x-owner-id': ownerId } : {}),
    ...(typeof token === 'string' && token ? { authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Account seed state: none, issued (vault comes back), or confirmed.
 * Developer preview can opt into browser-only recovery without an account store.
 */
export async function readRecoveryState(fetchImpl, { ownerId, token, allowLocal = false } = {}) {
  const url = shellRuntimeUrl('/api/recovery');
  if (!url || !ownerId) return { ok: false, error: 'runtime' };
  try {
    const response = await fetchImpl(url, { headers: headers(ownerId, token), cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    // The proxy answers 503 with source unconfigured when no worker origin is set.
    if (body?.source === 'unconfigured') {
      return allowLocal
        ? { ok: true, local: true, state: 'none' }
        : { ok: false, error: 'runtime_unconfigured' };
    }
    if (!response.ok) return { ok: false, error: body.error || 'recovery_unavailable' };
    return {
      ok: true,
      state: ['confirmed', 'issued', 'lost'].includes(body.state) ? body.state : 'none',
      vault: body.vault ?? null,
      verifier: body.verifier ?? null,
    };
  } catch {
    return { ok: false, error: 'recovery_unavailable' };
  }
}

/**
 * Where the ceremony starts for an account. The words are shown only in the
 * visit that issued them: a seed the account already holds is typed back from
 * the downloaded file, never shown again.
 */
export function recoveryStartStep(state, { hadLocalSeed = false } = {}) {
  if (state === 'issued') return 'finish';
  if (state === 'confirmed') return 'restore';
  // 'lost': the account had a seed but its record is gone. A browser that
  // saved a seed before seeds were account-wide brings that one back too.
  if (state === 'lost' || hadLocalSeed === true) return 'relink';
  return 'tell';
}

/** True when the browser's seed flag is not backed by a confirmed account seed. */
export function staleRecoveryAck(state) {
  return state?.ok === true && state.local !== true && state.state !== 'confirmed';
}

/** A missing token during signup should be asked again. A real outage should not. */
export function shouldRetryRecovery(error, attempt) {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt >= 3) return false;
  return error === 'login_required' || error === 'owner_required';
}

export function recoveryFailureNote(error) {
  if (error === 'login_required' || error === 'owner_required') {
    return 'Your sign-in expired. Sign in again to save the seed.';
  }
  if (error === 'account_state_schema_missing' || error === 'runtime_unconfigured') {
    return 'Account recovery storage needs setup. Ask a Maelstrom administrator to check it.';
  }
  if (error === 'account_state_access_failed') {
    return 'Maelstrom could not access account recovery storage. Ask an administrator to check it.';
  }
  if (error === 'account_state_unavailable') {
    return 'Account recovery storage is temporarily unavailable. Try again shortly.';
  }
  return 'Could not reach your account to check your seed. Check the connection and try again.';
}

/** Stores the sealed phrase. A 409 means this account already has one. */
export async function issueRecovery(fetchImpl, { ownerId, token, sealed } = {}) {
  const url = shellRuntimeUrl('/api/recovery');
  if (!url || !ownerId || !sealed) return { ok: false, error: 'runtime' };
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: headers(ownerId, token),
      body: JSON.stringify({ vault: sealed.vault, verifier: sealed.verifier }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 409) {
      return { ok: false, exists: true, state: ['confirmed', 'lost'].includes(body.state) ? body.state : 'issued' };
    }
    if (!response.ok) return { ok: false, error: body.error || 'recovery_failed' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'recovery_failed' };
  }
}

/** Re-registers a seed the owner already holds. Only a verifier is sent. */
export async function restoreRecovery(fetchImpl, { ownerId, token, words, random = bytes => crypto.getRandomValues(bytes) } = {}) {
  const url = shellRuntimeUrl('/api/recovery');
  if (!url || !ownerId) return { ok: false, error: 'runtime' };
  let verifier;
  try {
    const salt = toHex(random(new Uint8Array(16)));
    verifier = { salt, iterations: VAULT_ITERATIONS, hash: await phraseProof(words, { salt, iterations: VAULT_ITERATIONS }) };
  } catch {
    return { ok: false, error: 'invalid_phrase' };
  }
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: headers(ownerId, token),
      body: JSON.stringify({ restore: true, verifier }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 409) return { ok: false, exists: true };
    if (!response.ok) return { ok: false, error: body.error || 'recovery_failed' };
    return { ok: true, state: 'confirmed' };
  } catch {
    return { ok: false, error: 'recovery_failed' };
  }
}

/** Checks the typed phrase against the account verifier. `confirm` finishes the seed. */
export async function verifyRecovery(fetchImpl, { ownerId, token, words, verifier, confirm = false } = {}) {
  const url = shellRuntimeUrl('/api/recovery/verify');
  if (!url || !ownerId || !verifier) return { ok: false, error: 'runtime' };
  let proof = '';
  try {
    proof = await phraseProof(words, verifier);
  } catch {
    return { ok: false, error: 'invalid_phrase' };
  }
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: headers(ownerId, token),
      body: JSON.stringify({ proof, ...(confirm ? { confirm: true } : {}) }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 && body.error === 'recovery_mismatch') return { ok: false, mismatch: true };
    if (!response.ok) return { ok: false, error: body.error || 'recovery_failed' };
    return { ok: true, state: body.state };
  } catch {
    return { ok: false, error: 'recovery_failed' };
  }
}
