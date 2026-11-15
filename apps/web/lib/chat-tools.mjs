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
  sharedToolsInstruction,
  toOpenAiTools,
} from '@ubc2026/agent-tools';
import { browserSessionUrl } from './live-view.mjs';
import { ownerApiUrl, runtimeBaseUrl } from './runtime-data.mjs';

const MAX_TOOL_RESULT = 6000;
const DASHBOARD_NAMES = new Set(DASHBOARD_TOOLS.map((tool) => tool.name));

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

function formatUsdcLabel(amount) {
  if (typeof amount !== 'string' || !/^-?(0|[1-9][0-9]{0,39})$/.test(amount)) return null;
  const negative = amount.startsWith('-');
  const digits = negative ? amount.slice(1) : amount;
  const padded = digits.padStart(7, '0');
  const whole = padded.slice(0, -6);
  const fraction = padded.slice(-6).replace(/0+$/, '');
  const shown = fraction ? `${whole}.${fraction}` : whole;
  return `${negative ? '-' : ''}${shown} USDC`;
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
  const displayUsdcLabel = (typeof shellBalanceLabel === 'string' && shellBalanceLabel.trim())
    ? shellBalanceLabel.trim().slice(0, 64)
    : (existing?.displayUsdcLabel
      || (platform.transferCount > 0 ? platform.label : null)
      || items.find((wallet) => typeof wallet?.displayUsdcLabel === 'string')?.displayUsdcLabel
      || items.find((wallet) => typeof wallet?.usdcBalanceLabel === 'string')?.usdcBalanceLabel
      || null);
  const balances = {
    ...(existing || {}),
    ...(platform.transferCount > 0 ? {
      platformUsdc: platform.amount,
      platformUsdcLabel: platform.label,
      platformTransferCount: platform.transferCount,
    } : {}),
    displayUsdcLabel,
    displaySource: existing?.displaySource
      || (platform.transferCount > 0 ? 'platform' : (displayUsdcLabel ? 'shell' : 'onchain')),
  };
  return {
    ...payload,
    items: items.map((wallet) => ({
      ...wallet,
      displayUsdcLabel: wallet.displayUsdcLabel || displayUsdcLabel || wallet.usdcBalanceLabel || null,
      displaySource: wallet.displaySource || balances.displaySource,
    })),
    balances,
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

  async function invokeDashboard(name, args = {}) {
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
        const value = args[key] != null ? String(args[key]) : (key === 'botId' ? botId : '');
        if (value) params.set(key, value);
      }
      const query = params.toString();
      if (query) url = `${url}${url.includes('?') ? '&' : '?'}${query}`;
    }
    const body = {};
    for (const key of entry.body || []) {
      if (typeof args[key] === 'string' && args[key].trim()) body[key] = args[key].trim();
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
        if (remoteItems.length > 0) {
          return withDisplayBalances(remote, { ownerId, shellBalanceLabel: balanceHint, transfers });
        }
        if (localWallets.length > 0) {
          return withDisplayBalances(
            { ok: true, source: 'shell', items: localWallets },
            { ownerId, shellBalanceLabel: balanceHint, transfers },
          );
        }
        return withDisplayBalances(remote || { ok: true, items: [] }, {
          ownerId,
          shellBalanceLabel: balanceHint,
          transfers,
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
