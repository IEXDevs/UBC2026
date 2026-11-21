import { SOLANA_CLUSTER, SOLANA_GENESIS_HASH, SOLANA_USDC_MINT } from '@ubc2026/contracts/solana';
import { formatAmount, shortAddress, solscanTxUrl } from './money-views.mjs';
import { assertPortfolioRpc, MAINNET_USDT_MINT, PortfolioError, SOL_MINT } from './portfolio.mjs';

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RECENT_TRANSACTIONS = 30;
const MAX_WALLETS = 24;
const SYMBOLS = { [SOLANA_USDC_MINT]: 'USDC', [MAINNET_USDT_MINT]: 'USDT', [SOL_MINT]: 'wSOL' };

async function rpc(fetcher, url, method, params) {
  const response = await fetcher(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    redirect: 'manual',
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new PortfolioError('rpc_failed');
  const body = await response.json();
  if (body?.error || body?.result == null) throw new PortfolioError('rpc_failed');
  return body.result;
}

function tokenAmounts(balances, owners, address, sign, totals) {
  for (const balance of balances) {
    const { accountIndex, mint, uiTokenAmount } = balance ?? {};
    if ((balance?.owner ?? owners.get(accountIndex)) !== address || typeof mint !== 'string' || !ADDRESS.test(mint)) continue;
    const { amount, decimals } = uiTokenAmount ?? {};
    if (typeof amount !== 'string' || !/^\d{1,20}$/.test(amount) || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) continue;
    const previous = totals.get(mint)?.value ?? 0n;
    totals.set(mint, { value: previous + sign * BigInt(amount), decimals });
  }
}

function lamports(value) {
  if (Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^\d{1,20}$/.test(value)) return BigInt(value);
  return null;
}

function activityForWallet(tx, address) {
  const { meta, transaction } = tx ?? {};
  if (!meta || meta.err !== null) return [];
  const pre = Array.isArray(meta.preTokenBalances) ? meta.preTokenBalances : [];
  const post = Array.isArray(meta.postTokenBalances) ? meta.postTokenBalances : [];
  const owners = new Map([...pre, ...post].filter(row => row?.owner).map(row => [row.accountIndex, row.owner]));
  const totals = new Map();
  tokenAmounts(pre, owners, address, -1n, totals);
  tokenAmounts(post, owners, address, 1n, totals);
  const keys = transaction?.message?.accountKeys;
  const index = Array.isArray(keys) ? keys.findIndex(key => (key?.pubkey ?? key) === address) : -1;
  if (index >= 0) {
    const before = lamports(meta.preBalances?.[index]);
    const after = lamports(meta.postBalances?.[index]);
    const fee = index === 0 ? lamports(meta.fee) : 0n;
    if (before !== null && after !== null && fee !== null) {
      totals.set('SOL', { value: after - before + fee, decimals: 9 });
    }
  }
  return [...totals].filter(([, entry]) => entry.value !== 0n).map(([asset, { value, decimals }]) => {
    const symbol = asset === 'SOL' ? asset : SYMBOLS[asset] ?? shortAddress(asset);
    return (value > 0n ? '+' : '') + formatAmount(value.toString(), decimals) + ' ' + symbol;
  });
}

/** Read confirmed money movement for wallets already resolved by the owner route. */
export async function loadWalletActivity({ wallets, rpcUrl, fetcher = fetch }) {
  const distinct = new Map(wallets.filter(wallet => typeof wallet?.address === 'string' && ADDRESS.test(wallet.address))
    .map(wallet => [wallet.address, wallet]));
  const selected = [...distinct.values()].slice(0, MAX_WALLETS);
  if (selected.length === 0) return { items: [], incomplete: false };
  const url = assertPortfolioRpc(rpcUrl);
  if (await rpc(fetcher, url, 'getGenesisHash', []) !== SOLANA_GENESIS_HASH) throw new PortfolioError('wrong_cluster');

  const results = await Promise.allSettled(selected.map(async wallet => {
    const result = await rpc(fetcher, url, 'getTransactionsForAddress', [wallet.address, {
      commitment: 'confirmed',
      encoding: 'jsonParsed',
      limit: RECENT_TRANSACTIONS,
      maxSupportedTransactionVersion: 1,
      transactionDetails: 'full',
      filters: { status: 'succeeded', tokenAccounts: 'balanceChanged' },
    }]);
    if (!Array.isArray(result?.data)) throw new PortfolioError('rpc_failed');
    return result.data.map(tx => ({ tx, wallet }));
  }));
  if (results.every(result => result.status === 'rejected')) throw new PortfolioError('rpc_failed');

  const entries = new Map();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const { tx, wallet } of result.value) {
      const signature = tx?.transaction?.signatures?.[0];
      if (!solscanTxUrl(signature, SOLANA_CLUSTER)) continue;
      const changes = activityForWallet(tx, wallet.address);
      if (!changes.length) continue;
      if (!entries.has(signature)) {
        entries.set(signature, {
          id: 'chain:' + signature,
          signature,
          cluster: SOLANA_CLUSTER,
          slot: tx.slot,
          at: Number.isSafeInteger(tx.blockTime) && tx.blockTime > 0 ? tx.blockTime * 1000 : 0,
          title: 'Transaction confirmed',
          lines: [],
        });
      }
      const entry = entries.get(signature);
      const label = wallet.label ? wallet.label + ' · ' + shortAddress(wallet.address) : shortAddress(wallet.address);
      if (!entry.lines.some(line => line.label === label)) entry.lines.push({ label, value: changes.join(', ') });
    }
  }
  return {
    items: [...entries.values()].sort((a, b) => b.slot - a.slot),
    incomplete: distinct.size > selected.length || results.some(result => result.status === 'rejected'),
  };
}
