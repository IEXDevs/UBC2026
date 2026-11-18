/**
 * Privy Solana wallet path for Maelstrom.
 * Login provisioning (main wallet at sign-up, additional wallets) and
 * server signing. Bot spends, owner sweeps, and wallet-adapter deposits
 * broadcast on Solana devnet through QUICKNODE_DEVNET_RPC_URL.
 * Key material stays in Privy and in
 * environment variables; this module never returns a private key.
 */
import { createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { SECRET_GROUPS, requireConfig, validateWallet, ContractError } from '@ubc2026/contracts';
import {
  WalletError,
  assertSpendAllowed,
  createAdditionalWallet,
  createMainWallet,
} from './wallets.mjs';

export { WalletError };

/**
 * Full Solana-devnet genesis hash from getGenesisHash.
 * CAIP-2 uses the truncated form solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 — do not use that for RPC checks.
 */
export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const DEVNET_CAIP2 = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

/** Circle USDC mint on Solana devnet. Mainnet USDC is never queried or transferred here. */
export const DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

const PRIVY_API_BASE = 'https://api.privy.io';
const PRIVY_AUTH_BASE = 'https://auth.privy.io';
const REQUEST_TTL_MS = 60_000;
const MAX_TX_BYTES = 1232;
const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const privyWalletIdPattern = /^[A-Za-z0-9_-]{10,128}$/;
const ownerIdPattern = /^[a-zA-Z0-9:_.-]{1,256}$/;

const fail = (message, code = 'wallet_error') => {
  throw new WalletError(message, code);
};

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
      return chain === 'solana' && client === 'privy' && connector === 'embedded';
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
  try {
    const part = String(accessToken).split('.')[1];
    if (!part) return '';
    const payload = JSON.parse(base64UrlToUtf8(part));
    return typeof payload?.sub === 'string' ? payload.sub.trim() : '';
  } catch {
    return '';
  }
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
    if (client === 'privy' && connector === 'embedded') continue;
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
  const quicknode = rpcUrl == null || rpcUrl === '' ? null : assertHttps(rpcUrl, 'QuickNode devnet RPC');
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

  async function fetchJson(url, { method, headers, body }, code) {
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
      const target = code === 'rpc_failed' ? 'QuickNode devnet RPC' : 'Privy';
      if (isForbiddenOutboundHeaderError(error)) {
        fail(`${target} request failed (forbidden_header)`, code === 'rpc_failed' ? code : 'worker_origin_forbidden');
      }
      // Include a short, non-secret cause so Cloudflare / network misconfig is diagnosable.
      const cause = aborted ? 'timed out' : safeNetworkCause(error);
      fail(`${target} request ${cause}`, code);
    }
    {
      const target = code === 'rpc_failed' ? 'QuickNode devnet RPC' : 'Privy';
      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        fail(`${target} request failed (redirect)`, code);
      }
    }
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = null; }
    }
    if (!response.ok) {
      const detail = safePrivyCode(payload);
      if (code === 'rpc_failed') {
        fail(`QuickNode devnet RPC request failed (${response.status}${detail ? `: ${detail}` : ''})`, code);
      }
      const step = safePrivyPath(url);
      fail(`Privy ${step} failed (${response.status}${detail ? `: ${detail}` : ''})`, code);
    }
    if (payload == null) fail(code === 'rpc_failed' ? 'QuickNode devnet RPC failed' : 'Privy request failed', code);
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
    if (!quicknode) fail('QuickNode devnet RPC is required', 'missing_config');
    return fetchJson(quicknode, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { jsonrpc: '2.0', id: 1, method, params },
    }, 'rpc_failed');
  }

  /** Genesis gate shared by signing, owner sweeps, deposits, and devnet reads. */
  async function assertDevnet() {
    if (!quicknode) fail('QuickNode devnet RPC is required', 'missing_config');
    const genesis = await rpc('getGenesisHash');
    if (genesis.result !== DEVNET_GENESIS_HASH) {
      fail('Refusing to broadcast outside Solana devnet', 'wrong_cluster');
    }
    return { cluster: 'devnet' };
  }

  async function signWithPrivy(walletId, transaction) {
    const unsigned = decodeBase64(transaction, 'Transaction');
    if (unsigned.length > MAX_TX_BYTES) fail('Transaction exceeds the Solana packet limit', 'invalid_transaction');
    const url = `${privyApi}/v1/wallets/${encodeURIComponent(walletId)}/rpc`;
    const body = {
      method: 'signTransaction',
      params: { transaction, encoding: 'base64' },
    };
    const signedBody = await fetchJson(url, {
      method: 'POST',
      headers: privyHeaders({ method: 'POST', url, body }),
      body,
    }, 'privy_failed');
    return signedBody?.data?.signed_transaction;
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
    await assertDevnet();
    const sent = await rpc('sendTransaction', [
      signedTransaction,
      { encoding: 'base64', preflightCommitment: 'confirmed' },
    ]);
    if (typeof sent.result !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(sent.result)) {
      fail('Devnet broadcast did not return a signature', 'rpc_rejected');
    }
    return sent.result;
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

    async readLoginUser({ accessToken, ownerId, origin } = {}) {
      const session = await this.readSession({ accessToken, ownerId, origin });
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
      if (solanaEmbedded(user).length < 1) fail('Create the main Privy wallet before adding another', 'main_wallet_required');
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

    async assertDevnetCluster() {
      return assertDevnet();
    },

    async signAndBroadcastDevnet({ bot, wallet, transaction } = {}) {
      assertSpendAllowed({ bot, wallet });
      const walletId = assertPrivyWalletId(wallet.privyWalletId);
      const signedTransaction = await signWithPrivy(walletId, transaction);
      const signature = await sendSigned(signedTransaction, { privy: true });
      return {
        cluster: 'devnet',
        signature,
        privyWalletId: walletId,
        botId: bot.id,
      };
    },

    /**
     * Owner sweep / withdraw / wallet-to-wallet move.
     * Bot freeze does not apply: Stop All grab-back must still move a frozen wallet.
     * Broadcast still refuses any cluster whose genesis hash is not devnet.
     */
    async signAndBroadcastOwnerDevnet({ ownerId, wallet, transaction } = {}) {
      const owner = assertOwnerId(ownerId);
      try {
        validateWallet(wallet);
      } catch (error) {
        if (error instanceof ContractError) fail(error.message, 'invalid_wallet');
        throw error;
      }
      if (wallet.ownerId !== owner) fail('Wallet owner must match', 'owner_mismatch');
      const walletId = assertPrivyWalletId(wallet.privyWalletId);
      const signedTransaction = await signWithPrivy(walletId, transaction);
      const signature = await sendSigned(signedTransaction, { privy: true });
      return { cluster: 'devnet', signature, privyWalletId: walletId };
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
    async broadcastSignedDevnet({ signedTransaction } = {}) {
      const signature = await sendSigned(signedTransaction, { privy: false });
      return { cluster: 'devnet', signature };
    },

    async getDevnetBlockhash() {
      await assertDevnet();
      const latest = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
      const blockhash = latest.result?.value?.blockhash;
      const lastValidBlockHeight = latest.result?.value?.lastValidBlockHeight;
      if (typeof blockhash !== 'string' || !base58.test(blockhash)) fail('Devnet blockhash was not returned', 'rpc_rejected');
      if (!Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight < 0) {
        fail('Devnet blockhash was not returned', 'rpc_rejected');
      }
      return { cluster: 'devnet', blockhash, lastValidBlockHeight };
    },

    async getDevnetUsdcBalance({ address: owner } = {}) {
      if (typeof owner !== 'string' || !base58.test(owner)) fail('Wallet address is required', 'invalid_address');
      await assertDevnet();
      const listed = await rpc('getTokenAccountsByOwner', [
        owner,
        { mint: DEVNET_USDC_MINT },
        { encoding: 'jsonParsed' },
      ]);
      const accounts = listed.result?.value;
      if (!Array.isArray(accounts)) fail('Devnet USDC balance was not returned', 'rpc_rejected');
      let total = 0n;
      for (const account of accounts) {
        const info = account?.account?.data?.parsed?.info;
        const tokenAmount = info?.tokenAmount;
        if (!info || info.mint !== DEVNET_USDC_MINT || tokenAmount?.decimals !== 6) {
          fail('Devnet USDC balance was not returned', 'rpc_rejected');
        }
        if (typeof tokenAmount.amount !== 'string' || !/^(0|[1-9][0-9]{0,39})$/.test(tokenAmount.amount)) {
          fail('Devnet USDC balance was not returned', 'rpc_rejected');
        }
        total += BigInt(tokenAmount.amount);
      }
      return { cluster: 'devnet', mint: DEVNET_USDC_MINT, address: owner, amount: total.toString() };
    },
  };
}

export function createPrivyWalletClientFromEnv(env = process.env, options = {}) {
  const values = requireConfig(env, SECRET_GROUPS.serverSigning);
  const authorizationKey = typeof env?.PRIVY_AUTHORIZATION_KEY === 'string' ? env.PRIVY_AUTHORIZATION_KEY.trim() : '';
  return createPrivyWalletClient({
    ...options,
    appId: values.PRIVY_APP_ID,
    appSecret: values.PRIVY_APP_SECRET,
    rpcUrl: values.QUICKNODE_DEVNET_RPC_URL,
    authorizationKey: authorizationKey || null,
  });
}
