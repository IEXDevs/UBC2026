import { describeLoginMethods } from './privy-config.mjs';

/** Only wallets explicitly linked as external in Privy can be unlinked. */
export function manageableWallets(wallets = [], user = null) {
  const linked = describeLoginMethods(user).wallets;
  const byAddress = new Map(linked.map(wallet => [wallet.address, wallet]));
  const seen = new Set();
  return [...wallets, ...linked].flatMap(wallet => {
    if (!wallet?.address || seen.has(wallet.address)) return [];
    seen.add(wallet.address);
    const account = byAddress.get(wallet.address);
    const external = Boolean(account && !account.spendable);
    return [{
      ...wallet,
      label: wallet.label || (external ? `${account.client === 'wallet' ? 'External' : account.client} wallet` : 'Agent wallet'),
      external,
      canUnlink: external,
    }];
  });
}
