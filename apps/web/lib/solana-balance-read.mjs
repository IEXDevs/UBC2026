import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
/**
 * Confirmed Solana mainnet-beta SOL + USDC for one address.
 * QuickNode mainnet-beta is used when that URL is https. Otherwise the public
 * mainnet-beta RPC. Mainnet URLs are ignored. The result never includes an RPC URL.
 */
import { SOLANA_USDC_MINT } from '@ubc2026/wallets/privy';
import { accessTokenFromRequest } from './privy-cookie-session.mjs';
import { PUBLIC_SOLANA_RPC_URL, readClusterWalletBalances } from '@ubc2026/wallets/balances';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function solanaBalanceRpcUrl(env = {}) {
  const raw = typeof env.SOLANA_RPC_URL === 'string' ? env.SOLANA_RPC_URL.trim() : '';
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.protocol === 'https:' && !url.username && !url.password) return url.toString();
    } catch {
      /* public mainnet-beta */
    }
  }
  return PUBLIC_SOLANA_RPC_URL;
}

function publicTokens(tokens) {
  if (!Array.isArray(tokens)) return [];
  return tokens.slice(0, 48).map((token) => ({
    mint: token.mint,
    amount: token.amount,
    decimals: token.decimals,
    symbol: token.symbol,
  })).filter((token) => typeof token.mint === 'string' && typeof token.amount === 'string');
}

export async function readAssignedSolanaBalance({ address, env = {}, fetcher = fetch } = {}) {
  const owner = typeof address === 'string' ? address.trim() : '';
  if (!BASE58.test(owner)) {
    return {
      ok: false,
      code: 'invalid_address',
      cluster: SOLANA_CLUSTER,
      address: null,
      solLamports: null,
      usdcAmount: null,
      mint: SOLANA_USDC_MINT,
      tokens: [],
      spendableCluster: SOLANA_CLUSTER,
    };
  }
  const bal = await readClusterWalletBalances({
    cluster: SOLANA_CLUSTER,
    rpcUrl: solanaBalanceRpcUrl(env),
    address: owner,
    fetcher,
  });
  const ok = bal.ok === true && bal.cluster === SOLANA_CLUSTER;
  return {
    ok,
    code: ok ? null : (bal.code || 'rpc_failed'),
    cluster: SOLANA_CLUSTER,
    address: owner,
    solLamports: ok ? bal.solLamports : null,
    usdcAmount: ok ? (bal.usdcAmount || '0') : null,
    mint: SOLANA_USDC_MINT,
    tokens: ok ? publicTokens(bal.tokens) : [],
    spendableCluster: SOLANA_CLUSTER,
  };
}

function solanaEnv(options) {
  const fromCaller = options.env && typeof options.env === 'object' ? options.env : null;
  const raw = fromCaller
    ? fromCaller.SOLANA_RPC_URL
    : (typeof options.readEnv === 'function' ? options.readEnv('SOLANA_RPC_URL') : '');
  return {
    SOLANA_RPC_URL: typeof raw === 'string' ? raw : '',
  };
}

/** HTTP shape for GET /api/solana-balance. Does not read mainnet or the agent runtime. */
export async function handleSolanaBalanceRequest(request, options = {}) {
  const accessToken = accessTokenFromRequest(request);
  if (!accessToken) {
    return { status: 401, body: { error: 'login_required' } };
  }
  let address = '';
  try {
    address = new URL(request.url).searchParams.get('address') || '';
  } catch {
    address = '';
  }
  const fetcher = typeof options.fetcher === 'function' ? options.fetcher : fetch;
  const body = await readAssignedSolanaBalance({
    address,
    env: solanaEnv(options),
    fetcher,
  });
  if (body.code === 'invalid_address') return { status: 400, body };
  if (body.ok !== true) return { status: 502, body };
  return { status: 200, body };
}
