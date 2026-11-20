import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
/**
 * Display model for the assigned Privy wallet's Solana mainnet-beta balances.
 * No RPC here — the browser can import this. The server read lives in
 * solana-balance-read.mjs.
 */
import { formatBaseUnits } from './money-views.mjs';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const UNITS = /^(0|[1-9][0-9]{0,39})$/;

/** Spendable embedded wallet the app generated. External wallets stay out. */
export function assignedWalletAddress(wallets) {
  const list = Array.isArray(wallets) ? wallets : [];
  const rows = list.filter((wallet) => {
    if (!wallet || typeof wallet.address !== 'string' || !BASE58.test(wallet.address.trim())) return false;
    if (wallet.spendable === false) return false;
    const client = typeof wallet.walletClientType === 'string'
      ? wallet.walletClientType.trim().toLowerCase()
      : '';
    if (client && client !== 'privy') return false;
    return true;
  });
  const main = rows.find((wallet) => wallet.kind === 'main') || rows[0] || null;
  return main ? main.address.trim() : '';
}

/**
 * Confirmed mainnet-beta SOL and USDC, plus any other token the wallet actually holds.
 * A mainnet cluster is refused. A missing ledger is irrelevant here.
 */
export function solanaSpendableLabel(balance) {
  if (!balance || balance.ok !== true || balance.cluster !== SOLANA_CLUSTER) return null;
  if (typeof balance.solLamports !== 'string' || !UNITS.test(balance.solLamports)) return null;
  if (typeof balance.usdcAmount !== 'string' || !UNITS.test(balance.usdcAmount)) return null;
  const parts = [
    `${formatBaseUnits(balance.solLamports, 9)} SOL`,
    `${formatBaseUnits(balance.usdcAmount, 6)} USDC`,
  ];
  const seen = new Set(['SOL', 'USDC']);
  for (const token of Array.isArray(balance.tokens) ? balance.tokens : []) {
    const symbol = typeof token?.symbol === 'string' ? token.symbol.trim() : '';
    if (!symbol || seen.has(symbol) || symbol.length > 16 || /\s/.test(symbol)) continue;
    if (typeof token.amount !== 'string' || !UNITS.test(token.amount) || token.amount === '0') continue;
    if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 18) continue;
    parts.push(`${formatBaseUnits(token.amount, token.decimals)} ${symbol}`);
    seen.add(symbol);
  }
  return parts.join(' · ');
}
