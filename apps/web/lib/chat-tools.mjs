/**
 * Shared agent tools for same-origin text chat (parity with voice).
 * Browser open/live-view/release prefer the Worker (same DO store as Live View).
 * Search/scrape call https://api.firecrawl.dev/v1 with FIRECRAWL_API_KEY.
 * They do not ride the runtime service binding.
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
  applySituation,
  parseAwaySince,
  sharedToolsInstruction,
  spokenAwayBriefing,
  toOpenAiTools,
} from '@ubc2026/agent-tools';
import { parsePrivySigningFailure, parseSpendApprovalTerms } from '@ubc2026/contracts';
import { ownerAskedToBreakLoop } from '@ubc2026/contracts/card-loop';
import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
import { normalizePriceMint, readAgentPriceQuote } from '@ubc2026/prices';
import { ownerAsksForOneTrade } from './owner-trade.mjs';
import {
  BALANCE_READ_FAILED,
  classifyBalanceRead,
  readWalletBalancesAcrossClusters,
  unavailableBalanceLabel,
} from '@ubc2026/wallets/balances';
import { browserSessionUrl } from './live-view.mjs';
import { ownerApiUrl, runtimeBaseUrl } from './runtime-data.mjs';
import { isLasoCardRequest, LASO_CARD_CHOICE_PROMPT, lasoCardKind, lasoPreparationArgs, lasoReloadableChecklist } from './laso-chat.mjs';
import { privySignerId } from './privy-signers.mjs';

const MAX_TOOL_RESULT = 6000;
const DASHBOARD_NAMES = new Set(DASHBOARD_TOOLS.map((tool) => tool.name));
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CLUSTER_NOTE = `Execution uses Solana ${SOLANA_CLUSTER}. Use each holding’s network label when reporting balances.`;

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

function gateFields(detail) {
  if (!detail || typeof detail !== 'object') return {};
  const steps = Array.isArray(detail.steps)
    ? detail.steps.filter(step => typeof step === 'string').slice(0, 8)
    : [];
  const privyFailure = parsePrivySigningFailure(detail.privyFailure);
  const approvalTerms = parseSpendApprovalTerms(detail.approvalTerms);
  return {
    ...(typeof detail.state === 'string' ? { state: detail.state } : {}),
    ...(detail.failure ? { failure: detail.failure } : {}),
    ...(steps.length > 0 ? { steps } : {}),
    ...(typeof detail.signed === 'boolean' ? { signed: detail.signed } : {}),
    ...(typeof detail.reason === 'string' ? { reason: detail.reason } : {}),
    ...(typeof detail.simulationReason === 'string' && /^[a-zA-Z0-9_]{1,100}$/.test(detail.simulationReason)
      ? { simulationReason: detail.simulationReason } : {}),
    ...(privyFailure ? { privyFailure } : {}),
    ...(approvalTerms ? { approvalTerms } : {}),
    ...(typeof detail.prompt === 'string' ? { prompt: detail.prompt } : {}),
    ...(typeof detail.cluster === 'string' ? { cluster: detail.cluster } : {}),
  };
}

function toolErrorPayload(error) {
  const code = typeof error?.code === 'string' && error.code
    ? error.code
    : (error instanceof ProviderError || error instanceof SessionError ? error.code : 'tool_failed');
  const gate = gateFields(error?.detail);
  return {
    error: code,
    ...gate,
    ...(code === 'desk_locked' && !gate.state
      ? { hint: 'Desk lock is not an approval hold.' }
      : {}),
  };
}

async function workerJson(fetcher, url, ownerId, method, body, accessToken = '', extraHeaders = null) {
  const headers = {
    'content-type': 'application/json',
    'x-owner-id': ownerId,
  };
  if (extraHeaders && extraHeaders['x-loop-break'] === 'owner-asked') {
    headers['x-loop-break'] = 'owner-asked';
  }
  if (
    extraHeaders
    && typeof extraHeaders['x-desk-grant'] === 'string'
    && /^[0-9a-f]{64}$/.test(extraHeaders['x-desk-grant'])
  ) {
    headers['x-desk-grant'] = extraHeaders['x-desk-grant'];
  }
  if (typeof accessToken === 'string' && accessToken.trim() && accessToken.length < 8000) {
    headers.authorization = `Bearer ${accessToken.trim()}`;
  }
  const approval = extraHeaders?.['x-spend-approve-once'];
  if (typeof approval === 'string' && /^v1\.[0-9]{13}\.[a-f0-9]{64}$/.test(approval)) {
    headers['x-spend-approve-once'] = approval;
  }
  const response = await fetcher(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof data.error === 'string'
      ? data.error
      : (typeof data.state === 'string' ? data.state : 'browser_request_failed');
    const err = new Error(code);
    err.code = code;
    err.detail = gateFields(data);
    // Only the chat route holding the quote can pass enrollment to the owner UI.
    if (body?.action === 'swap' && body.autoSwap === true && body.swapTicket && data.reason === 'swap_signer_missing') {
      const signerId = privySignerId(data.swapDelegation?.signerId);
      const walletAddress = data.swapDelegation?.walletAddress;
      if (signerId && typeof walletAddress === 'string' && ADDRESS.test(walletAddress)) {
        err.swapDelegation = { walletAddress, signerId };
      }
    }
    throw err;
  }
  return data;
}

function localBrowserService(env = {}, fetcher = fetch, researchFetch = fetch) {
  const apiKey = typeof env.FIRECRAWL_API_KEY === 'string' ? env.FIRECRAWL_API_KEY.trim() : '';
  return createBrowserSessionService({
    store: createMemoryStore(),
    search: createSearch({ apiKey, fetcher: researchFetch }),
    scrape: createScrape({ apiKey, fetcher: researchFetch }),
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
      ...(typeof wallet.solLamports === 'string' ? { solLamports: wallet.solLamports } : {}),
      ...(typeof wallet.solBalanceLabel === 'string' ? { solBalanceLabel: wallet.solBalanceLabel } : {}),
      ...(Array.isArray(wallet.tokens) ? { tokens: wallet.tokens } : {}),
      ...(typeof wallet.tokensLabel === 'string' ? { tokensLabel: wallet.tokensLabel } : {}),
      ...(Array.isArray(wallet.holdings) ? { holdings: wallet.holdings } : {}),
      ...(typeof wallet.displayBalanceLabel === 'string' ? { displayBalanceLabel: wallet.displayBalanceLabel } : {}),
      ...(typeof wallet.displaySolLabel === 'string' ? { displaySolLabel: wallet.displaySolLabel } : {}),
      ...(typeof wallet.balanceStatus === 'string' ? { balanceStatus: wallet.balanceStatus } : {}),
      ...(typeof wallet.cluster === 'string' ? { cluster: wallet.cluster } : {}),
      ...(typeof wallet.displaySource === 'string' ? { displaySource: wallet.displaySource } : {}),
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

function walletAlreadyOnchainOk(wallet) {
  return wallet?.balanceStatus === 'ok'
    || (typeof wallet?.solLamports === 'string' && /^(0|[1-9][0-9]{0,39})$/.test(wallet.solLamports))
    || (Array.isArray(wallet?.holdings) && wallet.holdings.some((row) => row?.label));
}

/** Read on-chain holdings using the configured network. */
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
    // Never clobber a successful runtime/onchain read with a later RPC miss
    // (e.g. QuickNode URL sent through the AGENT_RUNTIME service binding).
    if (!bal.ok && walletAlreadyOnchainOk(wallet)) {
      return wallet;
    }
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
  let solKnown = false;
  for (const wallet of items) {
    if (typeof wallet?.solLamports === 'string' && /^(0|[1-9][0-9]{0,39})$/.test(wallet.solLamports)) {
      sol += BigInt(wallet.solLamports);
      solKnown = true;
    }
  }
  const classified = classifyBalanceRead({ items });
  const failed = classified.status === BALANCE_READ_FAILED
    || classified.status === 'partial'
    || classified.ok === false;
  const displayBalanceLabel = holdings.map((row) => row.label).filter(Boolean).join(' · ')
    || (failed ? unavailableBalanceLabel(classified.code || 'rpc_failed') : (solKnown ? formatSolLabel(sol.toString()) : null));
  return {
    onchainSol: solKnown ? sol.toString() : null,
    onchainSolLabel: solKnown ? formatSolLabel(sol.toString()) : null,
    tokens,
    tokensLabel: tokens.map((token) => token.label).filter(Boolean).join(' · ') || null,
    holdings,
    displayBalanceLabel,
    displaySolLabel: solKnown ? formatSolLabel(sol.toString()) : null,
    displaySource: 'onchain',
    balanceStatus: classified.status,
    balanceCode: classified.code,
    balanceOk: classified.ok,
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
  const failed = onchain.balanceOk === false;
  const solLabelFinal = onchain.onchainSolLabel || solLabel;
  const onchainLabel = onchain.holdings?.length
    ? onchain.displayBalanceLabel
    : (onchain.onchainSol != null && onchain.onchainSol !== '0' ? onchain.displayBalanceLabel : null);
  const unavailable = unavailableBalanceLabel(onchain.balanceCode || 'rpc_failed');
  const displayBalanceLabel = failed
    ? ([
      shellHint ? `${shellHint} (shell · onchain unavailable)` : null,
      platform.transferCount > 0 ? platform.label : null,
      onchain.holdings?.length ? onchain.displayBalanceLabel : unavailable,
    ].filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).join(' · ')
      || unavailable)
    : ([
      platform.transferCount > 0 ? platform.label : null,
      onchainLabel,
      shellHint,
      solLabelFinal,
      displayUsdcLabel,
    ].filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).join(' · ')
      || onchain.displayBalanceLabel
      || '0 SOL');
  const balances = {
    ...(existing || {}),
    ...onchain,
    ...(platform.transferCount > 0 ? {
      platformUsdc: platform.amount,
      platformUsdcLabel: platform.label,
      platformTransferCount: platform.transferCount,
    } : {}),
    displayUsdcLabel: failed
      ? (shellHint || (platform.transferCount > 0 ? platform.label : null))
      : (displayUsdcLabel || existing?.displayUsdcLabel || null),
    displaySolLabel: failed ? null : solLabelFinal,
    displayBalanceLabel,
    balanceStatus: failed && shellHint ? 'partial' : onchain.balanceStatus,
    balanceCode: onchain.balanceCode,
    ok: onchain.balanceOk !== false,
    displaySource: platform.transferCount > 0
      ? (onchain.tokens.length || (onchain.onchainSol != null && onchain.onchainSol !== '0') ? 'mixed' : 'platform')
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
  accessToken = '',
  ownerMessage = '',
  priceFetch = null,
  searchFetch = fetch,
  /** Solana JSON-RPC must use global fetch — never AGENT_RUNTIME.bind. */
  rpcFetch = null,
  deskGrant = '',
  situation = null,
} = {}) {
  if (typeof ownerId !== 'string' || !ownerId || typeof botId !== 'string' || !botId) {
    throw new Error('invalid_identity');
  }
  const identity = { ownerId, botId };
  // Firecrawl must not ride the runtime fetcher. A Worker 404 is not an outage.
  const researchFetch = typeof searchFetch === 'function' ? searchFetch : null;
  // Prefer dedicated rpcFetch (global fetch in production). Fall back to
  // fetcher so unit tests that mock Solana on the same double still work.
  const solanaFetch = typeof rpcFetch === 'function' ? rpcFetch : fetcher;
  const local = localBrowserService(env, fetcher, researchFetch);
  const root = runtimeBaseUrl(runtimeBase);
  const localBots = shellBotItems(shellBots);
  const localWallets = shellWalletItems(shellWallets);
  const token = typeof accessToken === 'string' ? accessToken.trim() : '';
  const spendGrant = typeof deskGrant === 'string' && /^[0-9a-f]{64}$/.test(deskGrant) ? deskGrant : '';
  const balanceHint = typeof shellBalanceLabel === 'string' && shellBalanceLabel.trim()
    ? shellBalanceLabel.trim().slice(0, 64)
    : null;

  function callWorker(url, method, body, extraHeaders) {
    const headers = { ...(extraHeaders || {}) };
    if (spendGrant && typeof url === 'string' && url.includes('/api/spend')) {
      headers['x-desk-grant'] = spendGrant;
    }
    return workerJson(fetcher, url, ownerId, method, body, token, headers);
  }

  async function invokeBrowser(name, args = {}) {
    const openUrl = browserSessionUrl(root, botId);
    let sessionRecordId = typeof args.sessionRecordId === 'string' ? args.sessionRecordId.trim() : '';
    if (['browser_navigate', 'browser_live_view', 'browser_release', 'browser_click'].includes(name) && !sessionRecordId) {
      const listed = openUrl ? await callWorker(openUrl, 'GET') : await local.listOpenSessions(identity);
      const sessions = (Array.isArray(listed.sessions) ? listed.sessions : []).filter(session =>
        session?.status === 'open' && typeof session.sessionRecordId === 'string' && session.sessionRecordId.trim());
      if (sessions.length !== 1) {
        return { error: sessions.length ? 'browser_session_ambiguous' : 'browser_session_missing' };
      }
      sessionRecordId = sessions[0].sessionRecordId;
    }
    if (!openUrl) {
      return local.invokeTool(name, { ...args, sessionRecordId }, identity);
    }
    if (name === 'browser_open') {
      const body = {
        purpose: typeof args.purpose === 'string' ? args.purpose : 'browse',
      };
      if (typeof args.url === 'string' && args.url.trim()) body.url = args.url.trim();
      try {
        const opened = await callWorker(openUrl, 'POST', body);
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
        const listed = await callWorker(openUrl, 'GET');
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
          const navigated = await callWorker(navUrl, 'POST', { url: args.url.trim() });
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
      const url = browserSessionUrl(root, botId, { sessionRecordId, action: 'navigate' });
      const navigated = await callWorker(url, 'POST', {
        url: typeof args.url === 'string' ? args.url : '',
      });
      return {
        sessionRecordId: navigated.sessionRecordId || sessionRecordId,
        url: navigated.url,
        title: navigated.title,
      };
    }
    if (name === 'browser_live_view') {
      const url = browserSessionUrl(root, botId, { sessionRecordId, action: 'live-view' });
      const view = await callWorker(url, 'POST', {});
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
    if (name === 'browser_click') {
      if (typeof args.selector !== 'string' || !args.selector.trim() || args.selector.length > 256) {
        return { error: 'invalid_selector' };
      }
      const url = browserSessionUrl(root, botId, { sessionRecordId, action: 'click' });
      const clicked = await callWorker(url, 'POST', { selector: args.selector.trim() });
      return {
        sessionRecordId: clicked.sessionRecordId || sessionRecordId,
        x: clicked.x,
        y: clicked.y,
        tag: clicked.tag,
        text: clicked.text,
        note: 'Clicked via the visible cursor overlay in Live View.',
      };
    }
    if (name === 'browser_release') {
      const url = browserSessionUrl(root, botId, { sessionRecordId, action: 'release' });
      const released = await callWorker(url, 'POST', {});
      return {
        sessionRecordId: released.sessionRecordId || sessionRecordId,
        status: released.status || 'closed',
      };
    }
    return local.invokeTool(name, args, identity);
  }

  const apiBase = root || 'shell';

  async function invokeDashboard(name, args = {}, { sessionBot = true, approveOnce, spendAuthorization, swapTicket, lasoPayment, moveAuthorization } = {}) {
    if (name === 'break_loop' && !ownerAskedToBreakLoop(ownerMessage)) return { error: 'owner_must_ask' };
    const def = DASHBOARD_TOOLS.find((tool) => tool.name === name);
    if (!def?.voiceCalls?.length) return { error: 'unknown_tool' };
    if (name === 'stop_all') {
      const listPath = ownerApiUrl('/api/bots', apiBase);
      if (!listPath) return { error: 'runtime_unconfigured' };
      const listed = await callWorker(listPath, 'GET');
      const items = Array.isArray(listed.items) ? listed.items : [];
      const paused = [];
      for (const item of items) {
        const id = typeof item?.id === 'string' ? item.id : '';
        if (!id) continue;
        const pausePath = ownerApiUrl(`/bots/${encodeURIComponent(id)}/pause`, apiBase);
        if (!pausePath) continue;
        const result = await callWorker(pausePath, 'POST', {});
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
      let raw = args[key];
      if (key === 'cooldownMinutes' && Number.isInteger(raw)) raw = String(raw);
      if (key === 'amount' && typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) raw = String(raw);
      if (key === 'amountUsd' && typeof raw === 'number' && Number.isFinite(raw)) raw = String(raw);
      if (typeof raw === 'string' && raw.trim()) body[key] = raw.trim();
    }
    if (args.confirmed === true) body.confirmed = true;
    if (args.permission === 'ask' || args.permission === 'review' || args.permission === 'full') {
      body.permission = args.permission;
    }
    if ((name === 'request_spend' || name === 'sns_send') && typeof args.reviewCap === 'string' && /^(0|[1-9][0-9]{0,39})$/.test(args.reviewCap) && args.reviewCap !== '0') {
      body.reviewCap = args.reviewCap;
    }
    if (name === 'start_task' && args.ownerPermission === 'full') body.ownerPermission = 'full';
    if (name === 'wake_bot' && ownerAsksForOneTrade(ownerMessage)) body.reason = 'owner-ask';
    if (name === 'break_loop') {
      if (!ownerAskedToBreakLoop(ownerMessage)) return { error: 'owner_must_ask' };
      return callWorker(url, entry.method, entry.method === 'GET' ? undefined : body, { 'x-loop-break': 'owner-asked' });
    }
    if (name === 'request_spend' && spendAuthorization) body.spendAuthorization = spendAuthorization;
    if (name === 'request_spend' && ['spend', 'pay'].includes(args.action ?? 'spend') && moveAuthorization) body.moveAuthorization = moveAuthorization;
    if (name === 'request_spend' && args.action === 'x402' && lasoPayment) body.lasoPayment = lasoPayment;
    if (name === 'request_spend' && args.action === 'swap' && swapTicket) body.swapTicket = swapTicket;
    if (name === 'request_spend' && args.action === 'swap' && swapTicket && args.autoSwap === true) body.autoSwap = true;
    return callWorker(url, entry.method, entry.method === 'GET' ? undefined : body,
      name === 'request_spend' && approveOnce ? { 'x-spend-approve-once': approveOnce } : undefined);
  }

  return async function invokeTool(name, args = {}, { approveOnce, spendAuthorization, swapTicket, lasoPayment, moveAuthorization } = {}) {
    args = applySituation(name, args, situation);
    if (isLasoCardRequest(ownerMessage)) {
      if (name === 'prepare_shopping') {
        const kind = lasoCardKind(ownerMessage);
        if (kind === 'undecided') {
          return { ok: false, error: 'laso_card_choice_required', hint: LASO_CARD_CHOICE_PROMPT };
        }
        if (kind === 'reloadable') {
          return {
            ok: false,
            error: 'laso_reloadable_human_steps',
            steps: lasoReloadableChecklist(),
            hint: 'A new reloadable card is KYC plus a card-issuer code plus funding. Hand the steps to the owner instead of preparing a prepaid card.',
          };
        }
        args = lasoPreparationArgs(args, ownerMessage);
      }
      if (name === 'request_spend' && args.action !== 'x402') {
        return { error: 'laso_requires_x402', hint: 'Use action x402 with the prepared lasoTicket, never a plain transfer to Laso payTo.' };
      }
    }
    if (name === 'create_loop' || name === 'set_loop_cooldown' || name === 'break_loop') {
      args = { ...args, botId };
      delete args.ownerAsked;
      delete args.userAsked;
    }
    try {
      if (name === 'get_price') {
        const mint = normalizePriceMint(typeof args.mint === 'string' ? args.mint : '');
        const apiKey = typeof env.JUPITER_API_KEY === 'string' && env.JUPITER_API_KEY.trim()
          ? env.JUPITER_API_KEY.trim()
          : null;
        const client = typeof priceFetch === 'function' ? priceFetch : fetcher;
        if (typeof client !== 'function') {
          return { error: 'client_missing', hint: 'The price client is not configured.' };
        }
        try {
          const quote = await readAgentPriceQuote(mint, { fetcher: client, apiKey });
          return { ok: true, quote };
        } catch (error) {
          const code = typeof error?.code === 'string' ? error.code : 'price_unavailable';
          if (code === 'client_missing') return { error: code, hint: 'The price client is not configured.' };
          if (code === 'invalid_mint') return { error: code, hint: 'That is not a Solana mint.' };
          if (code === 'provider_failed' || code === 'provider_unavailable') {
            return { error: code, hint: 'The price provider is down.' };
          }
          return { error: code };
        }
      }
      if (name === 'web_search' || name === 'web_scrape') {
        try {
          return await local.invokeTool(name, args, identity);
        } catch (error) {
          const code = typeof error?.code === 'string' ? error.code : 'tool_failed';
          if (code === 'search_not_configured' || code === 'scrape_not_configured') {
            return { error: code, hint: 'FIRECRAWL_API_KEY is not configured.' };
          }
          if (code === 'client_missing') {
            return { error: code, hint: 'The research client is not configured.' };
          }
          if (code === 'provider_failed') {
            return { error: code, hint: 'The research provider is down.' };
          }
          return toolErrorPayload(error);
        }
      }
      if (
        name === 'browser_open'
        || name === 'browser_navigate'
        || name === 'browser_live_view'
        || name === 'browser_click'
        || name === 'browser_release'
      ) {
        return await invokeBrowser(name, args);
      }
      if (name === 'list_bots') {
        let remote;
        try {
          remote = await invokeDashboard(name, args);
        } catch (error) {
          if (error?.code === 'login_required' && localBots.length > 0) {
            return { ok: true, source: 'shell', items: localBots };
          }
          throw error;
        }
        const remoteItems = Array.isArray(remote?.items) ? remote.items : [];
        if (remoteItems.length > 0) return remote;
        if (localBots.length > 0) return { ok: true, source: 'shell', items: localBots };
        return remote;
      }
      if (name === 'get_wallets') {
        let remote = null;
        try {
          remote = await invokeDashboard(name, args);
        } catch (error) {
          // Runtime requires Bearer when Privy secrets are bound. Fall back to
          // shell wallets the composer already posted so chat still answers.
          if (error?.code === 'login_required' && localWallets.length > 0) {
            remote = { ok: true, source: 'shell', items: [] };
          } else {
            throw error;
          }
        }
        const remoteItems = Array.isArray(remote?.items) ? remote.items : [];
        let transfers = null;
        try {
          const transferPath = ownerApiUrl('/api/transfers', apiBase);
          if (transferPath) transfers = await callWorker(transferPath, 'GET');
        } catch {
          transfers = null;
        }
        const baseItems = remoteItems.length > 0
          ? remoteItems
          : (localWallets.length > 0 ? localWallets : []);
        const source = remoteItems.length > 0
          ? (remote?.source || 'supabase')
          : (localWallets.length > 0 ? 'shell' : (remote?.source || 'empty'));
        const enriched = await enrichWalletsOnchain(baseItems, { env, fetcher: solanaFetch });
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
        return await invokeDashboard(name, args, { approveOnce, spendAuthorization, swapTicket, lasoPayment, moveAuthorization });
      }
      return await local.invokeTool(name, args, identity);
    } catch (error) {
      const payload = toolErrorPayload(error);
      return error?.swapDelegation ? { ...payload, swapDelegation: error.swapDelegation } : payload;
    }
  };
}

export function serializeToolResult(result) {
  if (result?.provider === 'laso' && result.lasoTicket) {
    const { botId, provider, amountUsd, proposal, policy, next, lasoTicket, instruction } = result;
    return clipJson({ lasoTicket, instruction, botId, provider, amountUsd, proposal, policy, next });
  }
  if (result && typeof result === 'object' && (result.claimUrl || result.auth)) {
    const { claimUrl: _claimUrl, auth: _auth, ...rest } = result;
    return serializeToolResult(rest);
  }
  if (result && typeof result === 'object' && result.viewerUrl) {
    const { viewerUrl: _viewerUrl, ...rest } = result;
    return clipJson(rest);
  }
  return clipJson(result);
}
