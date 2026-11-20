import { configuredSolanaRpc, SOLANA_CLUSTER, SOLANA_GENESIS_HASH, SOLANA_CAIP2, SOLANA_USDC_MINT } from '@ubc2026/contracts/solana';
import { AddressLookupTableAccount, Transaction, VersionedTransaction } from '@solana/web3.js';
import { swapAccountSnapshot, verifySwapSimulation } from './swap-simulation.mjs';
/**
 * Privy Solana wallet path for Maelstrom.
 * Login provisioning (main wallet at sign-up, additional wallets) and
 * server signing. Bot spends, owner sweeps, and wallet-adapter deposits
 * broadcast on Solana mainnet-beta through SOLANA_RPC_URL.
 * Wallet keys stay in Privy. Signing credentials stay server-side.
 */
import { createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { SECRET_GROUPS, requireConfig, validateWallet, ContractError, parsePrivySigningFailure } from '@ubc2026/contracts';
import {
  WalletError,
  assertSpendAllowed,
  createAdditionalWallet,
  createMainWallet,
} from './wallets.mjs';

export { WalletError };

export function simulationFailureReason(value) {
  const err = value?.err;
  if (err === 'AccountNotFound') return 'account_not_found';
  if (err === 'InsufficientFundsForFee' || err === 'InsufficientFundsForRent') return 'insufficient_funds';
  const instruction = err?.InstructionError;
  if (Array.isArray(instruction) && Number.isSafeInteger(instruction[0])) {
    const code = typeof instruction[1] === 'string' && /^[A-Za-z]{1,64}$/.test(instruction[1])
      ? instruction[1] : Number.isSafeInteger(instruction[1]?.Custom) ? `custom_${instruction[1].Custom}` : 'unknown';
    return `instruction_${instruction[0]}_${code}`;
  }
  return 'simulation_unavailable';
}

function failSimulation(value) {
  const error = new WalletError('Solana transfer simulation failed', 'simulation_failed');
  error.simulationReason = simulationFailureReason(value);
  throw error;
}

/**
 * Full Solana-mainnet-beta genesis hash from getGenesisHash.
 * CAIP-2 uses the truncated form solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp — do not use that for RPC checks.
 */
export { SOLANA_GENESIS_HASH, SOLANA_CAIP2, SOLANA_USDC_MINT };

const PRIVY_API_BASE = 'https://api.privy.io';
const PRIVY_AUTH_BASE = 'https://auth.privy.io';
const REQUEST_TTL_MS = 60_000;
const MAX_TX_BYTES = 1232;
const SINGLE_SIGNATURE_MESSAGE_OFFSET = 65;
const CLASSIC_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const privyWalletIdPattern = /^[A-Za-z0-9_-]{10,128}$/;
const ownerIdPattern = /^[a-zA-Z0-9:_.-]{1,256}$/;
const USER_WALLET_AUTH_ERRORS = new Set([
  'missing_or_empty_authorization_header',
  'zero_correct_authorization_signatures',
  'no_valid_user_session_keys',
  'user_session_keys_expired',
]);

const fail = (message, code = 'wallet_error') => {
  throw new WalletError(message, code);
};

function privyErrorCodes(body) {
  return [body?.code, body?.error_code, body?.error?.code, body?.error?.error_code, body?.error];
}

function privySigningFailure(status, body) {
  const codes = privyErrorCodes(body);
  const code = codes.includes('policy_violation')
    ? 'policy_violation'
    : codes.find(value => parsePrivySigningFailure({ code: value }));
  return parsePrivySigningFailure({ status, code });
}

function privyResponseDetail(body) {
  const detail = (typeof body === 'string' ? [body] : [
    body?.code, body?.error_code, body?.error?.code, body?.error?.error_code,
    body?.error, body?.message, body?.error?.message,
  ]).filter(value => typeof value === 'string').map(value => value.slice(0, 512)).join(' ');
  if (!detail) return undefined;
  if (/missing_mfa_enrollment|mfa.{0,24}enroll/i.test(detail)) return 'mfa-enrollment-required';
  if (/mfa_required|mfa.{0,36}(?:required|missing)|(?:required|missing).{0,36}mfa/i.test(detail)) return 'mfa-required';
  if (/(?:jwt|token).{0,32}expired|expired.{0,32}(?:jwt|token)/i.test(detail)) return 'token-expired';
  if (/jwt.{0,45}(?:not enabled|not configured|configuration)|(?:enable|configure).{0,36}jwt|jwks/i.test(detail)) return 'jwt-configuration';
  if (/(?:invalid|malformed|unverifiable).{0,35}(?:jwt|token)|(?:jwt|token).{0,32}(?:invalid|malformed|unverifiable)/i.test(detail)) return 'token-invalid';
  if (/no.{0,24}wallets|wallets.{0,24}not found/i.test(detail)) return 'no-wallets';
  if (/(?:invalid|unsupported|missing).{0,35}(?:hpke|recipient.public.key|encryption)|(?:hpke|recipient.public.key|encryption).{0,35}(?:invalid|unsupported|missing)/i.test(detail)) return 'invalid-encryption';
  if (/\binvalid_data\b/i.test(detail)) return 'invalid-data';
  return 'provider-detail';
}

function recordPrivyResponse(attempt, response) {
  attempt.status = response.status;
  attempt.requestId = response.headers.get('privy-request-id')
    || response.headers.get('x-privy-request-id')
    || response.headers.get('x-request-id')
    || response.headers.get('request-id');
  attempt.edgeId = response.headers.get('cf-ray');
}

function recordPrivyErrorBody(attempt, body) {
  attempt.code = privySigningFailure(attempt.status, body)?.code
    || privyErrorCodes(body).find(code => parsePrivySigningFailure({
      requests: [{ stage: attempt.stage, code }],
    })?.requests[0].code);
  attempt.detail = privyResponseDetail(body);
  attempt.requestId ||= body?.request_id || body?.requestId || body?.error?.request_id;
}

function privyTransportFailure(error, attempt) {
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return 'timeout';
  return attempt.status ? 'invalid-response' : 'network';
}

function failSigning(message, code, diagnostic) {
  const error = new WalletError(message, code);
  if (diagnostic) error.privyFailure = diagnostic;
  throw error;
}

const HPKE_B64 = /^[A-Za-z0-9+/]+={0,2}$/;

function assertHpkeField(value, label) {
  if (typeof value !== 'string' || value.length < 43 || value.length > 4096 || !HPKE_B64.test(value)) {
    fail(`${label} is required`, 'invalid_export');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < 32 || bytes.length > 3072) fail(`${label} is required`, 'invalid_export');
  return value;
}

function acceptHpkeExport(payload) {
  if (!payload || typeof payload !== 'object') fail('Privy export failed', 'invalid_provider_response');
  for (const key of Object.keys(payload)) {
    const normalized = key.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    if (normalized === 'privatekey' || normalized === 'seed' || normalized === 'mnemonic' || normalized === 'secretkey') {
      fail('Privy export included a plaintext key', 'plaintext_key');
    }
  }
  if (payload.encryption_type !== 'HPKE') fail('Privy export was not encrypted', 'invalid_provider_response');
  return {
    encryptionType: 'HPKE',
    encapsulatedKey: assertHpkeField(payload.encapsulated_key, 'Encapsulated key'),
    ciphertext: assertHpkeField(payload.ciphertext, 'Ciphertext'),
  };
}

function assertHeaderSafe(value, label) {
  if (typeof value !== 'string' || value.trim() === '' || /[\r\n]/.test(value) || value.length > 8192) {
    fail(`${label} is required`, 'missing_config');
  }
  return value.trim();
}

function assertHttps(url, label) {
  let parsed;
  try { parsed = new URL(url); } catch { fail(`${label} must be an https URL`, 'invalid_rpc'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) fail(`${label} must be an https URL`, 'invalid_rpc');
  return parsed.toString().replace(/\/$/, '');
}

/** RFC 8785 for the JSON values this client signs (objects, arrays, strings, integers, booleans, null). */
export function canonicalizeJson(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) fail('Authorization payload contains a non-integer number', 'invalid_authorization');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(entry => canonicalizeJson(entry)).join(',')}]`;
  if (typeof value !== 'object') fail('Authorization payload is not JSON', 'invalid_authorization');
  const keys = Object.keys(value).filter(key => value[key] !== undefined).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`).join(',')}}`;
}

function authorizationPem(authorizationKey) {
  const trimmed = assertHeaderSafe(authorizationKey, 'Authorization key');
  const raw = trimmed.startsWith('wallet-auth:') ? trimmed.slice('wallet-auth:'.length).trim() : trimmed;
  if (raw.includes('BEGIN') || !/^[A-Za-z0-9+/=]+$/.test(raw) || raw.length < 32) {
    fail('Authorization key must be the Privy wallet-auth private key', 'invalid_authorization_key');
  }
  const body = raw.match(/.{1,64}/g).join('\n');
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
}

/**
 * P-256 signature over the Privy authorization payload.
 * `authorizationKey` is the dashboard private key, with or without the `wallet-auth:` prefix.
 */
export function privyAuthorizationSignature({
  appId,
  authorizationKey,
  method,
  url,
  body,
  idempotencyKey,
  expiresAt,
}) {
  const headers = { 'privy-app-id': assertHeaderSafe(appId, 'Privy app id') };
  if (idempotencyKey) headers['privy-idempotency-key'] = idempotencyKey;
  if (expiresAt != null) headers['privy-request-expiry'] = String(expiresAt);
  const payload = canonicalizeJson({ version: 1, method, url, body, headers });
  let key;
  try {
    key = createPrivateKey({ key: authorizationPem(authorizationKey), format: 'pem' });
  } catch (error) {
    if (error instanceof WalletError) throw error;
    fail('Authorization key could not be read', 'invalid_authorization_key');
  }
  return cryptoSign('sha256', Buffer.from(payload), key).toString('base64');
}

function basicAuth(appId, appSecret) {
  return `Basic ${Buffer.from(`${appId}:${appSecret}`, 'utf8').toString('base64')}`;
}

function safePrivyCode(payload) {
  if (!payload || typeof payload !== 'object') return '';
  for (const raw of [payload.error, payload.code, payload.error_code, payload.message]) {
    if (typeof raw !== 'string') continue;
    const normalized = raw.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (/^[a-z0-9_]{1,64}$/.test(normalized)) return normalized;
  }
  return '';
}

function safePrivyPath(url) {
  try {
    const path = new URL(url).pathname;
    if (path.includes('/users/me')) return 'users/me';
    if (path.includes('/v1/wallets') && !path.includes('/rpc')) return 'wallets';
    if (path.includes('/v1/users/')) return 'users';
    return 'privy';
  } catch {
    return 'privy';
  }
}

/** Browser Origin for auth.privy.io /users/me (required; 403 must_specify_origin without it). */
export function sanitizeOrigin(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256 || /[\r\n]/.test(trimmed)) return '';
  try {
    const url = new URL(trimmed);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return '';
    return url.origin;
  } catch {
    return '';
  }
}

/**
 * Cloudflare Workers / OpenNext forbid setting outbound `Origin` / `Referer`.
 * Calling `/users/me` there throws TypeError → opaque "Privy request failed".
 */
export function isCloudflareWorkerRuntime(global = globalThis) {
  try {
    const ua = global?.navigator?.userAgent;
    if (typeof ua === 'string' && ua.includes('Cloudflare-Workers')) return true;
  } catch {
    /* ignore */
  }
  try {
    // workerd / OpenNext-on-Workers expose WebSocketPair; plain Node does not.
    if (typeof global?.WebSocketPair === 'function') return true;
  } catch {
    /* ignore */
  }
  return false;
}

function isForbiddenOutboundHeaderError(error) {
  const name = typeof error?.name === 'string' ? error.name : '';
  const message = typeof error?.message === 'string' ? error.message : '';
  if (!message && name !== 'TypeError') return false;
  return /origin|referer|forbidden header name|immutable/i.test(`${name} ${message}`);
}

/** Short non-secret cause for failed outbound fetch (Workers often throw bare TypeError). */
function safeNetworkCause(error) {
  const name = typeof error?.name === 'string' && error.name ? error.name : 'Error';
  const raw = typeof error?.message === 'string' ? error.message.replace(/[\r\n]+/g, ' ').trim() : '';
  const clipped = raw
    .replace(/(sk_[A-Za-z0-9]+)/g, 'sk_[redacted]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[redacted]')
    .slice(0, 100);
  if (clipped && clipped.length > 2 && !/(secret|password|api[_-]?key)/i.test(clipped)) {
    return `failed (${name}: ${clipped})`;
  }
  return name && name !== 'Error' ? `failed (${name})` : 'failed';
}

function decodeBase64(value, label) {
  if (typeof value !== 'string' || value.length < 4 || value.length > 4096 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    fail(`${label} must be base64`, 'invalid_transaction');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < 1 || bytes.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) {
    fail(`${label} must be base64`, 'invalid_transaction');
  }
  return bytes;
}

function accountField(account, snake, camel) {
  if (!account || typeof account !== 'object') return undefined;
  if (account[snake] !== undefined) return account[snake];
  return account[camel];
}

/**
 * Privy createOnLogin often links a Solana embedded wallet with `id: null`
 * until it is on the server wallet stack / delegated. Only wallets with a
 * real server wallet id can be used for acceptLogin provisioning.
 */
function isPrivyEmbeddedClient(client, connector) {
  if (client !== 'privy' && client !== 'privy-v2') return false;
  return connector == null || connector === '' || connector === 'embedded';
}

function solanaEmbedded(user) {
  const accounts = Array.isArray(user?.linked_accounts)
    ? user.linked_accounts
    : (Array.isArray(user?.linkedAccounts) ? user.linkedAccounts : []);
  return accounts
    .filter(account => {
      if (!account || account.type !== 'wallet') return false;
      const chain = accountField(account, 'chain_type', 'chainType');
      const client = accountField(account, 'wallet_client_type', 'walletClientType');
      const connector = accountField(account, 'connector_type', 'connectorType');
      return chain === 'solana' && isPrivyEmbeddedClient(client, connector);
    })
    .map(account => {
      const index = accountField(account, 'wallet_index', 'walletIndex');
      return {
        id: account.id,
        address: account.address,
        walletIndex: Number.isInteger(index) ? index : 0,
      };
    })
    .filter(account => privyWalletIdPattern.test(account.id) && typeof account.address === 'string' && base58.test(account.address))
    .sort((a, b) => a.walletIndex - b.walletIndex);
}

function assertPrivyWalletId(id) {
  if (typeof id !== 'string' || !privyWalletIdPattern.test(id)) fail('Privy wallet id is required', 'invalid_wallet');
  return id;
}

function assertOwnerId(ownerId) {
  if (typeof ownerId !== 'string' || !ownerIdPattern.test(ownerId)) {
    const kind = ownerId == null ? 'missing' : typeof ownerId;
    fail(`Wallet owner is required (${kind})`, 'invalid_owner');
  }
  return ownerId;
}

function readPrivyUserPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.id === 'string' && payload.id.trim()) return payload;
  if (payload.user && typeof payload.user === 'object' && typeof payload.user.id === 'string') return payload.user;
  if (payload.data && typeof payload.data === 'object' && typeof payload.data.id === 'string') return payload.data;
  return payload;
}

function base64UrlToUtf8(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const b64 = `${normalized}${pad}`;
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64').toString('utf8');
  }
  if (typeof atob === 'function') {
    const binary = atob(b64);
    let out = '';
    for (let i = 0; i < binary.length; i += 1) out += String.fromCharCode(binary.charCodeAt(i));
    return out;
  }
  throw new Error('no_base64');
}

/**
 * Read the Privy user id from an access-token JWT `sub` without verifying the
 * signature. Empty when the token is opaque / malformed — callers must then
 * use `/users/me` (needs Origin) or an explicit owner id.
 */
export function readPrivyAccessTokenSub(accessToken) {
  const payload = readPrivyAccessTokenClaims(accessToken);
  return typeof payload?.sub === 'string' ? payload.sub.trim() : '';
}

function readPrivyAccessTokenClaims(accessToken) {
  try {
    const part = String(accessToken).split('.')[1];
    return part ? JSON.parse(base64UrlToUtf8(part)) : null;
  } catch {
    return null;
  }
}

function ownerSessionChecks(accessToken, ownerId, appId, at) {
  if (!accessToken) return { check: 'missing' };
  const claims = readPrivyAccessTokenClaims(accessToken);
  if (typeof claims?.sub !== 'string' || !claims.sub.trim()) return { check: 'unreadable' };
  return {
    check: claims.sub.trim() === ownerId ? 'owner-matched' : 'owner-mismatch',
    audience: claims.aud == null ? 'missing' : [].concat(claims.aud).includes(appId) ? 'match' : 'mismatch',
    issuer: claims.iss == null ? 'missing' : claims.iss === 'privy.io' ? 'match' : 'mismatch',
    expiry: !Number.isFinite(claims.exp) ? 'missing' : claims.exp <= at / 1000 ? 'expired' : 'current',
  };
}

function jwtSub(accessToken) {
  return readPrivyAccessTokenSub(accessToken);
}

function resolvePrivyUserId(user, accessToken, ownerId) {
  for (const candidate of [user?.id, user?.user_id, user?.userId, ownerId, jwtSub(accessToken)]) {
    if (typeof candidate === 'string' && ownerIdPattern.test(candidate.trim())) return candidate.trim();
  }
  return '';
}

const CLIENT_LABELS = Object.freeze({
  phantom: 'Phantom',
  solflare: 'Solflare',
  backpack: 'Backpack',
  jupiter: 'Jupiter',
  privy: 'Privy',
});

function clientLabel(client) {
  if (CLIENT_LABELS[client]) return CLIENT_LABELS[client];
  if (typeof client !== 'string' || !/^[a-z0-9_-]{1,24}$/i.test(client)) return 'Wallet';
  return client.slice(0, 1).toUpperCase() + client.slice(1);
}

function linkedAccountList(user) {
  if (Array.isArray(user?.linked_accounts)) return user.linked_accounts;
  if (Array.isArray(user?.linkedAccounts)) return user.linkedAccounts;
  return [];
}

function methodDetail(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || text.length > 128 || /[\r\n]/.test(text)) return '';
  return text;
}

/** Sign-in methods on this Privy user. A later login with any of them is the same owner. */
export function loginMethodsFromUser(user) {
  const methods = [];
  const seen = new Set();
  for (const account of linkedAccountList(user)) {
    if (!account || typeof account !== 'object') continue;
    const type = typeof account.type === 'string' ? account.type : '';
    if (type === 'email') {
      const detail = methodDetail(account.address || account.email);
      if (detail && !seen.has(`email:${detail}`)) {
        seen.add(`email:${detail}`);
        methods.push({ method: 'email', detail });
      }
      continue;
    }
    if (type === 'google_oauth' || type === 'google') {
      const detail = methodDetail(account.email || account.name);
      if (!seen.has('google')) {
        seen.add('google');
        methods.push({ method: 'google', detail });
      }
      continue;
    }
    if (type === 'github_oauth' || type === 'github') {
      const detail = methodDetail(account.username || account.email);
      if (!seen.has('github')) {
        seen.add('github');
        methods.push({ method: 'github', detail });
      }
      continue;
    }
    if (type === 'discord_oauth' || type === 'discord') {
      const detail = methodDetail(account.username || account.email);
      if (!seen.has('discord')) {
        seen.add('discord');
        methods.push({ method: 'discord', detail });
      }
      continue;
    }
    if (type !== 'wallet') continue;
    const chain = accountField(account, 'chain_type', 'chainType');
    const address = typeof account.address === 'string' ? account.address.trim() : '';
    if ((chain && chain !== 'solana') || !base58.test(address) || seen.has(`wallet:${address}`)) continue;
    seen.add(`wallet:${address}`);
    const client = accountField(account, 'wallet_client_type', 'walletClientType') || 'wallet';
    methods.push({
      method: 'wallet',
      detail: typeof client === 'string' ? client : 'wallet',
      address,
    });
  }
  return methods;
}

function observingWallets(user, ownerId, privyUserId, taken) {
  const out = [];
  for (const account of linkedAccountList(user)) {
    if (!account || account.type !== 'wallet') continue;
    const chain = accountField(account, 'chain_type', 'chainType');
    const client = accountField(account, 'wallet_client_type', 'walletClientType') || 'wallet';
    const connector = accountField(account, 'connector_type', 'connectorType');
    const address = typeof account.address === 'string' ? account.address.trim() : '';
    if ((chain && chain !== 'solana') || !base58.test(address) || taken.has(address)) continue;
    if (isPrivyEmbeddedClient(client, connector)) continue;
    taken.add(address);
    out.push({
      ...createAdditionalWallet({
        ownerId,
        address,
        id: `linked_${address}`,
        label: clientLabel(client),
      }),
      spendable: false,
      walletClientType: typeof client === 'string' ? client : 'wallet',
      privyUserId,
    });
  }
  return out;
}

function attachLinked(record, user) {
  if (!record?.main) return record;
  const taken = new Set([
    record.main.address,
    ...(record.additional || []).map(wallet => wallet.address),
  ]);
  return {
    ...record,
    main: { ...record.main, spendable: true },
    additional: [
      ...(record.additional || []).map(wallet => ({ ...wallet, spendable: wallet.spendable !== false })),
      ...observingWallets(user, record.main.ownerId, record.privyUserId, taken),
    ],
    loginMethods: loginMethodsFromUser(user),
  };
}

function recordsFromEmbedded(embedded, ownerId, privyUserId) {
  if (embedded.length < 1) return null;
  const [first, ...rest] = embedded;
  const main = {
    ...createMainWallet({ ownerId, address: first.address, id: assertPrivyWalletId(first.id) }),
    privyWalletId: first.id,
    privyUserId,
  };
  const additional = rest.map(wallet => ({
    ...createAdditionalWallet({
      ownerId,
      address: wallet.address,
      id: assertPrivyWalletId(wallet.id),
      label: `Additional ${wallet.walletIndex}`,
    }),
    privyWalletId: wallet.id,
    privyUserId,
  }));
  return { main, additional };
}

function idempotencyKey(prefix, privyUserId, label = '') {
  const user = privyUserId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48);
  const name = label.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 24);
  return name ? `${prefix}_${user}_${name}` : `${prefix}_${user}`;
}

export function createPrivyWalletClient({
  appId,
  appSecret,
  rpcUrl,
  authorizationKey = null,
  fetcher = fetch,
  now = () => Date.now(),
  apiBase = PRIVY_API_BASE,
  authBase = PRIVY_AUTH_BASE,
  // OpenNext / workerd cannot set Origin; keep users/me fallback off there.
  allowUsersMeFallback = !isCloudflareWorkerRuntime(),
} = {}) {
  const id = assertHeaderSafe(appId, 'Privy app id');
  const secret = assertHeaderSafe(appSecret, 'Privy app secret');
  // RPC is required for broadcast/signing; acceptLogin / wallet create can omit it.
  const quicknode = rpcUrl == null || rpcUrl === '' ? null : assertHttps(rpcUrl, 'QuickNode mainnet-beta RPC');
  const privyApi = assertHttps(apiBase, 'Privy API');
  const privyAuth = assertHttps(authBase, 'Privy auth API');
  const authKey = authorizationKey == null || authorizationKey === '' ? null : authorizationKey;
  const usersMeFallback = allowUsersMeFallback === true;

  function abortAfter(ms) {
    // OpenNext Cloudflare for Dev / workerd may lack AbortSignal.timeout.
    if (typeof AbortSignal === 'function' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(ms);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    if (typeof timer?.unref === 'function') timer.unref();
    return controller.signal;
  }

  async function fetchJson(url, { method, headers, body, signingAttempt }, code) {
    let response;
    try {
      // Cloudflare Workers only allow redirect "follow" | "manual".
      // `redirect: "error"` throws TypeError on workerd / OpenNext (the hosted
      // "Privy request failed (TypeError)" regression).
      response = await fetcher(url, {
        method,
        headers,
        body: body == null ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: abortAfter(15000),
      });
    } catch (error) {
      const aborted = error?.name === 'AbortError' || error?.name === 'TimeoutError';
      if (signingAttempt) {
        failSigning('Could not reach the Privy signing API', code, { transport: aborted ? 'timeout' : 'network' });
      }
      const target = code === 'rpc_failed' ? 'QuickNode mainnet-beta RPC' : 'Privy';
      if (isForbiddenOutboundHeaderError(error)) {
        fail(`${target} request failed (forbidden_header)`, code === 'rpc_failed' ? code : 'worker_origin_forbidden');
      }
      // Include a short, non-secret cause so Cloudflare / network misconfig is diagnosable.
      const cause = aborted ? 'timed out' : safeNetworkCause(error);
      fail(`${target} request ${cause}`, code);
    }
    if (signingAttempt) recordPrivyResponse(signingAttempt, response);
    {
      const target = code === 'rpc_failed' ? 'QuickNode mainnet-beta RPC' : 'Privy';
      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        if (signingAttempt) failSigning('Privy redirected the signing request', code, { transport: 'redirect' });
        fail(`${target} request failed (redirect)`, code);
      }
    }
    let text;
    try {
      text = await response.text();
    } catch (error) {
      if (signingAttempt) {
        failSigning('Could not read the Privy signing response', code,
          { ...privySigningFailure(response.status), transport: 'invalid-response' });
      }
      throw error;
    }
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = null; }
    }
    if (!response.ok) {
      if (signingAttempt) {
        recordPrivyErrorBody(signingAttempt, payload ?? text);
        const diagnostic = privySigningFailure(response.status, payload);
        if (diagnostic?.code === 'policy_violation') {
          failSigning('Privy wallet policy rejected the transaction', 'wallet_policy_rejected', diagnostic);
        }
        if (USER_WALLET_AUTH_ERRORS.has(diagnostic?.code)) {
          failSigning('Privy requires wallet authorization', 'wallet_authorization_required', diagnostic);
        }
        failSigning('Privy refused the signing request', code, diagnostic);
      }
      const detail = safePrivyCode(payload);
      if (code === 'rpc_failed') {
        fail(`QuickNode mainnet-beta RPC request failed (${response.status}${detail ? `: ${detail}` : ''})`, code);
      }
      const step = safePrivyPath(url);
      fail(`Privy ${step} failed (${response.status}${detail ? `: ${detail}` : ''})`, code);
    }
    if (payload == null) {
      if (signingAttempt) failSigning('Privy returned an unreadable signing response', code, { transport: 'invalid-response' });
      fail(code === 'rpc_failed' ? 'QuickNode mainnet-beta RPC failed' : 'Privy request failed', code);
    }
    return payload;
  }

  function privyHeaders({ method, url, body, idempotency }) {
    const headers = {
      Authorization: basicAuth(id, secret),
      'privy-app-id': id,
      'Content-Type': 'application/json',
    };
    if (idempotency) headers['privy-idempotency-key'] = idempotency;
    // Sign every method when an authorization key is configured — apps that
    // require signatures reject unsigned wallet list/create with 403.
    if (authKey) {
      const expiresAt = now() + REQUEST_TTL_MS;
      headers['privy-request-expiry'] = String(expiresAt);
      headers['privy-authorization-signature'] = privyAuthorizationSignature({
        appId: id,
        authorizationKey: authKey,
        method,
        url,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        idempotencyKey: idempotency,
        expiresAt,
      });
    }
    return headers;
  }

  async function privy(method, path, body, idempotency) {
    const url = `${privyApi}${path}`;
    return fetchJson(url, {
      method,
      headers: privyHeaders({ method, url, body, idempotency }),
      body,
    }, 'privy_failed');
  }

  async function loadUser(privyUserId) {
    if (typeof privyUserId !== 'string' || !ownerIdPattern.test(privyUserId)) fail('Privy user id is required', 'invalid_owner');
    // App-secret Basic auth only — do not attach PRIVY_AUTHORIZATION_KEY.
    // Wallet-auth signatures are for wallet RPC/create; a bad key here 403s
    // GET /v1/users/:id on Workers while localhost /users/me (Bearer+Origin) still works.
    const url = `${privyApi}/v1/users/${encodeURIComponent(privyUserId)}`;
    return fetchJson(url, {
      method: 'GET',
      headers: {
        Authorization: basicAuth(id, secret),
        'privy-app-id': id,
        'Content-Type': 'application/json',
      },
    }, 'privy_failed');
  }

  function createdRecord(payload, ownerId, privyUserId, kind, label) {
    if (!payload || payload.chain_type !== 'solana') fail('Privy returned a non-Solana wallet', 'invalid_provider_response');
    const walletId = assertPrivyWalletId(payload.id);
    if (typeof payload.address !== 'string' || !base58.test(payload.address)) fail('Privy returned an invalid Solana address', 'invalid_provider_response');
    const built = kind === 'main'
      ? createMainWallet({ ownerId, address: payload.address, id: walletId })
      : createAdditionalWallet({ ownerId, address: payload.address, id: walletId, label });
    return { ...built, privyWalletId: walletId, privyUserId };
  }

  async function listSolanaWallets(privyUserId, { required = true } = {}) {
    const query = new URLSearchParams({
      user_id: privyUserId,
      chain_type: 'solana',
      limit: '50',
    });
    try {
      const payload = await privy('GET', `/v1/wallets?${query}`);
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      return rows
        .filter(wallet => wallet
          && wallet.chain_type === 'solana'
          && typeof wallet.address === 'string'
          && base58.test(wallet.address)
          && privyWalletIdPattern.test(wallet.id))
        .map(wallet => ({
          id: wallet.id,
          address: wallet.address,
          walletIndex: 0,
        }));
    } catch (error) {
      if (!required && error instanceof WalletError && (error.code === 'privy_failed')) {
        return [];
      }
      throw error;
    }
  }

  function recordsFromServerWallets(wallets, ownerId, privyUserId) {
    if (!Array.isArray(wallets) || wallets.length < 1) return null;
    return recordsFromEmbedded(wallets, ownerId, privyUserId);
  }

  async function syncWallets(user, ownerId, accessToken = '') {
    const resolved = resolvePrivyUserId(user, accessToken, ownerId);
    const privyUserId = assertOwnerId(resolved || user?.id);
    const owner = assertOwnerId(ownerId || resolved || user?.id);
    const embedded = solanaEmbedded(user);
    const existing = recordsFromEmbedded(embedded, owner, privyUserId);
    if (existing) return attachLinked({ privyUserId, ...existing, created: false }, user);

    // createOnLogin may have linked a wallet with id:null — recover via Wallet API.
    // List is best-effort: a 403 here (auth signature / permissions) must not block create.
    const listed = await listSolanaWallets(privyUserId, { required: false });
    const fromList = recordsFromServerWallets(listed, owner, privyUserId);
    if (fromList) return attachLinked({ privyUserId, ...fromList, created: false }, user);

    try {
      const created = await privy('POST', '/v1/wallets', {
        chain_type: 'solana',
        owner: { user_id: privyUserId },
        display_name: 'Main',
      }, idempotencyKey('main-solana', privyUserId));
      return attachLinked({
        privyUserId,
        main: createdRecord(created, owner, privyUserId, 'main'),
        additional: [],
        created: true,
      }, user);
    } catch (error) {
      const retry = recordsFromServerWallets(
        await listSolanaWallets(privyUserId, { required: false }),
        owner,
        privyUserId,
      );
      if (retry) return attachLinked({ privyUserId, ...retry, created: false }, user);
      if (
        error instanceof WalletError
        && error.code === 'privy_failed'
        && /403/.test(error.message)
        && !authKey
      ) {
        fail(
          'Privy wallets failed (403). Set PRIVY_AUTHORIZATION_KEY from Privy → Authorization keys (wallet-auth private key), or disable required authorization signatures.',
          'privy_failed',
        );
      }
      throw error;
    }
  }

  async function rpc(method, params) {
    if (!quicknode) fail('QuickNode mainnet-beta RPC is required', 'missing_config');
    return fetchJson(quicknode, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { jsonrpc: '2.0', id: 1, method, params },
    }, 'rpc_failed');
  }

  /** Genesis gate shared by signing, owner sweeps, deposits, and mainnet-beta reads. */
  async function assertSolana() {
    if (!quicknode) fail('QuickNode mainnet-beta RPC is required', 'missing_config');
    const genesis = await rpc('getGenesisHash');
    if (genesis.result !== SOLANA_GENESIS_HASH) {
      fail('Refusing to broadcast outside Solana mainnet-beta', 'wrong_cluster');
    }
    return { cluster: SOLANA_CLUSTER };
  }

  async function checkPrivyWalletAccess(walletId, walletAddress, attempt) {
    try {
      const response = await fetcher(`${privyApi}/v1/wallets/${encodeURIComponent(walletId)}`, {
        method: 'GET',
        headers: { Authorization: basicAuth(id, secret), 'privy-app-id': id },
        redirect: 'manual',
        signal: abortAfter(5000),
      });
      recordPrivyResponse(attempt, response);
      if (response.status === 200) {
        const wallet = await response.json();
        const matchesWallet = wallet?.id === walletId
          && wallet.chain_type === 'solana'
          && wallet.address === walletAddress;
        attempt.detail = matchesWallet ? 'wallet-matched' : 'wallet-mismatch';
        return matchesWallet ? 200 : null;
      }
      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        attempt.transport = 'redirect';
      }
      await response.body?.cancel().catch(() => {});
      return response.status;
    } catch (error) {
      attempt.transport = privyTransportFailure(error, attempt);
      return null;
    }
  }

  async function signWithPrivy(walletId, transaction, userAuthorization) {
    const unsigned = decodeBase64(transaction, 'Transaction');
    if (unsigned.length > MAX_TX_BYTES) fail('Transaction exceeds the Solana packet limit', 'invalid_transaction');
    const url = `${privyApi}/v1/wallets/${encodeURIComponent(walletId)}/rpc`;
    const body = {
      method: 'signTransaction',
      params: { transaction, encoding: 'base64' },
    };
    const appAttempt = userAuthorization ? { stage: 'app-sign' } : undefined;
    const report = appAttempt ? { at: now(), requests: [appAttempt] } : null;
    try {
      const headers = privyHeaders({ method: 'POST', url, body });
      if (report) report.appSignature = Boolean(headers['privy-authorization-signature']);
      const signedBody = await fetchJson(url, {
        method: 'POST',
        headers,
        body,
        signingAttempt: appAttempt,
      }, 'privy_failed');
      if (userAuthorization && typeof signedBody?.data?.signed_transaction !== 'string') {
        appAttempt.detail = 'missing-signed-transaction';
        failSigning('Privy returned no signed transaction', 'privy_failed', { transport: 'invalid-response' });
      }
      return signedBody?.data?.signed_transaction;
    } catch (error) {
      if (!userAuthorization) throw error;
      const { ownerId, accessToken, walletAddress } = userAuthorization;
      let requiresOwnerAuthorization = error?.code === 'wallet_authorization_required';
      const diagnostic = error?.privyFailure;
      if (diagnostic?.transport) appAttempt.transport = diagnostic.transport;
      if (!diagnostic) appAttempt.detail = 'local-failure';
      let walletLookupStatus;
      if (error?.code === 'privy_failed' && diagnostic?.status === 401 && !diagnostic.code) {
        const lookup = { stage: 'wallet-lookup' };
        report.requests.push(lookup);
        walletLookupStatus = await checkPrivyWalletAccess(walletId, walletAddress, lookup);
        requiresOwnerAuthorization = walletLookupStatus === 200;
      }
      if (requiresOwnerAuthorization) report.session = ownerSessionChecks(accessToken, ownerId, id, report.at);
      error.privyFailure = parsePrivySigningFailure({ ...diagnostic, walletLookupStatus, ...report });
      if (!requiresOwnerAuthorization) throw error;
      // The local sub check scopes the request. Privy verifies the JWT and
      // enforces wallet ownership and policy during the exchange and signature.
      if (report.session.check !== 'owner-matched') {
        failSigning('The wallet owner must sign in again', 'wallet_owner_session_required', error.privyFailure);
      }
      let sessionAttempt;
      try {
        const { PrivyClient } = await import('@privy-io/node');
        const client = new PrivyClient({
          appId: id, appSecret: secret, apiUrl: privyApi,
          fetch: async (url, init) => {
            const exchange = new URL(url).pathname.endsWith('/v1/wallets/authenticate');
            sessionAttempt = { stage: exchange ? 'session-exchange' : 'owner-sign' };
            if (exchange) sessionAttempt.mfaProof = new Headers(init.headers).has('privy-mfa-token');
            report.requests.push(sessionAttempt);
            let response;
            try {
              response = await fetcher(url, { ...init, redirect: 'manual' });
            } catch (error) {
              sessionAttempt.transport = privyTransportFailure(error, sessionAttempt);
              throw error;
            }
            recordPrivyResponse(sessionAttempt, response);
            if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
              sessionAttempt.transport = 'redirect';
              fail('Privy redirected the authorization request', 'wallet_authorization_failed');
            }
            return response;
          },
          timeout: 15000,
          maxRetries: 0,
          logLevel: 'off',
          requestExpiry: { defaultMs: REQUEST_TTL_MS },
        });
        const result = await client.wallets().solana().signTransaction(walletId, {
          transaction,
          authorization_context: { user_jwts: [accessToken] },
        });
        if (typeof result?.signed_transaction !== 'string') {
          sessionAttempt.detail = 'missing-signed-transaction';
          sessionAttempt.transport = 'invalid-response';
          fail('Privy returned no signed transaction', 'wallet_authorization_failed');
        }
        return result.signed_transaction;
      } catch (error) {
        if (!sessionAttempt) {
          sessionAttempt = { stage: 'session-exchange', detail: 'local-failure' };
          report.requests.push(sessionAttempt);
        } else if (error?.status) {
          recordPrivyErrorBody(sessionAttempt, error.error ?? error.message);
        } else if (!sessionAttempt.transport) {
          sessionAttempt.detail = 'local-failure';
        }
        const failure = parsePrivySigningFailure({ ...sessionAttempt, ...report });
        if (failure?.code === 'policy_violation') {
          failSigning('Privy wallet policy rejected the transaction', 'wallet_policy_rejected', failure);
        }
        failSigning('Privy could not authorize signing with the owner session', 'wallet_authorization_failed', failure);
      }
    }
  }

  function browserAuthorizedRequest(wallet, prepared, expiresAt) {
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now() || expiresAt > now() + REQUEST_TTL_MS) {
      fail('The payment authorization expired', 'wallet_authorization_failed');
    }
    const walletId = assertPrivyWalletId(wallet.privyWalletId);
    return {
      version: 1,
      url: `${privyApi}/v1/wallets/${encodeURIComponent(walletId)}/rpc`,
      method: 'POST',
      headers: { 'privy-app-id': id, 'privy-request-expiry': String(expiresAt) },
      body: {
        chain_type: 'solana', method: 'signTransaction',
        params: { transaction: prepared.transaction, encoding: 'base64' },
      },
    };
  }

  async function signWithBrowserAuthorization(wallet, prepared, { expiresAt, signature }) {
    if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]{80,128}={0,2}$/.test(signature)
      || signature.length % 4 !== 0) fail('Invalid Privy authorization signature', 'wallet_authorization_failed');
    const request = browserAuthorizedRequest(wallet, prepared, expiresAt);
    const attempt = { stage: 'browser-owner-sign' };
    const at = now();
    try {
      const result = await fetchJson(request.url, {
        method: request.method,
        headers: {
          ...request.headers,
          Authorization: basicAuth(id, secret),
          'Content-Type': 'application/json',
          'privy-authorization-signature': signature,
        },
        body: request.body,
        signingAttempt: attempt,
      }, 'wallet_authorization_failed');
      if (typeof result?.data?.signed_transaction !== 'string') {
        attempt.detail = 'missing-signed-transaction';
        failSigning('Privy returned no signed transaction', 'wallet_authorization_failed', { transport: 'invalid-response' });
      }
      return result.data.signed_transaction;
    } catch (error) {
      const diagnostic = error?.privyFailure;
      if (diagnostic?.transport) attempt.transport = diagnostic.transport;
      const code = diagnostic?.code === 'policy_violation' ? 'wallet_policy_rejected' : 'wallet_authorization_failed';
      failSigning('Privy rejected the browser-authorized signing request', code,
        parsePrivySigningFailure({ ...diagnostic, at, requests: [attempt] }));
    }
  }

  async function sendSigned(signedTransaction, { privy = false } = {}) {
    const signed = decodeBase64(signedTransaction, 'Signed transaction');
    if (signed.length <= 64) {
      fail(
        privy
          ? 'Privy returned a raw signature, not a serialized transaction'
          : 'Signed transaction is not a serialized Solana transaction',
        'invalid_signature',
      );
    }
    if (signed.length > MAX_TX_BYTES) fail('Signed transaction exceeds the Solana packet limit', 'invalid_transaction');
    await assertSolana();
    const sent = await rpc('sendTransaction', [
      signedTransaction,
      { encoding: 'base64', preflightCommitment: 'confirmed' },
    ]);
    if (typeof sent.result !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(sent.result)) {
      fail('Solana broadcast did not return a signature', 'rpc_rejected');
    }
    return sent.result;
  }

  const simulatedTransfers = new WeakSet();
  const simulatedX402 = new WeakSet();

  function x402Message(transaction, walletAddress, feePayer) {
    let parsed;
    try { parsed = VersionedTransaction.deserialize(decodeBase64(transaction, 'Transaction')); } catch { fail('Invalid x402 transaction', 'invalid_transaction'); }
    const keys = parsed.message.staticAccountKeys;
    if (SOLANA_CLUSTER !== 'mainnet-beta' || parsed.version !== 0 || parsed.message.header.numRequiredSignatures !== 2
        || keys[0]?.toBase58() !== feePayer || keys[1]?.toBase58() !== walletAddress || walletAddress === feePayer) {
      fail('x402 requires the ticket fee payer and wallet signer', 'invalid_transaction');
    }
    return parsed;
  }

  function singleSignerMessage(transaction) {
    const bytes = decodeBase64(transaction, 'Transaction');
    if (bytes.length <= SINGLE_SIGNATURE_MESSAGE_OFFSET || bytes.length > MAX_TX_BYTES || bytes[0] !== 1) {
      fail('Expected a single-signer Solana transaction', 'invalid_transaction');
    }
    return bytes.subarray(SINGLE_SIGNATURE_MESSAGE_OFFSET);
  }

  return {
    async readSession({ accessToken, ownerId, origin } = {}) {
      const token = assertHeaderSafe(accessToken, 'Privy access token');
      const headers = {
        Authorization: `Bearer ${token}`,
        'privy-app-id': id,
      };
      const safeOrigin = sanitizeOrigin(origin);
      if (!safeOrigin) {
        fail('Privy users/me requires Origin (e.g. http://localhost:3000)', 'missing_origin');
      }
      headers.Origin = safeOrigin;
      headers.Referer = `${safeOrigin}/`;
      const payload = await fetchJson(`${privyAuth}/api/v1/users/me`, {
        method: 'GET',
        headers,
      }, 'privy_failed');
      const user = readPrivyUserPayload(payload) || {};
      const resolvedId = resolvePrivyUserId(user, token, ownerId);
      if (resolvedId && !user.id) user.id = resolvedId;
      // Prefer server user lookup when /users/me omitted id but JWT sub is present.
      const hydrated = resolvedId && !Array.isArray(user.linked_accounts) && !Array.isArray(user.linkedAccounts)
        ? await loadUser(resolvedId).catch(() => user)
        : user;
      if (resolvedId && !hydrated.id) hydrated.id = resolvedId;
      return {
        user: hydrated,
        ownerId: ownerId || resolvedId || hydrated.id,
        accessToken: token,
      };
    },

    /**
     * Read the signed-in Privy user without creating a wallet.
     * Hosted OpenNext cannot call `/users/me` (outbound Origin is forbidden, and
     * a customer access token is rejected there). Use the JWT `sub` or owner id
     * with the app secret, and fall back to `/users/me` only on local Node.
     */
    async readLoginUser({ accessToken, ownerId, origin } = {}) {
      const token = assertHeaderSafe(accessToken, 'Privy access token');
      const fromJwt = jwtSub(token);
      const headerOwner = typeof ownerId === 'string' && ownerIdPattern.test(ownerId.trim())
        ? ownerId.trim()
        : '';
      // Prefer JWT `sub`. A stale x-owner-id must not select a different user.
      const serverUserId = fromJwt || headerOwner;
      const canUseUsersMe = usersMeFallback && Boolean(sanitizeOrigin(origin));
      if (serverUserId) {
        try {
          const user = await loadUser(serverUserId);
          if (user && typeof user === 'object' && !user.id) user.id = serverUserId;
          return user;
        } catch (error) {
          if (!canUseUsersMe || !(error instanceof WalletError)) throw error;
        }
      } else if (!canUseUsersMe) {
        fail(
          'Privy login needs a JWT sub or owner id on Cloudflare Workers (users/me unavailable)',
          'worker_origin_forbidden',
        );
      } else if (!sanitizeOrigin(origin)) {
        fail('Privy users/me requires Origin (e.g. http://localhost:3000)', 'missing_origin');
      }
      const session = await this.readSession({ accessToken: token, ownerId, origin });
      return session.user;
    },

    /**
     * Provision / sync Solana wallets after Privy login.
     * Prefer the app-secret `/v1/users/:id` path when the access token JWT has a
     * `sub` — Cloudflare Workers strip outbound `Origin`, so `/users/me` throws
     * (forbidden header) or 403s on hosted OpenNext / agent-runtime Workers.
     * Fall back to `/users/me` only on local Node when Origin is available.
     */
    async acceptLogin({ accessToken, ownerId, origin } = {}) {
      const token = assertHeaderSafe(accessToken, 'Privy access token');
      const fromJwt = jwtSub(token);
      const headerOwner = typeof ownerId === 'string' && ownerIdPattern.test(ownerId.trim())
        ? ownerId.trim()
        : '';
      // Prefer JWT `sub` (source of truth). A stale x-owner-id must not block provision.
      const serverUserId = fromJwt || headerOwner;
      const canUseUsersMe = usersMeFallback && Boolean(sanitizeOrigin(origin));
      if (serverUserId) {
        try {
          const user = await loadUser(serverUserId);
          return syncWallets(user, serverUserId, token);
        } catch (error) {
          // Never fall through to /users/me on Workers — Origin cannot be set.
          if (!canUseUsersMe || !(error instanceof WalletError)) throw error;
        }
      } else if (!usersMeFallback) {
        fail(
          'Privy login needs a JWT sub or owner id on Cloudflare Workers (users/me unavailable)',
          'worker_origin_forbidden',
        );
      } else if (!sanitizeOrigin(origin)) {
        fail('Privy users/me requires Origin (e.g. http://localhost:3000)', 'missing_origin');
      }
      const session = await this.readSession({ accessToken: token, ownerId, origin });
      return syncWallets(session.user, session.ownerId, session.accessToken);
    },

    ensureMainWallet({ privyUserId, ownerId } = {}) {
      return loadUser(privyUserId).then(user => syncWallets(user, ownerId ?? user?.id));
    },

    async createAdditional({ privyUserId, ownerId, label, idempotencyKey: callerKey } = {}) {
      const owner = assertOwnerId(ownerId);
      if (typeof label !== 'string' || !label.trim() || label.length > 64) fail('Additional wallet label is required');
      const user = await loadUser(privyUserId);
      const hasMain = solanaEmbedded(user).length > 0
        || (await listSolanaWallets(privyUserId, { required: false })).length > 0;
      if (!hasMain) fail('Create the main Privy wallet before adding another', 'main_wallet_required');
      const key = typeof callerKey === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(callerKey)
        ? callerKey
        : idempotencyKey('add', privyUserId, label);
      const created = await privy('POST', '/v1/wallets', {
        chain_type: 'solana',
        owner: { user_id: user.id },
        display_name: typeof label === 'string' ? label.trim() : label,
      }, key);
      return createdRecord(created, owner, user.id, 'additional', label);
    },

    async assertSolanaCluster() {
      return assertSolana();
    },

    async signAndBroadcastSolana({ bot, wallet, transaction } = {}) {
      assertSpendAllowed({ bot, wallet });
      const walletId = assertPrivyWalletId(wallet.privyWalletId);
      const signedTransaction = await signWithPrivy(walletId, transaction);
      const signature = await sendSigned(signedTransaction, { privy: true });
      return {
        cluster: SOLANA_CLUSTER,
        signature,
        privyWalletId: walletId,
        botId: bot.id,
      };
    },

    async readSolanaMint({ mint, allowToken2022 = false } = {}) {
      if (typeof mint !== 'string' || !base58.test(mint)) fail('Mint address is required', 'invalid_mint');
      await assertSolana();
      const result = await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
      const account = result.result?.value;
      const decimals = account?.data?.parsed?.info?.decimals;
      const supported = account?.owner === CLASSIC_TOKEN_PROGRAM || (allowToken2022 && account?.owner === TOKEN_2022_PROGRAM);
      if (!supported || account?.data?.parsed?.type !== 'mint'
        || account.data.parsed.info?.isInitialized !== true || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
        fail('Unsupported or missing mainnet-beta mint', 'unsupported_mint');
      }
      return { cluster: SOLANA_CLUSTER, mint, decimals, ...(allowToken2022 ? { tokenProgramId: account.owner } : {}) };
    },

    async readSolanaAsset({ address, asset } = {}) {
      if (!base58.test(address || '')) fail('Wallet address is required', 'invalid_wallet');
      await assertSolana();
      if (asset === 'SOL') {
        const read = await rpc('getBalance', [address, { commitment: 'confirmed' }]);
        const amount = read.result?.value;
        if (!Number.isSafeInteger(amount) || amount < 0) fail('SOL balance unavailable', 'rpc_rejected');
        return { asset, decimals: 9, amount: String(amount) };
      }
      const mint = await this.readSolanaMint({ mint: asset, allowToken2022: true });
      const listed = await rpc('getTokenAccountsByOwner', [address, { mint: asset }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
      if (!Array.isArray(listed.result?.value)) fail('Token balance unavailable', 'rpc_rejected');
      const accounts = [];
      const seen = new Set();
      for (const row of listed.result.value) {
        const info = row?.account?.data?.parsed?.info;
        const amount = info?.tokenAmount?.amount;
        if (row?.account?.owner !== mint.tokenProgramId || info?.owner !== address || info?.mint !== asset
          || info?.tokenAmount?.decimals !== mint.decimals || !base58.test(row?.pubkey || '')
          || typeof amount !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(amount)) fail('Invalid token balance', 'rpc_rejected');
        if (info.state === 'frozen' || amount === '0' || seen.has(row.pubkey)) continue;
        seen.add(row.pubkey);
        accounts.push({ address: row.pubkey, amount });
      }
      return { asset, decimals: mint.decimals, tokenProgramId: mint.tokenProgramId, accounts, amount: accounts.reduce((sum, row) => sum + BigInt(row.amount), 0n).toString() };
    },

    async prepareSolanaTransfer({ transaction, accountCreationPayer, requiredSignerAddresses } = {}) {
      let message;
      if (requiredSignerAddresses) {
        const bytes = decodeBase64(transaction, 'Transaction');
        if (bytes.length > MAX_TX_BYTES) fail('Invalid transaction', 'invalid_transaction');
        const parsed = Transaction.from(bytes);
        const expected = new Set(requiredSignerAddresses);
        if (expected.size < 1 || expected.size > 2 || parsed.signatures.length !== expected.size
            || parsed.signatures.some(entry => !expected.has(entry.publicKey.toBase58()))) {
          fail('Unexpected transaction signers', 'invalid_transaction');
        }
        message = parsed.serializeMessage();
      } else message = singleSignerMessage(transaction);
      await assertSolana();
      const [fee, simulation] = await Promise.all([
        rpc('getFeeForMessage', [message.toString('base64'), { commitment: 'confirmed' }]),
        rpc('simulateTransaction', [transaction, { encoding: 'base64', commitment: 'confirmed', sigVerify: false, replaceRecentBlockhash: false }]),
      ]);
      if (simulation.result?.value?.err !== null) failSimulation(simulation.result?.value);
      const lamports = fee.result?.value;
      if (!Number.isSafeInteger(lamports) || lamports < 0) fail('Solana transaction fee unavailable', 'rpc_rejected');
      let maxSolCost;
      if (accountCreationPayer) {
        const parsed = VersionedTransaction.deserialize(Buffer.from(transaction, 'base64'));
        const pre = simulation.result.value.preBalances?.[0];
        const post = simulation.result.value.postBalances?.[0];
        if (parsed.message.staticAccountKeys[0]?.toBase58() !== accountCreationPayer
            || !Number.isSafeInteger(pre) || !Number.isSafeInteger(post) || post < 0
            || pre - post < lamports || pre - post > 5_000_000) {
          const error = new WalletError('Could not verify account creation costs', 'simulation_failed');
          error.simulationReason = 'invalid_balance_metadata';
          throw error;
        }
        maxSolCost = String(pre - post);
      }
      const prepared = Object.freeze({ transaction, feeLamports: String(lamports), ...(maxSolCost ? { maxSolCost } : {}) });
      simulatedTransfers.add(prepared);
      return prepared;
    },

    async prepareSolanaX402Payment({ transaction, walletAddress, accepted, sourceTokenAccount, destinationTokenAccount } = {}) {
      const parsed = x402Message(transaction, walletAddress, accepted?.extra?.feePayer);
      await assertSolana();
      const sourceAccount = await rpc('getAccountInfo', [sourceTokenAccount, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
      const sourceValue = sourceAccount.result?.value;
      const sourceInfo = sourceValue?.data?.parsed?.info;
      if (sourceValue?.owner !== CLASSIC_TOKEN_PROGRAM || sourceValue?.data?.parsed?.type !== 'account'
          || sourceInfo?.owner !== walletAddress || sourceInfo?.mint !== SOLANA_USDC_MINT || sourceInfo?.state !== 'initialized') {
        const error = new WalletError('Source USDC account is unavailable', 'simulation_failed');
        error.simulationReason = 'source_account_not_found';
        throw error;
      }
      const account = await rpc('getAccountInfo', [destinationTokenAccount, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
      const value = account.result?.value;
      const info = value?.data?.parsed?.info;
      if (value?.owner !== CLASSIC_TOKEN_PROGRAM || value?.data?.parsed?.type !== 'account'
          || info?.owner !== accepted.payTo || info?.mint !== SOLANA_USDC_MINT || info?.state !== 'initialized') {
        const error = new WalletError('Laso recipient token account is unavailable', 'simulation_failed');
        error.simulationReason = 'recipient_account_not_found';
        throw error;
      }
      const simulation = await rpc('simulateTransaction', [transaction, {
        encoding: 'base64', commitment: 'confirmed', sigVerify: false, replaceRecentBlockhash: false,
      }]);
      if (simulation.result?.value?.err !== null) failSimulation(simulation.result?.value);
      const prepared = Object.freeze({ transaction, walletAddress, feePayer: parsed.message.staticAccountKeys[0].toBase58(), feeLamports: '0', maxSolCost: '0' });
      simulatedTransfers.add(prepared);
      simulatedX402.add(prepared);
      return prepared;
    },

    async signPreparedSolanaX402Payment({ bot, wallet, prepared, accessToken, ownerAuthorization } = {}) {
      assertSpendAllowed({ bot, wallet });
      if (!simulatedX402.has(prepared)) fail('Payment simulation is required', 'simulation_required');
      await assertSolana();
      const signed = ownerAuthorization
        ? await signWithBrowserAuthorization(wallet, prepared, ownerAuthorization)
        : await signWithPrivy(assertPrivyWalletId(wallet.privyWalletId), prepared.transaction, {
            ownerId: wallet.ownerId, walletAddress: wallet.address, accessToken,
          });
      return this.verifyPreparedSolanaX402Payment({ bot, wallet, prepared, signedTransaction: signed });
    },

    async verifyPreparedSolanaX402Payment({ bot, wallet, prepared, signedTransaction } = {}) {
      assertSpendAllowed({ bot, wallet });
      if (!simulatedX402.delete(prepared) || !simulatedTransfers.delete(prepared)) fail('Payment simulation is required', 'simulation_required');
      const original = x402Message(prepared.transaction, wallet.address, prepared.feePayer);
      await assertSolana();
      const parsed = x402Message(signedTransaction, wallet.address, prepared.feePayer);
      const message = Buffer.from(parsed.message.serialize());
      const publicKey = createPublicKey({ key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(parsed.message.staticAccountKeys[1].toBytes()),
      ]), format: 'der', type: 'spki' });
      if (!message.equals(Buffer.from(original.message.serialize())) || parsed.signatures[0].some(byte => byte !== 0)
          || !cryptoVerify(null, message, publicKey, parsed.signatures[1])) fail('Signed payment differs from simulation', 'transaction_mismatch');
      return { transaction: signedTransaction };
    },

    async prepareSolanaSwap({ transaction, walletAddress, inputMint, outputMint, amount, minOutput } = {}) {
      if (SOLANA_CLUSTER !== 'mainnet-beta') fail('Swap requires Solana mainnet', 'wrong_cluster');
      const message = singleSignerMessage(transaction);
      let parsed;
      try {
        parsed = VersionedTransaction.deserialize(Buffer.from(transaction, 'base64'));
      } catch {
        fail('Invalid swap transaction', 'invalid_transaction');
      }
      if (parsed.version !== 0 || parsed.message.header.numRequiredSignatures !== 1
          || parsed.message.staticAccountKeys[0]?.toBase58() !== walletAddress
          || parsed.signatures[0].some(byte => byte !== 0)) fail('Unexpected swap signer', 'invalid_transaction');
      await assertSolana();
      const tables = await Promise.all(parsed.message.addressTableLookups.map(async ({ accountKey }) => {
        const read = await rpc('getAccountInfo', [accountKey.toBase58(), { encoding: 'base64', commitment: 'confirmed' }]);
        const data = read.result?.value?.data;
        if (data?.[1] !== 'base64') fail('Swap lookup table is unavailable', 'simulation_failed');
        return new AddressLookupTableAccount({ key: accountKey, state: AddressLookupTableAccount.deserialize(Buffer.from(data[0], 'base64')) });
      }));
      const addresses = parsed.message.getAccountKeys({ addressLookupTableAccounts: tables }).keySegments().flat().map(key => key.toBase58());
      if (addresses.length > 100) fail('Swap has too many accounts to verify', 'swap_simulation_unavailable');
      const prior = await rpc('getMultipleAccounts', [addresses, { encoding: 'base64', commitment: 'confirmed' }]);
      const before = swapAccountSnapshot(prior.result?.value, walletAddress);
      if (!before || !Number.isSafeInteger(prior.result?.context?.slot)) fail('Swap account snapshot is unavailable', 'swap_simulation_unavailable');
      const [fee, simulation] = await Promise.all([
        rpc('getFeeForMessage', [message.toString('base64'), { commitment: 'confirmed' }]),
        rpc('simulateTransaction', [transaction, {
          encoding: 'base64', commitment: 'confirmed', sigVerify: false, replaceRecentBlockhash: false,
          minContextSlot: prior.result.context.slot, accounts: { encoding: 'base64', addresses },
        }]),
      ]);
      const value = simulation.result?.value;
      if (value?.err !== null) failSimulation(value);
      const after = swapAccountSnapshot(value.accounts, walletAddress);
      if (!after) fail('Swap simulated accounts are unavailable', 'swap_simulation_unavailable');
      const effects = verifySwapSimulation({
        err: value.err, fee: fee.result?.value, preBalances: [before.lamports], postBalances: [after.lamports],
        preTokenBalances: before.tokens, postTokenBalances: after.tokens,
      }, { wallet: walletAddress, inputMint, outputMint, amount, minOutput });
      if (!effects || String(fee.result?.value) !== effects.feeLamports) fail('Swap simulation did not match the quote', 'simulation_failed');
      const prepared = Object.freeze({ transaction, ...effects });
      simulatedTransfers.add(prepared);
      return prepared;
    },

    ownerAuthorizationPayload({ ownerId, wallet, transaction, expiresAt } = {}) {
      if (!wallet || wallet.ownerId !== assertOwnerId(ownerId)) fail('Wallet owner must match', 'owner_mismatch');
      if (wallet.frozen) fail('Wallet is frozen', 'wallet_frozen');
      if (!wallet.id || /^(linked_|client_)/.test(wallet.id)) fail('Wallet is not owned', 'wallet_not_owned');
      const bytes = decodeBase64(transaction, 'Transaction');
      if (bytes.length <= 64 || bytes.length > MAX_TX_BYTES) fail('Invalid transaction', 'invalid_transaction');
      try { VersionedTransaction.deserialize(bytes); } catch { fail('Invalid transaction', 'invalid_transaction'); }
      return Buffer.from(canonicalizeJson(browserAuthorizedRequest(wallet, { transaction }, expiresAt))).toString('base64');
    },

    async signWithOwnerAuthorization({ ownerId, wallet, transaction, expiresAt, signature } = {}) {
      this.ownerAuthorizationPayload({ ownerId, wallet, transaction, expiresAt });
      const signed = await signWithBrowserAuthorization(wallet, { transaction }, { expiresAt, signature });
      const bytes = decodeBase64(signed, 'Signed transaction');
      if (bytes.length > MAX_TX_BYTES) fail('Invalid transaction', 'invalid_transaction');
      let message;
      try { message = VersionedTransaction.deserialize(bytes).message.serialize(); }
      catch { fail('Invalid signed transaction', 'transaction_mismatch'); }
      if (!Buffer.from(message).equals(Buffer.from(VersionedTransaction.deserialize(decodeBase64(transaction, 'Transaction')).message.serialize()))) {
        fail('Signed transaction differs from request', 'transaction_mismatch');
      }
      return signed;
    },

    formatPreparedSpendAuthorization({ bot, wallet, prepared, expiresAt } = {}) {
      assertSpendAllowed({ bot, wallet });
      if (!simulatedTransfers.has(prepared)) fail('Transfer simulation is required', 'simulation_required');
      const request = browserAuthorizedRequest(wallet, prepared, expiresAt);
      return Buffer.from(canonicalizeJson(request)).toString('base64');
    },

    async signPreparedSolanaTransfer({ bot, wallet, prepared, accessToken, ownerAuthorization } = {}) {
      assertSpendAllowed({ bot, wallet });
      if (!simulatedTransfers.delete(prepared)) fail('Transfer simulation is required', 'simulation_required');
      await assertSolana();
      const signed = ownerAuthorization
        ? await signWithBrowserAuthorization(wallet, prepared, ownerAuthorization)
        : await signWithPrivy(assertPrivyWalletId(wallet.privyWalletId), prepared.transaction, {
            ownerId: wallet.ownerId,
            walletAddress: wallet.address,
            accessToken,
          });
      if (!singleSignerMessage(signed).equals(singleSignerMessage(prepared.transaction))) {
        fail('Signed transfer differs from the simulation', 'transaction_mismatch');
      }
      return { cluster: SOLANA_CLUSTER, signature: await sendSigned(signed, { privy: true }) };
    },

    /**
     * Owner sweep / withdraw / wallet-to-wallet move.
     * Bot freeze does not apply: Stop All grab-back must still move a frozen wallet.
     * Broadcast still refuses any cluster whose genesis hash is not solana.
     */
    async signAndBroadcastOwnerSolana({ ownerId, wallet, transaction, accessToken, feePayerWallet } = {}) {
      const owner = assertOwnerId(ownerId);
      try {
        validateWallet(wallet);
      } catch (error) {
        if (error instanceof ContractError) fail(error.message, 'invalid_wallet');
        throw error;
      }
      if (wallet.ownerId !== owner) fail('Wallet owner must match', 'owner_mismatch');
      const walletId = assertPrivyWalletId(wallet.privyWalletId);
      if (feePayerWallet) {
        try {
          validateWallet(feePayerWallet);
        } catch (error) {
          if (error instanceof ContractError) fail(error.message, 'invalid_wallet');
          throw error;
        }
        if (feePayerWallet.ownerId !== owner) fail('Wallet owner must match', 'owner_mismatch');
        if (feePayerWallet.frozen || feePayerWallet.spendable === false
            || String(feePayerWallet.id).startsWith('linked_') || String(feePayerWallet.id).startsWith('client_')) {
          fail('Wallet cannot sign', 'wallet_frozen');
        }
        assertPrivyWalletId(feePayerWallet.privyWalletId);
      }
      const ownerSession = typeof accessToken === 'string' && accessToken
        ? { ownerId: owner, accessToken, walletAddress: wallet.address }
        : undefined;
      let signedTransaction = await signWithPrivy(walletId, transaction, ownerSession);
      if (feePayerWallet && feePayerWallet.address !== wallet.address) {
        const original = Transaction.from(decodeBase64(transaction, 'Transaction'));
        const sourceSigned = Transaction.from(decodeBase64(signedTransaction, 'Signed transaction'));
        const message = original.serializeMessage();
        if (!sourceSigned.serializeMessage().equals(message)
            || original.feePayer?.toBase58() !== feePayerWallet.address
            || original.signatures.length !== 2
            || !original.signatures.some(entry => entry.publicKey.toBase58() === wallet.address)
            || !sourceSigned.verifySignatures(false)) fail('Signed transfer differs from the request', 'transaction_mismatch');
        const sourceEntry = sourceSigned.signatures.find(entry => entry.publicKey.toBase58() === wallet.address);
        if (!sourceEntry?.signature) fail('Source signature is required', 'invalid_signature');
        const payerSession = typeof accessToken === 'string' && accessToken
          ? { ownerId: owner, accessToken, walletAddress: feePayerWallet.address }
          : undefined;
        const payerSigned = await signWithPrivy(feePayerWallet.privyWalletId,
          sourceSigned.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'), payerSession);
        const fullySigned = Transaction.from(decodeBase64(payerSigned, 'Signed transaction'));
        if (!fullySigned.serializeMessage().equals(message)) fail('Signed transfer differs from the request', 'transaction_mismatch');
        fullySigned.addSignature(sourceEntry.publicKey, sourceEntry.signature);
        if (!fullySigned.verifySignatures()) fail('Both wallet signatures are required', 'invalid_signature');
        signedTransaction = fullySigned.serialize().toString('base64');
      }
      const signature = await sendSigned(signedTransaction, { privy: true });
      return { cluster: SOLANA_CLUSTER, signature, privyWalletId: walletId };
    },

    async signPreparedOwnerSolana({ ownerId, wallet, prepared, accessToken } = {}) {
      validateWallet(wallet);
      if (wallet.ownerId !== assertOwnerId(ownerId)) fail('Wallet owner must match', 'owner_mismatch');
      if (wallet.frozen || wallet.spendable === false || String(wallet.id).startsWith('linked_')) fail('Wallet cannot sign', 'wallet_frozen');
      if (!simulatedTransfers.delete(prepared)) fail('Transfer simulation is required', 'simulation_required');
      const walletId = assertPrivyWalletId(wallet.privyWalletId);
      const ownerSession = typeof accessToken === 'string' && accessToken
        ? { ownerId, accessToken, walletAddress: wallet.address }
        : undefined;
      const signed = await signWithPrivy(walletId, prepared.transaction, ownerSession);
      if (!singleSignerMessage(signed).equals(singleSignerMessage(prepared.transaction))) fail('Signed transfer differs from the simulation', 'transaction_mismatch');
      return { cluster: SOLANA_CLUSTER, signature: await sendSigned(signed, { privy: true }) };
    },

    /**
     * Export a user-owned server wallet. Privy encrypts the key to the caller's
     * HPKE public key. The plaintext key is never read or returned.
     */
    async exportOwnerWallet({ ownerId, wallet, recipientPublicKey } = {}) {
      const owner = assertOwnerId(ownerId);
      try {
        validateWallet(wallet);
      } catch (error) {
        if (error instanceof ContractError) fail(error.message, 'invalid_wallet');
        throw error;
      }
      if (wallet.ownerId !== owner) fail('Wallet owner must match', 'owner_mismatch');
      if (wallet.spendable === false || String(wallet.id).startsWith('linked_')) {
        fail('Observing wallets cannot be exported', 'observing_wallet');
      }
      const walletId = assertPrivyWalletId(wallet.privyWalletId);
      assertHpkeField(recipientPublicKey, 'Recipient public key');
      const payload = await privy('POST', `/v1/wallets/${encodeURIComponent(walletId)}/export`, {
        encryption_type: 'HPKE',
        recipient_public_key: recipientPublicKey,
      });
      return acceptHpkeExport(payload);
    },

    /** Broadcast a transaction the Wallet Adapter already signed. No Privy call. */
    async broadcastSignedSolana({ signedTransaction } = {}) {
      const signature = await sendSigned(signedTransaction, { privy: false });
      return { cluster: SOLANA_CLUSTER, signature };
    },

    async getSolanaBlockhash() {
      await assertSolana();
      const latest = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
      const blockhash = latest.result?.value?.blockhash;
      const lastValidBlockHeight = latest.result?.value?.lastValidBlockHeight;
      if (typeof blockhash !== 'string' || !base58.test(blockhash)) fail('Solana blockhash was not returned', 'rpc_rejected');
      if (!Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight < 0) {
        fail('Solana blockhash was not returned', 'rpc_rejected');
      }
      return { cluster: SOLANA_CLUSTER, blockhash, lastValidBlockHeight };
    },

    async getSolanaUsdcBalance({ address: owner } = {}) {
      if (typeof owner !== 'string' || !base58.test(owner)) fail('Wallet address is required', 'invalid_address');
      await assertSolana();
      const listed = await rpc('getTokenAccountsByOwner', [
        owner,
        { mint: SOLANA_USDC_MINT },
        { encoding: 'jsonParsed' },
      ]);
      const accounts = listed.result?.value;
      if (!Array.isArray(accounts)) fail('Solana USDC balance was not returned', 'rpc_rejected');
      let total = 0n;
      for (const account of accounts) {
        const info = account?.account?.data?.parsed?.info;
        const tokenAmount = info?.tokenAmount;
        if (!info || info.mint !== SOLANA_USDC_MINT || tokenAmount?.decimals !== 6) {
          fail('Solana USDC balance was not returned', 'rpc_rejected');
        }
        if (typeof tokenAmount.amount !== 'string' || !/^(0|[1-9][0-9]{0,39})$/.test(tokenAmount.amount)) {
          fail('Solana USDC balance was not returned', 'rpc_rejected');
        }
        total += BigInt(tokenAmount.amount);
      }
      return { cluster: SOLANA_CLUSTER, mint: SOLANA_USDC_MINT, address: owner, amount: total.toString() };
    },
  };
}

export function createPrivyWalletClientFromEnv(env = process.env, options = {}) {
  const values = requireConfig({ ...env, SOLANA_RPC_URL: configuredSolanaRpc(env) }, SECRET_GROUPS.serverSigning);
  const authorizationKey = typeof env?.PRIVY_AUTHORIZATION_KEY === 'string' ? env.PRIVY_AUTHORIZATION_KEY.trim() : '';
  return createPrivyWalletClient({
    ...options,
    appId: values.PRIVY_APP_ID,
    appSecret: values.PRIVY_APP_SECRET,
    rpcUrl: values.SOLANA_RPC_URL,
    authorizationKey: authorizationKey || null,
  });
}
