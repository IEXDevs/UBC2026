/**
 * Messages for POST /api/wallets after Privy login.
 * Never include secret values — only env names and safe error codes.
 */

const REQUIRED = Object.freeze(['PRIVY_APP_ID', 'PRIVY_APP_SECRET', 'QUICKNODE_DEVNET_RPC_URL']);

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
    return 'Main wallet needs PRIVY_APP_ID, PRIVY_APP_SECRET, and QUICKNODE_DEVNET_RPC_URL in the repo root .env.local.';
  }
  if (code === 'invalid_rpc') {
    return 'QUICKNODE_DEVNET_RPC_URL must be an https QuickNode Solana devnet RPC URL.';
  }
  if (code === 'privy_failed') {
    const detail = typeof body.detail === 'string' ? body.detail.trim() : '';
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
