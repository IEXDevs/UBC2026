const WALLET_ID = /^[a-zA-Z0-9:_-]{1,128}$/;

export function validWalletId(id) {
  return typeof id === 'string' && WALLET_ID.test(id);
}

function agentWallet(wallet) {
  return validWalletId(wallet?.id) && wallet.spendable !== false && wallet.readOnly !== true
    && !wallet.id.startsWith('linked_') && !wallet.deletedAt && !wallet.deleted_at;
}

export function mainAgentWallet(wallets) {
  return wallets?.find(wallet => wallet?.kind === 'main' && agentWallet(wallet)) ?? null;
}

export function agentWalletChoices(wallets) {
  const available = (wallets ?? []).filter(wallet => agentWallet(wallet) && wallet.frozen !== true);
  const main = mainAgentWallet(available);
  return main ? [main, ...available.filter(wallet => wallet.id !== main.id)] : available;
}

/** Keep server wallet IDs when Privy and the runtime list the same address. */
export function mergeWalletDirectory(live, persisted) {
  const byAddress = new Map();
  for (const wallet of [...(live ?? []), ...(persisted ?? [])]) {
    if (!validWalletId(wallet?.id)) continue;
    const key = wallet.address || wallet.id;
    byAddress.set(key, { ...byAddress.get(key), ...wallet });
  }
  return [...byAddress.values()];
}

export function withAssignedWallet(bots, wallets) {
  if (!Array.isArray(bots)) return { bots: [], wallets: null };
  if (!Array.isArray(wallets) || wallets.length === 0) return { bots, wallets: null };
  const main = mainAgentWallet(wallets);
  if (!main) return { bots, wallets };
  return {
    wallets,
    bots: bots.map(bot => bot.walletId ? bot : { ...bot, walletId: main.id }),
  };
}
