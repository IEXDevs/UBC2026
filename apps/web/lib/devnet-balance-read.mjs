/**
 * Confirmed Solana devnet SOL + USDC for one address.
 * QuickNode devnet is used when that URL is https. Otherwise the public
 * devnet RPC. Mainnet URLs are ignored. The result never includes an RPC URL.
 */
import { DEVNET_USDC_MINT } from '@ubc2026/wallets/privy';
import { PUBLIC_DEVNET_RPC_URL, readClusterWalletBalances } from '@ubc2026/wallets/balances';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function devnetBalanceRpcUrl(env = {}) {
  const raw = typeof env.QUICKNODE_DEVNET_RPC_URL === 'string' ? env.QUICKNODE_DEVNET_RPC_URL.trim() : '';
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.protocol === 'https:' && !url.username && !url.password) return url.toString();
    } catch {
      /* public devnet */
    }
  }
  return PUBLIC_DEVNET_RPC_URL;
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

export async function readAssignedDevnetBalance({ address, env = {}, fetcher = fetch } = {}) {
  const owner = typeof address === 'string' ? address.trim() : '';
  if (!BASE58.test(owner)) {
    return {
      ok: false,
      code: 'invalid_address',
      cluster: 'devnet',
      address: null,
      solLamports: null,
      usdcAmount: null,
      mint: DEVNET_USDC_MINT,
      tokens: [],
      spendableCluster: 'devnet',
    };
  }
  const bal = await readClusterWalletBalances({
    cluster: 'devnet',
    rpcUrl: devnetBalanceRpcUrl(env),
    address: owner,
    fetcher,
  });
  const ok = bal.ok === true && bal.cluster === 'devnet';
  return {
    ok,
    code: ok ? null : (bal.code || 'rpc_failed'),
    cluster: 'devnet',
    address: owner,
    solLamports: ok ? bal.solLamports : null,
    usdcAmount: ok ? (bal.usdcAmount || '0') : null,
    mint: DEVNET_USDC_MINT,
    tokens: ok ? publicTokens(bal.tokens) : [],
    spendableCluster: 'devnet',
  };
}

function devnetEnv(options) {
  const fromCaller = options.env && typeof options.env === 'object' ? options.env : null;
  const raw = fromCaller
    ? fromCaller.QUICKNODE_DEVNET_RPC_URL
    : (typeof options.readEnv === 'function' ? options.readEnv('QUICKNODE_DEVNET_RPC_URL') : '');
  return {
    QUICKNODE_DEVNET_RPC_URL: typeof raw === 'string' ? raw : '',
  };
}

/** HTTP shape for GET /api/devnet-balance. Does not read mainnet or the agent runtime. */
export async function handleDevnetBalanceRequest(request, options = {}) {
  const header = request?.headers?.get?.('authorization') ?? '';
  const accessToken = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
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
  const body = await readAssignedDevnetBalance({
    address,
    env: devnetEnv(options),
    fetcher,
  });
  if (body.code === 'invalid_address') return { status: 400, body };
  if (body.ok !== true) return { status: 502, body };
  return { status: 200, body };
}
