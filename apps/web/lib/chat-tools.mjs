/**
 * Shared agent tools for same-origin text chat (parity with voice).
 * Browser open/live-view/release prefer the Worker (same DO store as Live View).
 * Search/scrape use Firecrawl from root env when present.
 * Dashboard tools call the same owner HTTP routes as voice webhooks.
 */

import {
  createBrowserSessionService,
  createMemoryStore,
  ProviderError,
  SessionError,
} from '@ubc2026/browser-session';
import { createBrowserProvider, createScrape, createSearch } from '@ubc2026/browser-search';
import {
  DASHBOARD_TOOLS,
  SHARED_AGENT_TOOLS,
  parseAwaySince,
  sharedToolsInstruction,
  spokenAwayBriefing,
  toOpenAiTools,
} from '@ubc2026/agent-tools';
import { readAgentPriceQuote } from '@ubc2026/prices';
import { readWalletBalancesAcrossClusters } from '@ubc2026/wallets/balances';
import { browserSessionUrl } from './live-view.mjs';
import { ownerApiUrl, runtimeBaseUrl } from './runtime-data.mjs';

const MAX_TOOL_RESULT = 6000;
const DASHBOARD_NAMES = new Set(DASHBOARD_TOOLS.map((tool) => tool.name));
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CLUSTER_NOTE = 'Holdings are whatever non-zero SOL/SPL balances exist on Solana-devnet and Solana-testnet for these addresses. Mainnet is never queried.';

export function openAiAgentTools(tools = SHARED_AGENT_TOOLS) {
  return toOpenAiTools(tools);
}

export function chatToolsInstruction() {
  return sharedToolsInstruction();
}

function clipJson(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.length <= MAX_TOOL_RESULT) return text;
  return `${text.slice(0, MAX_TOOL_RESULT)}…[truncated]`;
}

function toolErrorPayload(error) {
  const code = typeof error?.code === 'string' && error.code
    ? error.code
    : (error instanceof ProviderError || error instanceof SessionError ? error.code : 'tool_failed');
  return { error: code };
}

async function workerJson(fetcher, url, ownerId, method, body) {
  const response = await fetcher(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-owner-id': ownerId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof data.error === 'string' ? data.error : 'browser_request_failed';
    const err = new Error(code);
    err.code = code;
    throw err;
  }
  return data;
}

function localBrowserService(env = {}, fetcher = fetch) {
  return createBrowserSessionService({
    store: createMemoryStore(),
    search: createSearch({ apiKey: env.FIRECRAWL_API_KEY, fetcher }),
    scrape: createScrape({ apiKey: env.FIRECRAWL_API_KEY, fetcher }),
    browsers: createBrowserProvider({
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: env.CLOUDFLARE_API_TOKEN,
      fetcher,
    }),
  });
}

/**
 * Build an invokeTool(name, args) for completeTextChat.
 * Prefer Worker browser routes when NEXT_PUBLIC_AGENT_RUNTIME_URL is set.
 */
function shellBotItems(shellBots) {
  if (!Array.isArray(shellBots)) return [];
  return shellBots
    .filter((bot) => bot && typeof bot.id === 'string' && bot.id)
    .map((bot) => ({
      id: bot.id,
      name: typeof bot.name === 'string' ? bot.name : bot.id,
      type: bot.type || 'trading',
      status: bot.status || 'idle',
      goal: typeof bot.goal === 'string' ? bot.goal : '',
      walletId: bot.walletId || null,
      enabled: bot.enabled !== false,
      frozen: bot.frozen === true,
    }));
}

function shellWalletItems(shellWallets) {
  if (!Array.isArray(shellWallets)) return [];
  return shellWallets
    .filter((wallet) => wallet && typeof wallet.id === 'string' && wallet.id)
    .map((wallet) => ({
      id: wallet.id,
      ownerId: wallet.ownerId || null,
      kind: wallet.kind || 'additional',
      label: wallet.label || 'Wallet',
      address: wallet.address || null,
      frozen: wallet.frozen === true,
      provider: wallet.provider || 'privy',
      ...(typeof wallet.usdcBalance === 'string' ? { usdcBalance: wallet.usdcBalance } : {}),
      ...(typeof wallet.usdcBalanceLabel === 'string' ? { usdcBalanceLabel: wallet.usdcBalanceLabel } : {}),
      ...(typeof wallet.displayUsdcLabel === 'string' ? { displayUsdcLabel: wallet.displayUsdcLabel } : {}),
    }));
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

function formatUsdcLabel(amount) {
  return formatFixedUnits(amount, 6, 'USDC');
}

function formatSolLabel(lamports, cluster = null) {
  const label = formatFixedUnits(lamports, 9, 'SOL');
  if (!label) return null;
  return cluster ? `${label} (${cluster})` : label;
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

/** Read whatever non-zero SOL/SPL balances exist on Solana-devnet + Solana-testnet. */
async function enrichWalletsOnchain(wallets, { env = {}, fetcher = fetch } = {}) {
  const list = Array.isArray(wallets) ? wallets : [];
  const head = list.slice(0, 8);
  const enriched = await Promise.all(head.map(async (wallet) => {
    const address = typeof wallet?.address === 'string' ? wallet.address : '';
    if (!ADDRESS.test(address)) {
      return {
        ...wallet,
        balanceStatus: 'invalid_address',
        holdings: [],
        tokens: Array.isArray(wallet.tokens) ? wallet.tokens : [],
      };
    }
    const bal = await readWalletBalancesAcrossClusters({ address, env, fetcher });
    const holdings = Array.isArray(bal.holdings) ? bal.holdings.filter((row) => row?.label) : [];
    const tokens = publicTokens(bal.tokens);
    const usdc = bal.usdcAmount;
    const sol = bal.solLamports;
    const solOk = typeof sol === 'string' && /^(0|[1-9][0-9]{0,39})$/.test(sol);
    const usdcOk = typeof usdc === 'string' && /^(0|[1-9][0-9]{0,39})$/.test(usdc);
    const label = bal.displayBalanceLabel
      || holdings.map((row) => row.label).join(' · ')
      || null;
    return {
      ...wallet,
      usdcBalance: usdcOk ? usdc : (wallet.usdcBalance ?? null),
      usdcBalanceLabel: usdcOk ? formatUsdcLabel(usdc) : (wallet.usdcBalanceLabel ?? null),
      usdcBalanceDecimals: 6,
      solLamports: solOk ? sol : (wallet.solLamports ?? null),
      solBalanceLabel: solOk ? formatSolLabel(sol) : (wallet.solBalanceLabel ?? null),
      solDecimals: 9,
      tokens,
      tokensLabel: tokens.map((token) => token.label).filter(Boolean).join(' · ') || null,
      holdings,
      displayBalanceLabel: label,
      displaySolLabel: solOk ? formatSolLabel(sol) : null,
      balanceStatus: bal.ok === true || holdings.length > 0 ? 'ok' : (bal.code || 'rpc_failed'),
      cluster: bal.cluster || null,
    };
  }));
  return {
    items: [...enriched, ...list.slice(8)],
    note: null,
    clusterNote: CLUSTER_NOTE,
  };
}

function summarizeOnchain(items) {
  const holdings = [];
  for (const wallet of items) {
    for (const row of Array.isArray(wallet?.holdings) ? wallet.holdings : []) {
      if (row?.label) holdings.push(row);
    }
  }
  const tokens = [];
  for (const wallet of items) {
    for (const token of Array.isArray(wallet?.tokens) ? wallet.tokens : []) {
      if (token?.label) tokens.push(token);
    }
  }
  let sol = 0n;
  for (const wallet of items) {
    if (typeof wallet?.solLamports === 'string' && /^(0|[1-9][0-9]{0,39})$/.test(wallet.solLamports)) {
      sol += BigInt(wallet.solLamports);
    }
  }
  const displayBalanceLabel = holdings.map((row) => row.label).filter(Boolean).join(' · ')
    || formatSolLabel(sol.toString());
  return {
    onchainSol: sol.toString(),
    onchainSolLabel: formatSolLabel(sol.toString()),
    tokens,
    tokensLabel: tokens.map((token) => token.label).filter(Boolean).join(' · ') || null,
    holdings,
    displayBalanceLabel,
    displaySolLabel: formatSolLabel(sol.toString()),
    displaySource: 'onchain',
  };
}

function platformNetFromTransfers(items, ownerId) {
  let net = 0n;
  let count = 0;
  for (const row of Array.isArray(items) ? items : []) {
    if (!row || row.asset !== 'USDC') continue;
    if (typeof row.amount !== 'string' || !/^(0|[1-9][0-9]{0,39})$/.test(row.amount)) continue;
    const mine = row.toOwnerId === ownerId || row.fromOwnerId === ownerId
      || row.direction === 'in' || row.direction === 'out';
    if (!mine && row.direction !== 'in' && row.direction !== 'out') continue;
    let direction = row.direction;
    if (direction !== 'in' && direction !== 'out') {
      if (row.toOwnerId === ownerId) direction = 'in';
      else if (row.fromOwnerId === ownerId) direction = 'out';
      else continue;
    }
    count += 1;
    const units = BigInt(row.amount);
    net += direction === 'in' ? units : -units;
  }
  const amount = net.toString();
  return { amount, label: formatUsdcLabel(amount), transferCount: count };
}

function withDisplayBalances(payload, {
  ownerId,
  shellBalanceLabel = null,
  transfers = null,
} = {}) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const platform = platformNetFromTransfers(transfers?.items || transfers, ownerId);
  const existing = payload?.balances && typeof payload.balances === 'object' ? payload.balances : null;
  const shellHint = typeof shellBalanceLabel === 'string' && shellBalanceLabel.trim()
    ? shellBalanceLabel.trim().slice(0, 64)
    : null;
  const solLabel = existing?.displaySolLabel
    || existing?.onchainSolLabel
    || items.find((wallet) => typeof wallet?.solBalanceLabel === 'string')?.solBalanceLabel
    || null;
  const displayUsdcLabel = shellHint
    || existing?.displayUsdcLabel
    || (platform.transferCount > 0 ? platform.label : null)
    || items.find((wallet) => typeof wallet?.displayUsdcLabel === 'string')?.displayUsdcLabel
    || items.find((wallet) => typeof wallet?.usdcBalanceLabel === 'string')?.usdcBalanceLabel
    || null;
  const onchain = summarizeOnchain(items);
  const solLabelFinal = onchain.onchainSolLabel || solLabel;
  const onchainLabel = onchain.holdings?.length
    ? onchain.displayBalanceLabel
    : (onchain.onchainSol !== '0' ? onchain.displayBalanceLabel : null);
  const displayBalanceLabel = [
    platform.transferCount > 0 ? platform.label : null,
    onchainLabel,
    shellHint,
    solLabelFinal,
    displayUsdcLabel,
  ].filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).join(' · ')
    || onchain.displayBalanceLabel
    || '0 SOL';
  const balances = {
    ...(existing || {}),
    ...onchain,
    ...(platform.transferCount > 0 ? {
      platformUsdc: platform.amount,
      platformUsdcLabel: platform.label,
      platformTransferCount: platform.transferCount,
    } : {}),
    displayUsdcLabel: displayUsdcLabel || existing?.displayUsdcLabel || null,
    displaySolLabel: solLabelFinal,
    displayBalanceLabel,
    displaySource: platform.transferCount > 0
      ? (onchain.tokens.length || onchain.onchainSol !== '0' ? 'mixed' : 'platform')
      : 'onchain',
    clusterNote: CLUSTER_NOTE,
  };
  return {
    ...payload,
    items: items.map((wallet) => ({
      ...wallet,
      displayUsdcLabel: wallet.displayUsdcLabel || wallet.usdcBalanceLabel || displayUsdcLabel || null,
      displaySolLabel: wallet.displaySolLabel || wallet.solBalanceLabel || solLabelFinal || null,
      displayBalanceLabel: wallet.displayBalanceLabel
        || [wallet.solBalanceLabel, wallet.tokensLabel || wallet.usdcBalanceLabel].filter(Boolean).join(' · ')
        || displayBalanceLabel,
      displaySource: wallet.displaySource || balances.displaySource,
    })),
    balances,
    clusterNote: CLUSTER_NOTE,
  };
}

export function createChatToolInvoker({
  ownerId,
  botId,
  env = {},
  fetcher = fetch,
  runtimeBase = runtimeBaseUrl(env.NEXT_PUBLIC_AGENT_RUNTIME_URL),
  shellBots = null,
  shellWallets = null,
  shellBalanceLabel = null,
} = {}) {
  if (typeof ownerId !== 'string' || !ownerId || typeof botId !== 'string' || !botId) {
    throw new Error('invalid_identity');
  }
  const identity = { ownerId, botId };
  const local = localBrowserService(env, fetcher);
  const root = runtimeBaseUrl(runtimeBase);
  const localBots = shellBotItems(shellBots);
  const localWallets = shellWalletItems(shellWallets);
  const balanceHint = typeof shellBalanceLabel === 'string' && shellBalanceLabel.trim()
    ? shellBalanceLabel.trim().slice(0, 64)
    : null;

  async function invokeBrowser(name, args = {}) {
    const openUrl = browserSessionUrl(root, botId);
    if (!openUrl) {
      return local.invokeTool(name, args, identity);
    }
    if (name === 'browser_open') {
      const body = {
        purpose: typeof args.purpose === 'string' ? args.purpose : 'browse',
      };
      if (typeof args.url === 'string' && args.url.trim()) body.url = args.url.trim();
      try {
        const opened = await workerJson(fetcher, openUrl, ownerId, 'POST', body);
        return {
          sessionRecordId: opened.sessionRecordId,
          purpose: opened.purpose,
          status: opened.status || 'open',
          url: opened.url ?? null,
          title: opened.title ?? '',
          reused: opened.reused === true,
          note: opened.note,
        };
      } catch (error) {
        // Older Workers still return concurrency_limit — reuse via list + navigate.
        if (error?.code !== 'concurrency_limit') throw error;
        const listed = await workerJson(fetcher, openUrl, ownerId, 'GET');
        const sessions = Array.isArray(listed.sessions) ? listed.sessions : [];
        const newest = [...sessions].sort((a, b) => {
          const aAt = Number(a?.updatedAt ?? a?.createdAt ?? 0);
          const bAt = Number(b?.updatedAt ?? b?.createdAt ?? 0);
          return bAt - aAt;
        })[0];
        if (!newest?.sessionRecordId) throw error;
        if (typeof args.url === 'string' && args.url.trim()) {
          const navUrl = browserSessionUrl(root, botId, {
            sessionRecordId: newest.sessionRecordId,
            action: 'navigate',
          });
          const navigated = await workerJson(fetcher, navUrl, ownerId, 'POST', { url: args.url.trim() });
          return {
            sessionRecordId: navigated.sessionRecordId || newest.sessionRecordId,
            purpose: newest.purpose || body.purpose,
            status: 'open',
            url: navigated.url,
            title: navigated.title,
            reused: true,
            note: 'Reused an existing session after concurrency_limit and navigated to the url.',
          };
        }
        return {
          sessionRecordId: newest.sessionRecordId,
          purpose: newest.purpose || body.purpose,
          status: 'open',
          url: typeof newest.url === 'string' ? newest.url : null,
          title: '',
          reused: true,
          note: 'Reused an existing session after concurrency_limit. Call browser_navigate with an https url to change the page.',
        };
      }
    }
    if (name === 'browser_navigate') {
      let sessionRecordId = typeof args.sessionRecordId === 'string' ? args.sessionRecordId : '';
      if (!sessionRecordId) {
        const listed = await workerJson(fetcher, openUrl, ownerId, 'GET');
        const sessions = Array.isArray(listed.sessions) ? listed.sessions : [];
        sessionRecordId = sessions[0]?.sessionRecordId || '';
      }
      const url = browserSessionUrl(root, botId, { sessionRecordId, action: 'navigate' });
      const navigated = await workerJson(fetcher, url, ownerId, 'POST', {
        url: typeof args.url === 'string' ? args.url : '',
      });
      return {
        sessionRecordId: navigated.sessionRecordId || sessionRecordId,
        url: navigated.url,
        title: navigated.title,
      };
    }
    if (name === 'browser_live_view') {
      const sessionRecordId = typeof args.sessionRecordId === 'string' ? args.sessionRecordId : '';
      const url = browserSessionUrl(root, botId, { sessionRecordId, action: 'live-view' });
      const view = await workerJson(fetcher, url, ownerId, 'POST', {});
      // Never return viewerUrl to the model.
      return {
        sessionRecordId: view.sessionRecordId || sessionRecordId,
        mode: view.mode,
        connectBefore: view.connectBefore,
        embedVerified: view.embedVerified,
        fallback: view.fallback,
        pageUrl: view.pageUrl ?? null,
        note: view.pageUrl
          ? 'Live View is ready for the owner UI. The viewer URL is not returned to chat.'
          : 'Live View is ready, but the session is still on about:blank — call browser_navigate with an https url.',
      };
    }
    if (name === 'browser_release') {
      const sessionRecordId = typeof args.sessionRecordId === 'string' ? args.sessionRecordId : '';
      const url = browserSessionUrl(root, botId, { sessionRecordId, action: 'release' });
      const released = await workerJson(fetcher, url, ownerId, 'POST', {});
      return {
        sessionRecordId: released.sessionRecordId || sessionRecordId,
        status: released.status || 'closed',
      };
    }
    return local.invokeTool(name, args, identity);
  }

  const apiBase = root || 'shell';

  async function invokeDashboard(name, args = {}, { sessionBot = true } = {}) {
    const def = DASHBOARD_TOOLS.find((tool) => tool.name === name);
    if (!def?.voiceCalls?.length) return { error: 'unknown_tool' };
    if (name === 'stop_all') {
      const listPath = ownerApiUrl('/api/bots', apiBase);
      if (!listPath) return { error: 'runtime_unconfigured' };
      const listed = await workerJson(fetcher, listPath, ownerId, 'GET');
      const items = Array.isArray(listed.items) ? listed.items : [];
      const paused = [];
      for (const item of items) {
        const id = typeof item?.id === 'string' ? item.id : '';
        if (!id) continue;
        const pausePath = ownerApiUrl(`/bots/${encodeURIComponent(id)}/pause`, apiBase);
        if (!pausePath) continue;
        const result = await workerJson(fetcher, pausePath, ownerId, 'POST', {});
        paused.push({ botId: id, status: result.status || 'paused' });
      }
      return { list: listed, paused };
    }
    const entry = def.voiceCalls[0];
    let path = entry.path;
    for (const key of ['botId', 'sessionRecordId']) {
      if (path.includes(`:${key}`)) {
        const value = typeof args[key] === 'string' ? args[key] : (key === 'botId' ? botId : '');
        if (!value) return { error: 'invalid_parameters' };
        path = path.replace(`:${key}`, encodeURIComponent(value));
      }
    }
    let url = ownerApiUrl(path, apiBase);
    if (!url) return { error: 'runtime_unconfigured' };
    if (entry.query?.length) {
      const params = new URLSearchParams();
      for (const key of entry.query) {
        const explicit = args[key] != null && String(args[key]) !== '';
        const value = explicit ? String(args[key]) : (sessionBot && key === 'botId' ? botId : '');
        if (value) params.set(key, value);
      }
      const query = params.toString();
      if (query) url = `${url}${url.includes('?') ? '&' : '?'}${query}`;
    }
    const body = {};
    for (const key of entry.body || []) {
      if (typeof args[key] === 'string' && args[key].trim()) body[key] = args[key].trim();
    }
    if (args.confirmed === true) body.confirmed = true;
    if (args.permission === 'ask' || args.permission === 'review' || args.permission === 'full') {
      body.permission = args.permission;
    }
    return workerJson(
      fetcher,
      url,
      ownerId,
      entry.method,
      entry.method === 'GET' ? undefined : body,
    );
  }

  return async function invokeTool(name, args = {}) {
    try {
      if (name === 'get_price') {
        const mint = typeof args.mint === 'string' ? args.mint.trim() : '';
        const apiKey = typeof env.JUPITER_API_KEY === 'string' && env.JUPITER_API_KEY.trim()
          ? env.JUPITER_API_KEY.trim()
          : null;
        const quote = await readAgentPriceQuote(mint, { fetcher, apiKey });
        return { ok: true, quote };
      }
      if (name === 'web_search' || name === 'web_scrape') {
        return await local.invokeTool(name, args, identity);
      }
      if (
        name === 'browser_open'
        || name === 'browser_navigate'
        || name === 'browser_live_view'
        || name === 'browser_release'
      ) {
        return await invokeBrowser(name, args);
      }
      if (name === 'list_bots') {
        const remote = await invokeDashboard(name, args);
        const remoteItems = Array.isArray(remote?.items) ? remote.items : [];
        if (remoteItems.length > 0) return remote;
        if (localBots.length > 0) return { ok: true, source: 'shell', items: localBots };
        return remote;
      }
      if (name === 'get_wallets') {
        const remote = await invokeDashboard(name, args);
        const remoteItems = Array.isArray(remote?.items) ? remote.items : [];
        let transfers = null;
        try {
          const transferPath = ownerApiUrl('/api/transfers', apiBase);
          if (transferPath) transfers = await workerJson(fetcher, transferPath, ownerId, 'GET');
        } catch {
          transfers = null;
        }
        const baseItems = remoteItems.length > 0
          ? remoteItems
          : (localWallets.length > 0 ? localWallets : []);
        const source = remoteItems.length > 0
          ? (remote?.source || 'supabase')
          : (localWallets.length > 0 ? 'shell' : (remote?.source || 'empty'));
        const enriched = await enrichWalletsOnchain(baseItems, { env, fetcher });
        return withDisplayBalances(
          {
            ok: true,
            source,
            items: enriched.items,
            ...(remote?.balances ? { balances: remote.balances } : {}),
            rpcNote: enriched.note,
          },
          { ownerId, shellBalanceLabel: balanceHint, transfers },
        );
      }
      if (name === 'what_happened_while_away') {
        if (args.since != null && args.since !== '' && parseAwaySince(String(args.since)) == null) {
          return { error: 'invalid_parameters' };
        }
        if (typeof args.botId === 'string' && args.botId !== '' && !/^[a-zA-Z0-9:_-]{1,128}$/.test(args.botId)) {
          return { error: 'invalid_parameters' };
        }
        const remote = await invokeDashboard(name, args, { sessionBot: false });
        if (remote?.error) return remote;
        return spokenAwayBriefing(remote?.items, {
          since: args.since,
          source: remote?.source,
          botId: typeof args.botId === 'string' ? args.botId : '',
          unavailable: remote?.ok === false,
        });
      }
      if (DASHBOARD_NAMES.has(name)) {
        return await invokeDashboard(name, args);
      }
      return await local.invokeTool(name, args, identity);
    } catch (error) {
      return toolErrorPayload(error);
    }
  };
}

export function serializeToolResult(result) {
  if (result && typeof result === 'object' && result.viewerUrl) {
    const { viewerUrl: _viewerUrl, ...rest } = result;
    return clipJson(rest);
  }
  return clipJson(result);
}
