/**
 * Privy Solana wallet path for Maelstrom.
 * Login provisioning (main wallet at sign-up, additional wallets) and
 * server signing. The signed transaction is broadcast on Solana devnet
 * through QUICKNODE_DEVNET_RPC_URL. Key material stays in Privy and in
 * environment variables; this module never returns a private key.
 */
import { createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { SECRET_GROUPS, requireConfig } from '@ubc2026/contracts';
import {
  WalletError,
  assertSpendAllowed,
  createAdditionalWallet,
  createMainWallet,
} from './wallets.mjs';

export { WalletError };

/** Solana devnet genesis hash. Also the CAIP-2 reference for solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1. */
export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

const PRIVY_API_BASE = 'https://api.privy.io';
const PRIVY_AUTH_BASE = 'https://auth.privy.io';
const REQUEST_TTL_MS = 60_000;
const MAX_TX_BYTES = 1232;
const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const privyWalletIdPattern = /^[A-Za-z0-9_-]{10,128}$/;
const ownerIdPattern = /^[a-zA-Z0-9:_-]{1,128}$/;

const fail = (message, code = 'wallet_error') => {
  throw new WalletError(message, code);
};

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
  const code = payload && (payload.error ?? payload.code);
  return typeof code === 'string' && /^[a-z0-9_]{1,64}$/.test(code) ? code : '';
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

function solanaEmbedded(user) {
  const accounts = Array.isArray(user?.linked_accounts) ? user.linked_accounts : [];
  return accounts
    .filter(account => account
      && account.type === 'wallet'
      && account.chain_type === 'solana'
      && account.wallet_client_type === 'privy'
      && account.connector_type === 'embedded')
    .map(account => ({
      id: account.id,
      address: account.address,
      walletIndex: Number.isInteger(account.wallet_index) ? account.wallet_index : 0,
    }))
    .sort((a, b) => a.walletIndex - b.walletIndex);
}

function assertPrivyWalletId(id) {
  if (typeof id !== 'string' || !privyWalletIdPattern.test(id)) fail('Privy wallet id is required', 'invalid_wallet');
  return id;
}

function assertOwnerId(ownerId) {
  if (typeof ownerId !== 'string' || !ownerIdPattern.test(ownerId)) fail('Wallet owner is required', 'invalid_owner');
  return ownerId;
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
} = {}) {
  const id = assertHeaderSafe(appId, 'Privy app id');
  const secret = assertHeaderSafe(appSecret, 'Privy app secret');
  const quicknode = assertHttps(rpcUrl, 'QuickNode devnet RPC');
  const privyApi = assertHttps(apiBase, 'Privy API');
  const privyAuth = assertHttps(authBase, 'Privy auth API');
  const authKey = authorizationKey == null || authorizationKey === '' ? null : authorizationKey;

  async function fetchJson(url, { method, headers, body }, code) {
    let response;
    try {
      response = await fetcher(url, {
        method,
        headers,
        body: body == null ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      fail(code === 'rpc_failed' ? 'QuickNode devnet RPC failed' : 'Privy request failed', code);
    }
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = null; }
    }
    if (!response.ok) {
      const detail = safePrivyCode(payload);
      const target = code === 'rpc_failed' ? 'QuickNode devnet RPC' : 'Privy';
      fail(`${target} request failed (${response.status}${detail ? `: ${detail}` : ''})`, code);
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
    if (authKey && method !== 'GET') {
      const expiresAt = now() + REQUEST_TTL_MS;
      headers['privy-request-expiry'] = String(expiresAt);
      headers['privy-authorization-signature'] = privyAuthorizationSignature({
        appId: id,
        authorizationKey: authKey,
        method,
        url,
        body,
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
    return privy('GET', `/v1/users/${encodeURIComponent(privyUserId)}`);
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

  async function syncWallets(user, ownerId) {
    const privyUserId = assertOwnerId(user?.id);
    const owner = assertOwnerId(ownerId);
    const embedded = solanaEmbedded(user);
    const existing = recordsFromEmbedded(embedded, owner, privyUserId);
    if (existing) return { privyUserId, ...existing, created: false };
    const created = await privy('POST', '/v1/wallets', {
      chain_type: 'solana',
      owner: { user_id: privyUserId },
      display_name: 'Main',
    }, idempotencyKey('main-solana', privyUserId));
    return {
      privyUserId,
      main: createdRecord(created, owner, privyUserId, 'main'),
      additional: [],
      created: true,
    };
  }

  return {
    async acceptLogin({ accessToken, ownerId } = {}) {
      const token = assertHeaderSafe(accessToken, 'Privy access token');
      const user = await fetchJson(`${privyAuth}/api/v1/users/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'privy-app-id': id,
        },
      }, 'privy_failed');
      return syncWallets(user, ownerId ?? user?.id);
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

    async signAndBroadcastDevnet({ bot, wallet, transaction } = {}) {
      assertSpendAllowed({ bot, wallet });
      const walletId = assertPrivyWalletId(wallet.privyWalletId);
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
      const signedTransaction = signedBody?.data?.signed_transaction;
      const signed = decodeBase64(signedTransaction, 'Signed transaction');
      if (signed.length <= 64) fail('Privy returned a raw signature, not a serialized transaction', 'invalid_signature');
      if (signed.length > MAX_TX_BYTES) fail('Signed transaction exceeds the Solana packet limit', 'invalid_transaction');

      const genesis = await fetchJson(quicknode, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { jsonrpc: '2.0', id: 1, method: 'getGenesisHash' },
      }, 'rpc_failed');
      if (genesis.result !== DEVNET_GENESIS_HASH) {
        fail('Refusing to broadcast outside Solana devnet', 'wrong_cluster');
      }
      const sent = await fetchJson(quicknode, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'sendTransaction',
          params: [signedTransaction, { encoding: 'base64', preflightCommitment: 'confirmed' }],
        },
      }, 'rpc_failed');
      if (typeof sent.result !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(sent.result)) {
        fail('Devnet broadcast did not return a signature', 'rpc_rejected');
      }
      return {
        cluster: 'devnet',
        signature: sent.result,
        privyWalletId: walletId,
        botId: bot.id,
      };
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
