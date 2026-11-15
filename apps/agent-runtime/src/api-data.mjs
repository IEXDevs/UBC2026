/**
 * Live /api/* data routes backed by Supabase + Privy when secrets exist.
 * Without secrets, returns empty items with source: 'unconfigured' (not a fake DB).
 */
import { createPrivyWalletClientFromEnv, sanitizeOrigin } from '@ubc2026/wallets/privy';
import {
  ConfigError,
  httpsAvatarUrl,
  normalizeDisplayName,
  normalizeHandle,
  parseRecipient,
} from '@ubc2026/contracts';
import { createSnsResolver, SnsError } from '@ubc2026/sns';
import { WalletError } from '@ubc2026/wallets';
import {
  amountText,
  createSupabaseRpc,
  mapBotRow,
  mapWalletRow,
  supabaseConfig,
  supabaseGet,
  supabaseWrite,
} from './supabase-rest.mjs';
import { createOpenRouterFromEnv, OpenRouterError } from './openrouter.mjs';
import {
  mapTransferRow,
  platformProposal,
  transferErrorCode,
  transferRequest,
} from './platform-transfer.mjs';
import { readDevnetWalletBalances } from '@ubc2026/wallets/balances';

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function ownerHeader(request) {
  const value = request.headers.get('x-owner-id');
  if (typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(value)) return value;
  return null;
}

function bearerToken(request) {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
}

function privyClient(env) {
  if (env.transferClient) return env.transferClient;
  try {
    return createPrivyWalletClientFromEnv(env, { fetcher: env.fetch ?? fetch });
  } catch (error) {
    if (error instanceof ConfigError || error?.code === 'missing_secrets') return null;
    throw error;
  }
}

/** Browser Origin for Privy /users/me — required when creating/syncing wallets. */
function requestOrigin(request, env = {}) {
  const headerOrigin = sanitizeOrigin(request.headers.get('origin') || request.headers.get('Origin'));
  if (headerOrigin) return headerOrigin;
  const maelstrom = sanitizeOrigin(request.headers.get('x-maelstrom-origin'));
  if (maelstrom) return maelstrom;
  const referer = request.headers.get('referer') || request.headers.get('Referer');
  if (typeof referer === 'string' && referer.trim()) {
    try {
      const fromReferer = sanitizeOrigin(new URL(referer.trim()).origin);
      if (fromReferer) return fromReferer;
    } catch { /* ignore */ }
  }
  return sanitizeOrigin(env.WEB_ORIGIN || env.PRIVY_ALLOWED_ORIGIN || '');
}

async function resolveOwner(request, env) {
  const header = ownerHeader(request);
  const token = bearerToken(request);
  if (!token) return { ownerId: header, user: null, token: '' };

  const client = privyClient(env);
  if (!client?.acceptLogin) return { ownerId: header, user: null, token };

  try {
    const result = await client.acceptLogin({
      accessToken: token,
      ownerId: header || undefined,
      origin: requestOrigin(request, env),
    });
    const ownerId = header || result?.main?.ownerId || result?.userId || null;
    return { ownerId, user: result, token };
  } catch (error) {
    if (error instanceof WalletError) {
      return { ownerId: header, user: null, token, error: error.code || 'privy_failed' };
    }
    return { ownerId: header, user: null, token, error: 'privy_failed' };
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
  };
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
    provider: wallet.provider === 'privy' || !wallet.provider ? 'privy' : 'privy',
    frozen: wallet.frozen === true,
  };
}

async function persistWalletRows(env, ownerId, wallets, fetcher) {
  if (!supabaseConfig(env) || !ownerId) return { wrote: 0 };
  const rows = (Array.isArray(wallets) ? wallets : [])
    .map((wallet) => walletRowFromPublic(wallet, ownerId))
    .filter(Boolean)
    .slice(0, 20);
  if (!rows.length) return { wrote: 0 };
  await supabaseWrite(env, {
    path: 'users',
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { id: ownerId, privy_user_id: ownerId },
    fetcher,
  });
  await supabaseWrite(env, {
    path: 'wallets',
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: rows,
    fetcher,
  });
  return { wrote: rows.length };
}

async function persistLogin(env, login, ownerId) {
  if (!supabaseConfig(env) || !login?.main) return;
  const owner = ownerId || login.main.ownerId;
  const fetcher = env.fetch ?? fetch;
  await persistWalletRows(
    env,
    owner,
    [login.main, ...(login.additional || [])].filter(Boolean),
    fetcher,
  );
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

/** Format SOL lamports (9 decimals) for agent speech — Solana devnet native. */
export function formatSolLabel(lamports) {
  const label = formatFixedUnits(lamports, 9, 'SOL');
  return label ? `${label} (devnet)` : null;
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
    balanceStatus: status,
    cluster: 'devnet',
  };
}

function formatTokenLabel(token) {
  if (!token || typeof token !== 'object') return null;
  const symbol = typeof token.symbol === 'string' && token.symbol.trim()
    ? token.symbol.trim().slice(0, 32)
    : 'TOKEN';
  return formatFixedUnits(token.amount, token.decimals, symbol);
}

function publicTokens(tokens) {
  if (!Array.isArray(tokens)) return [];
  return tokens.slice(0, 24).map((token) => ({
    mint: token.mint,
    amount: token.amount,
    decimals: token.decimals,
    symbol: token.symbol,
    known: token.known === true,
    label: formatTokenLabel(token),
  })).filter((token) => token.label);
}

function tokensLabel(tokens) {
  const labels = publicTokens(tokens).map((token) => token.label).filter(Boolean);
  return labels.length ? labels.join(' · ') : null;
}

/** Attach Solana-devnet SOL + all SPL token balances for agent get_wallets. */
async function withOnchainBalances(env, wallets) {
  const list = Array.isArray(wallets) ? wallets : [];
  const rpcUrl = typeof env.QUICKNODE_DEVNET_RPC_URL === 'string' ? env.QUICKNODE_DEVNET_RPC_URL : '';
  if (!rpcUrl.trim()) {
    return list.map((wallet) => ({ ...wallet, ...emptyOnchainFields('rpc_not_configured') }));
  }
  const fetcher = env.fetch ?? fetch;
  const head = list.slice(0, BALANCE_CAP);
  const enriched = await Promise.all(head.map(async (wallet) => {
    const bal = await readDevnetWalletBalances({
      rpcUrl,
      address: wallet.address,
      fetcher,
    });
    const usdc = bal.usdcAmount;
    const sol = bal.solLamports;
    const solOk = typeof sol === 'string' && /^(0|[1-9][0-9]{0,39})$/.test(sol);
    const usdcOk = typeof usdc === 'string' && /^(0|[1-9][0-9]{0,39})$/.test(usdc);
    const tokens = publicTokens(bal.tokens);
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
      balanceStatus: bal.ok === true || solOk ? 'ok' : (bal.code || 'rpc_failed'),
      cluster: 'devnet',
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
  const onchainUsdc = sumField(items, 'usdcBalance');
  const onchainSol = sumField(items, 'solLamports');
  const tokens = mergeTokenHoldings(items);
  const hasPlatform = platform.transferCount > 0 && platform.amount != null;
  const hasSol = onchainSol !== '0';
  const parts = [];
  if (hasPlatform) parts.push(platform.label);
  if (hasSol) parts.push(formatSolLabel(onchainSol));
  for (const token of tokens) {
    if (token.label) parts.push(token.label);
  }
  if (!parts.length) {
    parts.push(formatSolLabel(onchainSol) || formatUsdcLabel(onchainUsdc));
  }
  const displayBalanceLabel = joinBalanceParts(parts);
  const displaySource = hasPlatform
    ? (hasSol || tokens.length ? 'mixed' : 'platform')
    : (tokens.length || hasSol ? 'onchain' : 'onchain');
  const displayUsdc = hasPlatform ? platform.amount : onchainUsdc;
  return {
    platformUsdc: platform.amount,
    platformUsdcLabel: platform.label,
    platformTransferCount: platform.transferCount,
    onchainUsdc,
    onchainUsdcLabel: formatUsdcLabel(onchainUsdc),
    onchainSol,
    onchainSolLabel: formatSolLabel(onchainSol),
    tokens,
    tokensLabel: tokensLabel(tokens),
    displayUsdc,
    displayUsdcLabel: formatUsdcLabel(displayUsdc),
    displaySol: onchainSol,
    displaySolLabel: formatSolLabel(onchainSol),
    displayBalanceLabel,
    displaySource,
  };
}

export async function handleApiData(request, env, matched) {
  const routeId = matched?.route?.id;
  if (!routeId) return null;

  const fetcher = env.fetch ?? fetch;

  if (routeId === 'me') {
    const { ownerId, user, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) {
      return json({ ok: true, source: 'unconfigured', user: { id: ownerId, privyUserId: user?.main?.ownerId || ownerId } });
    }
    const result = await supabaseGet(env, `users?id=eq.${encodeURIComponent(ownerId)}&select=*`, fetcher);
    const row = result.rows?.[0];
    return json({
      ok: true,
      source: result.configured ? 'supabase' : 'unconfigured',
      user: row
        ? { id: row.id, privyUserId: row.privy_user_id, createdAt: row.created_at }
        : { id: ownerId, privyUserId: user?.main?.ownerId || ownerId },
    });
  }

  if (routeId === 'wallets.list') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
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
    // Cloudflare Workers strip Origin on outbound Privy calls — Next provisions
    // wallets, then posts them here so Supabase (and agents) see the same rows.
    // Skip Privy here: require bearer + x-owner-id (same trust as list when Privy fails).
    const ownerId = ownerHeader(request);
    const token = bearerToken(request);
    if (!token) return json({ error: 'login_required' }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) return json({ error: 'unconfigured' }, 503);
    const body = await request.json().catch(() => null);
    const wallets = Array.isArray(body?.wallets) ? body.wallets : [];
    const { wrote } = await persistWalletRows(env, ownerId, wallets, fetcher);
    if (!wrote) return json({ error: 'invalid_wallets' }, 400);
    const listed = await supabaseGet(
      env,
      `wallets?owner_id=eq.${encodeURIComponent(ownerId)}&select=*&order=created_at.asc`,
      fetcher,
    );
    return json({
      ok: true,
      source: 'supabase',
      wrote,
      wallets: (listed.rows || []).map(mapWalletRow).filter(Boolean).map(publicWallet),
    });
  }

  if (routeId === 'wallets.create') {
    const { ownerId, user, token, error } = await resolveOwner(request, env);
    if (error) {
      const status = error === 'missing_origin' ? 503 : 502;
      const detail = error === 'privy_failed' || error === 'missing_origin'
        ? 'Worker cannot set Origin for Privy; use POST /api/wallets on Next then /api/wallets/persist'
        : undefined;
      return json(detail ? { error, detail } : { error }, status);
    }
    if (!token) return json({ error: 'login_required' }, 401);
    const client = privyClient(env);
    if (!client) return json({ error: 'signer_not_configured' }, 503);
    try {
      const origin = requestOrigin(request, env);
      const login = user || await client.acceptLogin({
        accessToken: token,
        ownerId: ownerId || undefined,
        origin,
      });
      const owner = ownerId || login.main?.ownerId;
      await persistLogin(env, login, owner);
      return json({
        ok: true,
        created: login.created === true,
        wallets: [login.main, ...(login.additional || [])].filter(Boolean).map(publicWallet),
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
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    const client = privyClient(env);
    if (!client) return json({ error: 'signer_not_configured' }, 503);
    const walletId = matched.params?.walletId;
    const body = await request.json().catch(() => ({}));
    if (!body?.transaction || typeof body.transaction !== 'string') {
      return json({ error: 'transaction_required' }, 400);
    }
    let wallet = body.wallet || null;
    if (!wallet && supabaseConfig(env)) {
      const loaded = await supabaseGet(
        env,
        `wallets?id=eq.${encodeURIComponent(walletId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=*`,
        fetcher,
      );
      wallet = mapWalletRow(loaded.rows?.[0]);
    }
    if (!wallet) return json({ error: 'wallet_not_found' }, 404);
    try {
      const sent = body.bot
        ? await client.signAndBroadcastDevnet({ bot: body.bot, wallet, transaction: body.transaction })
        : await client.signAndBroadcastOwnerDevnet({ ownerId, wallet, transaction: body.transaction });
      return json({ ok: true, ...sent });
    } catch (err) {
      const code = err instanceof WalletError ? err.code : err?.code || 'sign_failed';
      return json({ error: code }, 400);
    }
  }

  if (routeId === 'bots.list') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
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
    if (error && !ownerId) return json({ error }, 401);
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
    const capAsset = typeof body.cap?.asset === 'string' && body.cap.asset.trim()
      ? body.cap.asset.trim().slice(0, 32)
      : 'USDC';
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

    const written = await supabaseWrite(env, {
      path: 'bots',
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: row,
      fetcher,
    });
    if (written.ok === false) return json({ error: 'persist_failed' }, 502);

    await supabaseWrite(env, {
      path: 'spend_ledgers',
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
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
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    const botId = matched?.params?.botId;
    if (typeof botId !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(botId)) {
      return json({ error: 'invalid_bot' }, 400);
    }
    if (!supabaseConfig(env)) return json({ error: 'unconfigured' }, 503);

    const existing = await supabaseGet(
      env,
      `bots?id=eq.${encodeURIComponent(botId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=id`,
      fetcher,
    );
    if (!Array.isArray(existing.rows) || existing.rows.length < 1) {
      return json({ error: 'not_found' }, 404);
    }

    // Child tables reference bots(id) without ON DELETE CASCADE — clear dependents first.
    const dependents = [
      `budget_reservations?bot_id=eq.${encodeURIComponent(botId)}`,
      `spend_ledgers?bot_id=eq.${encodeURIComponent(botId)}`,
      `approvals?bot_id=eq.${encodeURIComponent(botId)}`,
      `decision_records?bot_id=eq.${encodeURIComponent(botId)}`,
      `timeline_events?bot_id=eq.${encodeURIComponent(botId)}`,
      `payments?bot_id=eq.${encodeURIComponent(botId)}`,
      `metrics?bot_id=eq.${encodeURIComponent(botId)}`,
      `stream_events?bot_id=eq.${encodeURIComponent(botId)}`,
      `activity_logs?bot_id=eq.${encodeURIComponent(botId)}`,
    ];
    for (const path of dependents) {
      const cleared = await supabaseWrite(env, {
        path,
        method: 'DELETE',
        prefer: 'return=minimal',
        fetcher,
      });
      // 404 = table/row missing on older schemas; treat as already clear.
      if (cleared.configured && cleared.status >= 400 && cleared.status !== 404) {
        return json({ error: 'delete_failed', detail: path.split('?')[0] }, 502);
      }
    }

    const removed = await supabaseWrite(env, {
      path: `bots?id=eq.${encodeURIComponent(botId)}&owner_id=eq.${encodeURIComponent(ownerId)}`,
      method: 'DELETE',
      prefer: 'return=minimal',
      fetcher,
    });
    if (removed.ok === false && removed.status !== 204) {
      return json({ error: 'delete_failed' }, 502);
    }
    return json({ ok: true, deleted: botId, source: 'supabase' });
  }

  if (routeId === 'bots.chat') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
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
      return json({
        ok: true,
        botId,
        reply: reply.text,
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
    if (error && !ownerId) return json({ error }, 401);
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
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) return json({ ok: true, source: 'unconfigured', items: [] });
    const url = new URL(request.url);
    const botId = url.searchParams.get('botId');
    let path = `timeline_events?owner_id=eq.${encodeURIComponent(ownerId)}&select=*&order=at.desc&limit=100`;
    if (botId) path = `timeline_events?owner_id=eq.${encodeURIComponent(ownerId)}&bot_id=eq.${encodeURIComponent(botId)}&select=*&order=at.desc&limit=100`;
    const result = await supabaseGet(env, path, fetcher);
    return json({
      ok: true,
      source: 'supabase',
      items: (result.rows || []).map((row) => ({
        id: row.id,
        botId: row.bot_id,
        ownerId: row.owner_id,
        kind: row.kind,
        summary: row.summary,
        prevHash: row.prev_hash,
        at: row.at,
      })),
    });
  }

  if (routeId === 'decisions.list') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
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
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) return json({ ok: true, source: 'unconfigured', items: [] });
    const bots = await supabaseGet(
      env,
      `bots?owner_id=eq.${encodeURIComponent(ownerId)}&select=id`,
      fetcher,
    );
    const ids = (bots.rows || []).map((row) => row.id).filter(Boolean);
    if (!ids.length) return json({ ok: true, source: 'supabase', items: [] });
    const url = new URL(request.url);
    const botId = url.searchParams.get('botId');
    const path = botId && ids.includes(botId)
      ? `payments?bot_id=eq.${encodeURIComponent(botId)}&select=*&order=created_at.desc&limit=100`
      : `payments?bot_id=in.(${ids.map(encodeURIComponent).join(',')})&select=*&order=created_at.desc&limit=100`;
    const result = await supabaseGet(env, path, fetcher);
    return json({
      ok: true,
      source: 'supabase',
      items: (result.rows || []).map((row) => ({
        id: row.id,
        botId: row.bot_id,
        direction: row.direction,
        protocol: row.protocol,
        amount: amountText(row.amount),
        asset: row.asset,
        counterparty: row.counterparty,
        cluster: row.cluster,
        txSignature: row.tx_signature,
        createdAt: row.created_at,
      })),
    });
  }

  if (routeId === 'metrics.get') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
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
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) return json({ ok: true, source: 'unconfigured', profile: null });
    const result = await supabaseGet(
      env,
      `profiles?owner_id=eq.${encodeURIComponent(ownerId)}&select=handle,display_name,avatar_url`,
      fetcher,
    );
    const row = result.rows?.[0];
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
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    const body = await request.json().catch(() => ({}));
    const handle = normalizeHandle(body.handle);
    const displayName = normalizeDisplayName(body.displayName);
    const avatarUrl = body.avatarUrl == null || body.avatarUrl === '' ? null : httpsAvatarUrl(body.avatarUrl);
    if (!handle || !displayName) return json({ error: 'invalid_profile' }, 400);
    if (body.avatarUrl && !avatarUrl) return json({ error: 'invalid_avatar' }, 400);
    if (!supabaseConfig(env)) {
      return json({ ok: true, source: 'unconfigured', profile: { handle, displayName, avatarUrl } });
    }
    await supabaseWrite(env, {
      path: 'users',
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: { id: ownerId, privy_user_id: ownerId },
      fetcher,
    });
    const saved = await supabaseWrite(env, {
      path: 'profiles?on_conflict=owner_id',
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: {
        owner_id: ownerId,
        handle,
        display_name: displayName,
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString(),
      },
      fetcher,
    });
    if (saved.status === 409) return json({ error: 'handle_taken' }, 409);
    if (saved.ok === false) return json({ error: 'profile_save_failed' }, 502);
    return json({ ok: true, source: 'supabase', profile: { handle, displayName, avatarUrl } });
  }

  if (routeId === 'profiles.lookup') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    const query = new URL(request.url).searchParams.get('q') || '';
    const parsed = parseRecipient(query);
    if (!parsed) return json({ error: 'invalid_recipient' }, 400);
    if (parsed.kind === 'sns') {
      try {
        const resolver = createSnsResolver({
          resolveFn: typeof env.resolveSns === 'function'
            ? env.resolveSns
            : async (domain) => {
              const demo = env.SNS_DEMO_MAP && typeof env.SNS_DEMO_MAP === 'object' ? env.SNS_DEMO_MAP : {};
              if (demo[domain]) return demo[domain];
              throw new SnsError('sns_not_found');
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
      return json({ ok: true, source: 'unconfigured', recipient: { kind: 'handle', handle: parsed.handle, missing: true } });
    }
    const found = await supabaseGet(
      env,
      `profiles?handle=eq.${encodeURIComponent(parsed.handle)}&select=owner_id,handle,display_name,avatar_url`,
      fetcher,
    );
    const row = found.rows?.[0];
    if (!row) return json({ ok: true, source: 'supabase', recipient: { kind: 'handle', handle: parsed.handle, missing: true } });
    const wallet = await supabaseGet(
      env,
      `wallets?owner_id=eq.${encodeURIComponent(row.owner_id)}&kind=eq.main&select=address&limit=1`,
      fetcher,
    );
    return json({
      ok: true,
      source: 'supabase',
      recipient: {
        kind: 'handle',
        handle: row.handle,
        displayName: row.display_name,
        avatarUrl: row.avatar_url || null,
        address: wallet.rows?.[0]?.address || null,
      },
    });
  }

  if (routeId === 'transfers.list') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
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
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
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

  return null;
}
