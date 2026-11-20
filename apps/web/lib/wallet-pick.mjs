import { shortAddress } from './money-views.mjs';

/** Only the main wallet carries the account @handle; added and linked wallets do not. */
export function walletPickLabel(row, handle = '') {
  const name = row?.kind === 'main' && handle ? ` · @${handle}` : '';
  return `${row?.label || 'Wallet'}${name} · ${shortAddress(row?.address || '')}`;
}

export function walletPickTag(row, wallet = null) {
  if (row?.kind === 'main') return 'Main';
  if (wallet?.spendable === false || row?.kind === 'connected') return 'Linked';
  return 'Added';
}
