/**
 * Verify a Privy access token against the app JWKS.
 * The owner id is the verified `sub`. A header is not an owner.
 */
import { createPublicKey, createVerify } from 'node:crypto';

const ISSUER = 'privy.io';
const APP_ID = /^[a-z0-9]{8,64}$/;
const OWNER = /^did:privy:[a-zA-Z0-9_-]{1,80}$/;

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

function verifyEs256(signingInput, signature, jwk) {
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const verifier = createVerify('SHA256');
  verifier.update(signingInput);
  verifier.end();
  return verifier.verify({ key, dsaEncoding: 'ieee-p1363' }, signature);
}

async function loadJwks(appId, fetcher) {
  const url = privyJwksUrl(appId);
  if (!url) {
    const error = new Error('Privy app id is required');
    error.code = 'missing_config';
    throw error;
  }
  const response = await fetcher(url, { method: 'GET', redirect: 'manual' });
  if (!response || response.ok !== true) {
    const error = new Error('Privy JWKS was not available');
    error.code = 'login_required';
    throw error;
  }
  const body = await response.json();
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  return keys.filter(key => key && key.kty === 'EC' && key.crv === 'P-256' && key.use !== 'enc');
}

/**
 * @returns {Promise<{ sub: string }>}
 */
export async function verifyPrivyAccessToken(accessToken, { appId, fetcher, now = Date.now } = {}) {
  const token = typeof accessToken === 'string' ? accessToken.trim() : '';
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(part => !part)) {
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
  if (header?.alg !== 'ES256' || typeof header.kid !== 'string' || !header.kid) {
    const error = new Error('Privy access token is required');
    error.code = 'login_required';
    throw error;
  }
  const keys = await loadJwks(appId, fetcher);
  const jwk = keys.find(key => key.kid === header.kid);
  if (!jwk) {
    const error = new Error('Privy access token is required');
    error.code = 'login_required';
    throw error;
  }
  let signatureOk = false;
  try {
    signatureOk = verifyEs256(
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
