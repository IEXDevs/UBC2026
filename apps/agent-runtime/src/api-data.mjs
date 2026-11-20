/**
 * Live /api/* data routes backed by Supabase + Privy when secrets exist.
 * Without secrets, returns empty items with source: 'unconfigured' (not a fake DB).
 */
import { createPrivyWalletClientFromEnv } from '@ubc2026/wallets/privy';
import { ownerAuthStatus, resolveOwner } from './owner-auth.mjs';
import {
  ConfigError,
  solanaSpendAsset,
  httpsAvatarUrl,
  normalizeDisplayName,
  normalizeHandle,
  lookupHandleFilter,
  lookupHandleKey,
  parseLookupQuery,
  postgrestEq,
  publicDisplayName,
} from '@ubc2026/contracts';
import { createSnsResolver, resolveSnsOwner, SnsError } from '@ubc2026/sns';
import { accountWriteBodies, WalletError } from '@ubc2026/wallets';
import {
  amountText,
  createSupabaseRpc,
  mapBotRow,
  mapWalletRow,
  supabaseConfig,
  supabaseGet,
  supabaseWrite,
} from './supabase-rest.mjs';
import { readBotAlerts } from './bot-alerts.mjs';
import { createOpenRouterFromEnv, OpenRouterError } from './openrouter.mjs';
import { BLOCKED_TURN, parseTurnVerdict, turnVerifyTask } from '@ubc2026/verify-consensus/turn';
import {
  mapTransferRow,
  platformProposal,
  transferErrorCode,
  transferRequest,
} from './platform-transfer.mjs';
import {
  BALANCE_READ_FAILED,
  classifyBalanceRead,
  readWalletBalancesAcrossClusters,
  unavailableBalanceLabel,
} from '@ubc2026/wallets/balances';
import {
  deskSpendAllowed,
  newDeskGrant,
  parseDeskVerifier,
  passwordMatches,
  sha256Hex,
} from './desk-grant.mjs';
import { spendLedgerCrossCheck, streamConfirmedPayments } from '@ubc2026/quicknode-streams';
import { handleAccountRoute } from './account-state.mjs';

const ACCOUNT_ROUTES = new Set(['state.list', 'state.write', 'recovery.status', 'recovery.issue', 'recovery.verify']);

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function deskDenied(request, env, ownerId, fetcher) {
  const desk = await deskSpendAllowed(env, request, ownerId, fetcher);
  if (desk.ok) return null;
  const status = desk.error === 'desk_lock_unavailable' ? 503 : 403;
  return json({ error: desk.error }, status);
}

function privyClient(env) {
  if (env.transferClient) return env.transferClient;
  try {
    // Workers cannot set outbound Origin — never fall through to /users/me here.
    return createPrivyWalletClientFromEnv(env, {
      fetcher: env.fetch ?? fetch,
      allowUsersMeFallback: false,
    });
  } catch (error) {
    if (error instanceof ConfigError || error?.code === 'missing_secrets') return null;
    throw error;
  }
}

const WALLET_ID = /^[a-zA-Z0-9:_-]{1,128}$/;
const WALLET_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BALANCE_CAP = 8;

function publicWallet(wallet) {
  return {
    id: wallet.id,
    ownerId: wallet.ownerId,
    kind: wallet.kind,
    label: wallet.label,
    address: wallet.address,
    provider: wallet.provider || 'privy',
    frozen: wallet.frozen === true,
    spendable: wallet.spendable !== false && !String(wallet.id).startsWith('linked_'),
    walletClientType: wallet.walletClientType || null,
  };
}

async function persistLogin(env, login, ownerId) {
  const bodies = accountWriteBodies(login, ownerId);
  if (!supabaseConfig(env) || !bodies) return;
  const fetcher = env.fetch ?? fetch;
  const userWrite = await supabaseWrite(env, {
    path: 'users',
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: bodies.user,
    fetcher,
  });
  if (!userWrite?.ok) {
    const { login_methods, ...core } = bodies.user;
    await supabaseWrite(env, {
      path: 'users',
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: core,
      fetcher,
    });
  }
  if (bodies.wallets.length) {
    const walletWrite = await supabaseWrite(env, {
      path: 'wallets',
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: bodies.wallets,
      fetcher,
    });
    if (!walletWrite?.ok) {
      await supabaseWrite(env, {
        path: 'wallets',
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: bodies.wallets.map(({ spendable, ...row }) => row),
        fetcher,
      });
    }
  }
}

function walletRowFromPublic(wallet, ownerId) {
  if (!wallet || typeof wallet !== 'object') return null;
  const id = typeof wallet.id === 'string' ? wallet.id.trim() : '';
  const address = typeof wallet.address === 'string' ? wallet.address.trim() : '';
  const kind = wallet.kind === 'additional' ? 'additional' : 'main';
  const label = typeof wallet.label === 'string' && wallet.label.trim()
    ? wallet.label.trim().slice(0, 64)
    : (kind === 'main' ? 'Main' : 'Wallet');
  if (!WALLET_ID.test(id) || !WALLET_ADDRESS.test(address)) return null;
  return {
    id,
    owner_id: ownerId,
    kind,
    label,
    address,
    provider: 'privy',
  };
}

async function persistWalletRows(env, ownerId, rows, fetcher) {
  const userWrite = await supabaseWrite(env, {
    path: 'users',
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { id: ownerId, privy_user_id: ownerId },
    fetcher,
  });
  if (!userWrite.ok) return false;
  const walletWrite = await supabaseWrite(env, {
    path: 'wallets',
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: rows,
    fetcher,
  });
  return walletWrite.ok;
}

function formatFixedUnits(amount, decimals, symbol) {
  if (typeof amount !== 'string' || !/^-?(0|[1-9][0-9]{0,39})$/.test(amount)) return null;
  const negative = amount.startsWith('-');
  const digits = negative ? amount.slice(1) : amount;
  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  const shown = fraction ? `${whole}.${fraction}` : whole;
  return `${negative ? '-' : ''}${shown} ${symbol}`;
}

/** Format USDC base units (6 decimals) for agent speech — never invent values. */
export function formatUsdcLabel(amount) {
  return formatFixedUnits(amount, 6, 'USDC');
}

/** Format SOL lamports (9 decimals) for agent speech. */
export function formatSolLabel(lamports, cluster = null) {
  const label = formatFixedUnits(lamports, 9, 'SOL');
  if (!label) return null;
  return cluster ? `${label} (${cluster})` : label;
}

function mapTransferDirection(row, ownerId) {
  if (!row || row.asset !== 'USDC') return null;
  const amount = typeof row.amount === 'number' ? String(row.amount) : String(row.amount ?? '');
  if (!/^(0|[1-9][0-9]{0,39})$/.test(amount)) return null;
  if (row.to_owner_id === ownerId || row.toOwnerId === ownerId) return { direction: 'in', amount };
  if (row.from_owner_id === ownerId || row.fromOwnerId === ownerId) return { direction: 'out', amount };
  return null;
}

/** Same net the shell wallet glance uses (platform transfers). */
async function platformUsdcNet(env, ownerId, fetcher) {
  if (!supabaseConfig(env) || !ownerId) {
    return { amount: null, label: null, transferCount: 0 };
  }
  const result = await supabaseGet(
    env,
    `platform_transfers?or=(from_owner_id.eq.${encodeURIComponent(ownerId)},to_owner_id.eq.${encodeURIComponent(ownerId)})&select=*&order=created_at.desc&limit=100`,
    fetcher,
  );
  const rows = Array.isArray(result.rows) ? result.rows : [];
  let net = 0n;
  let count = 0;
  for (const row of rows) {
    const entry = mapTransferDirection(row, ownerId);
    if (!entry) continue;
    count += 1;
    const units = BigInt(entry.amount);
    net += entry.direction === 'in' ? units : -units;
  }
  const amount = net.toString();
  return { amount, label: formatUsdcLabel(amount), transferCount: count };
}

function emptyOnchainFields(status) {
  return {
    usdcBalance: null,
    usdcBalanceLabel: null,
    usdcBalanceDecimals: 6,
    solLamports: null,
    solBalanceLabel: null,
    solDecimals: 9,
    tokens: [],
    tokensLabel: null,
    holdings: [],
    balanceStatus: status,
    cluster: null,
  };
}

function formatTokenLabel(token) {
  if (!token || typeof token !== 'object') return null;
  const symbol = typeof token.symbol === 'string' && token.symbol.trim()
    ? token.symbol.trim().slice(0, 32)
    : 'TOKEN';
  const base = formatFixedUnits(token.amount, token.decimals, symbol);
  if (!base) return null;
  return token.cluster ? `${base} (${token.cluster})` : base;
}

function publicTokens(tokens) {
  if (!Array.isArray(tokens)) return [];
  return tokens.slice(0, 48).map((token) => ({
    mint: token.mint,
    amount: token.amount,
    decimals: token.decimals,
    symbol: token.symbol,
    known: token.known === true,
    cluster: token.cluster || null,
    label: formatTokenLabel(token),
  })).filter((token) => token.label);
}

function tokensLabel(tokens) {
  const labels = publicTokens(tokens).map((token) => token.label).filter(Boolean);
  return labels.length ? labels.join(' · ') : null;
}

/** Attach whatever non-zero SOL/SPL balances exist on Solana-mainnet-beta and Solana-testnet. */
async function withOnchainBalances(env, wallets) {
  const list = Array.isArray(wallets) ? wallets : [];
  // Always hit Solana over public HTTPS (or the injected test double). Never
  // reuse a service-binding fetcher if one is later stuffed onto env.fetch.
  const fetcher = typeof env.fetch === 'function' ? env.fetch : globalThis.fetch;
  const head = list.slice(0, BALANCE_CAP);
  const enriched = await Promise.all(head.map(async (wallet) => {
    const bal = await readWalletBalancesAcrossClusters({
      address: wallet.address,
      env,
      fetcher,
    });
    const holdings = Array.isArray(bal.holdings) ? bal.holdings.filter((row) => row?.label) : [];
    const tokens = publicTokens(bal.tokens);
    const usdc = bal.usdcAmount;
    const sol = bal.solLamports;
    const solOk = typeof sol === 'string' && /^(0|[1-9][0-9]{0,39})$/.test(sol);
    const usdcOk = typeof usdc === 'string' && /^(0|[1-9][0-9]{0,39})$/.test(usdc);
    return {
      ...wallet,
      usdcBalance: usdcOk ? usdc : null,
      usdcBalanceLabel: usdcOk ? formatUsdcLabel(usdc) : null,
      usdcBalanceDecimals: 6,
      solLamports: solOk ? sol : null,
      solBalanceLabel: solOk ? formatSolLabel(sol) : null,
      solDecimals: 9,
      tokens,
      tokensLabel: tokensLabel(tokens),
      holdings,
      displayBalanceLabel: bal.displayBalanceLabel
        || holdings.map((row) => row.label).join(' · ')
        || null,
      balanceStatus: bal.ok === true || holdings.length > 0 ? 'ok' : (bal.code || 'rpc_failed'),
      cluster: bal.cluster || null,
      clusters: bal.clusters
        ? {
          solana: bal.clusters.solana?.ok === true,
          testnet: bal.clusters.testnet?.ok === true,
        }
        : null,
    };
  }));
  const rest = list.slice(BALANCE_CAP).map((wallet) => ({
    ...wallet,
    ...emptyOnchainFields('capped'),
  }));
  return [...enriched, ...rest];
}

function sumField(items, key) {
  return (Array.isArray(items) ? items : []).reduce((sum, wallet) => {
    const value = wallet?.[key];
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,39})$/.test(value)) return sum;
    return sum + BigInt(value);
  }, 0n).toString();
}

function mergeTokenHoldings(items) {
  const byMint = new Map();
  for (const wallet of Array.isArray(items) ? items : []) {
    for (const token of Array.isArray(wallet?.tokens) ? wallet.tokens : []) {
      if (!token?.mint || typeof token.amount !== 'string') continue;
      if (!/^(0|[1-9][0-9]{0,39})$/.test(token.amount) || token.amount === '0') continue;
      const existing = byMint.get(token.mint);
      if (existing) {
        existing.amount = (BigInt(existing.amount) + BigInt(token.amount)).toString();
        continue;
      }
      byMint.set(token.mint, {
        mint: token.mint,
        amount: token.amount,
        decimals: token.decimals,
        symbol: token.symbol,
        known: token.known === true,
      });
    }
  }
  return publicTokens([...byMint.values()]);
}

function joinBalanceParts(parts) {
  return parts.filter(Boolean).join(' · ') || null;
}

function walletDisplayParts(wallet) {
  if (Array.isArray(wallet?.holdings) && wallet.holdings.length) {
    return wallet.holdings.map((row) => row?.label).filter(Boolean);
  }
  const parts = [];
  if (wallet?.solLamports && wallet.solLamports !== '0' && wallet.solBalanceLabel) {
    parts.push(wallet.solBalanceLabel);
  }
  if (Array.isArray(wallet?.tokens)) {
    for (const token of wallet.tokens) {
      if (token?.label) parts.push(token.label);
    }
  } else if (wallet?.usdcBalance && wallet.usdcBalance !== '0' && wallet.usdcBalanceLabel) {
    parts.push(wallet.usdcBalanceLabel);
  }
  return parts;
}

function walletBalanceSummary(items, platform) {
  const classified = classifyBalanceRead({ items });
  const failed = classified.ok === false;
  const onchainUsdc = sumField(items, 'usdcBalance');
  const onchainSolKnown = Array.isArray(items) && items.some((wallet) => (
    typeof wallet?.solLamports === 'string' && /^(0|[1-9][0-9]{0,39})$/.test(wallet.solLamports)
  ));
  const onchainSol = onchainSolKnown ? sumField(items, 'solLamports') : null;
  const tokens = mergeTokenHoldings(items);
  const holdings = [];
  for (const wallet of Array.isArray(items) ? items : []) {
    for (const row of Array.isArray(wallet?.holdings) ? wallet.holdings : []) {
      if (row?.label) holdings.push(row);
    }
  }
  const hasPlatform = platform.transferCount > 0 && platform.amount != null;
  const hasSol = onchainSol != null && onchainSol !== '0';
  const parts = [];
  if (hasPlatform) parts.push(platform.label);
  if (holdings.length) {
    for (const row of holdings) parts.push(row.label);
  } else {
    if (hasSol) parts.push(formatSolLabel(onchainSol));
    for (const token of tokens) {
      if (token.label) parts.push(token.label);
    }
  }
  if (!parts.length) {
    if (failed) parts.push(unavailableBalanceLabel(classified.code || 'rpc_failed'));
    else parts.push(formatSolLabel(onchainSol || '0') || formatUsdcLabel(onchainUsdc || '0'));
  }
  const displayBalanceLabel = failed && !holdings.length && !hasSol
    ? unavailableBalanceLabel(classified.code || 'rpc_failed')
    : joinBalanceParts(parts);
  const displaySource = hasPlatform
    ? (hasSol || tokens.length || holdings.length ? 'mixed' : 'platform')
    : 'onchain';
  const displayUsdc = hasPlatform ? platform.amount : (failed ? null : onchainUsdc);
  return {
    platformUsdc: platform.amount,
    platformUsdcLabel: platform.label,
    platformTransferCount: platform.transferCount,
    onchainUsdc: failed && !hasPlatform ? null : onchainUsdc,
    onchainUsdcLabel: failed && !hasPlatform ? null : formatUsdcLabel(onchainUsdc),
    onchainSol,
    onchainSolLabel: onchainSol != null ? formatSolLabel(onchainSol) : null,
    balanceStatus: classified.status,
    balanceCode: classified.code,
    ok: classified.ok,
    tokens,
    tokensLabel: tokensLabel(tokens),
    holdings,
    displayUsdc,
    displayUsdcLabel: displayUsdc != null ? formatUsdcLabel(displayUsdc) : null,
    displaySol: onchainSol,
    displaySolLabel: onchainSol != null ? formatSolLabel(onchainSol) : null,
    displayBalanceLabel,
    displaySource,
  };
}

export async function handleApiData(request, env, matched) {
  const routeId = matched?.route?.id;
  if (!routeId) return null;

  const fetcher = env.fetch ?? fetch;

  if (routeId === 'me') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) {
      return json({
        ok: true,
        source: 'unconfigured',
        user: { id: ownerId, privyUserId: ownerId, loginMethods: [] },
      });
    }
    const result = await supabaseGet(env, `users?id=eq.${encodeURIComponent(ownerId)}&select=*`, fetcher);
    const row = result.rows?.[0];
    const storedMethods = Array.isArray(row?.login_methods) ? row.login_methods : [];
    return json({
      ok: true,
      source: result.configured ? 'supabase' : 'unconfigured',
      user: row
        ? { id: row.id, privyUserId: row.privy_user_id, createdAt: row.created_at, loginMethods: storedMethods }
        : { id: ownerId, privyUserId: ownerId, loginMethods: [] },
    });
  }

  if (routeId === 'wallets.list') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) {
      return json({
        ok: true,
        source: 'unconfigured',
        items: [],
        balances: walletBalanceSummary([], { amount: null, label: null, transferCount: 0 }),
      });
    }
    const result = await supabaseGet(
      env,
      `wallets?owner_id=eq.${encodeURIComponent(ownerId)}&select=*&order=created_at.asc`,
      fetcher,
    );
    const [items, platform] = await Promise.all([
      withOnchainBalances(
        env,
        (result.rows || []).map(mapWalletRow).filter(Boolean).map(publicWallet),
      ),
      platformUsdcNet(env, ownerId, fetcher),
    ]);
    const balances = walletBalanceSummary(items, platform);
    return json({
      ok: true,
      source: 'supabase',
      items: items.map((wallet) => {
        const onchainParts = walletDisplayParts(wallet);
        const displayBalanceLabel = balances.displaySource === 'platform' || balances.displaySource === 'mixed'
          ? joinBalanceParts([
            balances.platformUsdcLabel,
            ...onchainParts,
          ])
          : (joinBalanceParts(onchainParts) || balances.displayBalanceLabel);
        return {
          ...wallet,
          displayUsdc: balances.displaySource === 'platform' || balances.displaySource === 'mixed'
            ? balances.displayUsdc
            : wallet.usdcBalance,
          displayUsdcLabel: balances.displaySource === 'platform' || balances.displaySource === 'mixed'
            ? balances.displayUsdcLabel
            : (wallet.usdcBalanceLabel || balances.displayUsdcLabel),
          displaySolLabel: wallet.solBalanceLabel,
          displayBalanceLabel,
          displaySource: balances.displaySource,
        };
      }),
      balances,
    });
  }

  if (routeId === 'wallets.persist') {
    const { ownerId, token, error } = await resolveOwner(request, env);
    if (error) return json({ error: error === 'owner_required' && !request.headers.has('authorization') ? 'login_required' : error }, ownerAuthStatus(error));
    if (!token) return json({ error: 'login_required' }, 401);
    if (!supabaseConfig(env)) return json({ error: 'unconfigured' }, 503);
    const body = await request.json().catch(() => null);
    const requested = Array.isArray(body?.wallets) ? body.wallets
      .map(wallet => walletRowFromPublic(wallet, ownerId)).filter(Boolean).slice(0, 20) : [];
    if (!requested.length) return json({ error: 'invalid_wallets' }, 400);
    const client = privyClient(env);
    if (!client?.ensureMainWallet) return json({ error: 'signer_not_configured' }, 503);
    let owned;
    try {
      const { main, additional = [] } = await client.ensureMainWallet({ privyUserId: ownerId, ownerId });
      owned = new Map([main, ...additional].filter(wallet => wallet?.ownerId === ownerId).map(wallet => [wallet.id, wallet]));
    } catch {
      return json({ error: 'wallet_directory_unavailable' }, 502);
    }
    if (!requested.every(wallet => owned.get(wallet.id)?.address === wallet.address)) {
      return json({ error: 'wallet_not_owned' }, 403);
    }
    const rows = [...new Set(requested.map(wallet => wallet.id))]
      .map(id => walletRowFromPublic(owned.get(id), ownerId));
    if (!await persistWalletRows(env, ownerId, rows, fetcher)) return json({ error: 'wallet_persist_failed' }, 502);
    const listed = await supabaseGet(
      env,
      `wallets?owner_id=eq.${encodeURIComponent(ownerId)}&select=*&order=created_at.asc`,
      fetcher,
    );
    return json({
      ok: true,
      source: 'supabase',
      wrote: rows.length,
      wallets: (listed.rows || []).map(mapWalletRow).filter(Boolean).map(publicWallet),
    });
  }

  if (routeId === 'wallets.create') {
    const { ownerId, token, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!token) return json({ error: 'login_required' }, 401);
    const client = privyClient(env);
    if (!client?.acceptLogin) return json({ error: 'signer_not_configured' }, 503);
    try {
      // Do not pass Origin — Workers forbid that outbound header.
      const login = await client.acceptLogin({
        accessToken: token,
        ownerId: ownerId || undefined,
      });
      const owner = ownerId || login.main?.ownerId;
      await persistLogin(env, login, owner);
      return json({
        ok: true,
        created: login.created === true,
        wallets: [login.main, ...(login.additional || [])].filter(Boolean).map(publicWallet),
        loginMethods: login.loginMethods || [],
      });
    } catch (err) {
      const code = err instanceof WalletError ? err.code : 'wallet_failed';
      const status = code === 'missing_config' || code === 'missing_secrets' || code === 'missing_origin' ? 503 : 502;
      const detail = typeof err?.message === 'string'
        ? err.message.replace(/[\r\n]+/g, ' ').slice(0, 180)
        : undefined;
      return json(detail ? { error: code, detail } : { error: code }, status);
    }
  }

  if (routeId === 'wallets.sign') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    const denied = await deskDenied(request, env, ownerId, fetcher);
    if (denied) return denied;
    const client = privyClient(env);
    if (!client) return json({ error: 'signer_not_configured' }, 503);
    const walletId = matched.params?.walletId;
    const body = await request.json().catch(() => ({}));
    if (!body?.transaction || typeof body.transaction !== 'string') {
      return json({ error: 'transaction_required' }, 400);
    }
    const loaded = await supabaseGet(
      env,
      `wallets?id=eq.${encodeURIComponent(walletId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=*`,
      fetcher,
    );
    const wallet = mapWalletRow(loaded.rows?.[0]);
    if (!wallet || wallet.ownerId !== ownerId) return json({ error: 'wallet_not_found' }, 404);
    if (wallet.spendable === false || String(wallet.id).startsWith('linked_')) {
      return json({ error: 'observing_wallet' }, 400);
    }
    try {
      const bot = body.bot && mapBotRow((await supabaseGet(
        env,
        `bots?${postgrestEq('id', body.bot.id)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=*`,
        fetcher,
      )).rows?.[0]);
      if (body.bot && (!bot || bot.ownerId !== ownerId || bot.walletId !== wallet.id)) {
        return json({ error: 'bot_not_found' }, 404);
      }
      const sent = bot
        ? await client.signAndBroadcastSolana({ bot, wallet, transaction: body.transaction })
        : await client.signAndBroadcastOwnerSolana({ ownerId, wallet, transaction: body.transaction });
      return json({ ok: true, ...sent });
    } catch (err) {
      const code = err instanceof WalletError ? err.code : err?.code || 'sign_failed';
      return json({ error: code }, 400);
    }
  }

  if (routeId === 'wallets.export') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    const denied = await deskDenied(request, env, ownerId, fetcher);
    if (denied) return denied;
    const client = privyClient(env);
    if (!client?.exportOwnerWallet) return json({ error: 'signer_not_configured' }, 503);
    const walletId = matched.params?.walletId;
    const body = await request.json().catch(() => ({}));
    const recipientPublicKey = typeof body?.recipientPublicKey === 'string' ? body.recipientPublicKey : '';
    if (!supabaseConfig(env)) return json({ error: 'wallet_not_found' }, 404);
    const loaded = await supabaseGet(
      env,
      `wallets?id=eq.${encodeURIComponent(walletId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=*`,
      fetcher,
    );
    const wallet = mapWalletRow(loaded.rows?.[0]);
    if (!wallet) return json({ error: 'wallet_not_found' }, 404);
    try {
      const exported = await client.exportOwnerWallet({ ownerId, wallet, recipientPublicKey });
      return json({
        ok: true,
        encryptionType: 'HPKE',
        encapsulatedKey: exported.encapsulatedKey,
        ciphertext: exported.ciphertext,
      });
    } catch (err) {
      const code = err instanceof WalletError ? err.code : 'export_failed';
      return json({ error: code }, 400);
    }
  }

  if (routeId === 'bots.list') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) return json({ ok: true, source: 'unconfigured', items: [] });
    const result = await supabaseGet(
      env,
      `bots?owner_id=eq.${encodeURIComponent(ownerId)}&select=*&order=created_at.asc`,
      fetcher,
    );
    return json({
      ok: true,
      source: 'supabase',
      items: (result.rows || []).map(mapBotRow).filter(Boolean),
    });
  }

  if (routeId === 'bots.create') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) return json({ error: 'unconfigured' }, 503);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'invalid_body' }, 400);

    const botId = typeof body.id === 'string' ? body.id.trim() : '';
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    const goal = typeof body.goal === 'string' && body.goal.trim()
      ? body.goal.trim().slice(0, 2000)
      : 'Waiting for a goal.';
    const type = typeof body.type === 'string' ? body.type.trim() : 'trading';
    const walletId = typeof body.walletId === 'string' ? body.walletId.trim() : '';
    const approvalMode = typeof body.approvalMode === 'string' ? body.approvalMode.trim() : 'ask';
    const TYPES = new Set(['trading', 'shopping', 'position-management']);
    const MODES = new Set(['ask', 'fully-automatic', 'capped-automatic']);
    if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(botId) || !name || !TYPES.has(type) || !MODES.has(approvalMode)) {
      return json({ error: 'invalid_bot' }, 400);
    }
    if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(walletId)) return json({ error: 'wallet_required' }, 400);

    const walletLookup = await supabaseGet(
      env,
      `wallets?id=eq.${encodeURIComponent(walletId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=id,frozen`,
      fetcher,
    );
    const walletRow = walletLookup.rows?.[0];
    if (!walletRow?.id) return json({ error: 'wallet_not_found' }, 404);
    if (walletRow.frozen === true) return json({ error: 'wallet_frozen' }, 400);

    await supabaseWrite(env, {
      path: 'users',
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: { id: ownerId, privy_user_id: ownerId },
      fetcher,
    });

    const capMode = body.cap?.mode === 'unlimited' ? 'unlimited' : 'limited';
    const rawCapAsset = typeof body.cap?.asset === 'string' ? body.cap.asset.trim() : '';
    const capAsset = solanaSpendAsset(rawCapAsset) || rawCapAsset.slice(0, 32) || 'USDC';
    const row = {
      id: botId,
      owner_id: ownerId,
      wallet_id: walletId,
      name,
      goal,
      type,
      approval_mode: approvalMode,
      auto_approve_cap: body.autoApproveCap != null ? body.autoApproveCap : null,
      template_id: typeof body.templateId === 'string' ? body.templateId : null,
      enabled: body.enabled !== false,
      frozen: body.frozen === true,
      policy_version: 1,
      cap_mode: capMode,
      cap_asset: capAsset,
      max_outflow: capMode === 'limited' && type !== 'position-management'
        ? (body.cap?.maxOutflow ?? '1000000')
        : null,
      max_per_transaction: capMode === 'limited' && type !== 'position-management'
        ? (body.cap?.maxPerTransaction ?? '1000000')
        : null,
      max_loss: type === 'position-management'
        ? (body.cap?.maxLoss ?? '1000000')
        : null,
    };

    let written = await supabaseWrite(env, {
      path: 'bots',
      method: 'POST',
      prefer: 'resolution=ignore-duplicates,return=representation',
      body: row,
      fetcher,
    });
    if (written.code === 'PT410') return json({ error: 'agent_deleted' }, 410);
    if (written.ok === false) return json({ error: 'persist_failed' }, 502);
    if (Array.isArray(written.rows) && written.rows.length === 0) {
      const { id, owner_id, ...changes } = row;
      written = await supabaseWrite(env, {
        path: `bots?${postgrestEq('id', id)}&${postgrestEq('owner_id', owner_id)}`,
        method: 'PATCH',
        body: changes,
        fetcher,
      });
      if (!written.ok) return json({ error: 'persist_failed' }, 502);
      if (!written.rows?.length) return json({ error: 'bot_id_conflict' }, 409);
    }

    await supabaseWrite(env, {
      path: 'spend_ledgers',
      method: 'POST',
      prefer: 'resolution=ignore-duplicates,return=minimal',
      body: {
        bot_id: botId,
        asset: capAsset,
        spent: 0,
        reserved: 0,
        realized_loss: 0,
      },
      fetcher,
    });

    const persisted = Array.isArray(written.rows) && written.rows[0]
      ? mapBotRow(written.rows[0])
      : mapBotRow(row);
    return json({ ok: true, source: 'supabase', bot: persisted });
  }

  if (routeId === 'bots.delete') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    const botId = matched?.params?.botId;
    if (typeof botId !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(botId)) {
      return json({ error: 'invalid_bot' }, 400);
    }
    if (!supabaseConfig(env)) return json({ error: 'unconfigured' }, 503);

    const owner = encodeURIComponent(ownerId);
    const removed = await supabaseWrite(env, {
      path: 'rpc/delete_owner_agent',
      body: { p_owner_id: ownerId, p_bot_id: botId },
      prefer: 'return=minimal',
      fetcher,
    });
    if (removed.ok) return json({ ok: true, deleted: botId, source: 'supabase' });
    if (removed.status !== 404 || removed.code !== 'PGRST202') {
      return json({ error: 'delete_failed' }, 502);
    }

    // An older database still supports deletion, but cannot record a tombstone.
    const bot = encodeURIComponent(botId);
    const existing = await supabaseGet(env, `bots?id=eq.${bot}&owner_id=eq.${owner}&select=id`, fetcher);
    if (existing.status !== 200 || !Array.isArray(existing.rows)) return json({ error: 'delete_failed' }, 502);
    if (!existing.rows.length) return json({ ok: true, deleted: botId });

    const dependents = [
      'budget_reservations', 'spend_ledgers', 'approvals', 'decision_records',
      'timeline_events', 'payments', 'metrics', 'stream_events',
    ].map(table => `${table}?bot_id=eq.${bot}`);
    dependents.push(`activity_logs?bot_id=eq.${bot}&owner_id=eq.${owner}`);
    for (const path of dependents) {
      const cleared = await supabaseWrite(env, { path, method: 'DELETE', prefer: 'return=minimal', fetcher });
      if (cleared.configured && cleared.status >= 400 && cleared.status !== 404) {
        return json({ error: 'delete_failed', detail: path.split('?')[0] }, 502);
      }
    }
    const legacy = await supabaseWrite(env, {
      path: `bots?id=eq.${bot}&owner_id=eq.${owner}`,
      method: 'DELETE',
      prefer: 'return=minimal',
      fetcher,
    });
    if (!legacy.ok) return json({ error: 'delete_failed' }, 502);
    return json({ ok: true, deleted: botId, source: 'supabase' });
  }

  if (routeId === 'bots.chat') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    const botId = matched?.params?.botId;
    if (typeof botId !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(botId)) {
      return json({ error: 'invalid_bot' }, 400);
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({ error: 'invalid_body' }, 400);
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message || message.length > 4000) return json({ error: 'message_required' }, 400);
    const history = Array.isArray(body.history) ? body.history.slice(-16) : [];

    let botName = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : 'Agent';
    let botGoal = typeof body.goal === 'string' && body.goal.trim() ? body.goal.trim().slice(0, 2000) : 'Waiting for a goal.';
    let botType = typeof body.type === 'string' && body.type.trim() ? body.type.trim().slice(0, 40) : 'trading';

    // Prefer Supabase identity when the bot is stored; otherwise use client name/goal
    // so locally created roster bots can still chat before they are persisted.
    if (supabaseConfig(env)) {
      const loaded = await supabaseGet(
        env,
        `bots?id=eq.${encodeURIComponent(botId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=*`,
        fetcher,
      );
      const row = mapBotRow(loaded.rows?.[0]);
      if (row) {
        botName = row.name || botName;
        botGoal = row.goal || botGoal;
        botType = row.type || botType;
      }
    }

    const openrouter = typeof env.openRouter === 'object' && env.openRouter
      ? env.openRouter
      : createOpenRouterFromEnv(env, fetcher);
    try {
      const reply = await openrouter.chat({
        botName,
        botGoal,
        botType,
        history,
        message,
      });
      const verdict = await openrouter.complete({
        role: 'verify',
        goal: botGoal,
        task: turnVerifyTask('reply', reply.text),
      });
      const text = parseTurnVerdict(verdict.text).allow ? reply.text : BLOCKED_TURN;
      return json({
        ok: true,
        botId,
        reply: text,
        model: reply.model,
      });
    } catch (err) {
      const code = err instanceof OpenRouterError ? err.code : 'chat_failed';
      const status = err instanceof OpenRouterError ? err.status : 502;
      return json({ error: code }, status);
    }
  }

  if (routeId === 'logs.list') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) return json({ ok: true, source: 'unconfigured', items: [] });
    const url = new URL(request.url);
    const botId = url.searchParams.get('botId');
    const requested = Number(url.searchParams.get('limit'));
    const limit = Number.isInteger(requested) && requested >= 1 && requested <= 100 ? requested : 100;
    let path = `activity_logs?owner_id=eq.${encodeURIComponent(ownerId)}&select=*&order=created_at.desc&limit=${limit}`;
    if (botId && /^[a-zA-Z0-9:_-]{1,128}$/.test(botId)) {
      path += `&bot_id=eq.${encodeURIComponent(botId)}`;
    }
    const result = await supabaseGet(env, path, fetcher);
    return json({
      ok: true,
      source: 'supabase',
      items: (result.rows || []).map((row) => ({
        id: row.id,
        ownerId: row.owner_id,
        botId: row.bot_id,
        source: row.source,
        action: row.action,
        status: row.status,
        detail: row.detail ?? {},
        at: row.created_at,
      })),
    });
  }

  if (routeId === 'events.list') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    const url = new URL(request.url);
    const botId = url.searchParams.get('botId');
    const local = await readBotAlerts(env, botId, ownerId);
    if (!supabaseConfig(env)) {
      return json({
        ok: true,
        source: local.length > 0 ? 'bot' : 'unconfigured',
        items: local,
      });
    }
    let path = `timeline_events?owner_id=eq.${encodeURIComponent(ownerId)}&select=*&order=at.desc&limit=100`;
    if (botId) path = `timeline_events?owner_id=eq.${encodeURIComponent(ownerId)}&bot_id=eq.${encodeURIComponent(botId)}&select=*&order=at.desc&limit=100`;
    const result = await supabaseGet(env, path, fetcher);
    const remote = (result.rows || []).map((row) => ({
      id: row.id,
      botId: row.bot_id,
      ownerId: row.owner_id,
      kind: row.kind,
      summary: row.summary,
      prevHash: row.prev_hash,
      at: row.at,
    }));
    const seen = new Set(remote.map(event => event.id));
    const items = remote.slice();
    for (const event of local) {
      if (!seen.has(event.id)) items.push(event);
    }
    return json({
      ok: true,
      source: 'supabase',
      items,
    });
  }

  if (routeId === 'decisions.list') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) return json({ ok: true, source: 'unconfigured', items: [] });
    const url = new URL(request.url);
    const botId = url.searchParams.get('botId');
    // decisions don't store owner_id — join via bots owned by this owner
    const bots = await supabaseGet(
      env,
      `bots?owner_id=eq.${encodeURIComponent(ownerId)}&select=id`,
      fetcher,
    );
    const ids = (bots.rows || []).map((row) => row.id).filter(Boolean);
    if (!ids.length) return json({ ok: true, source: 'supabase', items: [] });
    const filter = botId && ids.includes(botId) ? botId : ids.join(',');
    const path = botId && ids.includes(botId)
      ? `decision_records?bot_id=eq.${encodeURIComponent(botId)}&select=*&order=created_at.desc&limit=100`
      : `decision_records?bot_id=in.(${ids.map(encodeURIComponent).join(',')})&select=*&order=created_at.desc&limit=100`;
    const result = await supabaseGet(env, path, fetcher);
    return json({
      ok: true,
      source: 'supabase',
      items: (result.rows || []).map((row) => ({
        id: row.id,
        botId: row.bot_id,
        runId: row.run_id,
        cluster: row.cluster,
        factsDigest: row.facts_digest,
        proposalDigest: row.proposal_digest,
        status: row.status,
        memoSignature: row.memo_signature,
        createdAt: row.created_at,
      })),
      filter,
    });
  }

  if (routeId === 'payments.list') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    // Empty until a QuickNode Stream row exists. No Supabase config means no read and no invented rows.
    if (!supabaseConfig(env)) return json({ ok: true, source: 'unconfigured', items: [], crossCheck: [] });
    const botsResult = await supabaseGet(
      env,
      `bots?owner_id=eq.${encodeURIComponent(ownerId)}&select=id,wallet_id`,
      fetcher,
    );
    const walletsResult = await supabaseGet(
      env,
      `wallets?owner_id=eq.${encodeURIComponent(ownerId)}&select=id,address,owner_id`,
      fetcher,
    );
    const bots = (botsResult.rows || []).filter((row) => row?.id);
    const wallets = (walletsResult.rows || []).filter((row) => row?.id && row?.address);
    const url = new URL(request.url);
    const requestedBot = url.searchParams.get('botId');
    const visibleBots = requestedBot && bots.some((row) => row.id === requestedBot)
      ? bots.filter((row) => row.id === requestedBot)
      : bots;
    if (!visibleBots.length && !wallets.length) {
      return json({ ok: true, source: 'supabase', items: [], crossCheck: [] });
    }
    const botIds = bots.map((row) => row.id);
    const addresses = [...new Set(wallets.map((row) => row.address))];
    const filters = [];
    if (addresses.length) filters.push(`wallet.in.(${addresses.map(encodeURIComponent).join(',')})`);
    if (botIds.length) filters.push(`bot_id.in.(${botIds.map(encodeURIComponent).join(',')})`);
    const eventsResult = filters.length
      ? await supabaseGet(
        env,
        `stream_events?or=(${filters.join(',')})&select=signature,wallet,bot_id,event_type,amount,token,cluster&order=processed_at.desc&limit=200`,
        fetcher,
      )
      : { rows: [] };
    const events = eventsResult.rows || [];
    const botLinks = bots.map((bot) => ({
      id: bot.id,
      walletAddress: wallets.find((wallet) => wallet.id === bot.wallet_id)?.address || null,
    }));
    const items = streamConfirmedPayments(events, { bots: botLinks })
      .filter((row) => !requestedBot || row.botId === requestedBot);
    const ledgerResult = botIds.length
      ? await supabaseGet(
        env,
        `spend_ledgers?bot_id=in.(${botIds.map(encodeURIComponent).join(',')})&select=bot_id,asset,spent,reserved`,
        fetcher,
      )
      : { rows: [] };
    const crossCheck = spendLedgerCrossCheck({
      events,
      wallets: wallets.map((wallet) => ({
        id: wallet.id,
        address: wallet.address,
        botIds: bots.filter((bot) => bot.wallet_id === wallet.id).map((bot) => bot.id),
      })),
      ledgers: ledgerResult.rows || [],
    });
    return json({
      ok: true,
      source: 'supabase',
      items,
      crossCheck,
    });
  }

  if (routeId === 'positions.list') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) return json({ ok: true, source: 'unconfigured', items: [], checks: [] });
    const url = new URL(request.url);
    const botId = url.searchParams.get('botId');
    let path = `paper_positions?owner_id=eq.${encodeURIComponent(ownerId)}&status=eq.open&select=*&order=updated_at.desc&limit=100`;
    let checksPath = `position_checks?owner_id=eq.${encodeURIComponent(ownerId)}&select=id,bot_id,at,reason,status,flag,unrealized_loss_micro_usd,max_loss,created_at&order=at.desc&limit=50`;
    if (typeof botId === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(botId)) {
      // Still filter by owner_id — never trust botId alone (cross-user IDOR).
      path = `paper_positions?owner_id=eq.${encodeURIComponent(ownerId)}&bot_id=eq.${encodeURIComponent(botId)}&status=eq.open&select=*&order=updated_at.desc&limit=100`;
      checksPath = `position_checks?owner_id=eq.${encodeURIComponent(ownerId)}&bot_id=eq.${encodeURIComponent(botId)}&select=id,bot_id,at,reason,status,flag,unrealized_loss_micro_usd,max_loss,created_at&order=at.desc&limit=50`;
    }
    const [positions, checks] = await Promise.all([
      supabaseGet(env, path, fetcher),
      supabaseGet(env, checksPath, fetcher),
    ]);
    return json({
      ok: true,
      source: 'supabase',
      items: (positions.rows || []).map((row) => ({
        id: row.id,
        ownerId: row.owner_id,
        botId: row.bot_id,
        mint: row.mint,
        symbol: row.symbol,
        quantity: amountText(row.quantity),
        entryMicroUsdc: amountText(row.entry_micro_usdc),
        realizedMicroUsdc: amountText(row.realized_micro_usdc),
        status: row.status,
        mode: row.mode,
        cluster: row.cluster,
        updatedAt: row.updated_at,
      })).filter((row) => row.ownerId === ownerId),
      checks: (checks.rows || []).map((row) => ({
        id: row.id,
        botId: row.bot_id,
        at: row.at,
        reason: row.reason,
        status: row.status,
        flag: row.flag,
        unrealizedLossMicroUsd: amountText(row.unrealized_loss_micro_usd),
        maxLoss: amountText(row.max_loss),
      })),
    });
  }

  if (routeId === 'metrics.get') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) return json({ ok: true, source: 'unconfigured', items: [] });
    const result = await supabaseGet(
      env,
      `metrics?owner_id=eq.${encodeURIComponent(ownerId)}&select=*&order=updated_at.desc`,
      fetcher,
    );
    return json({
      ok: true,
      source: 'supabase',
      items: (result.rows || []).map((row) => ({
        id: row.id,
        ownerId: row.owner_id,
        botId: row.bot_id,
        decisions: row.decisions,
        transactionsExecuted: row.transactions_executed,
        mismatchesCaught: row.mismatches_caught,
        transactionsBlocked: row.transactions_blocked,
        approvalsRequested: row.approvals_requested,
        approvalsGranted: row.approvals_granted,
        x402Payments: row.x402_payments,
        pnlMicroUsdc: amountText(row.pnl_micro_usdc),
        updatedAt: row.updated_at,
      })),
    });
  }

  if (routeId === 'profiles.me' && request.method === 'GET') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) return json({ ok: true, source: 'unconfigured', profile: null });
    const result = await supabaseGet(
      env,
      `profiles?${postgrestEq('owner_id', ownerId)}&select=handle,display_name,avatar_url`,
      fetcher,
    );
    if (result.status !== 200 || !Array.isArray(result.rows)) {
      return json({ error: result.code || 'profile_read_failed' }, 502);
    }
    const row = result.rows[0];
    return json({
      ok: true,
      source: 'supabase',
      profile: row ? {
        handle: row.handle,
        displayName: row.display_name,
        avatarUrl: row.avatar_url || null,
      } : null,
    });
  }

  if (routeId === 'profiles.update') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    const body = await request.json().catch(() => ({}));
    let handle = normalizeHandle(body.handle);
    const editOnly = body.editOnly === true;
    const displayName = normalizeDisplayName(body.displayName);
    const avatarUrl = body.avatarUrl == null || body.avatarUrl === '' ? null : httpsAvatarUrl(body.avatarUrl);
    if (!handle || !displayName) return json({ error: 'invalid_profile' }, 400);
    if (body.avatarUrl && !avatarUrl) return json({ error: 'invalid_avatar' }, 400);
    if (!supabaseConfig(env)) {
      return json({ ok: true, source: 'unconfigured', profile: { handle, displayName, avatarUrl } });
    }
    if (editOnly) {
      const existing = await supabaseGet(env, `profiles?${postgrestEq('owner_id', ownerId)}&select=handle`, fetcher);
      if (existing.status !== 200 || !Array.isArray(existing.rows)) return json({ error: existing.code || 'profile_read_failed' }, 502);
      if (!existing.rows[0]?.handle) return json({ error: 'profile_not_registered' }, 409);
      handle = existing.rows[0].handle;
    }
    if (!editOnly) {
      const userWrite = await supabaseWrite(env, {
        path: 'users?on_conflict=id',
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: { id: ownerId, privy_user_id: ownerId },
        fetcher,
      });
      if (userWrite?.ok !== true) {
        return json({ error: userWrite?.code || 'profile_save_failed' }, 502);
      }
    }
    const saved = await supabaseWrite(env, {
      path: editOnly ? `profiles?${postgrestEq('owner_id', ownerId)}` : 'profiles?on_conflict=owner_id',
      method: editOnly ? 'PATCH' : 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: {
        ...(!editOnly ? { owner_id: ownerId, handle } : {}),
        display_name: displayName,
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString(),
      },
      fetcher,
    });
    if (saved.status === 409) return json({ error: 'handle_taken' }, 409);
    if (saved?.ok !== true) return json({ error: saved?.code || 'profile_save_failed' }, 502);
    const stored = await supabaseGet(
      env,
      `profiles?${postgrestEq('owner_id', ownerId)}&select=handle,display_name,avatar_url`,
      fetcher,
    );
    if (stored.status !== 200 || stored.rows?.[0]?.handle !== handle) {
      const code = stored.code || (stored.status === 200 ? 'profile_not_confirmed' : 'profile_save_failed');
      return json({ error: code }, 502);
    }
    return json({ ok: true, source: 'supabase', profile: { handle, displayName, avatarUrl } });
  }

  if (routeId === 'profiles.lookup') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    const query = new URL(request.url).searchParams.get('q') || '';
    const parsed = parseLookupQuery(query);
    if (!parsed) return json({ error: 'invalid_recipient' }, 400);
    if (parsed.kind === 'sns') {
      try {
        const resolver = createSnsResolver({
          resolveFn: typeof env.resolveSns === 'function'
            ? env.resolveSns
            : async (domain) => {
              const demo = env.SNS_DEMO_MAP && typeof env.SNS_DEMO_MAP === 'object' ? env.SNS_DEMO_MAP : {};
              if (demo[domain]) return demo[domain];
              const resolved = await resolveSnsOwner(domain, { fetcher });
              return resolved.address;
            },
        });
        const resolved = await resolver(parsed.domain);
        return json({
          ok: true,
          recipient: { kind: 'sns', domain: resolved.domain, address: resolved.address },
        });
      } catch (err) {
        const code = err instanceof SnsError ? 'sns_not_found' : 'sns_failed';
        return json({ error: code, recipient: { kind: 'sns', domain: parsed.domain } }, 404);
      }
    }
    if (!supabaseConfig(env)) {
      return json({ error: 'directory_unconfigured' }, 503);
    }
    const columns = 'owner_id,handle,display_name,avatar_url';
    const exactHandle = normalizeHandle(query) || parsed.handle;
    const exact = await supabaseGet(env, `profiles?${postgrestEq('handle', exactHandle)}&select=${columns}&limit=1`, fetcher);
    if (exact.status !== 200 || !Array.isArray(exact.rows)) {
      return json({ error: exact.code || 'profile_read_failed' }, 502);
    }
    let row = exact.rows[0];
    if (!row && !exactHandle.includes('_')) {
      const found = await supabaseGet(env, `profiles?${lookupHandleFilter(parsed.handle)}&select=${columns}&limit=2`, fetcher);
      if (found.status !== 200 || !Array.isArray(found.rows)) {
        return json({ error: found.code || 'profile_read_failed' }, 502);
      }
      if (found.rows.length > 1) return json({ error: 'ambiguous_handle' }, 409);
      row = found.rows[0];
    }
    if (!row) return json({ ok: true, source: 'supabase', recipient: { kind: 'handle', handle: parsed.handle, missing: true } });
    if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(row.owner_id || '') || lookupHandleKey(row.handle) !== parsed.handle) {
      return json({ error: 'profile_read_failed' }, 502);
    }
    const wallet = await supabaseGet(
      env,
      `wallets?owner_id=eq.${encodeURIComponent(row.owner_id)}&kind=eq.main&select=address&limit=1`,
      fetcher,
    );
    if (wallet.status !== 200 || !Array.isArray(wallet.rows)) {
      return json({ error: 'recipient_wallet_lookup_failed' }, 502);
    }
    return json({
      ok: true,
      source: 'supabase',
      recipient: {
        kind: 'handle',
        handle: row.handle,
        displayName: publicDisplayName(row.display_name) || `@${row.handle}`,
        avatarUrl: row.avatar_url || null,
        self: row.owner_id === ownerId,
        missing: false,
        address: WALLET_ADDRESS.test(wallet.rows[0]?.address || '') ? wallet.rows[0].address : null,
      },
    });
  }

  if (routeId === 'transfers.list') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) return json({ ok: true, source: 'unconfigured', items: [] });
    const owner = encodeURIComponent(ownerId);
    const result = await supabaseGet(
      env,
      `platform_transfers?or=(from_owner_id.eq.${owner},to_owner_id.eq.${owner})&select=*&order=created_at.desc&limit=50`,
      fetcher,
    );
    return json({
      ok: true,
      source: 'supabase',
      items: (result.rows || []).map(row => mapTransferRow(row, ownerId)).filter(Boolean),
    });
  }

  if (routeId === 'transfers.create') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    const denied = await deskDenied(request, env, ownerId, fetcher);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    const requestBody = transferRequest(body);
    if (!requestBody) return json({ error: 'invalid_transfer' }, 400);
    if (!supabaseConfig(env)) return json({ ok: false, error: 'unconfigured', source: 'unconfigured' }, 503);
    const rpc = createSupabaseRpc(env, fetcher);
    if (requestBody.botId) {
      const bot = await supabaseGet(
        env,
        `bots?id=eq.${encodeURIComponent(requestBody.botId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=id`,
        fetcher,
      );
      if (bot.rows?.[0]) {
        let decision;
        try {
          decision = await rpc('policy_reserve_budget', {
            payload: platformProposal({
              ownerId,
              botId: requestBody.botId,
              handle: requestBody.handle,
              amount: requestBody.amount,
              idempotencyKey: requestBody.idempotencyKey,
              now: Date.now(),
            }),
          });
        } catch (err) {
          return json({ error: 'policy_failed' }, 502);
        }
        if (decision?.state !== 'reserved') {
          return json({
            ok: false,
            error: 'policy_blocked',
            state: decision?.state || 'blocked',
            reason: decision?.reason || null,
          }, 409);
        }
      }
    }
    try {
      const posted = await rpc('platform_post_transfer', {
        payload: {
          ownerId,
          handle: requestBody.handle,
          amount: requestBody.amount,
          idempotencyKey: requestBody.idempotencyKey,
          botId: requestBody.botId,
        },
      });
      const transfer = mapTransferRow(posted?.transfer, ownerId);
      if (!transfer) return json({ error: 'transfer_failed' }, 502);
      return json({ ok: true, source: 'supabase', replay: posted.replay === true, transfer });
    } catch (err) {
      return json({ error: transferErrorCode(err) }, 409);
    }
  }

  if (routeId === 'bots.freeze') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) return json({ error: 'unconfigured' }, 503);
    const raw = await request.text();
    let body;
    try {
      body = raw === '' ? {} : JSON.parse(raw);
    } catch {
      return json({ error: 'invalid_freeze_request' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)
        || ('frozen' in body && typeof body.frozen !== 'boolean')
        || ('botId' in body && (typeof body.botId !== 'string' || !WALLET_ID.test(body.botId)))) {
      return json({ error: 'invalid_freeze_request' }, 400);
    }
    const { botId, frozen: freeze = true } = body;
    const filter = botId ? `&id=eq.${encodeURIComponent(botId)}` : '';
    const listed = await supabaseGet(
      env,
      `bots?owner_id=eq.${encodeURIComponent(ownerId)}&select=id${filter}`,
      fetcher,
    );
    if (listed.status !== 200 || !Array.isArray(listed.rows)) {
      return json({ error: 'freeze_failed' }, 502);
    }
    const targets = listed.rows.filter(row => row?.id && (!botId || row.id === botId));
    if (botId && !targets.length) return json({ error: 'bot_not_found' }, 404);
    const rpc = createSupabaseRpc(env, fetcher);
    const fn = freeze ? 'policy_freeze_bot' : 'policy_unfreeze_bot';
    const items = [];
    let failures = 0;
    for (const row of targets) {
      try {
        const item = await rpc(fn, {
          payload: { ownerId, botId: row.id, now: Date.now() },
        });
        if (item?.botId === row.id && item.frozen === freeze) items.push(item);
        else failures += 1;
      } catch {
        failures += 1;
      }
    }
    if (failures) {
      return json({ error: 'freeze_failed', frozen: freeze, count: items.length, items }, 502);
    }
    return json({ ok: true, source: 'supabase', frozen: freeze, count: items.length, items });
  }

  if (routeId === 'desk.status') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) return json({ ok: true, source: 'unconfigured', locked: false });
    const existing = await supabaseGet(
      env,
      `desk_locks?owner_id=eq.${encodeURIComponent(ownerId)}&select=owner_id`,
      fetcher,
    );
    if (existing.status !== 200 || !Array.isArray(existing.rows)) {
      return json({ error: 'desk_lock_unavailable' }, 503);
    }
    return json({ ok: true, source: 'supabase', locked: Boolean(existing.rows[0]) });
  }

  if (routeId === 'desk.lock') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    const body = await request.json().catch(() => null);
    const verifier = parseDeskVerifier(body);
    if (!verifier) return json({ error: 'invalid_verifier' }, 400);
    if (!supabaseConfig(env)) return json({ error: 'unconfigured' }, 503);
    const existing = await supabaseGet(
      env,
      `desk_locks?owner_id=eq.${encodeURIComponent(ownerId)}&select=owner_id`,
      fetcher,
    );
    if (existing.status !== 200 || !Array.isArray(existing.rows)) {
      return json({ error: 'desk_lock_unavailable' }, 503);
    }
    if (existing.rows[0]) {
      if (body.replace !== true) return json({ error: 'desk_lock_exists' }, 409);
      const proof = typeof body.proof === 'string' ? body.proof.trim().toLowerCase() : '';
      if (!/^[0-9a-f]{64}$/.test(proof)) return json({ error: 'recovery_required' }, 401);
      const recovery = await supabaseGet(
        env,
        `owner_recovery?owner_id=eq.${encodeURIComponent(ownerId)}&select=verifier_hash`,
        fetcher,
      );
      if (recovery.status !== 200 || !Array.isArray(recovery.rows)) {
        return json({ error: 'desk_lock_unavailable' }, 503);
      }
      const stored = recovery.rows[0]?.verifier_hash;
      if (typeof stored !== 'string' || !/^[0-9a-f]{64}$/.test(stored)) {
        return json({ error: 'recovery_missing' }, 404);
      }
      let diff = 0;
      for (let index = 0; index < proof.length; index += 1) {
        diff |= proof.charCodeAt(index) ^ stored.charCodeAt(index);
      }
      if (diff !== 0) return json({ error: 'recovery_mismatch' }, 401);
      const replaced = await supabaseWrite(env, {
        path: `desk_locks?owner_id=eq.${encodeURIComponent(ownerId)}`,
        method: 'PATCH',
        prefer: 'return=minimal',
        body: {
          salt: verifier.salt,
          hash: verifier.hash,
          iterations: verifier.iterations,
          grant_hash: null,
          grant_until: null,
        },
        fetcher,
      });
      if (replaced?.ok !== true) return json({ error: 'desk_lock_failed' }, 502);
      return json({ ok: true, replaced: true });
    }
    const userWrite = await supabaseWrite(env, {
      path: 'users?on_conflict=id',
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: { id: ownerId, privy_user_id: ownerId },
      fetcher,
    });
    if (userWrite?.ok !== true) return json({ error: 'desk_lock_failed' }, 502);
    const written = await supabaseWrite(env, {
      path: 'desk_locks',
      method: 'POST',
      prefer: 'return=minimal',
      body: {
        owner_id: ownerId,
        salt: verifier.salt,
        hash: verifier.hash,
        iterations: verifier.iterations,
      },
      fetcher,
    });
    if (written?.ok !== true) return json({ error: 'desk_lock_failed' }, 502);
    return json({ ok: true });
  }

  if (routeId === 'desk.unlock') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    const body = await request.json().catch(() => null);
    const password = body && typeof body.password === 'string' ? body.password : '';
    if (!supabaseConfig(env)) return json({ error: 'unconfigured' }, 503);
    const existing = await supabaseGet(
      env,
      `desk_locks?owner_id=eq.${encodeURIComponent(ownerId)}&select=salt,hash,iterations`,
      fetcher,
    );
    if (existing.status !== 200 || !Array.isArray(existing.rows)) {
      return json({ error: 'desk_lock_unavailable' }, 503);
    }
    const row = existing.rows[0];
    if (!row) return json({ error: 'desk_lock_missing' }, 404);
    let matches = false;
    try {
      matches = await passwordMatches(password, {
        salt: row.salt,
        hash: row.hash,
        iterations: row.iterations,
      });
    } catch (error) {
      if (error?.code === 'password_check_unsupported') {
        return json({ error: 'password_check_unsupported' }, 409);
      }
      throw error;
    }
    if (!matches) return json({ error: 'desk_locked' }, 401);
    const grant = newDeskGrant();
    const grantHash = await sha256Hex(grant);
    const untilMs = Date.now() + (30 * 60 * 1000);
    const saved = await supabaseWrite(env, {
      path: `desk_locks?owner_id=eq.${encodeURIComponent(ownerId)}`,
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { grant_hash: grantHash, grant_until: new Date(untilMs).toISOString() },
      fetcher,
    });
    if (saved?.ok !== true) return json({ error: 'desk_lock_failed' }, 502);
    return json({ ok: true, grant, until: untilMs });
  }

  if (ACCOUNT_ROUTES.has(routeId)) {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error) return json({ error }, ownerAuthStatus(error));
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    return handleAccountRoute(routeId, request, env, ownerId, fetcher);
  }

  return null;
}
