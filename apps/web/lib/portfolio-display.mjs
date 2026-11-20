import { formatBaseUnits } from './money-views.mjs';

export function unpricedHoldingLabels(holdings = []) {
  return holdings.filter(row => row.usdMicro === '0').map(row => {
    const symbol = row.symbol?.trim() || `${row.mint.slice(0, 5)}...${row.mint.slice(-5)}`;
    return `${formatBaseUnits(row.amount, row.decimals)} ${symbol} · Not priced`;
  });
}

export function portfolioEmptyMessage(wallets = []) {
  return wallets.some(wallet => wallet.holdings?.length)
    ? 'No priced assets in the linked wallets yet.'
    : 'No assets in the linked wallets yet.';
}
