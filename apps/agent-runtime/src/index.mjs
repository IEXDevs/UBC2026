import { configuredSolanaRpc, SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
import { API_ROUTES, SECRET_NAMES, matchApiRoute } from '@ubc2026/contracts';
import { handleSpend } from './spend-route.mjs';
import { resolvePriceLookup } from './price-lookup.mjs';
import { BotDurableObject, INTERNAL_POSITION_HEADER, INTERNAL_POSITION_VALUE } from './bot-do.mjs';
import { persistPositionCheck } from './position-persist.mjs';
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
  readSolanaUsdcBalance,
  readSolanaWalletBalances,
  readStreamHealthFromSupabase,
  walletAddress,
} from './schedules.mjs';
import { handleVoiceRequest } from './voice.mjs';
import { matchCommerceRoute, dispatchCommerceRoute } from './commerce-routes.mjs';
import { enrichEnv } from './runtime-env.mjs';
import { handleApiData } from './api-data.mjs';
import { ownerAuthStatus, requestOwner, resolveOwner } from './owner-auth.mjs';
import { captureRequest, persistActivity, persistHttpActivity } from './activity-log.mjs';
import { botStub, rememberBotAlert } from './bot-alerts.mjs';
import { createSupabaseRpc, supabaseConfig, supabaseGet } from './supabase-rest.mjs';
import { corsPreflightResponse, withCors } from './cors.mjs';
import { SOL_MINT } from './usd-budget.mjs';

const OWNER_HEADER = 'x-owner-id';

/** Bot control + status actions that mutate or expose DO run / position state. */
const OWNER_BOT_ACTIONS = new Set([
  'status',
  'wake',
  'pause',
  'resume',
  'advance',
  'decide',
  'loop',
  'card-loop',
  'card-loop/cooldown',
  'card-loop/break',
]);

function isOwnerBotAction(action) {
  if (!action) return false;
  if (OWNER_BOT_ACTIONS.has(action)) return true;
  // Browser leaves share the DO and must not skip the edge owner gate.
  return String(action).startsWith('browser/');
}

/**
 * Status / positions / control plane: identity from resolveOwner (Privy bearer when
 * secrets exist), then prove that owner owns the bot when Supabase is configured.
 */
async function assertBotOwner(request, env, botId) {
  const { ownerId, error } = await resolveOwner(request, env);
  if (error && !ownerId) {
    return { ok: false, status: ownerAuthStatus(error), error, ownerId: null };
  }
  if (!ownerId) return { ok: false, status: 401, error: 'owner_required', ownerId: null };
  if (!supabaseConfig(env)) return { ok: true, ownerId };
  const result = await supabaseGet(
    env,
    `bots?id=eq.${encodeURIComponent(botId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=id`,
    env.fetch ?? fetch,
  );
  if (result.status !== 200 || !Array.isArray(result.rows)) {
    return { ok: false, status: 503, error: 'bot_directory_unavailable', ownerId };
  }
  if (result.rows.length === 0) return { ok: false, status: 404, error: 'bot_not_found', ownerId };
  return { ok: true, ownerId };
}

/**
 * Forward to a DO stub with a verified owner header. Always strip the internal
 * position-check header so clients cannot smuggle cron privileges.
 */
function forwardToBot(stub, target, request, ownerId = null) {
  const headers = new Headers(request.headers);
  headers.delete(INTERNAL_POSITION_HEADER);
  if (ownerId) headers.set(OWNER_HEADER, ownerId);
  const init = {
    method: request.method,
    headers,
    redirect: request.redirect,
  };
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
    init.body = request.body;
    // Node/undici requires duplex when re-wrapping a streaming body.
    init.duplex = 'half';
  }
  return stub.fetch(new Request(target, init));
}

const LOOP_BOT_ID = /^[a-zA-Z0-9:_-]{1,128}$/;

function clipLoopGoal(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 2000);
}

async function readLoopPayload(request) {
  const text = await request.text();
  if (!text.trim()) return { kind: 'json', value: {} };
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { kind: 'raw', text };
    return { kind: 'json', value: parsed };
  } catch {
    return { kind: 'raw', text };
  }
}

async function enrichLoopPayload(body, env, botId, ownerId) {
  const next = { ...body };
  if (supabaseConfig(env)) {
    delete next.bot;
    delete next.wallet;
    delete next.ledger;
    next.botId = botId;
  }
  if (!LOOP_BOT_ID.test(typeof next.botId === 'string' ? next.botId : '')) next.botId = botId;
  const suppliedGoal = clipLoopGoal(next.goal);
  if (suppliedGoal) next.goal = suppliedGoal;
  else delete next.goal;
  if (next.permission === 'full' && next.ownerPermission == null) next.ownerPermission = 'full';
  if (next.ownerPermission !== 'full' && next.ownerPermission !== 'review') delete next.ownerPermission;
  const complete = next.bot && next.wallet && next.ledger;
  if (!complete && typeof env.loadLoopContext === 'function') {
    try {
      const loaded = await env.loadLoopContext({
        botId,
        ownerId,
        goal: next.goal || '',
      });
      if (loaded && typeof loaded === 'object') {
        if (!next.bot && loaded.bot) next.bot = loaded.bot;
        if (!next.wallet && loaded.wallet) next.wallet = loaded.wallet;
        if (!next.ledger && loaded.ledger) next.ledger = loaded.ledger;
      }
    } catch {
      // A missing record is reported by the loop. Do not invent a bot or a balance.
    }
  }
  if (!next.goal) {
    const fromBot = clipLoopGoal(next.bot?.goal);
    if (fromBot) next.goal = fromBot;
  }
  return next;
}

function forwardPrepared(stub, target, request, ownerId, body, raw = false) {
  const headers = new Headers(request.headers);
  headers.delete(INTERNAL_POSITION_HEADER);
  headers.delete('content-length');
  if (ownerId) headers.set(OWNER_HEADER, ownerId);
  if (!raw) headers.set('content-type', 'application/json');
  return stub.fetch(new Request(target, {
    method: 'POST',
    headers,
    body: raw ? body : JSON.stringify(body),
  }));
}

async function forwardBotAction(stub, target, request, ownerId, env, botId, action) {
  if (request.method === 'POST' && (action === 'pause' || action === 'resume') && supabaseConfig(env)) {
    // Update the spend policy before changing the checkpoint. The RPC is
    // idempotent, so a caller can retry if the checkpoint write fails.
    try {
      const rpc = createSupabaseRpc(env, env.fetch ?? fetch);
      const result = await rpc(action === 'pause' ? 'policy_pause_bot' : 'policy_resume_bot', {
        payload: { ownerId, botId, now: Date.now() },
      });
      if (result?.state === 'blocked') return json({ error: result.reason }, 409);
      if (result?.enabled !== (action === 'resume')) return json({ error: 'agent_control_failed' }, 502);
    } catch {
      return json({ error: 'agent_control_failed' }, 502);
    }
  }
  if (action === 'loop' && request.method === 'POST') {
    const read = await readLoopPayload(request);
    if (read.kind === 'raw') return forwardPrepared(stub, target, request, ownerId, read.text, true);
    const payload = await enrichLoopPayload(read.value, env, botId, ownerId);
    return forwardPrepared(stub, target, request, ownerId, payload, false);
  }
  if (typeof action === 'string' && action.startsWith('card-loop') && request.method === 'POST') {
    const read = await readLoopPayload(request);
    const value = read.kind === 'json' ? { ...read.value } : {};
    value.botId = botId;
    return forwardPrepared(stub, target, request, ownerId, value, false);
  }
  return forwardToBot(stub, target, request, ownerId);
}

export { BotDurableObject };

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Maelstrom agent runtime Worker.
 * Routes wake/pause/resume/status, the checkpointed bot loop, and owner-bound browser sessions to a per-bot Durable Object.
 * QuickNode Streams wake bots through /wake. Hourly cron reads on-chain holdings.
 * A second cron re-checks USDC when the stream is stale.
 * ElevenLabs speech hits /voice. The desk text agent decides. Webhook tools do not.
 */
const routed = {
  async fetch(request, rawEnv) {
    const env = enrichEnv(rawEnv);
    if (request.method === 'OPTIONS') {
      return corsPreflightResponse(request, env);
    }
    const response = await dispatch(request, env, rawEnv);
    return withCors(request, response, env);
  },

  async scheduled(controller, rawEnv, ctx) {
    return runScheduled(controller, rawEnv, ctx);
  },
};

async function dispatch(request, env, rawEnv = env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      // Presence only — never echo secret values. bound=name exists; set=non-empty.
      const bound = (name) => rawEnv?.[name] != null && rawEnv[name] !== undefined;
      const set = (name) => typeof rawEnv?.[name] === 'string' && rawEnv[name].trim() !== '';
      const flag = (name) => ({ bound: bound(name), set: set(name) });
      const sb = supabaseConfig(rawEnv);
      return json({
        ok: true,
        product: env.PRODUCT ?? 'Maelstrom',
        cluster: SOLANA_CLUSTER,
        rpcConfigured: Boolean(configuredSolanaRpc(rawEnv)),
        signing: Boolean(env.transferClient),
        supabase: Boolean(sb),
        secrets: {
          PRIVY_APP_ID: flag('PRIVY_APP_ID'),
          PRIVY_APP_SECRET: flag('PRIVY_APP_SECRET'),
          PRIVY_AUTHORIZATION_KEY: flag('PRIVY_AUTHORIZATION_KEY'),
          PRIVY_SIGNER_ID: flag('PRIVY_SIGNER_ID'),
          NEXT_PUBLIC_PRIVY_SIGNER_ID: flag('NEXT_PUBLIC_PRIVY_SIGNER_ID'),
          SOLANA_RPC_URL: flag('SOLANA_RPC_URL'),
          QUICKNODE_MAINNET_RPC_URL: flag('QUICKNODE_MAINNET_RPC_URL'),
          SUPABASE_URL: flag('SUPABASE_URL'),
          SUPABASE_ANON_KEY: flag('SUPABASE_ANON_KEY'),
          SUPABASE_SERVICE_ROLE_KEY: flag('SUPABASE_SERVICE_ROLE_KEY'),
          META_MODEL_API_KEY: flag('META_MODEL_API_KEY'),
          OPENROUTER_API_KEY: flag('OPENROUTER_API_KEY'),
          ELEVENLABS_API_KEY: flag('ELEVENLABS_API_KEY'),
          ELEVENLABS_AGENT_ID: flag('ELEVENLABS_AGENT_ID'),
          ELEVENLABS_WEBHOOK_SECRET: flag('ELEVENLABS_WEBHOOK_SECRET'),
        },
      });
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

    // Isaac / 6B+6C: shopping, signal sell, SNS send
    const commerce = matchCommerceRoute(request.method, url.pathname);
    if (commerce) return dispatchCommerceRoute(request, env, commerce);

    if (url.pathname === '/api/routes' && request.method === 'GET') {
      return json({ routes: API_ROUTES, secretNames: SECRET_NAMES });
    }

    const matched = matchApiRoute(request.method, url.pathname);
    if (matched?.route.id === 'spend.create') return handleSpend(request, env);
    if (matched?.route.action && matched.params.botId) {
      const botId = matched.params.botId;
      let ownerId = null;
      if (isOwnerBotAction(matched.route.action)) {
        const gate = await assertBotOwner(request, env, botId);
        if (!gate.ok) return json({ error: gate.error }, gate.status);
        ownerId = gate.ownerId;
      }
      const stub = botStub(env, botId);
      const prefix = `/bots/${encodeURIComponent(botId)}`;
      const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : '';
      const target = rest.startsWith('/browser/')
        ? new URL(`https://bot/id/${encodeURIComponent(botId)}${rest}`)
        : new URL(`https://bot/${matched.route.action}`);
      return forwardBotAction(stub, target, request, ownerId, env, botId, matched.route.action);
    }

    // Live data / wallet routes (Supabase + Privy when secrets exist).
    if (matched && [
      'me',
      'wallets.list',
      'wallets.create',
      'wallets.persist',
      'wallets.sign',
      'wallets.export',
      'bots.list',
      'bots.create',
      'bots.delete',
      'bots.freeze',
      'bots.chat',
      'desk.lock',
      'desk.unlock',
      'desk.status',
      'state.list',
      'state.write',
      'recovery.status',
      'recovery.issue',
      'recovery.verify',
      'events.list',
      'logs.list',
      'decisions.list',
      'payments.list',
      'metrics.get',
      'profiles.me',
      'profiles.update',
      'profiles.lookup',
      'transfers.list',
      'transfers.create',
      'positions.list',
    ].includes(matched.route.id)) {
      const response = await handleApiData(request, env, matched);
      if (response) return response;
    }

    const botMatch = url.pathname.match(/^\/bots\/([^/]+)(?:\/(status|wake|pause|resume|advance|decide|loop))?$/);
    if (botMatch) {
      const botId = decodeURIComponent(botMatch[1]);
      const action = botMatch[2] ?? 'status';
      let ownerId = null;
      if (isOwnerBotAction(action)) {
        const gate = await assertBotOwner(request, env, botId);
        if (!gate.ok) return json({ error: gate.error }, gate.status);
        ownerId = gate.ownerId;
      }
      const stub = botStub(env, botId);
      const target = new URL(`https://bot/${action}`);
      return forwardBotAction(stub, target, request, ownerId, env, botId, action);
    }

    return json({ error: 'not_found' }, 404);
}

async function runScheduled(controller, rawEnv, ctx) {
    const env = enrichEnv(rawEnv);
    const cron = typeof controller?.cron === 'string' && controller.cron ? controller.cron : HOURLY_CRON;
    const now = Number.isSafeInteger(controller?.scheduledTime) ? controller.scheduledTime : Date.now();
    const bots = typeof env.listScheduledBots === 'function'
      ? await env.listScheduledBots()
      : await listScheduledBotsFromSupabase(env, env.fetch ?? fetch);
    if (!Array.isArray(bots) || bots.length === 0) {
      logCron(env, ctx, { cron, bots: [] });
      return;
    }

    const health = typeof env.readStreamHealth === 'function'
      ? await env.readStreamHealth(now)
      : await readStreamHealthFromSupabase(env, env.fetch ?? fetch);
    const plan = planScheduledWork({ bots, now, cron, health });
    const holdingsByWallet = new Map();
    let lookup;
    for (const bot of plan.positionChecks) {
      const address = walletAddress(bot);
      if (address && !holdingsByWallet.has(address)) {
        const readHoldings = env.readTradeHoldings ?? (address => readSolanaWalletBalances({
          address, rpcUrl: configuredSolanaRpc(env), fetcher: env.fetch ?? fetch,
        }));
        const live = await readHoldings(address).catch(() => null);
        holdingsByWallet.set(address, live);
      }
      const snapshot = holdingsByWallet.get(address);
      const available = snapshot?.ok === true && snapshot.cluster === SOLANA_CLUSTER;
      const positions = available ? (snapshot.holdings ?? []).map(({ mint, asset, amount, decimals }) => ({
        mint: mint || (asset === 'SOL' ? SOL_MINT : null), amount, decimals,
      })) : [];
      if (positions.length && lookup === undefined) lookup = priceLookup(env);
      const quotes = lookup && positions.length ? await quotePositions(lookup, positions) : {};
      ctx.waitUntil(deliverCheck(env, bot, { reason: 'cron-hourly', positions, quotes, available, now }));
    }

    if (!plan.streamDropped) {
      logCron(env, ctx, { cron, bots: bots.map(bot => bot.id).slice(0, 50), streamDropped: false });
      return;
    }
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
    logCron(env, ctx, { cron, bots: bots.map(bot => bot.id).slice(0, 50), streamDropped: true });
}

const worker = {
  async fetch(request, rawEnv, ctx) {
    const env = enrichEnv(rawEnv);
    const started = Date.now();
    const logging = Boolean(supabaseConfig(env));
    let captured = null;
    if (logging) {
      try {
        captured = await captureRequest(request);
      } catch {
        captured = null;
      }
    }
    let response;
    try {
      response = await routed.fetch(request, rawEnv);
    } catch {
      response = json({ error: 'internal' }, 500);
    }
    if (logging) {
      if (captured) captured.ownerId = requestOwner(request);
      const pending = persistHttpActivity(env, { captured, response, started }).catch(() => {});
      if (typeof ctx?.waitUntil === 'function') ctx.waitUntil(pending);
      else await pending;
    }
    return response;
  },

  scheduled(controller, rawEnv, ctx) {
    return routed.scheduled(controller, rawEnv, ctx);
  },
};

function logCron(env, ctx, detail) {
  if (!supabaseConfig(env) || typeof ctx?.waitUntil !== 'function') return;
  // Security: never log full position books, quotes, or balances — ids + flags only.
  const safe = {
    cron: typeof detail?.cron === 'string' ? detail.cron.slice(0, 64) : null,
    botCount: Array.isArray(detail?.bots) ? detail.bots.length : 0,
    bots: Array.isArray(detail?.bots) ? detail.bots.slice(0, 50).map(id => String(id).slice(0, 128)) : [],
    streamDropped: detail?.streamDropped === true,
  };
  ctx.waitUntil(persistActivity(env, {
    source: 'cron',
    action: `cron ${safe.cron ?? 'scheduled'}`,
    detail: safe,
  }).catch(() => {}));
}

export default worker;

function priceLookup(env) {
  return resolvePriceLookup(env);
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
      return { ok: false, code: 'rpc_failed', cluster: SOLANA_CLUSTER, address };
    }
  }
  return readSolanaUsdcBalance({
    rpcUrl: configuredSolanaRpc(env),
    address,
    fetcher: env.fetch ?? fetch,
  });
}

function checkPayload(bot, { reason, positions, quotes, balance, available, now }) {
  return {
    botId: bot.id,
    goal: typeof bot.goal === 'string' ? bot.goal : '',
    type: bot.type ?? null,
    maxLoss: bot.maxLoss ?? bot.cap?.maxLoss ?? null,
    ownerId: typeof bot.ownerId === 'string' ? bot.ownerId : null,
    positions: positions ?? [],
    available: available === true,
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
    available: payload.available,
  });
  const quotes = {};
  for (const [mint, quote] of Object.entries(payload.quotes ?? {})) quotes[mint] = slimQuote(quote);
  payload.quotes = quotes;
  payload.balance = recorded.balance;
  const response = botStub(env, bot.id).fetch(new Request('https://bot/position-check', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [INTERNAL_POSITION_HEADER]: INTERNAL_POSITION_VALUE,
      ...(payload.ownerId ? { [OWNER_HEADER]: payload.ownerId } : {}),
    },
    body: JSON.stringify(payload),
  })).then(response => response, () => Response.json({ ok: false, check: recorded }));
  return response.then(async (delivered) => {
    if (delivered.ok && payload.ownerId) {
      await persistPositionCheck(env, {
        ownerId: payload.ownerId,
        botId: bot.id,
        check: recorded,
      }).catch(() => {});
    }
    if ((recorded.flag === 'max-loss' || recorded.flag === 'near-max-loss') && payload.ownerId) {
      await rememberBotAlert(env, null, {
        alert: recorded.flag === 'max-loss' ? 'max-loss' : 'near-max-loss',
        botId: bot.id,
        ownerId: payload.ownerId,
        at: payload.now,
        scope: recorded.flag === 'near-max-loss' ? 'near-max-loss' : payload.now,
      });
    }
    return delivered;
  });
}
