/**
 * Verify a Privy access token against the app JWKS.
 * The owner id is the verified `sub`. A header is not an owner.
 */
import { Buffer } from 'node:buffer';

const ISSUER = 'privy.io';
const APP_ID = /^[a-z0-9]{8,64}$/;
const OWNER = /^did:privy:[a-zA-Z0-9_-]{1,80}$/;
const JWKS_TTL_MS = 60_000;
const JWKS_MISS_COOLDOWN_MS = 5_000;
const keyCache = new WeakMap();

export function privyJwksUrl(appId) {
  const id = typeof appId === 'string' ? appId.trim() : '';
  if (!APP_ID.test(id)) return '';
  return `https://auth.privy.io/api/v1/apps/${id}/jwks.json`;
}

function b64urlJson(part) {
  const text = Buffer.from(part, 'base64url').toString('utf8');
  return JSON.parse(text);
}

function audienceMatches(aud, appId) {
  if (typeof aud === 'string') return aud === appId;
  return Array.isArray(aud) && aud.some(value => value === appId);
}

async function verifyEs256(signingInput, signature, jwk) {
  if (signature.length !== 64) return false;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, new TextEncoder().encode(signingInput));
}

async function loadJwks(appId, fetcher, kid) {
  const url = privyJwksUrl(appId);
  if (!url) {
    const error = new Error('Privy app id is required');
    error.code = 'missing_config';
    throw error;
  }
  const cached = keyCache.get(fetcher);
  const now = Date.now();
  let retryAt = 0;
  if (cached?.url === url && cached.expires > now) {
    if (!kid || cached.keys.some(key => key.kid === kid) || cached.retryAt > now) return cached.keys;
    // An untrusted key id must not cause a fetch on every request.
    retryAt = cached.retryAt = now + JWKS_MISS_COOLDOWN_MS;
  }
  const response = await fetcher(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(5000) });
  if (!response || response.ok !== true) {
    const error = new Error('Privy JWKS was not available');
    error.code = 'login_required';
    throw error;
  }
  const body = await response.json();
  const keys = (Array.isArray(body?.keys) ? body.keys : [])
    .filter(key => key && key.kty === 'EC' && key.crv === 'P-256' && key.use !== 'enc');
  if (keys.length) keyCache.set(fetcher, { url, keys, expires: Date.now() + JWKS_TTL_MS, retryAt });
  return keys;
}

/**
 * @returns {Promise<{ sub: string }>}
 */
export async function verifyPrivyAccessToken(accessToken, { appId, fetcher = fetch, now = Date.now } = {}) {
  const token = typeof accessToken === 'string' ? accessToken.trim() : '';
  const parts = token.split('.');
  if (token.length > 8192 || parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) {
    const error = new Error('Privy access token is required');
    error.code = 'login_required';
    throw error;
  }
  let header;
  let claims;
  try {
    header = b64urlJson(parts[0]);
    claims = b64urlJson(parts[1]);
  } catch {
    const error = new Error('Privy access token is required');
    error.code = 'login_required';
    throw error;
  }
  if (header?.alg !== 'ES256' || (header.kid !== undefined && typeof header.kid !== 'string')) {
    const error = new Error('Privy access token is required');
    error.code = 'login_required';
    throw error;
  }
  const keys = await loadJwks(appId, fetcher, header.kid);
  const jwk = header.kid ? keys.find(key => key.kid === header.kid) : (keys.length === 1 ? keys[0] : null);
  if (!jwk) {
    const error = new Error('Privy access token is required');
    error.code = 'login_required';
    throw error;
  }
  let signatureOk = false;
  try {
    signatureOk = await verifyEs256(
      `${parts[0]}.${parts[1]}`,
      Buffer.from(parts[2], 'base64url'),
      jwk,
    );
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) {
    const error = new Error('Privy access token is required');
    error.code = 'login_required';
    throw error;
  }
  const clock = typeof now === 'function' ? now() : now;
  const seconds = Math.floor(Number(clock) / 1000);
  if (!Number.isFinite(seconds)) {
    const error = new Error('Privy access token is required');
    error.code = 'login_required';
    throw error;
  }
  if (typeof claims.exp !== 'number' || claims.exp < seconds - 60) {
    const error = new Error('Privy access token is required');
    error.code = 'login_required';
    throw error;
  }
  if (typeof claims.nbf === 'number' && claims.nbf > seconds + 60) {
    const error = new Error('Privy access token is required');
    error.code = 'login_required';
    throw error;
  }
  if (claims.iss !== ISSUER || !audienceMatches(claims.aud, appId)) {
    const error = new Error('Privy access token is required');
    error.code = 'login_required';
    throw error;
  }
  if (typeof claims.sub !== 'string' || !OWNER.test(claims.sub)) {
    const error = new Error('Privy access token is required');
    error.code = 'login_required';
    throw error;
  }
  return { sub: claims.sub };
}
