import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
import { formatUsdMicro } from './portfolio.mjs';

export const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';

export function walletAssetName(row) {
  if (row?.mint === NATIVE_SOL_MINT) return row.native === false ? 'wSOL' : 'SOL';
  const name = typeof row?.symbol === 'string' ? row.symbol.trim() : '';
  const mint = row?.mint || '';
  const clipped = `${mint.slice(0, 5)}...${mint.slice(-5)}`;
  return !name || name === mint || name === clipped || name === clipped.replace('...', '…') ? 'Unknown token' : name;
}

export function walletAssetValue(row) {
  const amount = row?.usdMicro;
  if (typeof amount !== 'string' || !/^[1-9][0-9]*$/.test(amount)) return 'Not priced';
  return BigInt(amount) < 10000n ? '<$0.01' : formatUsdMicro(amount);
}

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
    else assets.set(id, { id, mint: row.mint, symbol: walletAssetName(row), decimals: row.decimals, amount: row.amount });
  }
  return [...assets.values()];
}
