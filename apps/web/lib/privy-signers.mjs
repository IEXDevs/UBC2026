/**
 * Privy signers let the server sign for user-owned wallets while the owner
 * is away. The signer is the key quorum of PRIVY_AUTHORIZATION_KEY; its id
 * is public. Without it on a wallet, app-key signing returns 401.
 */
const SIGNER_ID = /^[A-Za-z0-9_-]{8,128}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function privySignerId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return SIGNER_ID.test(id) ? id : '';
}

function linkedAccounts(user) {
  if (Array.isArray(user?.linkedAccounts)) return user.linkedAccounts;
  if (Array.isArray(user?.linked_accounts)) return user.linked_accounts;
  return [];
}

/** Addresses of the owner's Privy Solana wallets that the server cannot sign for yet. */
export function walletsNeedingSigner(user, signerId) {
  if (!privySignerId(signerId)) return [];
  const addresses = [];
  for (const account of linkedAccounts(user)) {
    if (account?.type !== 'wallet') continue;
    const client = account.walletClientType ?? account.wallet_client_type;
    const chain = account.chainType ?? account.chain_type;
    if (client !== 'privy' || chain !== 'solana') continue;
    if (account.delegated === true) continue;
    if (typeof account.address !== 'string' || !BASE58.test(account.address)) continue;
    if (!addresses.includes(account.address)) addresses.push(account.address);
  }
  return addresses;
}
