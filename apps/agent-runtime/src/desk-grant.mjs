/**
 * Desk password gate for owner spend routes.
 * The row stores a PBKDF2 verifier and a hash of the current grant.
 * The password and the grant itself are not stored.
 */
import { supabaseConfig, supabaseGet } from './supabase-rest.mjs';

const textEncoder = new TextEncoder();
const HEX_32 = /^[0-9a-f]{32}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const SECRET_FIELDS = ['password', 'phrase', 'mnemonic', 'seed', 'seedphrase', 'privatekey', 'key'];

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  if (typeof hex !== 'string' || !HEX_64.test(hex) && !HEX_32.test(hex)) return null;
  if (hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

function sameBytes(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

function sameText(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

export function parseDeskVerifier(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const names = Object.keys(body).map(key => key.replace(/[^A-Za-z0-9]/g, '').toLowerCase());
  if (names.some(name => SECRET_FIELDS.includes(name))) return null;
  const iterations = body.iterations;
  if (!Number.isSafeInteger(iterations) || iterations < 10000 || iterations > 2000000) return null;
  if (typeof body.salt !== 'string' || !HEX_32.test(body.salt)) return null;
  if (typeof body.hash !== 'string' || !HEX_64.test(body.hash)) return null;
  return { iterations, salt: body.salt, hash: body.hash };
}

export async function passwordMatches(password, verifier) {
  const parsed = parseDeskVerifier(verifier);
  const clean = typeof password === 'string' ? password.normalize('NFC') : '';
  if (!parsed || clean.length < 8 || clean.length > 128) return false;
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(clean), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: hexToBytes(parsed.salt),
    iterations: parsed.iterations,
    hash: 'SHA-256',
  }, key, 256);
  return sameBytes(new Uint8Array(bits), hexToBytes(parsed.hash));
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return bytesToHex(digest);
}

export function newDeskGrant() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

export function voiceWebhookMatches(request, env) {
  const expected = typeof env?.ELEVENLABS_WEBHOOK_SECRET === 'string' ? env.ELEVENLABS_WEBHOOK_SECRET : '';
  if (!expected) return false;
  return sameText(request.headers.get('x-elevenlabs-webhook-secret') || '', expected);
}

/**
 * Owner spend is allowed when Supabase is not configured (offline tests),
 * when the ElevenLabs webhook already authenticated the call, or when the
 * desk grant matches the stored hash and has not expired.
 */
export async function deskSpendAllowed(env, request, ownerId, fetcher = env?.fetch ?? fetch, now = Date.now()) {
  if (voiceWebhookMatches(request, env)) return { ok: true, via: 'voice' };
  if (!supabaseConfig(env)) return { ok: true, via: 'unconfigured' };
  const lookup = await supabaseGet(
    env,
    `desk_locks?owner_id=eq.${encodeURIComponent(ownerId)}&select=grant_hash,grant_until`,
    fetcher,
  );
  if (lookup.status !== 200 || !Array.isArray(lookup.rows)) {
    return { ok: false, error: 'desk_lock_unavailable' };
  }
  const row = lookup.rows[0];
  if (!row) return { ok: false, error: 'desk_lock_required' };
  const grant = request.headers.get('x-desk-grant') || '';
  if (!HEX_64.test(grant) || typeof row.grant_hash !== 'string' || !HEX_64.test(row.grant_hash)) {
    return { ok: false, error: 'desk_locked' };
  }
  const actual = await sha256Hex(grant);
  const until = Date.parse(row.grant_until);
  if (!sameText(actual, row.grant_hash) || !Number.isFinite(until) || !Number.isFinite(now) || now >= until) {
    return { ok: false, error: 'desk_locked' };
  }
  return { ok: true, via: 'grant' };
}
