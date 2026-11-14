/** Point every visible bot at the owner's main Privy wallet. */

export function withAssignedWallet(bots, wallets) {
  if (!Array.isArray(bots)) return { bots: [], wallets: null };
  if (!Array.isArray(wallets) || wallets.length === 0) return { bots, wallets: null };
  const main = wallets.find(wallet => wallet?.kind === 'main') ?? wallets[0];
  if (!main?.id) return { bots, wallets: null };
  return {
    wallets,
    bots: bots.map(bot => ({ ...bot, walletId: main.id })),
  };
}
