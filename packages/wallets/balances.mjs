/**
 * Solana wallet balance reads across hackathon clusters (devnet + testnet).
 * Native SOL + every non-zero SPL / Token-2022 account. Never returns RPC URLs.
 */
import { DEVNET_GENESIS_HASH, DEVNET_USDC_MINT } from './privy.mjs';

export const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/** Solana testnet genesis hash. */
export const TESTNET_GENESIS_HASH = '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY';

/** Public HTTPS fallbacks when QuickNode secrets are unset or unreachable. */
export const PUBLIC_DEVNET_RPC_URL = 'https://api.devnet.solana.com';
export const PUBLIC_TESTNET_RPC_URL = 'https://api.testnet.solana.com';

/** Cap RPC rows scanned / returned so a whale wallet cannot blow the response. */
const TOKEN_ACCOUNT_CAP = 96;
const TOKEN_RESULT_CAP = 48;
const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const integerAmount = /^(0|[1-9][0-9]{0,39})$/;
const CLUSTERS = Object.freeze(['devnet', 'testnet']);

const CLUSTER_GENESIS = Object.freeze({
  devnet: DEVNET_GENESIS_HASH,
  testnet: TESTNET_GENESIS_HASH,
});

const KNOWN_MINTS = Object.freeze({
  [DEVNET_USDC_MINT]: Object.freeze({ symbol: 'USDC', clusters: Object.freeze(['devnet']) }),
});

function rejectBalance(code, address = null, cluster = 'devnet') {
  return {
    ok: false,
    code,
    cluster,
    address,
    amount: null,
    solLamports: null,
    usdcAmount: null,
    tokens: [],
    holdings: [],
  };
}

function shortMint(mint) {
  if (typeof mint !== 'string' || mint.length < 8) return 'TOKEN';
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

function knownSymbol(mint, cluster) {
  const known = KNOWN_MINTS[mint];
  if (!known) return null;
  if (Array.isArray(known.clusters) && !known.clusters.includes(cluster)) return null;
  return known.symbol;
}

async function rpcCall(fetcher, rpcUrl, method, params) {
  let response;
  try {
    response = await fetcher(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    const error = new Error('rpc_failed');
    error.code = 'rpc_failed';
    throw error;
  }
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok || !payload || payload.error) {
    const error = new Error('rpc_failed');
    error.code = 'rpc_failed';
    throw error;
  }
  return payload.result;
}

function assertHttpsRpc(rpcUrl) {
  if (typeof rpcUrl !== 'string' || !rpcUrl.trim()) return null;
  let endpoint;
  try { endpoint = new URL(rpcUrl.trim()); } catch { return null; }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) return null;
  return endpoint.toString();
}

/**
 * Aggregate parsed SPL token accounts by mint. Skips zero balances and bad rows.
 */
export function parseTokenAccountsByMint(accounts, { cap = TOKEN_RESULT_CAP, cluster = 'devnet' } = {}) {
  if (!Array.isArray(accounts)) return { ok: false, code: 'rpc_rejected', tokens: [] };
  const byMint = new Map();
  for (const account of accounts.slice(0, TOKEN_ACCOUNT_CAP)) {
    const info = account?.account?.data?.parsed?.info;
    const tokenAmount = info?.tokenAmount;
    const mint = typeof info?.mint === 'string' ? info.mint : '';
    if (!base58.test(mint)) continue;
    if (!Number.isInteger(tokenAmount?.decimals) || tokenAmount.decimals < 0 || tokenAmount.decimals > 18) continue;
    if (typeof tokenAmount.amount !== 'string' || !integerAmount.test(tokenAmount.amount)) continue;
    if (tokenAmount.amount === '0') continue;
    const next = BigInt(tokenAmount.amount);
    const existing = byMint.get(mint);
    if (existing) {
      existing.amount = (BigInt(existing.amount) + next).toString();
      continue;
    }
    const symbol = knownSymbol(mint, cluster) || shortMint(mint);
    byMint.set(mint, {
      mint,
      amount: next.toString(),
      decimals: tokenAmount.decimals,
      symbol,
      known: Boolean(knownSymbol(mint, cluster)),
      cluster,
    });
  }
  const tokens = [...byMint.values()]
    .sort((a, b) => {
      if (a.known !== b.known) return a.known ? -1 : 1;
      return a.symbol.localeCompare(b.symbol);
    })
    .slice(0, Math.max(1, Math.min(cap, TOKEN_RESULT_CAP)));
  return { ok: true, code: null, tokens };
}

function formatFixedUnits(amount, decimals, symbol, cluster) {
  if (typeof amount !== 'string' || !/^-?(0|[1-9][0-9]{0,39})$/.test(amount)) return null;
  const negative = amount.startsWith('-');
  const digits = negative ? amount.slice(1) : amount;
  if (!integerAmount.test(digits)) return null;
  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  const shown = fraction ? `${whole}.${fraction}` : whole;
  const unit = `${negative ? '-' : ''}${shown} ${symbol}`;
  return cluster ? `${unit} (${cluster})` : unit;
}

function holdingsFromClusterResult(result) {
  if (!result || result.ok !== true) return [];
  const out = [];
  if (typeof result.solLamports === 'string' && integerAmount.test(result.solLamports) && result.solLamports !== '0') {
    out.push({
      cluster: result.cluster,
      asset: 'SOL',
      mint: null,
      amount: result.solLamports,
      decimals: 9,
      symbol: 'SOL',
      label: formatFixedUnits(result.solLamports, 9, 'SOL', result.cluster),
    });
  }
  for (const token of Array.isArray(result.tokens) ? result.tokens : []) {
    const label = formatFixedUnits(token.amount, token.decimals, token.symbol, result.cluster);
    if (!label) continue;
    out.push({
      cluster: result.cluster,
      asset: token.symbol === 'USDC' ? 'USDC' : 'SPL',
      mint: token.mint,
      amount: token.amount,
      decimals: token.decimals,
      symbol: token.symbol,
      label,
    });
  }
  return out;
}

/**
 * Read one cluster (devnet or testnet): SOL + every non-zero SPL / Token-2022 balance.
 */
export async function readClusterWalletBalances({
  cluster = 'devnet',
  rpcUrl,
  address,
  fetcher = fetch,
} = {}) {
  if (cluster !== 'devnet' && cluster !== 'testnet') {
    return rejectBalance('invalid_cluster', null, 'devnet');
  }
  if (typeof address !== 'string' || !base58.test(address)) {
    return rejectBalance('invalid_address', null, cluster);
  }
  const target = assertHttpsRpc(rpcUrl);
  if (!target) return rejectBalance('rpc_not_configured', address, cluster);
  const expectedGenesis = CLUSTER_GENESIS[cluster];
  try {
    const genesis = await rpcCall(fetcher, target, 'getGenesisHash');
    if (genesis !== expectedGenesis) {
      return rejectBalance('wrong_cluster', address, cluster);
    }
    const encoding = { encoding: 'jsonParsed', commitment: 'confirmed' };
    const [lamportsRaw, classic, token2022] = await Promise.all([
      rpcCall(fetcher, target, 'getBalance', [address, { commitment: 'confirmed' }]),
      rpcCall(fetcher, target, 'getTokenAccountsByOwner', [
        address,
        { programId: SPL_TOKEN_PROGRAM_ID },
        encoding,
      ]),
      rpcCall(fetcher, target, 'getTokenAccountsByOwner', [
        address,
        { programId: TOKEN_2022_PROGRAM_ID },
        encoding,
      ]).catch(() => ({ value: [] })),
    ]);
    const lamportsValue = typeof lamportsRaw === 'number'
      ? lamportsRaw
      : (typeof lamportsRaw?.value === 'number' ? lamportsRaw.value : null);
    if (!Number.isSafeInteger(lamportsValue) || lamportsValue < 0) {
      return rejectBalance('rpc_rejected', address, cluster);
    }
    const classicAccounts = Array.isArray(classic?.value) ? classic.value : null;
    const token2022Accounts = Array.isArray(token2022?.value) ? token2022.value : [];
    if (!classicAccounts) {
      return {
        ...rejectBalance('rpc_rejected', address, cluster),
        solLamports: String(lamportsValue),
      };
    }
    const parsed = parseTokenAccountsByMint([...classicAccounts, ...token2022Accounts], { cluster });
    if (!parsed.ok) {
      return {
        ...rejectBalance(parsed.code, address, cluster),
        solLamports: String(lamportsValue),
      };
    }
    const usdcAmount = cluster === 'devnet'
      ? (parsed.tokens.find((token) => token.mint === DEVNET_USDC_MINT)?.amount || '0')
      : '0';
    const result = {
      ok: true,
      code: null,
      cluster,
      mint: cluster === 'devnet' ? DEVNET_USDC_MINT : null,
      address,
      amount: usdcAmount,
      solLamports: String(lamportsValue),
      usdcAmount,
      tokens: parsed.tokens,
    };
    return { ...result, holdings: holdingsFromClusterResult(result) };
  } catch {
    return rejectBalance('rpc_failed', address, cluster);
  }
}

/**
 * Resolve RPC endpoints for both hackathon clusters.
 * Testnet falls back to the public Solana HTTPS endpoint when the secret is empty.
 */
export function resolveClusterRpcUrls(env = {}) {
  const devnet = assertHttpsRpc(
    env.QUICKNODE_DEVNET_RPC_URL
    || env.devnetRpcUrl
    || PUBLIC_DEVNET_RPC_URL,
  );
  const testnet = assertHttpsRpc(
    env.QUICKNODE_TESTNET_RPC_URL
    || env.testnetRpcUrl
    || PUBLIC_TESTNET_RPC_URL,
  );
  return {
    devnet,
    testnet,
  };
}

/**
 * Read both Solana-devnet and Solana-testnet holdings for one address.
 */
export async function readWalletBalancesAcrossClusters({
  address,
  env = {},
  rpcUrls = null,
  fetcher = fetch,
} = {}) {
  const urls = rpcUrls || resolveClusterRpcUrls(env);
  const [devnet, testnet] = await Promise.all([
    urls.devnet
      ? readClusterWalletBalances({ cluster: 'devnet', rpcUrl: urls.devnet, address, fetcher })
      : rejectBalance('rpc_not_configured', address, 'devnet'),
    urls.testnet
      ? readClusterWalletBalances({ cluster: 'testnet', rpcUrl: urls.testnet, address, fetcher })
      : rejectBalance('rpc_not_configured', address, 'testnet'),
  ]);
  const holdings = [
    ...holdingsFromClusterResult(devnet),
    ...holdingsFromClusterResult(testnet),
  ];
  const tokens = [
    ...(Array.isArray(devnet.tokens) ? devnet.tokens : []),
    ...(Array.isArray(testnet.tokens) ? testnet.tokens : []),
  ];
  const anyOk = devnet.ok === true || testnet.ok === true;
  const solLamports = (() => {
    if (!anyOk) return null;
    const a = devnet.ok ? BigInt(devnet.solLamports || '0') : 0n;
    const b = testnet.ok ? BigInt(testnet.solLamports || '0') : 0n;
    return (a + b).toString();
  })();
  return {
    ok: anyOk,
    code: anyOk ? null : (devnet.code || testnet.code || 'rpc_failed'),
    address: typeof address === 'string' ? address : null,
    clusters: { devnet, testnet },
    holdings,
    // Compat fields — prefer the cluster that actually has SOL, else devnet.
    cluster: testnet.ok && testnet.solLamports !== '0' && (!devnet.ok || devnet.solLamports === '0')
      ? 'testnet'
      : 'devnet',
    solLamports,
    usdcAmount: devnet.ok ? (devnet.usdcAmount || '0') : null,
    amount: devnet.ok ? (devnet.usdcAmount || '0') : null,
    mint: DEVNET_USDC_MINT,
    tokens,
    displayBalanceLabel: holdings.map((row) => row.label).filter(Boolean).join(' · ')
      || (anyOk ? null : `balance unavailable (${devnet.code || testnet.code || 'rpc_failed'})`),
  };
}

/** Compat: Solana-devnet only. */
export async function readDevnetWalletBalances({ rpcUrl, address, fetcher = fetch } = {}) {
  return readClusterWalletBalances({ cluster: 'devnet', rpcUrl, address, fetcher });
}

/** Compat: Circle USDC on Solana-devnet only. */
export async function readDevnetUsdcBalance({ rpcUrl, address, fetcher = fetch } = {}) {
  const bal = await readDevnetWalletBalances({ rpcUrl, address, fetcher });
  return {
    ok: bal.ok === true && bal.usdcAmount != null,
    code: bal.ok === true ? null : bal.code,
    cluster: 'devnet',
    mint: DEVNET_USDC_MINT,
    address: bal.address,
    amount: bal.usdcAmount,
  };
}

export { CLUSTERS, formatFixedUnits as formatClusterAmountLabel };
