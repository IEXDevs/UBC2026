/**
 * Helpers for Solana private-key export in the wallets sheet.
 * Privy's export iframe sends an empty user_jwt to
 * POST /v1/wallets/authenticate, so a server wallet's copy control stays blank.
 * Those wallets are exported through our API instead.
 */

const SERVER_WALLET_ID = /^[A-Za-z0-9_-]{10,128}$/;

function serverWalletId(value) {
  if (typeof value !== 'string') return '';
  const id = value.trim();
  return SERVER_WALLET_ID.test(id) ? id : '';
}

/**
 * Find a Privy-embedded Solana wallet on the signed-in user.
 * @returns {{ address: string, id?: string } | null}
 */
export function privyEmbeddedSolanaWallet(user) {
  if (!user) return null;
  const accounts = Array.isArray(user.linkedAccounts)
    ? user.linkedAccounts
    : (Array.isArray(user.linked_accounts) ? user.linked_accounts : []);
  for (const account of accounts) {
    if (!account || typeof account !== 'object') continue;
    if (account.type !== 'wallet') continue;
    const client = account.walletClientType ?? account.wallet_client_type;
    const chain = account.chainType ?? account.chain_type;
    if (client !== 'privy') continue;
    if (chain && chain !== 'solana') continue;
    const address = typeof account.address === 'string' ? account.address.trim() : '';
    if (!address || address.startsWith('0x')) continue;
    const id = serverWalletId(account.id ?? account.walletId ?? account.wallet_id);
    return id ? { address, id } : { address };
  }
  return null;
}

/**
 * Server wallets copy through our export API. A client wallet with no server id
 * still opens Privy's screen.
 */
export function keyExportAction({ walletId = '', embedded = null } = {}) {
  const serverId = serverWalletId(walletId) || serverWalletId(embedded?.id);
  if (serverId) return { mode: 'server', walletId: serverId };
  if (typeof embedded?.address === 'string' && embedded.address) return { mode: 'client' };
  return { mode: 'none' };
}

/**
 * Prefer the sheet address when it matches an embedded wallet; else the embedded one.
 */
export function exportAddressForSheet(user, sheetAddress) {
  const embedded = privyEmbeddedSolanaWallet(user);
  if (!embedded) return null;
  const wanted = typeof sheetAddress === 'string' ? sheetAddress.trim() : '';
  if (wanted && wanted === embedded.address) return wanted;
  if (wanted) {
    // Sheet shows a server/API wallet that is not the client embedded one.
    return null;
  }
  return embedded.address;
}

export function exportFailureNote(error, { hasEmbedded = false, addressMatch = true } = {}) {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (!hasEmbedded) {
    return 'No Privy Solana embedded wallet is linked to this login. The app main wallet was created server-side and cannot use this key screen.';
  }
  if (!addressMatch) {
    return 'The address on this screen is the server-provisioned agent wallet. Privy’s key screen only opens for a client embedded wallet on this login.';
  }
  if (/not authenticated|unauthenticated/i.test(message)) {
    return 'Sign in again, then open the key screen.';
  }
  if (/embedded|no wallet|wallet not found|does not have/i.test(message)) {
    return 'Privy has no exportable Solana embedded wallet for this login.';
  }
  return 'Privy did not open the key screen.';
}
