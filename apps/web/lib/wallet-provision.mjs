/**
 * Messages for POST /api/wallets after Privy login.
 * Never include secret values — only env names and safe error codes.
 */

/**
 * Shell wallet provision URLs after Privy login.
 * Browser always hits same-origin Next `/api/wallets`. On Cloudflare that route
 * proxies create through the AGENT_RUNTIME service binding (workerd fetch to
 * Privy); local Next still calls Privy directly. Never call
 * `/api/runtime/api/wallets` from the browser.
 */
export function walletProvisionPaths() {
  return Object.freeze(['/api/wallets']);
}

/** True when a provision response has at least one usable wallet row. */
export function walletProvisionSucceeded(responseOk, body = {}) {
  if (responseOk !== true || !body || typeof body !== 'object') return false;
  return Array.isArray(body.wallets) && body.wallets.length > 0;
}

// acceptLogin only needs Privy credentials. QuickNode is for later signing.
const REQUIRED = Object.freeze(['PRIVY_APP_ID', 'PRIVY_APP_SECRET']);

export function missingWalletSecrets(env = {}) {
  const missing = [];
  for (const name of REQUIRED) {
    const value = typeof env[name] === 'string' ? env[name].trim() : '';
    if (!value) missing.push(name);
  }
  // Public app id can stand in for the server app id (same value).
  if (missing.includes('PRIVY_APP_ID')) {
    const pub = typeof env.NEXT_PUBLIC_PRIVY_APP_ID === 'string' ? env.NEXT_PUBLIC_PRIVY_APP_ID.trim() : '';
    if (pub) missing.splice(missing.indexOf('PRIVY_APP_ID'), 1);
  }
  return missing;
}

/**
 * Safe Cloudflare / Privy config flags for GET /api/wallets.
 * Never includes secret values or the raw app id.
 */
export function walletConfigFlags(env = {}) {
  const serverId = typeof env.PRIVY_APP_ID === 'string' ? env.PRIVY_APP_ID.trim() : '';
  const publicId = typeof env.NEXT_PUBLIC_PRIVY_APP_ID === 'string' ? env.NEXT_PUBLIC_PRIVY_APP_ID.trim() : '';
  const runtimeUrl = typeof env.NEXT_PUBLIC_AGENT_RUNTIME_URL === 'string'
    ? env.NEXT_PUBLIC_AGENT_RUNTIME_URL.trim()
    : '';
  let runtimeHostOk = false;
  if (runtimeUrl) {
    try {
      const parsed = new URL(runtimeUrl);
      runtimeHostOk = (parsed.protocol === 'https:' || parsed.protocol === 'http:')
        && !parsed.username
        && !parsed.password
        && /maelstrom\.iexdevs\.com$/i.test(parsed.hostname);
    } catch {
      runtimeHostOk = false;
    }
  }
  const bothIds = Boolean(serverId && publicId);
  return {
    hasAppId: Boolean(serverId || publicId),
    hasPublicAppId: Boolean(publicId),
    hasAppSecret: Boolean(typeof env.PRIVY_APP_SECRET === 'string' && env.PRIVY_APP_SECRET.trim()),
    hasRpc: Boolean(typeof env.SOLANA_RPC_URL === 'string' && env.SOLANA_RPC_URL.trim()),
    hasAuthorizationKey: Boolean(typeof env.PRIVY_AUTHORIZATION_KEY === 'string' && env.PRIVY_AUTHORIZATION_KEY.trim()),
    hasRuntimeUrl: Boolean(runtimeUrl),
    runtimeHostOk,
    // When both server + public ids are set they must match the same Privy app.
    appIdAligned: bothIds ? serverId === publicId : true,
    missing: missingWalletSecrets(env),
  };
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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

/**
 * Build display wallets from the Privy client user when POST /api/wallets fails.
 * Include every Solana linked wallet (embedded Privy + connected external).
 * createOnLogin often has an address before a server wallet id exists.
 */
/** Privy embedded Solana wallets already on this login. External wallets do not count. */
export function embeddedSolanaCount(user) {
  if (!user || typeof user !== 'object') return 0;
  const accounts = Array.isArray(user.linkedAccounts)
    ? user.linkedAccounts
    : (Array.isArray(user.linked_accounts) ? user.linked_accounts : []);
  return accounts.filter((account) => {
    if (!account || account.type !== 'wallet') return false;
    const chain = account.chainType ?? account.chain_type;
    if (typeof chain === 'string' && chain && chain !== 'solana') return false;
    const client = account.walletClientType ?? account.wallet_client_type ?? '';
    const connector = account.connectorType ?? account.connector_type ?? '';
    return client === 'privy' || client === 'privy-v2' || connector === 'embedded';
  }).length;
}

/**
 * First embedded wallet uses Privy's default (HD index 0).
 * The next call must name the following index or Privy refuses a second wallet.
 */
export function embeddedCreateOptions(count) {
  const n = Number.isInteger(count) && count > 0 ? count : 0;
  if (n <= 0) return undefined;
  // Server-wallet mode rejects walletIndex. createAdditional asks Privy for the next wallet.
  return { createAdditional: true };
}

/** Changes when the user links or unlinks a wallet. The positions book refetches on this. */
export function linkedWalletKey(user) {
  const accounts = Array.isArray(user?.linkedAccounts)
    ? user.linkedAccounts
    : (Array.isArray(user?.linked_accounts) ? user.linked_accounts : []);
  return accounts
    .map(account => (typeof account?.address === 'string' ? account.address.trim() : ''))
    .filter(Boolean)
    .join('|');
}

export function walletsFromPrivyUser(user, ownerId) {
  if (!user || typeof ownerId !== 'string' || !ownerId.trim()) return [];
  const owner = ownerId.trim();
  const accounts = Array.isArray(user.linkedAccounts)
    ? user.linkedAccounts
    : (Array.isArray(user.linked_accounts) ? user.linked_accounts : []);
  const out = [];
  const seen = new Set();

  function pushSolana(address, idHint, clientHint) {
    const addressText = typeof address === 'string' ? address.trim() : '';
    if (!BASE58.test(addressText) || seen.has(addressText)) return;
    seen.add(addressText);
    const client = typeof clientHint === 'string' && clientHint.trim() ? clientHint.trim() : 'privy';
    const id = typeof idHint === 'string' && idHint.trim()
      ? idHint.trim()
      : `client_${addressText.slice(0, 8)}`;
    const spendable = client === 'privy' || client === 'privy-v2';
    out.push({
      id,
      ownerId: owner,
      kind: out.length === 0 ? 'main' : 'additional',
      label: spendable
        ? (out.length === 0 ? 'Main' : `Additional ${out.length}`)
        : clientLabel(client),
      address: addressText,
      frozen: false,
      provider: 'privy',
      walletClientType: client,
      spendable,
    });
  }

  for (const account of accounts) {
    if (!account || account.type !== 'wallet') continue;
    const chain = account.chainType ?? account.chain_type;
    const address = typeof account.address === 'string' ? account.address.trim() : '';
    if (!BASE58.test(address) || address.startsWith('0x')) continue;
    // Keep Solana rows; skip known non-Solana chains.
    if (typeof chain === 'string' && chain && chain !== 'solana') continue;
    pushSolana(
      address,
      account.id,
      account.walletClientType ?? account.wallet_client_type,
    );
  }

  // Top-level wallet field on some Privy user payloads.
  if (user.wallet && typeof user.wallet === 'object') {
    const chain = user.wallet.chainType ?? user.wallet.chain_type ?? user.wallet.chain;
    const address = user.wallet.address;
    if (!chain || chain === 'solana') {
      pushSolana(address, user.wallet.id, user.wallet.walletClientType ?? user.wallet.wallet_client_type);
    }
  }

  return out;
}

/**
 * Server agent wallets stay spendable. Linked external wallets are appended
 * for the portfolio and never replace the agent main wallet.
 */
function realEmbeddedId(id) {
  return typeof id === 'string' && !id.startsWith('linked_') && !id.startsWith('client_');
}

export function mergeObservedWallets(serverWallets, user, ownerId) {
  const server = Array.isArray(serverWallets)
    ? serverWallets.filter(wallet => wallet && typeof wallet.address === 'string' && wallet.address)
    : [];
  const observed = walletsFromPrivyUser(user, ownerId);
  const byAddress = new Map();
  for (const wallet of server) {
    byAddress.set(wallet.address, { ...wallet, spendable: wallet.spendable !== false });
  }
  for (const wallet of observed) {
    const current = byAddress.get(wallet.address);
    if (!current) {
      byAddress.set(wallet.address, { ...wallet, kind: byAddress.size > 0 ? 'additional' : wallet.kind });
      continue;
    }
    const placeholder = current.spendable === false || String(current.id).startsWith('linked_');
    if (placeholder && wallet.spendable === true && realEmbeddedId(wallet.id)) {
      byAddress.set(wallet.address, {
        ...wallet,
        kind: current.kind === 'main' ? 'main' : 'additional',
        label: current.kind === 'main' && current.label ? current.label : wallet.label,
      });
    }
  }
  const out = [];
  for (const wallet of [...server, ...observed]) {
    const chosen = byAddress.get(wallet.address);
    if (!chosen || out.some(row => row.address === chosen.address)) continue;
    out.push(chosen);
  }
  return out;
}

export function resolvePrivyAppId(env = {}) {
  const server = typeof env.PRIVY_APP_ID === 'string' ? env.PRIVY_APP_ID.trim() : '';
  if (server) return server;
  const pub = typeof env.NEXT_PUBLIC_PRIVY_APP_ID === 'string' ? env.NEXT_PUBLIC_PRIVY_APP_ID.trim() : '';
  return pub;
}

/** Safe note from GET /api/wallets config flags (no secret values). */
export function walletConfigNote(config = {}) {
  const missing = Array.isArray(config.missing)
    ? config.missing.filter(name => typeof name === 'string' && /^[A-Z0-9_]{1,64}$/.test(name))
    : [];
  if (missing.length > 0) {
    return `Main wallet needs ${missing.join(', ')} in the repo root .env.local, then restart Next and sign in again.`;
  }
  if (config.hasAppSecret === false) {
    return 'Main wallet needs PRIVY_APP_SECRET in the repo root .env.local, then restart Next and sign in again.';
  }
  if (config.hasAppId === false) {
    return 'Main wallet needs PRIVY_APP_ID or NEXT_PUBLIC_PRIVY_APP_ID in the repo root .env.local.';
  }
  if (config.hasAuthorizationKey === false) {
    return 'PRIVY_APP_SECRET is set. If wallet create returns 403, add PRIVY_AUTHORIZATION_KEY from Privy → Authorization keys, restart Next, and sign in again.';
  }
  return '';
}

export function walletProvisionNote(body = {}, { ok = false } = {}) {
  if (ok && Array.isArray(body.wallets) && body.wallets.length > 0) {
    return body.created
      ? 'Main wallet created and assigned to these agents.'
      : 'Main wallet assigned to these agents.';
  }
  const code = typeof body.error === 'string' ? body.error : '';
  const missing = Array.isArray(body.missing)
    ? body.missing.filter(name => typeof name === 'string' && /^[A-Z0-9_]{1,64}$/.test(name))
    : [];
  if (code === 'missing_config' && missing.length > 0) {
    return `Main wallet needs ${missing.join(', ')} in the repo root .env.local, then restart Next and sign in again.`;
  }
  if (code === 'missing_config') {
    return 'Main wallet needs PRIVY_APP_ID and PRIVY_APP_SECRET in the repo root .env.local.';
  }
  if (code === 'token_missing') {
    return 'Privy did not return an access token. Sign out and sign in again, then open Wallets.';
  }
  if (code === 'invalid_rpc') {
    return 'SOLANA_RPC_URL must be an https QuickNode Solana mainnet-beta RPC URL.';
  }
  if (code === 'missing_origin' || (/must_specify_origin/i.test(typeof body.detail === 'string' ? body.detail : ''))) {
    return 'Privy users/me needs Origin. Sign in again so the shell can send your Privy user id, or allowlist this site under Privy → Domains.';
  }
  if (code === 'worker_origin_forbidden') {
    return 'Hosted Cloudflare cannot call Privy /users/me. Sign out and sign in again so the access token includes a user id, then retry wallet create.';
  }
  if (code === 'privy_failed') {
    const detail = typeof body.detail === 'string' ? body.detail.trim() : '';
    if (/Invalid redirect|redirect value/i.test(detail)) {
      return 'Worker fetch used an unsupported redirect mode. Redeploy web and agent-runtime (redirect:manual fix), then sign out/in and retry.';
    }
    if (/TypeError/i.test(detail)) {
      return 'Privy fetch failed inside the Worker (TypeError). Redeploy web and agent-runtime, confirm PRIVY_AUTHORIZATION_KEY on maelstrom-agent-runtime, then sign out/in and retry.';
    }
    if (/forbidden_header|worker_origin/i.test(detail)) {
      return 'Hosted Cloudflare blocked a Privy Origin header. Sign out and sign in again, then retry wallet create.';
    }
    if (/AUTHORIZATION_KEY|agent-runtime/i.test(detail)) {
      return 'Agent-runtime Privy create failed. Put the same PRIVY_APP_SECRET and PRIVY_AUTHORIZATION_KEY on maelstrom-agent-runtime, redeploy runtime, then sign in again.';
    }
    if (/403/i.test(detail) && /insufficient_app_secret_permissions/i.test(detail)) {
      return 'PRIVY_APP_SECRET is read-only. In Privy → App settings → API keys, create a full-access secret, put it in root .env.local, restart Next, and sign in again.';
    }
    if (/403/i.test(detail) && /PRIVY_AUTHORIZATION_KEY|authorization/i.test(detail)) {
      return 'Privy returned 403 without an authorization signature. Add PRIVY_AUTHORIZATION_KEY (wallet-auth private key from Privy → Authorization keys) to root .env.local, restart Next, and sign in again.';
    }
    if (/must_specify_origin|invalid_origin|cannot set Origin/i.test(detail)) {
      return 'Privy rejected the Origin. Allowlist this site (and http://localhost:3000) under Privy → Domains, then sign in again.';
    }
    if (/403/i.test(detail)) {
      return 'Privy returned 403. If the app secret is full-access, set PRIVY_AUTHORIZATION_KEY from Privy → Authorization keys (or turn off required authorization signatures).';
    }
    // Never echo bearer tokens / API keys that may appear in upstream detail strings.
    if (detail && detail.length <= 180 && !/[\r\n]/.test(detail)
      && !/(sk_|Bearer\s|api[_-]?key|secret|password)/i.test(detail)) {
      return `Privy wallet create failed: ${detail}. Check PRIVY_APP_SECRET, Solana wallets in the dashboard, and optional PRIVY_AUTHORIZATION_KEY.`;
    }
    return 'Privy rejected wallet create. Confirm PRIVY_APP_SECRET matches this app, Solana embedded wallets are on, and retry.';
  }
  if (code === 'invalid_wallet') {
    return 'Privy returned a wallet without a server id. Enable Solana embedded wallets, then sign in again.';
  }
  if (code === 'login_required') {
    return 'Sign in again so the shell can send a Privy access token.';
  }
  if (code) {
    const detail = typeof body.detail === 'string' ? body.detail.trim() : '';
    if (detail && detail.length <= 180 && !/[\r\n]/.test(detail)) {
      return `The main wallet was not created (${code}): ${detail}`;
    }
    return `The main wallet was not created (${code}). Sign in again and retry.`;
  }
  return 'The main wallet was not created. Sign in again and retry.';
}
