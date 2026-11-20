import { configuredSolanaRpc, SOLANA_CLUSTER, SOLANA_USDC_MINT, EXECUTION_LABEL } from '@ubc2026/contracts/solana';
/**
 * Read-only portfolio of linked Solana wallets.
 * Balances come from QuickNode. Dollar values use mainnet prices.
 * This module never signs or broadcasts.
 */

export class PortfolioError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PortfolioError';
    this.code = code;
  }
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const AMOUNT = /^(0|[1-9][0-9]{0,39})$/;
const PRICE = /^(0|[1-9]\d*)(\.\d+)?$/;

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const MAINNET_USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
export { SOLANA_USDC_MINT };

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const READ_ONLY_RPC = new Set(['getGenesisHash', 'getBalance', 'getTokenAccountsByOwner']);

const GENESIS = Object.freeze({
  // Full getGenesisHash values, plus the shorter ids used in CAIP-2 and older mocks.
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d': 'mainnet',
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'mainnet',
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: 'devnet',
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1: 'devnet',
  '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY': 'testnet',
  '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z': 'testnet',
});

const SYMBOLS = Object.freeze({
  [SOL_MINT]: 'SOL',
  [MAINNET_USDC_MINT]: 'USDC',
  [MAINNET_USDT_MINT]: 'USDT',
  [SOLANA_USDC_MINT]: 'USDC',
});

const PEGS = Object.freeze({
  [MAINNET_USDC_MINT]: '1',
  [MAINNET_USDT_MINT]: '1',
  [SOLANA_USDC_MINT]: '1',
});

export const PRICE_LABEL = EXECUTION_LABEL;
const MAX_WALLETS = 24;
const MAX_TOKENS = 40;

function fail(code) {
  throw new PortfolioError(code);
}

/** Balance reads. A broadcast or sign method is refused before any request. */
export function assertPortfolioReadMethod(method) {
  if (typeof method !== 'string' || !READ_ONLY_RPC.has(method)) fail('broadcast_refused');
  return method;
}

export function assertPortfolioRpc(url) {
  if (typeof url !== 'string' || !url.trim()) fail('missing_config');
  let parsed;
  try { parsed = new URL(url.trim()); } catch { fail('invalid_rpc'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) fail('invalid_rpc');
  return parsed.toString();
}

export function choosePortfolioRpc(env = {}, cluster = '') {
  const mainnet = typeof env.QUICKNODE_MAINNET_RPC_URL === 'string' ? env.QUICKNODE_MAINNET_RPC_URL.trim() : '';
  const solana = configuredSolanaRpc(env);
  if (cluster === SOLANA_CLUSTER) return { rpcUrl: solana, missing: solana ? [] : ['SOLANA_RPC_URL'] };
  if (mainnet) return { rpcUrl: mainnet, missing: [] };
  if (solana) return { rpcUrl: solana, missing: [] };
  return { rpcUrl: '', missing: ['QUICKNODE_MAINNET_RPC_URL', 'SOLANA_RPC_URL'] };
}

export function usdMicro(amount, decimals, priceUsd) {
  if (typeof amount !== 'string' || !AMOUNT.test(amount)) return null;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) return null;
  if (typeof priceUsd !== 'string' || !PRICE.test(priceUsd)) return null;
  const [whole, frac = ''] = priceUsd.split('.');
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, '') || '0';
  const numerator = BigInt(amount) * BigInt(digits) * 1000000n;
  const denominator = 10n ** BigInt(decimals + frac.length);
  return (numerator / denominator).toString();
}

export function formatUsdMicro(value) {
  if (typeof value !== 'string' || !AMOUNT.test(value)) fail('invalid_amount');
  const padded = value.padStart(7, '0');
  const whole = padded.slice(0, -6);
  const cents = padded.slice(-6, -4);
  return `$${whole}.${cents}`;
}

export function formatShare(bps) {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) return '';
  const text = (bps / 100).toFixed(2).replace(/\.?0+$/, '');
  return `${text}%`;
}

function symbolFor(mint) {
  if (SYMBOLS[mint]) return SYMBOLS[mint];
  if (typeof mint !== 'string' || mint.length < 8) return 'Token';
  return `${mint.slice(0, 5)}...${mint.slice(-5)}`;
}

function pegFor(mint, cluster) {
  if (mint === SOLANA_USDC_MINT && SOLANA_CLUSTER !== 'mainnet-beta' && cluster === 'mainnet') return null;
  return PEGS[mint] ?? null;
}

/** Stablecoin pegs fill gaps when a live DexScreener price is missing. */
export function withKnownPegs(cluster, prices = {}) {
  const next = { ...prices };
  for (const mint of Object.keys(PEGS)) {
    const peg = pegFor(mint, cluster);
    if (peg && (typeof next[mint] !== 'string' || !PRICE.test(next[mint]))) next[mint] = peg;
  }
  return next;
}

function addToken(bucket, token) {
  const key = token.native === false ? `${token.mint}:wrapped` : token.mint;
  const existing = bucket.get(key);
  if (!existing) {
    bucket.set(key, { ...token });
    return;
  }
  existing.amount = (BigInt(existing.amount) + BigInt(token.amount)).toString();
  existing.decimals = token.decimals;
}

function sharesOf(slices) {
  const total = slices.reduce((sum, slice) => sum + BigInt(slice.usdMicro), 0n);
  if (total === 0n) return slices.map(slice => ({ ...slice, shareBps: 0 }));
  let used = 0;
  const rows = slices.map(slice => {
    const bps = Number((BigInt(slice.usdMicro) * 10000n) / total);
    used += bps;
    return { ...slice, shareBps: bps };
  });
  const leftover = 10000 - used;
  if (rows.length > 0 && leftover !== 0) rows[0].shareBps += leftover;
  return rows;
}

export function portfolioErrorNote(body = {}) {
  const code = typeof body?.error === 'string' ? body.error : '';
  if (code === 'missing_config') {
    return 'Portfolio needs QUICKNODE_MAINNET_RPC_URL or SOLANA_RPC_URL in the repo root .env.local, then restart Next.';
  }
  if (code === 'invalid_rpc') return 'The QuickNode portfolio URL must be https.';
  if (code === 'wrong_cluster') return 'QuickNode returned a cluster this portfolio does not read.';
  if (code === 'login_required' || code === 'worker_origin_forbidden') {
    return 'Sign in again to read the portfolio.';
  }
  if (code === 'privy_failed') return 'Privy did not return this account. Sign out and sign in again.';
  if (code === 'rpc_failed' || code === 'rpc_timeout' || code === 'rpc_rate_limited') {
    return 'QuickNode did not return balances. Try again in a moment.';
  }
  return 'The portfolio could not be read.';
}

export function portfolioNote(cluster) {
  const where = cluster === 'mainnet'
    ? 'Read-only mainnet balances from QuickNode.'
    : cluster === 'testnet'
      ? 'Testnet balances from QuickNode.'
      : 'Solana balances from QuickNode. Set QUICKNODE_MAINNET_RPC_URL to graph mainnet holdings.';
  return `${where} Dollar values use mainnet prices and do not authorize a transaction. ${PRICE_LABEL}.`;
}

/**
 * @param {{ cluster: string, wallets: Array<{ address: string, label?: string, walletClientType?: string, spendable?: boolean, tokens: Array<{ mint: string, amount: string, decimals: number }> }>, prices: Record<string, string> }} input
 */
export function buildPortfolio({ cluster, wallets, prices = {} }) {
  if (cluster !== 'mainnet' && cluster !== SOLANA_CLUSTER) fail('wrong_cluster');
  const walletRows = [];
  const combined = new Map();
  let unpriced = 0;

  for (const wallet of wallets) {
    const holdings = [];
    const local = new Map();
    for (const token of wallet.tokens || []) {
      if (!token || !BASE58.test(token.mint) || !AMOUNT.test(token.amount) || token.amount === '0') continue;
      if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 18) continue;
      if (token.decimals === 0 && token.amount === '1') continue;
      addToken(local, { mint: token.mint, amount: token.amount, decimals: token.decimals, ...(token.native === undefined ? {} : { native: token.native }) });
    }
    let walletUsd = 0n;
    for (const token of local.values()) {
      const price = typeof prices[token.mint] === 'string' ? prices[token.mint] : null;
      const micro = price ? usdMicro(token.amount, token.decimals, price) : null;
      const priced = micro != null && micro !== '0';
      if (!priced) unpriced += 1;
      const row = {
        mint: token.mint,
        symbol: token.native === false && token.mint === SOL_MINT ? 'wSOL' : symbolFor(token.mint),
        amount: token.amount,
        decimals: token.decimals,
        usdMicro: priced ? micro : '0',
        ...(token.native === undefined ? {} : { native: token.native }),
      };
      holdings.push(row);
      if (priced) {
        walletUsd += BigInt(micro);
        addToken(combined, token);
      }
    }
    holdings.sort((a, b) => (BigInt(b.usdMicro) > BigInt(a.usdMicro) ? 1 : -1));
    walletRows.push({
      address: wallet.address,
      label: typeof wallet.label === 'string' && wallet.label.trim() ? wallet.label.trim() : 'Wallet',
      client: typeof wallet.walletClientType === 'string' ? wallet.walletClientType : null,
      spendable: wallet.spendable === true,
      totalUsdMicro: walletUsd.toString(),
      holdings,
    });
  }

  const pricedTokens = [];
  for (const token of combined.values()) {
    const micro = usdMicro(token.amount, token.decimals, prices[token.mint]);
    if (!micro || micro === '0') continue;
    pricedTokens.push({
      mint: token.mint,
      symbol: symbolFor(token.mint),
      amount: token.amount,
      decimals: token.decimals,
      usdMicro: micro,
    });
  }
  pricedTokens.sort((a, b) => (BigInt(b.usdMicro) > BigInt(a.usdMicro) ? 1 : -1));
  const slices = sharesOf(pricedTokens);
  const total = slices.reduce((sum, slice) => sum + BigInt(slice.usdMicro), 0n);

  return {
    cluster,
    priceLabel: PRICE_LABEL,
    authorizesTransaction: false,
    source: 'quicknode',
    totalUsdMicro: total.toString(),
    slices,
    wallets: walletRows,
    unpriced,
    note: portfolioNote(cluster),
  };
}

function abortAfter(ms) {
  if (typeof AbortSignal === 'function' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  if (typeof timer?.unref === 'function') timer.unref();
  return controller.signal;
}

async function rpcBatch(fetcher, rpcUrl, calls) {
  for (const call of calls) assertPortfolioReadMethod(call?.method);
  const url = assertPortfolioRpc(rpcUrl);
  let response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(calls.map((call, index) => ({
        jsonrpc: '2.0',
        id: index,
        method: call.method,
        params: call.params,
      }))),
      redirect: 'follow',
      signal: abortAfter(20000),
    });
  } catch (error) {
    if (error instanceof PortfolioError) throw error;
    fail('rpc_failed');
  }
  if (!response?.ok) fail('rpc_failed');
  let payload;
  try { payload = await response.json(); } catch { fail('rpc_failed'); }
  const rows = Array.isArray(payload) ? payload : [payload];
  const byId = new Map(rows.map(row => [row?.id, row]));
  return calls.map((_, index) => byId.get(index) ?? null);
}

function rpcResult(row) {
  if (!row || row.error) return null;
  return row.result ?? null;
}

function parseLamports(result) {
  const value = result?.value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && AMOUNT.test(value)) return value;
  return null;
}

function parseTokenAccounts(result) {
  const list = result?.value;
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const row of list) {
    const info = row?.account?.data?.parsed?.info;
    const mint = info?.mint;
    const amount = info?.tokenAmount?.amount;
    const decimals = info?.tokenAmount?.decimals;
    if (!BASE58.test(mint) || typeof amount !== 'string' || !AMOUNT.test(amount)) continue;
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) continue;
    if (amount === '0' || (decimals === 0 && amount === '1')) continue;
    out.push({ mint, amount, decimals, ...(mint === SOL_MINT ? { native: false } : {}) });
    if (out.length >= MAX_TOKENS) break;
  }
  return out;
}

function tokenAccountCall(address, programId) {
  return {
    method: 'getTokenAccountsByOwner',
    params: [
      address,
      { programId },
      { encoding: 'jsonParsed' },
    ],
  };
}

export async function readChainBalances({ rpcUrl, wallets, fetcher = fetch }) {
  const list = [];
  const seen = new Set();
  for (const wallet of wallets || []) {
    const address = typeof wallet?.address === 'string' ? wallet.address.trim() : '';
    if (!BASE58.test(address) || seen.has(address)) continue;
    seen.add(address);
    list.push(wallet);
    if (list.length >= MAX_WALLETS) break;
  }
  if (list.length === 0) return { cluster: null, wallets: [], truncated: false };

  const calls = [{ method: 'getGenesisHash', params: [] }];
  for (const wallet of list) {
    calls.push({ method: 'getBalance', params: [wallet.address] });
    calls.push(tokenAccountCall(wallet.address, TOKEN_PROGRAM));
    calls.push(tokenAccountCall(wallet.address, TOKEN_2022));
  }
  const rows = await rpcBatch(fetcher, rpcUrl, calls);
  const genesis = rpcResult(rows[0]);
  const cluster = GENESIS[typeof genesis === 'string' ? genesis : ''];
  if (!cluster) fail('wrong_cluster');

  const balances = list.map((wallet, index) => {
    const base = index * 3 + 1;
    const lamports = parseLamports(rpcResult(rows[base]));
    const tokens = [
      ...parseTokenAccounts(rpcResult(rows[base + 1])),
      ...parseTokenAccounts(rpcResult(rows[base + 2])),
    ];
    if (lamports && lamports !== '0') {
      tokens.unshift({ mint: SOL_MINT, amount: lamports, decimals: 9, native: true });
    }
    return {
      address: wallet.address,
      label: wallet.label,
      walletClientType: wallet.walletClientType,
      spendable: wallet.spendable === true,
      tokens,
    };
  });
  return { cluster, wallets: balances, truncated: (wallets || []).length > list.length };
}

export async function loadPortfolio({ wallets, rpcUrl, fetcher = fetch, lookupPrice, now = () => new Date() }) {
  const read = await readChainBalances({ rpcUrl, wallets, fetcher });
  if (!read.cluster) {
    return {
      cluster: null,
      priceLabel: PRICE_LABEL,
      authorizesTransaction: false,
      source: 'quicknode',
      totalUsdMicro: '0',
      slices: [],
      wallets: [],
      unpriced: 0,
      truncated: false,
      note: 'Connect a Solana wallet to build the portfolio.',
      fetchedAt: now().toISOString(),
    };
  }
  const mints = new Set();
  for (const wallet of read.wallets) {
    for (const token of wallet.tokens) mints.add(token.mint);
  }
  const prices = {};
  if (typeof lookupPrice === 'function') {
    await Promise.all([...mints].map(async mint => {
      try {
        const quote = await lookupPrice(mint);
        if (quote && typeof quote.priceUsd === 'string' && PRICE.test(quote.priceUsd)) {
          prices[mint] = quote.priceUsd;
          return;
        }
      } catch {
        /* Unpriced tokens stay out of the dollar graph. */
      }
      const peg = pegFor(mint, read.cluster);
      if (peg) prices[mint] = peg;
    }));
  }
  const built = buildPortfolio({ cluster: read.cluster, wallets: read.wallets, prices });
  return {
    ...built,
    truncated: read.truncated,
    fetchedAt: now().toISOString(),
  };
}
