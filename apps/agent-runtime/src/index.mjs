import { API_ROUTES, SECRET_NAMES, matchApiRoute } from '@ubc2026/contracts';
import { createDexScreenerPriceProvider } from '@ubc2026/prices';
import { BotDurableObject } from './bot-do.mjs';
import {
  processQuickNodeWebhook,
  processStreamWalletSync,
  processStreamBackfill,
} from './quicknode-webhook.mjs';
import {
  HOURLY_CRON,
  assessPositions,
  listScheduledBotsFromSupabase,
  planScheduledWork,
  readDevnetUsdcBalance,
  readStreamHealthFromSupabase,
  walletAddress,
} from './schedules.mjs';
import { handleVoiceRequest } from './voice.mjs';

export { BotDurableObject };

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function botStub(env, botId) {
  const id = env.BOT.idFromName(botId);
  return env.BOT.get(id);
}

/**
 * Maelstrom agent runtime Worker.
 * Routes wake/pause/resume/status, the checkpointed bot loop, and owner-bound browser sessions to a per-bot Durable Object.
 * QuickNode Streams wake bots through /wake. Hourly cron records a paper
 * position check. A second cron re-checks devnet USDC when the stream is stale.
 * ElevenLabs webhook tools and the Grok custom LLM live under /voice and call these same routes.
 */
const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, product: env.PRODUCT ?? 'Maelstrom', cluster: env.CLUSTER ?? 'devnet' });
    }

    if (url.pathname === '/voice/agent' || url.pathname.startsWith('/voice/')) {
      return handleVoiceRequest(request, env, {
        fetchApi: (inner, sameEnv) => worker.fetch(inner, sameEnv ?? env),
        fetcher: typeof env.voiceFetcher === 'function' ? env.voiceFetcher : fetch,
      });
    }

    // QuickNode Streams (Isaac / 5A): HMAC → dedupe → persist → wake → loop.
    if (url.pathname === '/webhooks/quicknode' && request.method === 'POST') {
      return processQuickNodeWebhook(request, env, botStub);
    }
    if (url.pathname === '/internal/streams/sync-wallets' && request.method === 'POST') {
      return processStreamWalletSync(request, env);
    }
    if (url.pathname === '/internal/streams/backfill' && request.method === 'POST') {
      return processStreamBackfill(request, env, botStub);
    }

    if (url.pathname === '/api/routes' && request.method === 'GET') {
      return json({ routes: API_ROUTES, secretNames: SECRET_NAMES });
    }

    const matched = matchApiRoute(request.method, url.pathname);
    if (matched?.route.action && matched.params.botId) {
      const stub = botStub(env, matched.params.botId);
      const botId = matched.params.botId;
      const prefix = `/bots/${encodeURIComponent(botId)}`;
      const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : '';
      const target = rest.startsWith('/browser/')
        ? new URL(`https://bot/id/${encodeURIComponent(botId)}${rest}`)
        : new URL(`https://bot/${matched.route.action}`);
      return stub.fetch(new Request(target, request));
    }

    // Contract routes that are not the live bot DO yet. Signing and database
    // reads stay stubs until later chunks. No secret values are read here.
    if (matched && (matched.route.status === 'stub' || matched.route.status === 'guarded')) {
      return json({ ok: true, stub: true, route: matched.route.id, items: [] });
    }

    const botMatch = url.pathname.match(/^\/bots\/([^/]+)(?:\/(status|wake|pause|resume|advance|decide|loop))?$/);
    if (botMatch) {
      const botId = decodeURIComponent(botMatch[1]);
      const action = botMatch[2] ?? 'status';
      const stub = botStub(env, botId);
      const target = new URL(`https://bot/${action}`);
      return stub.fetch(new Request(target, request));
    }

    return json({ error: 'not_found' }, 404);
  },

  async scheduled(controller, env, ctx) {
    const cron = typeof controller?.cron === 'string' && controller.cron ? controller.cron : HOURLY_CRON;
    const now = Number.isSafeInteger(controller?.scheduledTime) ? controller.scheduledTime : Date.now();
    const bots = typeof env.listScheduledBots === 'function'
      ? await env.listScheduledBots()
      : await listScheduledBotsFromSupabase(env, env.fetch ?? fetch);
    if (!Array.isArray(bots) || bots.length === 0) return;

    const health = typeof env.readStreamHealth === 'function'
      ? await env.readStreamHealth(now)
      : await readStreamHealthFromSupabase(env, env.fetch ?? fetch);
    const plan = planScheduledWork({ bots, now, cron, health });
    const needsPrices = plan.positionChecks.some(bot => Array.isArray(bot.positions) && bot.positions.length > 0);
    const lookup = needsPrices ? priceLookup(env) : null;

    for (const bot of plan.positionChecks) {
      const quotes = lookup ? await quotePositions(lookup, bot.positions) : {};
      ctx.waitUntil(deliverCheck(env, bot, { reason: 'cron-hourly', quotes, balance: null, now }));
    }

    if (!plan.streamDropped) return;
    const balances = new Map();
    for (const wallet of plan.walletRechecks) {
      balances.set(wallet.address, await readBalance(env, wallet.address));
    }
    for (const bot of plan.recheckBots) {
      const address = walletAddress(bot);
      ctx.waitUntil(deliverCheck(env, bot, {
        reason: 'stream-drop-recheck',
        quotes: {},
        balance: address ? balances.get(address) : null,
        now,
      }));
    }
  },
};

export default worker;

function priceLookup(env) {
  if (env.lookupPrice === null) return null;
  if (typeof env.lookupPrice === 'function') return env.lookupPrice;
  return createDexScreenerPriceProvider({ fetcher: env.fetch ?? fetch });
}

async function quotePositions(lookup, positions) {
  const quotes = {};
  for (const position of Array.isArray(positions) ? positions.slice(0, 30) : []) {
    const mint = position?.mint;
    if (typeof mint !== 'string' || quotes[mint]) continue;
    try {
      quotes[mint] = await lookup(mint);
    } catch (error) {
      quotes[mint] = { error: typeof error?.code === 'string' ? error.code : 'price_unavailable' };
    }
  }
  return quotes;
}

async function readBalance(env, address) {
  if (typeof env.readWalletBalance === 'function') {
    try {
      return await env.readWalletBalance({ address });
    } catch {
      return { ok: false, code: 'rpc_failed', cluster: 'devnet', address };
    }
  }
  return readDevnetUsdcBalance({
    rpcUrl: env.QUICKNODE_DEVNET_RPC_URL,
    address,
    fetcher: env.fetch ?? fetch,
  });
}

function checkPayload(bot, { reason, quotes, balance, now }) {
  return {
    botId: bot.id,
    goal: typeof bot.goal === 'string' ? bot.goal : '',
    type: bot.type ?? null,
    maxLoss: bot.maxLoss ?? bot.cap?.maxLoss ?? null,
    positions: Array.isArray(bot.positions) ? bot.positions : [],
    quotes: quotes ?? {},
    balance: balance ?? null,
    reason,
    now,
  };
}

function slimQuote(quote) {
  if (!quote || typeof quote !== 'object') return {};
  const slim = {};
  if (typeof quote.priceUsd === 'string') slim.priceUsd = quote.priceUsd;
  if (typeof quote.quoteSource === 'string') slim.quoteSource = quote.quoteSource.slice(0, 64);
  if (typeof quote.error === 'string') slim.error = quote.error.slice(0, 64);
  return slim;
}

function deliverCheck(env, bot, details) {
  const payload = checkPayload(bot, details);
  const recorded = assessPositions({
    bot: { id: bot.id, maxLoss: payload.maxLoss },
    positions: payload.positions,
    quotes: payload.quotes,
    balance: payload.balance,
    reason: payload.reason,
    now: payload.now,
  });
  const quotes = {};
  for (const [mint, quote] of Object.entries(payload.quotes ?? {})) quotes[mint] = slimQuote(quote);
  payload.quotes = quotes;
  payload.balance = recorded.balance;
  return botStub(env, bot.id).fetch(new Request('https://bot/position-check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })).then(response => response, () => Response.json({ ok: false, check: recorded }));
}
