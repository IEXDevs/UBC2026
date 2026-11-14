/**
 * Messages for POST /api/wallets after Privy login.
 * Never include secret values — only env names and safe error codes.
 */

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

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Build display wallets from the Privy client user when POST /api/wallets fails.
 * Include every Solana linked wallet (embedded Privy + connected external).
 * createOnLogin often has an address before a server wallet id exists.
 */
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
    out.push({
      id,
      ownerId: owner,
      kind: out.length === 0 ? 'main' : 'additional',
      label: out.length === 0
        ? (client === 'privy' ? 'Main' : `Main (${client})`)
        : `Additional ${out.length}`,
      address: addressText,
      frozen: false,
      provider: 'privy',
      walletClientType: client,
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

export function resolvePrivyAppId(env = {}) {
  const server = typeof env.PRIVY_APP_ID === 'string' ? env.PRIVY_APP_ID.trim() : '';
  if (server) return server;
  const pub = typeof env.NEXT_PUBLIC_PRIVY_APP_ID === 'string' ? env.NEXT_PUBLIC_PRIVY_APP_ID.trim() : '';
  return pub;
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
  if (code === 'invalid_rpc') {
    return 'QUICKNODE_DEVNET_RPC_URL must be an https QuickNode Solana devnet RPC URL.';
  }
  if (code === 'missing_origin' || (/must_specify_origin/i.test(typeof body.detail === 'string' ? body.detail : ''))) {
    return 'Privy users/me needs Origin. Use the app from http://localhost:3000 and allowlist that origin in the Privy dashboard.';
  }
  if (code === 'privy_failed') {
    const detail = typeof body.detail === 'string' ? body.detail.trim() : '';
    if (/403/i.test(detail) && /insufficient_app_secret_permissions/i.test(detail)) {
      return 'PRIVY_APP_SECRET is read-only. In Privy → App settings → API keys, create a full-access secret, put it in root .env.local, restart Next, and sign in again.';
    }
    if (/403/i.test(detail) && /PRIVY_AUTHORIZATION_KEY|authorization/i.test(detail)) {
      return 'Privy returned 403 without an authorization signature. Add PRIVY_AUTHORIZATION_KEY (wallet-auth private key from Privy → Authorization keys) to root .env.local, restart Next, and sign in again.';
    }
    if (/must_specify_origin|invalid_origin/i.test(detail)) {
      return 'Privy rejected the Origin. Allowlist http://localhost:3000 under Privy → Domains, then restart and sign in again.';
    }
    if (/403/i.test(detail)) {
      return 'Privy returned 403. If the app secret is full-access, set PRIVY_AUTHORIZATION_KEY from Privy → Authorization keys (or turn off required authorization signatures).';
    }
    if (detail && detail.length <= 180 && !/[\r\n]/.test(detail)) {
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
