/**
 * Solana-devnet wallet balance reads (native SOL + every non-zero SPL / Token-2022).
 * Shared by the Worker and the Next text-chat tool path. Never returns the RPC URL.
 */
import { DEVNET_GENESIS_HASH, DEVNET_USDC_MINT } from './privy.mjs';

export const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const TOKEN_ACCOUNT_CAP = 48;
const TOKEN_RESULT_CAP = 24;
const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const integerAmount = /^(0|[1-9][0-9]{0,39})$/;

const KNOWN_MINTS = Object.freeze({
  [DEVNET_USDC_MINT]: Object.freeze({ symbol: 'USDC' }),
});

function rejectBalance(code, address = null) {
  return {
    ok: false,
    code,
    cluster: 'devnet',
    address,
    amount: null,
    solLamports: null,
    usdcAmount: null,
    tokens: [],
  };
}

function shortMint(mint) {
  if (typeof mint !== 'string' || mint.length < 8) return 'TOKEN';
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

async function rpcCall(fetcher, rpcUrl, method, params) {
  let response;
  try {
    response = await fetcher(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      redirect: 'error',
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

/**
 * Aggregate parsed SPL token accounts by mint. Skips zero balances and bad rows.
 */
export function parseTokenAccountsByMint(accounts, { cap = TOKEN_RESULT_CAP } = {}) {
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
    const known = KNOWN_MINTS[mint];
    const next = BigInt(tokenAmount.amount);
    const existing = byMint.get(mint);
    if (existing) {
      existing.amount = (BigInt(existing.amount) + next).toString();
      continue;
    }
    byMint.set(mint, {
      mint,
      amount: next.toString(),
      decimals: tokenAmount.decimals,
      symbol: known?.symbol || shortMint(mint),
      known: Boolean(known),
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

/**
 * Read Solana-devnet SOL + every non-zero SPL / Token-2022 balance for one wallet.
 * The RPC URL is never copied into the result.
 */
export async function readDevnetWalletBalances({ rpcUrl, address, fetcher = fetch } = {}) {
  if (typeof address !== 'string' || !base58.test(address)) {
    return rejectBalance('invalid_address', null);
  }
  if (typeof rpcUrl !== 'string' || rpcUrl.trim() === '') {
    return rejectBalance('rpc_not_configured', address);
  }
  let endpoint;
  try { endpoint = new URL(rpcUrl.trim()); } catch {
    return rejectBalance('invalid_rpc', address);
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    return rejectBalance('invalid_rpc', address);
  }
  const target = endpoint.toString();
  try {
    const genesis = await rpcCall(fetcher, target, 'getGenesisHash');
    if (genesis !== DEVNET_GENESIS_HASH) {
      return rejectBalance('wrong_cluster', address);
    }
    const encoding = { encoding: 'jsonParsed' };
    const [lamportsRaw, classic, token2022] = await Promise.all([
      rpcCall(fetcher, target, 'getBalance', [address]),
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
      return rejectBalance('rpc_rejected', address);
    }
    const classicAccounts = Array.isArray(classic?.value) ? classic.value : null;
    const token2022Accounts = Array.isArray(token2022?.value) ? token2022.value : [];
    if (!classicAccounts) {
      return {
        ...rejectBalance('rpc_rejected', address),
        solLamports: String(lamportsValue),
      };
    }
    const parsed = parseTokenAccountsByMint([...classicAccounts, ...token2022Accounts]);
    if (!parsed.ok) {
      return {
        ...rejectBalance(parsed.code, address),
        solLamports: String(lamportsValue),
      };
    }
    const usdcAmount = parsed.tokens.find((token) => token.mint === DEVNET_USDC_MINT)?.amount || '0';
    return {
      ok: true,
      code: null,
      cluster: 'devnet',
      mint: DEVNET_USDC_MINT,
      address,
      amount: usdcAmount,
      solLamports: String(lamportsValue),
      usdcAmount,
      tokens: parsed.tokens,
    };
  } catch {
    return rejectBalance('rpc_failed', address);
  }
}

/** Read Circle USDC only (compat wrapper). */
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
