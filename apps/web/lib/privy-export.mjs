/**
 * Helpers for Privy Solana private-key export in the wallets sheet.
 * Client exportWallet only works for Privy-embedded Solana wallets on the user.
 */

/**
 * Find a Privy-embedded Solana wallet on the signed-in user.
 * @returns {{ address: string } | null}
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
    return { address };
  }
  return null;
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
