import { SOLANA_CLUSTER, SOLANA_RPC_URL } from '@ubc2026/contracts/solana';
/**
 * Solana wallet balance reads across hackathon clusters (mainnet-beta + testnet).
 * Native SOL + every non-zero SPL / Token-2022 account. Never returns RPC URLs.
 */
import { SOLANA_GENESIS_HASH, SOLANA_USDC_MINT } from './privy.mjs';

export const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/** Solana testnet genesis hash. */
export const TESTNET_GENESIS_HASH = '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY';

/** Public HTTPS fallbacks when QuickNode secrets are unset or unreachable. */
export const PUBLIC_SOLANA_RPC_URL = SOLANA_RPC_URL;
export const PUBLIC_TESTNET_RPC_URL = 'https://api.testnet.solana.com';

/** Cap RPC rows scanned / returned so a whale wallet cannot blow the response. */
const TOKEN_ACCOUNT_CAP = 96;
const TOKEN_RESULT_CAP = 48;
const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const integerAmount = /^(0|[1-9][0-9]{0,39})$/;
const CLUSTERS = Object.freeze([SOLANA_CLUSTER, 'testnet']);

const CLUSTER_GENESIS = Object.freeze({
  [SOLANA_CLUSTER]: SOLANA_GENESIS_HASH,
  testnet: TESTNET_GENESIS_HASH,
});

const KNOWN_MINTS = Object.freeze({
  [SOLANA_USDC_MINT]: Object.freeze({ symbol: 'USDC', clusters: Object.freeze([SOLANA_CLUSTER]) }),
});

function rejectBalance(code, address = null, cluster = SOLANA_CLUSTER) {
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

/** Distinct read outcomes — never collapse rpc_failed into a zero balance. */
export const BALANCE_READ_OK = 'ok';
export const BALANCE_READ_EMPTY = 'empty';
export const BALANCE_READ_FAILED = 'failed';
export const BALANCE_READ_PARTIAL = 'partial';
export const BALANCE_READ_STALE = 'stale';

export function unavailableBalanceLabel(code = 'rpc_failed') {
  const safe = typeof code === 'string' && /^[a-z0-9_]{1,64}$/i.test(code.trim())
    ? code.trim()
    : 'rpc_failed';
  return `balance unavailable (${safe})`;
}

/**
 * Classify a wallet list (or single balance) for agents and UI.
 * Failed / partial reads keep amounts null where unknown and never invent "0 SOL".
 */
export function classifyBalanceRead(input = {}) {
  const items = Array.isArray(input?.items)
    ? input.items
    : (input && typeof input === 'object' && (input.ok === true || input.ok === false || input.balanceStatus)
      ? [input]
      : []);
  if (items.length === 0) {
    return {
      status: BALANCE_READ_EMPTY,
      code: null,
      ok: true,
      displayBalanceLabel: '0 SOL',
      asOf: typeof input?.asOf === 'string' ? input.asOf : null,
    };
  }
  let okCount = 0;
  let emptyCount = 0;
  let failedCount = 0;
  let partialCount = 0;
  let staleCount = 0;
  let failCode = null;
  const labels = [];
  for (const item of items) {
    const status = typeof item?.balanceStatus === 'string' && item.balanceStatus
      ? item.balanceStatus
      : (item?.ok === false
        ? (item.code || BALANCE_READ_FAILED)
        : (item?.status || null));
    const holdings = Array.isArray(item?.holdings) ? item.holdings.filter((row) => row?.label) : [];
    const sol = item?.solLamports;
    const usdc = item?.usdcAmount ?? item?.usdcBalance;
    const solKnown = typeof sol === 'string' && integerAmount.test(sol);
    const usdcKnown = typeof usdc === 'string' && integerAmount.test(usdc);
    const hasFunds = holdings.length > 0
      || (solKnown && sol !== '0')
      || (usdcKnown && usdc !== '0');
    if (status === BALANCE_READ_STALE || item?.stale === true) {
      staleCount += 1;
      if (typeof item?.displayBalanceLabel === 'string' && item.displayBalanceLabel) {
        labels.push(item.displayBalanceLabel);
      }
      continue;
    }
    if (status && status !== 'ok' && status !== 'empty' && status !== BALANCE_READ_PARTIAL) {
      failedCount += 1;
      if (!failCode) failCode = status === BALANCE_READ_FAILED ? (item.code || 'rpc_failed') : status;
      if (solKnown || usdcKnown || holdings.length > 0) partialCount += 1;
      continue;
    }
    if (item?.ok === false) {
      failedCount += 1;
      if (!failCode) failCode = item.code || 'rpc_failed';
      if (solKnown || usdcKnown || holdings.length > 0) partialCount += 1;
      continue;
    }
    if (hasFunds) {
      okCount += 1;
      if (typeof item?.displayBalanceLabel === 'string' && item.displayBalanceLabel) {
        labels.push(item.displayBalanceLabel);
      } else {
        for (const row of holdings) labels.push(row.label);
      }
    } else {
      emptyCount += 1;
    }
  }
  const asOf = typeof input?.asOf === 'string' ? input.asOf : null;
  if (staleCount > 0 && okCount === 0 && failedCount === 0) {
    return {
      status: BALANCE_READ_STALE,
      code: null,
      ok: true,
      displayBalanceLabel: labels.filter(Boolean).join(' · ') || 'balance stale',
      asOf,
    };
  }
  if (failedCount > 0 && okCount === 0 && partialCount === 0) {
    return {
      status: BALANCE_READ_FAILED,
      code: failCode || 'rpc_failed',
      ok: false,
      displayBalanceLabel: unavailableBalanceLabel(failCode || 'rpc_failed'),
      asOf,
    };
  }
  if (failedCount > 0 && (okCount > 0 || partialCount > 0)) {
    return {
      status: BALANCE_READ_PARTIAL,
      code: failCode || 'rpc_failed',
      ok: false,
      displayBalanceLabel: [
        ...labels.filter(Boolean),
        unavailableBalanceLabel(failCode || 'rpc_failed'),
      ].join(' · '),
      asOf,
    };
  }
  if (okCount > 0) {
    return {
      status: BALANCE_READ_OK,
      code: null,
      ok: true,
      displayBalanceLabel: labels.filter(Boolean).join(' · ') || null,
      asOf,
    };
  }
  return {
    status: BALANCE_READ_EMPTY,
    code: null,
    ok: true,
    displayBalanceLabel: '0 SOL',
    asOf,
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

/** OpenNext / workerd may lack AbortSignal.timeout — same guard as privy.mjs. */
function abortAfter(ms) {
  if (typeof AbortSignal === 'function' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  if (typeof AbortController !== 'function') return undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  if (typeof timer?.unref === 'function') timer.unref();
  return controller.signal;
}

function rpcFailureCode(error) {
  const name = String(error?.name || '');
  const message = String(error?.message || '').toLowerCase();
  if (name === 'AbortError' || /aborted|timeout|timed out/.test(message)) return 'rpc_timeout';
  if (/429|rate.?limit|too many/.test(message)) return 'rpc_rate_limited';
  return 'rpc_failed';
}

async function rpcCallOnce(fetcher, rpcUrl, method, params) {
  let response;
  try {
    response = await fetcher(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      // Prefer follow so QuickNode/CDN 3xx still yields a JSON body. Workers
      // reject redirect:"error"; "manual" left 302 as !ok → rpc_failed.
      redirect: 'follow',
      signal: abortAfter(15_000),
    });
  } catch (error) {
    const failed = new Error(rpcFailureCode(error));
    failed.code = rpcFailureCode(error);
    throw failed;
  }
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    const failed = new Error('rpc_failed');
    failed.code = 'rpc_failed';
    throw failed;
  }
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (response.status === 429) {
    const failed = new Error('rpc_rate_limited');
    failed.code = 'rpc_rate_limited';
    throw failed;
  }
  if (!response.ok || !payload || payload.error) {
    const failed = new Error('rpc_failed');
    failed.code = 'rpc_failed';
    throw failed;
  }
  return payload.result;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function rpcCall(fetcher, rpcUrl, method, params) {
  try {
    return await rpcCallOnce(fetcher, rpcUrl, method, params);
  } catch (first) {
    // Brief backoff before retry — public Solana RPC rate-limits CF egress.
    await sleep(first?.code === 'rpc_rate_limited' ? 400 : 120);
    try {
      return await rpcCallOnce(fetcher, rpcUrl, method, params);
    } catch (second) {
      throw second?.code ? second : first;
    }
  }
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
export function parseTokenAccountsByMint(accounts, { cap = TOKEN_RESULT_CAP, cluster = SOLANA_CLUSTER } = {}) {
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
 * Read one cluster (mainnet-beta or testnet): SOL + every non-zero SPL / Token-2022 balance.
 */
export async function readClusterWalletBalances({
  cluster = SOLANA_CLUSTER,
  rpcUrl,
  address,
  fetcher = fetch,
} = {}) {
  if (cluster !== SOLANA_CLUSTER && cluster !== 'testnet') {
    return rejectBalance('invalid_cluster', null, SOLANA_CLUSTER);
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
    const usdcAmount = cluster === SOLANA_CLUSTER
      ? (parsed.tokens.find((token) => token.mint === SOLANA_USDC_MINT)?.amount || '0')
      : '0';
    const result = {
      ok: true,
      code: null,
      cluster,
      mint: cluster === SOLANA_CLUSTER ? SOLANA_USDC_MINT : null,
      address,
      amount: usdcAmount,
      solLamports: String(lamportsValue),
      usdcAmount,
      tokens: parsed.tokens,
    };
    return { ...result, holdings: holdingsFromClusterResult(result) };
  } catch (error) {
    const code = typeof error?.code === 'string' && error.code ? error.code : 'rpc_failed';
    return rejectBalance(code, address, cluster);
  }
}

/**
 * Resolve RPC endpoints for both hackathon clusters.
 * Testnet falls back to the public Solana HTTPS endpoint when the secret is empty.
 */
export function resolveClusterRpcUrls(env = {}) {
  const solana = assertHttpsRpc(
    env.SOLANA_RPC_URL
    || env.solanaRpcUrl
    || PUBLIC_SOLANA_RPC_URL,
  );
  const testnet = SOLANA_CLUSTER === 'devnet' ? assertHttpsRpc(
    env.QUICKNODE_TESTNET_RPC_URL
    || env.testnetRpcUrl
    || PUBLIC_TESTNET_RPC_URL,
  ) : null;
  return {
    solana,
    testnet,
  };
}

/**
 * Read both Solana-mainnet-beta and Solana-testnet holdings for one address.
 */
export async function readWalletBalancesAcrossClusters({
  address,
  env = {},
  rpcUrls = null,
  fetcher = fetch,
} = {}) {
  const urls = rpcUrls || resolveClusterRpcUrls(env);
  // Sequential clusters cut public-RPC burst rate from Workers (parallel was
  // ~8 methods at once per wallet and often 429'd into rpc_failed).
  const solana = urls.solana
    ? await readClusterWalletBalances({ cluster: SOLANA_CLUSTER, rpcUrl: urls.solana, address, fetcher })
    : rejectBalance('rpc_not_configured', address, SOLANA_CLUSTER);
  const testnet = urls.testnet
    ? await readClusterWalletBalances({ cluster: 'testnet', rpcUrl: urls.testnet, address, fetcher })
    : rejectBalance('rpc_not_configured', address, 'testnet');
  const holdings = [
    ...holdingsFromClusterResult(solana),
    ...holdingsFromClusterResult(testnet),
  ];
  const tokens = [
    ...(Array.isArray(solana.tokens) ? solana.tokens : []),
    ...(Array.isArray(testnet.tokens) ? testnet.tokens : []),
  ];
  const anyOk = solana.ok === true || testnet.ok === true;
  const solLamports = (() => {
    if (!anyOk) return null;
    const a = solana.ok ? BigInt(solana.solLamports || '0') : 0n;
    return a.toString();
  })();
  return {
    ok: anyOk,
    code: anyOk ? null : (solana.code || testnet.code || 'rpc_failed'),
    address: typeof address === 'string' ? address : null,
    clusters: { solana, testnet },
    holdings,
    cluster: SOLANA_CLUSTER,
    solLamports,
    usdcAmount: solana.ok ? (solana.usdcAmount || '0') : null,
    amount: solana.ok ? (solana.usdcAmount || '0') : null,
    mint: SOLANA_USDC_MINT,
    tokens,
    displayBalanceLabel: holdings.map((row) => row.label).filter(Boolean).join(' · ')
      || (anyOk ? null : unavailableBalanceLabel(solana.code || testnet.code || 'rpc_failed')),
    balanceStatus: anyOk
      ? ((holdings.length > 0 || solLamports !== '0') ? BALANCE_READ_OK : BALANCE_READ_EMPTY)
      : BALANCE_READ_FAILED,
  };
}

/** Compat: Solana-mainnet-beta only. */
export async function readSolanaWalletBalances({ rpcUrl, address, fetcher = fetch } = {}) {
  return readClusterWalletBalances({ cluster: SOLANA_CLUSTER, rpcUrl, address, fetcher });
}

/** Compat: Circle USDC on Solana-mainnet-beta only. */
export async function readSolanaUsdcBalance({ rpcUrl, address, fetcher = fetch } = {}) {
  const bal = await readSolanaWalletBalances({ rpcUrl, address, fetcher });
  return {
    ok: bal.ok === true && bal.usdcAmount != null,
    code: bal.ok === true ? null : bal.code,
    cluster: SOLANA_CLUSTER,
    mint: SOLANA_USDC_MINT,
    address: bal.address,
    amount: bal.usdcAmount,
  };
}

export { CLUSTERS, formatFixedUnits as formatClusterAmountLabel };
