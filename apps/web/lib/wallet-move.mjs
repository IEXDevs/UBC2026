/**
 * Plan a devnet USDC move between two Privy wallets on the same desk.
 * This file does not sign or broadcast.
 */
import { validateWallet } from '@ubc2026/contracts';

const AMOUNT = /^[1-9][0-9]{0,39}$/;

function walletOrNull(wallet) {
  try {
    return validateWallet(wallet);
  } catch {
    return null;
  }
}

export function planWalletMove({ from, to, amount, ownerId, env = {} } = {}) {
  const source = walletOrNull(from);
  const dest = walletOrNull(to);
  if (!source || !dest) return { error: 'invalid_wallet' };
  if (typeof ownerId !== 'string' || !ownerId || source.ownerId !== ownerId || dest.ownerId !== ownerId) {
    return { error: 'owner_mismatch' };
  }
  if (source.frozen || dest.frozen) return { error: 'wallet_frozen' };
  if (source.id === dest.id || source.address === dest.address) return { error: 'invalid_destination' };
  if (typeof amount !== 'string' || !AMOUNT.test(amount)) return { error: 'invalid_amount' };
  const missing = [];
  for (const key of ['PRIVY_APP_ID', 'PRIVY_APP_SECRET', 'QUICKNODE_DEVNET_RPC_URL']) {
    const value = typeof env[key] === 'string' ? env[key].trim() : '';
    const pub = key === 'PRIVY_APP_ID' && typeof env.NEXT_PUBLIC_PRIVY_APP_ID === 'string'
      ? env.NEXT_PUBLIC_PRIVY_APP_ID.trim()
      : '';
    if (!value && !pub) missing.push(key);
  }
  if (missing.length > 0) return { error: 'missing_config', missing };
  return {
    from: source,
    to: dest,
    amount,
    memo: 'wallet.move',
  };
}
