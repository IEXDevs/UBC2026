/** Point every visible bot at the owner's main Privy wallet. */

/**
 * Prefer non-empty wallet lists. Empty arrays are not "loaded" — they must not
 * block a later source (Privy client fallback or Worker list).
 */
export function pickWalletList(...lists) {
  for (const list of lists) {
    if (Array.isArray(list) && list.length > 0) return list;
  }
  return [];
}

export function withAssignedWallet(bots, wallets) {
  if (!Array.isArray(bots)) return { bots: [], wallets: null };
  if (!Array.isArray(wallets) || wallets.length === 0) return { bots, wallets: null };
  const spendable = wallets.filter(wallet => wallet && wallet.spendable !== false && wallet.id);
  const main = spendable.find(wallet => wallet.kind === 'main') ?? spendable[0];
  if (!main?.id) return { bots, wallets };
  return {
    wallets,
    bots: bots.map(bot => ({ ...bot, walletId: main.id })),
  };
}
