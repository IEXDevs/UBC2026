import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';

export const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';

export function walletSendAssets(portfolio, address) {
  const cluster = SOLANA_CLUSTER === 'mainnet-beta' ? 'mainnet' : SOLANA_CLUSTER;
  if (portfolio?.cluster !== cluster && portfolio?.cluster !== SOLANA_CLUSTER) return [];
  const wallet = portfolio?.wallets?.find(row => row?.address === address);
  const assets = new Map();
  for (const row of wallet?.holdings || []) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row?.mint || '') || !/^[1-9][0-9]{0,39}$/.test(row?.amount || '')
      || !Number.isInteger(row.decimals) || row.decimals < 0 || row.decimals > 18) continue;
    const native = row.mint === NATIVE_SOL_MINT && row.native !== false;
    const id = native ? 'SOL' : row.mint;
    const current = assets.get(id);
    if (current) current.amount = (BigInt(current.amount) + BigInt(row.amount)).toString();
    else assets.set(id, { id, mint: row.mint, symbol: native ? 'SOL' : row.symbol || row.mint, decimals: row.decimals, amount: row.amount });
  }
  return [...assets.values()];
}
