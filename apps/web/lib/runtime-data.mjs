/**
 * Live Worker list helpers for the glass shell.
 * The browser calls the same-origin /api/runtime proxy so panes load when the
 * Worker URL is configured on the server. Empty arrays when unsigned or unconfigured.
 * Never invent PreviewMain / demo bots.
 */
import { sanitizeActivity } from './chat-activity.mjs';
import { catalogPayload } from './file-catalog.mjs';
import { isAllowedRuntimePath, safeRuntimeSearch } from './runtime-proxy.mjs';

const OWNER = /^[a-zA-Z0-9:_.-]{1,256}$/;
const BOT_ID = /^[a-zA-Z0-9:_-]{1,128}$/;
const AMOUNT = /^(0|[1-9][0-9]{0,39})$/;
const SIGNED = /^-?(0|[1-9][0-9]{0,39})$/;

export function runtimeBaseUrl(value = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return '';
  }
}

export function shellBotFromRemote(row, looks = {}) {
  if (!row || typeof row.id !== 'string') return null;
  const look = looks[row.id] && typeof looks[row.id] === 'object' ? looks[row.id] : {};
  const frozen = row.frozen === true;
  const enabled = row.enabled !== false;
  return {
    id: row.id,
    name: typeof look.name === 'string' && look.name.trim()
      ? look.name.trim()
      : (typeof row.name === 'string' && row.name.trim() ? row.name.trim() : row.id),
    shape: look.shape || 'circle',
    color: look.color || '#3dd6c6',
    type: row.type || 'trading',
    status: frozen ? 'paused' : (enabled ? 'watching' : 'idle'),
    goal: typeof row.goal === 'string' && row.goal.trim() ? row.goal.trim() : 'Waiting for a goal.',
    walletId: row.walletId || null,
    ownerId: row.ownerId || null,
    approvalMode: row.approvalMode,
    enabled,
    frozen,
    record: row,
  };
}

function ownerHeaders(ownerId, accessToken) {
  const headers = { 'x-owner-id': ownerId };
  if (typeof accessToken === 'string' && accessToken.trim() && accessToken.length < 8000) {
    headers.authorization = `Bearer ${accessToken.trim()}`;
  }
  return headers;
}

/** Browser path. The Next route forwards this to the Worker. */
export function shellRuntimeUrl(pathnameAndQuery) {
  if (typeof pathnameAndQuery !== 'string') return null;
  const q = pathnameAndQuery.indexOf('?');
  const pathname = q === -1 ? pathnameAndQuery : pathnameAndQuery.slice(0, q);
  const search = safeRuntimeSearch(q === -1 ? '' : pathnameAndQuery.slice(q));
  if (search == null || !isAllowedRuntimePath(pathname)) return null;
  return `/api/runtime${pathname}${search}`;
}

/**
 * Absolute Worker URL when `runtimeBase` is set (tests and server tools).
 * Otherwise the same-origin proxy.
 */
export function ownerApiUrl(path, runtimeBase) {
  if (typeof path !== 'string') return null;
  if (runtimeBase == null || runtimeBase === 'shell') return shellRuntimeUrl(path);
  const root = runtimeBaseUrl(runtimeBase);
  if (!root) return null;
  const q = path.indexOf('?');
  const pathname = q === -1 ? path : path.slice(0, q);
  const search = safeRuntimeSearch(q === -1 ? '' : path.slice(q));
  if (search == null || !isAllowedRuntimePath(pathname)) return null;
  return `${root}${pathname}${search}`;
}

function shortMint(mint) {
  if (typeof mint !== 'string' || mint.length < 8) return 'asset';
  return `${mint.slice(0, 5)}...${mint.slice(-5)}`;
}

/** Paper rows from GET /bots/:id/status `positionCheck`. Drops unusable amounts. */
export function positionsFromStatus(botId, body) {
  if (typeof botId !== 'string' || !BOT_ID.test(botId)) return [];
  const rows = Array.isArray(body?.positionCheck?.positions) ? body.positionCheck.positions : [];
  const out = [];
  for (const row of rows) {
    const amount = typeof row?.amount === 'string' && AMOUNT.test(row.amount) ? row.amount : null;
    if (!amount) continue;
    const entry = typeof row.entryMicroUsd === 'string' && SIGNED.test(row.entryMicroUsd) ? row.entryMicroUsd : null;
    const mark = typeof row.markMicroUsd === 'string' && SIGNED.test(row.markMicroUsd) ? row.markMicroUsd : null;
    let pnl = '0';
    if (entry && mark) {
      const delta = (BigInt(mark) - BigInt(entry)).toString();
      if (SIGNED.test(delta)) pnl = delta;
    }
    const mint = typeof row.mint === 'string' ? row.mint : '';
    const asset = typeof row.asset === 'string' && row.asset.trim()
      ? row.asset.trim().slice(0, 16)
      : shortMint(mint);
    out.push({
      id: `${botId}:${mint || out.length}`,
      botId,
      asset,
      mint: mint || null,
      amount,
      decimals: Number.isInteger(row.decimals) && row.decimals >= 0 && row.decimals <= 18 ? row.decimals : 6,
      pnlMicroUsdc: pnl,
      quoteSource: typeof row.quoteSource === 'string' && row.quoteSource.trim()
        ? row.quoteSource.trim().slice(0, 64)
        : 'runtime',
      ...(typeof row.venue === 'string' && row.venue.trim() ? { venue: row.venue.trim().slice(0, 32) } : {}),
      ...(typeof row.market === 'string' && row.market.trim()
        ? { market: row.market.trim().slice(0, 32) }
        : (row.pricingCluster === 'mainnet' ? { market: 'mainnet price' } : {})),
      side: typeof row.side === 'string' && row.side.trim() ? row.side.trim().slice(0, 16) : 'supply',
      mark: typeof row.priceUsd === 'string' ? row.priceUsd : null,
      notionalMicroUsdc: mark && AMOUNT.test(mark) ? mark : null,
      walletId: typeof row.walletId === 'string' ? row.walletId : null,
    });
  }
  return out;
}

function livePayment(row) {
  return Boolean(row
    && typeof row.id === 'string'
    && AMOUNT.test(typeof row.amount === 'string' ? row.amount : '')
    && typeof row.asset === 'string'
    && row.asset.trim());
}

function liveWallet(row) {
  return Boolean(row && typeof row.id === 'string' && typeof row.address === 'string' && row.address.trim());
}

async function getJson(url, headers, fetcher) {
  const response = await fetcher(url, { headers, cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, body };
}

export async function fetchOwnerLists(ownerId, runtimeBaseOrOptions = 'shell') {
  const options = runtimeBaseOrOptions && typeof runtimeBaseOrOptions === 'object'
    ? runtimeBaseOrOptions
    : { runtimeBase: runtimeBaseOrOptions };
  const runtimeBase = options.runtimeBase === undefined ? 'shell' : options.runtimeBase;
  if (typeof ownerId !== 'string' || !OWNER.test(ownerId)) {
    return { bots: [], wallets: [], payments: [], positions: [], paymentCrossCheck: [], source: 'unsigned' };
  }
  const fetcher = typeof options.fetcher === 'function' ? options.fetcher : fetch;
  const headers = ownerHeaders(ownerId, options.accessToken);
  const botsUrl = ownerApiUrl('/api/bots', runtimeBase);
  const walletsUrl = ownerApiUrl('/api/wallets', runtimeBase);
  const paymentsUrl = ownerApiUrl('/api/payments', runtimeBase);
  if (!botsUrl || !walletsUrl || !paymentsUrl) {
    return { bots: [], wallets: [], payments: [], positions: [], paymentCrossCheck: [], source: 'unsigned' };
  }
  const [botsRes, walletsRes, paymentsRes] = await Promise.all([
    getJson(botsUrl, headers, fetcher),
    getJson(walletsUrl, headers, fetcher),
    getJson(paymentsUrl, headers, fetcher),
  ]);
  const bots = botsRes.ok && Array.isArray(botsRes.body?.items) ? botsRes.body.items : [];
  const positions = [];
  await Promise.all(bots.slice(0, 30).map(async (bot) => {
    if (!bot || !BOT_ID.test(bot.id)) return;
    const url = ownerApiUrl(`/bots/${encodeURIComponent(bot.id)}/status`, runtimeBase);
    if (!url) return;
    const status = await getJson(url, headers, fetcher);
    if (!status.ok) return;
    positions.push(...positionsFromStatus(bot.id, status.body));
  }));
  const source = botsRes.body?.source || walletsRes.body?.source || paymentsRes.body?.source || 'unknown';
  return {
    source,
    bots,
    wallets: walletsRes.ok && Array.isArray(walletsRes.body?.items) ? walletsRes.body.items.filter(liveWallet) : [],
    payments: paymentsRes.ok && Array.isArray(paymentsRes.body?.items) ? paymentsRes.body.items.filter(livePayment) : [],
    paymentCrossCheck: paymentsRes.ok && Array.isArray(paymentsRes.body?.crossCheck)
      ? paymentsRes.body.crossCheck.filter(row => row
        && row.alert === 'unapproved_spend'
        && row.freeze === true
        && typeof row.walletId === 'string'
        && typeof row.excess === 'string')
      : [],
    positions,
  };
}

export function emptyMoneyState() {
  return { bots: [], wallets: [], payments: [], positions: [], paymentCrossCheck: [] };
}

export function deleteBotUrl(runtimeBase, botId) {
  const root = runtimeBaseUrl(runtimeBase);
  if (!root || typeof botId !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(botId)) return null;
  return `${root}/api/bots/${encodeURIComponent(botId)}`;
}

export async function deleteOwnerBot(ownerId, botId, runtimeBaseOrOptions = 'shell') {
  const options = runtimeBaseOrOptions && typeof runtimeBaseOrOptions === 'object'
    ? runtimeBaseOrOptions
    : { runtimeBase: runtimeBaseOrOptions };
  const runtimeBase = options.runtimeBase === undefined ? 'shell' : options.runtimeBase;
  const url = ownerApiUrl(`/api/bots/${encodeURIComponent(botId)}`, runtimeBase);
  if (!url || typeof ownerId !== 'string' || !OWNER.test(ownerId)) {
    return { ok: false, error: 'invalid_request' };
  }
  const fetcher = typeof options.fetcher === 'function' ? options.fetcher : fetch;
  try {
    const response = await fetcher(url, {
      method: 'DELETE',
      headers: ownerHeaders(ownerId, options.accessToken),
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: body.error || `http_${response.status}` };
    return { ok: true, deleted: body.deleted || botId };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/**
 * Persist a shell / local-roster bot into Supabase so voice and text tools can list it.
 * Requires a wallet that already belongs to the owner.
 */
export async function upsertOwnerBot(ownerId, bot, runtimeBaseOrOptions = 'shell') {
  const options = runtimeBaseOrOptions && typeof runtimeBaseOrOptions === 'object'
    ? runtimeBaseOrOptions
    : { runtimeBase: runtimeBaseOrOptions };
  const runtimeBase = options.runtimeBase === undefined ? 'shell' : options.runtimeBase;
  const url = ownerApiUrl('/api/bots', runtimeBase);
  const walletId = typeof options.walletId === 'string' && options.walletId.trim()
    ? options.walletId.trim()
    : (typeof bot?.walletId === 'string' ? bot.walletId.trim() : '');
  if (!url || typeof ownerId !== 'string' || !OWNER.test(ownerId) || !bot || typeof bot !== 'object') {
    return { ok: false, error: 'invalid_request' };
  }
  if (!BOT_ID.test(typeof bot.id === 'string' ? bot.id : '') || !walletId || !BOT_ID.test(walletId)) {
    return { ok: false, error: 'wallet_required' };
  }
  const name = typeof bot.name === 'string' ? bot.name.trim().slice(0, 80) : '';
  if (!name) return { ok: false, error: 'invalid_bot' };
  const fetcher = typeof options.fetcher === 'function' ? options.fetcher : fetch;
  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...ownerHeaders(ownerId, options.accessToken),
      },
      body: JSON.stringify({
        id: bot.id,
        name,
        goal: typeof bot.goal === 'string' && bot.goal.trim() ? bot.goal.trim().slice(0, 2000) : 'Waiting for a goal.',
        type: bot.type === 'shopping' || bot.type === 'position-management' ? bot.type : 'trading',
        walletId,
        approvalMode: bot.approvalMode === 'fully-automatic' || bot.approvalMode === 'capped-automatic'
          ? bot.approvalMode
          : 'ask',
        enabled: bot.enabled !== false,
        frozen: bot.frozen === true,
        cap: bot.cap && typeof bot.cap === 'object'
          ? bot.cap
          : { mode: 'limited', asset: 'USDC', maxOutflow: '1000000', maxPerTransaction: '1000000' },
      }),
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: body.error || `http_${response.status}`,
      };
    }
    return { ok: true, bot: body.bot || null, source: body.source || 'supabase' };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** First non-frozen wallet id from a list (shell or remote). */
export function firstAssignableWalletId(wallets = []) {
  if (!Array.isArray(wallets)) return '';
  for (const wallet of wallets) {
    if (!wallet || typeof wallet !== 'object') continue;
    if (wallet.frozen === true) continue;
    if (typeof wallet.id === 'string' && BOT_ID.test(wallet.id)) return wallet.id;
  }
  return '';
}

/**
 * Same-origin Next route — works without redeploying the agent-runtime Worker.
 * (Worker also exposes the same path after deploy; the shell prefers Next.)
 */
export function botChatUrl(_runtimeBase, botId) {
  if (typeof botId !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(botId)) return null;
  return `/api/bots/${encodeURIComponent(botId)}/chat`;
}

/**
 * Owner text chat with a bot via the Next OpenRouter path.
 * history: prior bubble lines ({ role, text }) — agent/assistant both map server-side.
 */
export async function sendBotChat({
  ownerId,
  botId,
  message,
  history = [],
  name,
  goal,
  type,
  permission,
  grants = null,
  model,
  effort,
  shellBots = null,
  shellWallets = null,
  shellBalanceLabel = null,
  fileCatalog = null,
  accessToken = '',
  runtimeBase = runtimeBaseUrl(),
} = {}) {
  const url = botChatUrl(runtimeBase, botId);
  if (!url || typeof ownerId !== 'string' || !OWNER.test(ownerId)) {
    return { ok: false, error: 'invalid_request' };
  }
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return { ok: false, error: 'message_required' };
  const catalog = catalogPayload(fileCatalog);
  const prior = Array.isArray(history)
    ? history
      .filter(line => line && (line.role === 'user' || line.role === 'agent' || line.role === 'assistant'))
      .map(line => ({
        role: line.role === 'user' ? 'user' : 'assistant',
        text: typeof line.text === 'string' ? line.text : '',
      }))
      .filter(line => line.text.trim())
      .slice(-16)
    : [];
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-owner-id': ownerId,
        ...(typeof accessToken === 'string' && accessToken.trim() && accessToken.length < 8000
          ? { authorization: `Bearer ${accessToken.trim()}` }
          : {}),
      },
      body: JSON.stringify({
        message: text,
        history: prior,
        ...(typeof name === 'string' && name.trim() ? { name: name.trim().slice(0, 80) } : {}),
        ...(typeof goal === 'string' && goal.trim() ? { goal: goal.trim().slice(0, 2000) } : {}),
        ...(typeof type === 'string' && type.trim() ? { type: type.trim().slice(0, 40) } : {}),
        ...(typeof permission === 'string' && permission.trim() ? { permission: permission.trim().slice(0, 16) } : {}),
        ...(Array.isArray(grants) ? { grants: grants.slice(0, 4) } : {}),
        ...(typeof model === 'string' && model.trim() ? { model: model.trim().slice(0, 80) } : {}),
        ...(typeof effort === 'string' && effort.trim() ? { effort: effort.trim().slice(0, 16) } : {}),
        ...(Array.isArray(shellBots) ? { shellBots: shellBots.slice(0, 40) } : {}),
        ...(Array.isArray(shellWallets) ? { shellWallets: shellWallets.slice(0, 40) } : {}),
        ...(typeof shellBalanceLabel === 'string' && shellBalanceLabel.trim()
          ? { shellBalanceLabel: shellBalanceLabel.trim().slice(0, 64) }
          : {}),
        ...(catalog.length > 0 ? { fileCatalog: catalog } : {}),
      }),
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: body.error || `http_${response.status}` };
    const hold = body.hold && (body.hold.kind === 'inline' || body.hold.kind === 'modal')
      && typeof body.hold.name === 'string'
      ? body.hold
      : null;
    const reply = typeof body.reply === 'string' ? body.reply.trim() : '';
    if (!reply && !hold) return { ok: false, error: 'empty_reply' };
    const reported = Number(body.usage?.total);
    const tokens = Number.isSafeInteger(reported) && reported > 0 ? reported : 0;
    const activity = sanitizeActivity(body.activity);
    return { ok: true, reply: reply || hold.label || '', model: body.model || null, tokens, activity, hold };
  } catch {
    return { ok: false, error: 'network' };
  }
}
