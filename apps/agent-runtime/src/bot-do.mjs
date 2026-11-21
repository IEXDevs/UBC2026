import { configuredSolanaRpc, SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
import { createSearch } from '@ubc2026/browser-search';
import { createBrowserSessionService, createDefaultBrowserSessionService, ProviderError, SessionError } from '@ubc2026/browser-session';
import { SECRET_NAMES } from '@ubc2026/contracts';
import {
  CardLoopError,
  cardLoopDue,
  createCardLoop,
  LOOP_BREAK_HEADER,
  ownerBreakAuthorized,
  publicCardLoop,
  setCardLoopCooldown,
} from '@ubc2026/contracts/card-loop';
import { TransferError } from '@ubc2026/transfers';
import { readSolanaWalletBalances } from '@ubc2026/wallets/balances';
import { createEmptyRun, advanceRun, pauseRun, resumeRun } from './checkpoint.mjs';
import { decideFromCheckpoint } from './decide.mjs';
import { verifierFacts } from './spend-verifier.mjs';
import { LoopEngineError, runBotLoop } from './loop-engine.mjs';
import { INTERNAL_LOOP_SWAP, pendingLoopSwap } from './loop-swap.mjs';
import { createOpenRouterFromEnv, OpenRouterError } from './openrouter.mjs';
import { resolvePriceLookup } from './price-lookup.mjs';
import { resolveTrustLookup } from './trust-lookup.mjs';
import { assessPositions } from './schedules.mjs';
import { alertFromGate, alertFromPauseReason, rememberBotAlert, rememberDecisionMemo } from './bot-alerts.mjs';
import { handleLasoRequest } from './laso-do.mjs';
import { enrichEnv } from './runtime-env.mjs';

const OWNER_HEADER = 'x-owner-id';
/** Set only by the Worker cron path that calls the DO stub directly — never from the public edge. */
export const INTERNAL_POSITION_HEADER = 'x-maelstrom-internal';
export const INTERNAL_POSITION_VALUE = 'position-check';
export const INTERNAL_CARD_LOOP_VALUE = 'card-loop';
const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

function noStore(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function browserFailure(error) {
  if (error instanceof SessionError || error instanceof ProviderError) {
    return noStore({
      error: error.code,
      ...(Number.isInteger(error.providerStatus) ? { providerStatus: error.providerStatus } : {}),
      ...(['targets_unavailable', 'binding_session_expired', 'binding_failed'].includes(error.providerReason) ? { providerReason: error.providerReason } : {}),
    }, error.status);
  }
  return noStore({ error: 'browser_failed' }, 500);
}

function ownerFrom(request) {
  const ownerId = request.headers.get(OWNER_HEADER);
  if (typeof ownerId !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(ownerId)) return null;
  return ownerId;
}

const BOT_ID = /^[a-zA-Z0-9:_-]{1,128}$/;

function clipGoal(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 2000);
}

function loopBotId(body, meta) {
  const candidates = [body?.botId, body?.bot?.id, meta?.botId];
  for (const value of candidates) {
    if (typeof value === 'string' && BOT_ID.test(value)) return value;
  }
  return '';
}

function loopInput(body) {
  const input = { ...body };
  if (input.ownerPermission == null && input.permission === 'full') input.ownerPermission = 'full';
  if (input.ownerPermission === 'ask') delete input.ownerPermission;
  return input;
}

function loopModels(env) {
  return env.openRouter ?? createOpenRouterFromEnv(env, env.fetch ?? fetch);
}

function loopDeps(env) {
  return {
    search: env.search ?? (env.FIRECRAWL_API_KEY
      ? createSearch({ apiKey: env.FIRECRAWL_API_KEY, fetcher: env.fetch ?? fetch })
      : null),
    transferClient: env.transferClient ?? null,
    execute: env.execute ?? null,
    ledgerApi: env.ledgerApi ?? null,
    verifyFn: env.verifyFn,
    lookupPrice: resolvePriceLookup(env),
    trustLookup: resolveTrustLookup(env),
    readTradeHoldings: env.readTradeHoldings ?? (address => readSolanaWalletBalances({
      address, rpcUrl: configuredSolanaRpc(env), fetcher: env.fetch ?? fetch,
    })),
    recentBlockhash: env.recentBlockhash,
    secrets: SECRET_NAMES.map(name => env[name]).filter(value => typeof value === 'string' && value.length >= 8),
  };
}

function replaceableSwapRun(run, now) {
  const pending = pendingLoopSwap(run);
  return pending ? pending.expiresAt <= now : Boolean(
    run?.checkpoints?.decide?.proposal?.swap || run?.checkpoints?.execute?.paper
    || run?.checkpoints?.execute?.mode === 'live-swap'
    || ['no-trade-found', 'decide-invalid', 'use-permissioned-spend', 'swap_requires_usd_budget'].includes(run?.pauseReason),
  );
}

async function loopContext(env, body, ownerId) {
  const bot = body?.bot && typeof body.bot === 'object' ? body.bot : null;
  const wallet = body?.wallet && typeof body.wallet === 'object' ? body.wallet : null;
  const ledger = body?.ledger && typeof body.ledger === 'object' ? body.ledger : null;
  if (bot && wallet && ledger) return { bot, wallet, ledger };
  const botId = loopBotId(body, null);
  if (!botId || typeof env.loadLoopContext !== 'function') return { bot, wallet, ledger };
  try {
    const loaded = await env.loadLoopContext({ botId, ownerId, goal: clipGoal(body?.goal) });
    return {
      bot: bot || loaded?.bot || null,
      wallet: wallet || loaded?.wallet || null,
      ledger: ledger || loaded?.ledger || null,
    };
  } catch {
    return { bot, wallet, ledger };
  }
}

function isInternalPositionCheck(request) {
  return request.headers.get(INTERNAL_POSITION_HEADER) === INTERNAL_POSITION_VALUE;
}

function isInternalCardLoop(request) {
  return request.headers.get(INTERNAL_POSITION_HEADER) === INTERNAL_CARD_LOOP_VALUE;
}

function publicMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  return {
    botId: typeof meta.botId === 'string' ? meta.botId : null,
    cluster: typeof meta.cluster === 'string' ? meta.cluster : null,
    updatedAt: Number.isSafeInteger(meta.updatedAt) ? meta.updatedAt : null,
  };
}

/**
 * Adapter over Durable Object storage. `list` pages so closed session rows are not dropped.
 * `start` is treated as exclusive, matching Workers KV/DO list.
 */
export function createDurableStore(storage) {
  return {
    async get(key) {
      const value = await storage.get(key);
      return value == null ? null : structuredClone(value);
    },
    async put(key, value) {
      await storage.put(key, structuredClone(value));
    },
    async delete(key) {
      await storage.delete(key);
    },
    async list(prefix) {
      const values = [];
      const seen = new Set();
      let start;
      for (;;) {
        const page = await storage.list({ prefix, start, limit: 100 });
        let added = 0;
        let last;
        for (const [key, value] of page) {
          last = key;
          if (seen.has(key)) continue;
          seen.add(key);
          added += 1;
          values.push(structuredClone(value));
        }
        if (!last || added === 0 || page.size < 100) break;
        start = last;
      }
      return values;
    },
  };
}

function storeForMachine(machine) {
  return {
    get: key => machine.get(key),
    put: (key, value) => machine.put(key, value),
    delete: key => machine.delete(key),
    list: prefix => machine.list(prefix),
  };
}

function browserService(machine, env) {
  const store = storeForMachine(machine);
  if (env.browserSessionService) return env.browserSessionService;
  if (env.browsers) {
    return createBrowserSessionService({
      store,
      browsers: env.browsers,
      search: null,
      scrape: null,
      maxSessionsPerBot: env.MAX_BROWSER_SESSIONS_PER_BOT ?? 2,
    });
  }
  return createDefaultBrowserSessionService(env, store);
}

/**
 * Per-bot Durable Object. Holds live run checkpoints and owner-bound browser session records.
 * Durable business records (ledger, approvals, wallets) live in Supabase.
 *
 * This module is structured so unit tests can drive the same state machine
 * without a live workerd. The Cloudflare export wraps it below.
 */
export class BotStateMachine {
  constructor(storage = new Map(), hooks = {}) {
    this.storage = storage;
    this.hooks = hooks && typeof hooks === 'object' ? hooks : {};
  }

  async armAlarm(at) {
    if (typeof this.hooks.arm === 'function' && Number.isSafeInteger(at)) await this.hooks.arm(at);
  }

  async clearAlarm() {
    if (typeof this.hooks.clear === 'function') await this.hooks.clear();
  }

  async get(key) {
    return this.storage.has(key) ? structuredClone(this.storage.get(key)) : null;
  }

  async put(key, value) {
    this.storage.set(key, structuredClone(value));
  }

  async delete(key) {
    this.storage.delete(key);
  }

  async list(prefix) {
    if (!(this.storage instanceof Map)) return [];
    return [...this.storage.entries()]
      .filter(([key]) => typeof key === 'string' && key.startsWith(prefix))
      .map(([, value]) => structuredClone(value));
  }

  /**
   * When meta.ownerId is bound, require a matching x-owner-id.
   * Unbound DOs (stream wake before ownership stamp) still allow the call —
   * the Worker edge assertBotOwner covers public exposure.
   */
  async requireBoundOwner(request) {
    const meta = await this.get('meta');
    const metaOwner = typeof meta?.ownerId === 'string' ? meta.ownerId : null;
    if (!metaOwner) return null;
    const ownerId = ownerFrom(request);
    if (!ownerId) {
      return Response.json({ error: 'owner_required' }, { status: 401 });
    }
    if (ownerId !== metaOwner) {
      return Response.json({ error: 'owner_forbidden' }, { status: 403 });
    }
    return null;
  }

  async handle(request, env = {}) {
    const url = new URL(request.url);
    const now = Date.now();

    if (request.method === 'GET' && url.pathname === '/status') {
      const meta = await this.get('meta');
      const ownerId = ownerFrom(request);
      const metaOwner = typeof meta?.ownerId === 'string' ? meta.ownerId : null;
      // Unauthenticated callers must not see paper positions, run goals, or check history.
      if (!ownerId) {
        return Response.json({
          ok: true,
          meta: publicMeta(meta),
          run: null,
          positionCheck: null,
          auth: 'required',
        }, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (metaOwner && metaOwner !== ownerId) {
        return Response.json({ error: 'owner_forbidden' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
      }
      const run = await this.get('run');
      const savedCheck = await this.get('lastPositionCheck');
      const positionCheck = savedCheck?.paper === false ? savedCheck : null;
      const cardLoop = publicCardLoop(await this.get('cardLoop'));
      const ownerPaused = await this.get('ownerPaused') === true;
      const pendingSwap = pendingLoopSwap(run);
      return Response.json({
        ok: true,
        meta,
        run,
        paused: ownerPaused || run?.paused === true,
        ownerPaused,
        positionCheck,
        cardLoop,
        ...(!ownerPaused && pendingSwap?.expiresAt > now ? { pendingSwap } : {}),
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (url.pathname === '/loop-swap' && request.headers.get(INTERNAL_POSITION_HEADER) === INTERNAL_LOOP_SWAP) {
      const meta = await this.get('meta');
      if (!meta?.ownerId || ownerFrom(request) !== meta.ownerId) return noStore({ error: 'owner_forbidden' }, 403);
      const run = await this.get('run');
      const intent = pendingLoopSwap(run);
      if (!intent || intent.botId !== meta.botId) return noStore({ error: 'swap_intent_unavailable' }, 409);
      if (request.method === 'GET') {
        if (await this.get('ownerPaused') === true) return noStore({ error: 'run_paused' }, 409);
        return noStore({ intent });
      }
      const receipt = await request.json().catch(() => null);
      if (request.method !== 'POST' || receipt?.idempotencyKey !== intent.idempotencyKey
          || !SOLANA_SIGNATURE.test(receipt.signature ?? '')) return noStore({ error: 'invalid_swap_receipt' }, 409);
      const submitted = advanceRun(resumeRun(run, now), 'execute', 'Swap submitted to Solana', now);
      submitted.checkpoints.execute = {
        at: now, status: 'done', mode: 'live-swap', state: 'submitted', executed: true,
        cluster: SOLANA_CLUSTER, idempotencyKey: intent.idempotencyKey, signature: receipt.signature,
      };
      await this.put('run', submitted);
      return noStore({ ok: true });
    }

    if (request.method === 'POST' && url.pathname === '/position-check') {
      const body = await request.json().catch(() => ({}));
      const botId = String(body.botId ?? '');
      if (!botId) return Response.json({ error: 'botId_required' }, { status: 400 });
      const meta = await this.get('meta');
      const metaOwner = typeof meta?.ownerId === 'string' ? meta.ownerId : null;
      const headerOwner = ownerFrom(request);
      const internal = isInternalPositionCheck(request);
      // Public callers must prove owner. Cron uses the internal header set only on stub.fetch.
      if (!internal) {
        if (!headerOwner) {
          return Response.json({ error: 'owner_required' }, { status: 401 });
        }
        if (metaOwner && metaOwner !== headerOwner) {
          return Response.json({ error: 'owner_forbidden' }, { status: 403 });
        }
        if (typeof body.ownerId === 'string' && body.ownerId.length > 0 && body.ownerId !== headerOwner) {
          return Response.json({ error: 'owner_mismatch' }, { status: 403 });
        }
        const saved = await this.get('lastPositionCheck');
        return noStore({ ok: true, check: saved?.paper === false ? saved : null });
      }
      const ownerId = headerOwner || metaOwner;
      if (metaOwner && ownerId !== metaOwner) return noStore({ error: 'owner_forbidden' }, 403);
      if (ownerId && !metaOwner) {
        await this.put('meta', {
          ...(meta && typeof meta === 'object' ? meta : {}),
          botId: meta?.botId || botId,
          ownerId,
          cluster: meta?.cluster || SOLANA_CLUSTER,
          updatedAt: now,
        });
      }
      const checkedAt = Number.isSafeInteger(body.now) ? body.now : now;
      const check = assessPositions({
        bot: {
          id: botId,
          maxLoss: body.maxLoss ?? null,
        },
        positions: body.positions,
        quotes: body.quotes ?? {},
        balance: body.balance ?? null,
        reason: body.reason,
        now: checkedAt,
        available: body.available === true,
      });
      await this.put('lastPositionCheck', check);
      const history = await this.get('positionCheckHistory');
      const prior = Array.isArray(history) ? history : [];
      await this.put('positionCheckHistory', [...prior, check].slice(-48));
      if ((check.flag === 'max-loss' || check.flag === 'near-max-loss') && ownerId) {
        await rememberBotAlert(env, this, {
          alert: check.flag === 'max-loss' ? 'max-loss' : 'near-max-loss',
          botId,
          ownerId,
          at: checkedAt,
          scope: check.flag === 'near-max-loss' ? 'near-max-loss' : checkedAt,
        });
      }
      return Response.json({ ok: true, check }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (request.method === 'POST' && url.pathname === '/alert') {
      const ownerId = ownerFrom(request);
      const body = await request.json().catch(() => null);
      if (!ownerId || !body || body.ownerId !== ownerId) {
        return Response.json({ error: 'owner_required' }, { status: 401 });
      }
      const event = await rememberBotAlert(env, this, body);
      if (!event) return Response.json({ error: 'invalid_alert' }, { status: 400 });
      return Response.json({ ok: true, event });
    }

    if (request.method === 'GET' && url.pathname === '/alerts') {
      const ownerId = ownerFrom(request);
      if (!ownerId) return Response.json({ error: 'owner_required' }, { status: 401 });
      const prior = await this.get('alerts');
      const items = (Array.isArray(prior) ? prior : []).filter(event => event && event.ownerId === ownerId);
      return Response.json({ ok: true, items });
    }

    if (request.method === 'POST' && url.pathname === '/wake') {
      const body = await request.json().catch(() => ({}));
      const botId = String(body.botId ?? '');
      const goal = String(body.goal ?? '');
      if (!botId) return Response.json({ error: 'botId_required' }, { status: 400 });
      const headerOwner = ownerFrom(request);
      const bodyOwner = typeof body.ownerId === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(body.ownerId)
        ? body.ownerId
        : null;
      // Prefer verified header; ignore a body ownerId that conflicts with the header (IDOR attempt).
      if (headerOwner && bodyOwner && headerOwner !== bodyOwner) {
        return Response.json({ error: 'owner_mismatch' }, { status: 403 });
      }
      const priorMeta = await this.get('meta');
      const priorOwner = typeof priorMeta?.ownerId === 'string' ? priorMeta.ownerId : null;
      let ownerId = headerOwner || bodyOwner || null;
      if (priorOwner && ownerId && priorOwner !== ownerId) {
        return Response.json({ error: 'owner_forbidden' }, { status: 403 });
      }
      // Stream wakes may omit owner — never wipe a bound ownerId with null.
      if (priorOwner && !ownerId) ownerId = priorOwner;
      if (await this.get('ownerPaused') === true) return Response.json({ error: 'run_paused' }, { status: 409 });
      let run = await this.get('run');
      if (!run || body.forceNew || (body.reason === 'owner-ask' && replaceableSwapRun(run, now))) {
        run = createEmptyRun({ runId: `run_${now}`, botId, goal, now });
      } else if (run.paused) {
        // Do not leak the full checkpoint to an unauthorized caller.
        return Response.json({ error: 'run_paused' }, { status: 409 });
      }
      run = advanceRun(run, 'research', body.reason ?? 'wake', now);
      await this.put('run', run);
      await this.put('meta', {
        botId,
        ownerId: ownerId || null,
        cluster: SOLANA_CLUSTER,
        updatedAt: now,
      });
      return Response.json({ ok: true, run });
    }

    if (request.method === 'POST' && url.pathname === '/pause') {
      const body = await request.json().catch(() => ({}));
      const ownerGate = await this.requireBoundOwner(request);
      if (ownerGate) return ownerGate;
      let run = await this.get('run');
      await this.put('ownerPaused', true);
      if (run && !run.paused) {
        run = pauseRun(run, body.reason ?? 'owner-pause', now);
        await this.put('run', run);
      }
      return Response.json({ ok: true, run, paused: true });
    }

    if (request.method === 'POST' && url.pathname === '/resume') {
      const ownerGate = await this.requireBoundOwner(request);
      if (ownerGate) return ownerGate;
      let run = await this.get('run');
      if (run?.paused) {
        run = resumeRun(run, now);
        await this.put('run', run);
      }
      await this.delete('ownerPaused');
      const loop = await this.get('cardLoop');
      if (loop?.active) await this.armAlarm(Math.max(now, loop.nextWakeAt));
      return Response.json({ ok: true, run, paused: false });
    }

    if (request.method === 'POST' && url.pathname === '/advance') {
      const body = await request.json().catch(() => ({}));
      const ownerGate = await this.requireBoundOwner(request);
      if (ownerGate) return ownerGate;
      let run = await this.get('run');
      if (!run) return Response.json({ error: 'no_run' }, { status: 404 });
      try {
        run = advanceRun(run, body.step, body.summary, now);
      } catch (error) {
        return Response.json({ error: error.message }, { status: 409 });
      }
      await this.put('run', run);
      return Response.json({ ok: true, run });
    }

    if (request.method === 'POST' && url.pathname === '/loop') {
      const ownerId = ownerFrom(request);
      if (!ownerId) return Response.json({ error: 'owner_required' }, { status: 401 });
      const ownerGate = await this.requireBoundOwner(request);
      if (ownerGate) return ownerGate;
      if (await this.get('ownerPaused') === true) return Response.json({ error: 'run_paused' }, { status: 409 });
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return Response.json({ error: 'invalid_json' }, { status: 400 });
      }
      const loopNow = Number.isSafeInteger(body.now) ? body.now : Date.now();
      const context = await loopContext(env, body, ownerId);
      const meta = await this.get('meta');
      const botId = loopBotId({ ...body, bot: context.bot || body.bot }, meta);
      const goal = clipGoal(body.goal) || clipGoal(context.bot?.goal) || '';
      let run = await this.get('run');
      if (!run || replaceableSwapRun(run, loopNow)) {
        if (!botId) return Response.json({ error: 'no_run' }, { status: 404 });
        run = createEmptyRun({ runId: `run_${loopNow}`, botId, goal, now: loopNow });
        await this.put('run', run);
        await this.put('meta', {
          botId,
          ownerId,
          cluster: SOLANA_CLUSTER,
          updatedAt: loopNow,
        });
      } else if (goal && !run.goal) {
        run = { ...run, goal };
        await this.put('run', run);
      }
      const models = loopModels(env);
      const deps = loopDeps(env);
      const input = loopInput(body);
      try {
        const result = await runBotLoop({
          run,
          bot: context.bot,
          wallet: context.wallet,
          ledger: context.ledger,
          ownerId,
          input,
          models,
          deps,
          now: loopNow,
          persist: async next => { await this.put('run', next); },
        });
        const alert = alertFromPauseReason(result.run?.pauseReason);
        if (alert && context.bot?.id) {
          await rememberBotAlert(env, this, {
            alert,
            botId: context.bot.id,
            ownerId,
            at: loopNow,
            scope: result.run?.runId || loopNow,
          });
        }
        const memoStep = result.run?.checkpoints?.memo;
        if (memoStep?.status === 'done' && typeof memoStep.digest === 'string' && context.bot?.id) {
          const approval = result.run?.checkpoints?.approval;
          await rememberDecisionMemo(env, this, {
            botId: context.bot.id,
            ownerId,
            at: loopNow,
            runId: result.run.runId,
            digest: memoStep.digest,
            trustScore: result.run?.checkpoints?.decide?.facts?.trustScore,
            approval: approval?.automatic === true ? 'auto' : (approval?.action || 'recorded'),
          });
        }
        return Response.json({ ok: true, ...result });
      } catch (error) {
        // Owner already passed requireBoundOwner — returning the saved run lets the
        // shell resume; unauthenticated callers never reach this branch.
        const saved = await this.get('run');
        if (error instanceof OpenRouterError) return Response.json({ error: error.code, run: saved }, { status: error.status });
        if (error instanceof TransferError) return Response.json({ error: error.code, run: saved }, { status: 409 });
        if (error instanceof LoopEngineError) return Response.json({ error: error.code, run: saved }, { status: error.status });
        return Response.json({ error: 'loop_failed', run: saved }, { status: 500 });
      }
    }

    if (request.method === 'POST' && url.pathname === '/decide') {
      const body = await request.json().catch(() => ({}));
      const ownerGate = await this.requireBoundOwner(request);
      if (ownerGate) return ownerGate;
      let run = await this.get('run');
      if (!run) return Response.json({ error: 'no_run' }, { status: 404 });
      if (!body.bot || !body.wallet || !body.ledger || !body.proposal || !body.facts) {
        return Response.json({ error: 'decide_payload_incomplete' }, { status: 400 });
      }
      const facts = body.facts;
      try {
        const result = await decideFromCheckpoint({
          run,
          bot: body.bot,
          wallet: body.wallet,
          ledger: body.ledger,
          proposal: body.proposal,
          trustScore: body.trustScore ?? facts.trustScore,
          trustConfirmed: body.trustConfirmed === true,
          mainFn: async () => facts,
          verifyFn: async () => verifierFacts({
            facts,
            proposal: body.proposal,
            trustScore: body.trustScore ?? facts.trustScore,
          }),
          now,
        });
        await this.put('run', result.run);
        await this.put('lastGate', { at: now, gate: result.gate });
        const alert = alertFromGate(result.gate);
        if (alert && body.bot?.id && body.bot?.ownerId) {
          await rememberBotAlert(env, this, {
            alert,
            botId: body.bot.id,
            ownerId: body.bot.ownerId,
            at: now,
            scope: result.run?.runId || now,
          });
        }
        return Response.json({ ok: true, run: result.run, gate: result.gate });
      } catch (error) {
        return Response.json({ error: error.message }, { status: 409 });
      }
    }

    if (url.pathname === '/card-loop/tick' && request.method === 'POST') {
      if (!isInternalCardLoop(request)) return Response.json({ error: 'not_found' }, { status: 404 });
      const ownerGate = await this.requireBoundOwner(request);
      if (ownerGate) return ownerGate;
      const body = await request.json().catch(() => ({}));
      const tickNow = Number.isSafeInteger(body?.now) ? body.now : now;
      const woke = await this.wakeCardLoop(env, tickNow);
      return Response.json({ ok: true, ...woke }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (url.pathname === '/card-loop/check' && request.method === 'POST') {
      if (!ownerFrom(request)) return noStore({ error: 'owner_required' }, 401);
      const ownerGate = await this.requireBoundOwner(request);
      if (ownerGate) return ownerGate;
      return noStore({ ok: true, ...await this.wakeCardLoop(env, now) });
    }

    if (url.pathname === '/card-loop' || url.pathname === '/card-loop/cooldown' || url.pathname === '/card-loop/break') {
      return this.handleCardLoop(request, env, url.pathname, now);
    }

    if (url.pathname === '/laso/session' || url.pathname === '/laso/checkpoint' || url.pathname === '/laso/status') {
      return handleLasoRequest(this, request, env, now, url.pathname);
    }

    const browserPath = url.pathname.match(/^\/id\/([^/]+)\/browser\/sessions(?:\/([^/]+)\/(live-view|release|navigate|click))?$/);
    if (browserPath) {
      return this.handleBrowser(request, env, {
        botId: decodeURIComponent(browserPath[1]),
        sessionRecordId: browserPath[2] ? decodeURIComponent(browserPath[2]) : null,
        leaf: browserPath[3] ?? null,
      });
    }

    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  async handleCardLoop(request, env, pathname, now) {
    if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    const ownerId = ownerFrom(request);
    if (!ownerId) return Response.json({ error: 'owner_required' }, { status: 401 });
    const ownerGate = await this.requireBoundOwner(request);
    if (ownerGate) return ownerGate;
    const body = await request.json().catch(() => ({}));
    const meta = await this.get('meta');
    const botId = loopBotId({ botId: body?.botId }, meta);
    if (!botId) return Response.json({ error: 'invalid_bot' }, { status: 400 });
    if (!meta?.ownerId) {
      await this.put('meta', {
        ...(meta && typeof meta === 'object' ? meta : {}),
        botId,
        ownerId,
        cluster: meta?.cluster || SOLANA_CLUSTER,
        updatedAt: now,
      });
    }
    try {
      if (pathname === '/card-loop') {
        const loop = createCardLoop({
          botId,
          purpose: body?.purpose,
          cooldownMinutes: body?.cooldownMinutes,
          now,
        });
        await this.put('cardLoop', loop);
        await this.armAlarm(loop.nextWakeAt);
        return Response.json({ ok: true, loop: publicCardLoop(loop) }, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (pathname === '/card-loop/cooldown') {
        const current = await this.get('cardLoop');
        const loop = setCardLoopCooldown(current, body?.cooldownMinutes, now);
        await this.put('cardLoop', loop);
        await this.armAlarm(loop.nextWakeAt);
        return Response.json({ ok: true, loop: publicCardLoop(loop) }, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (!ownerBreakAuthorized(request.headers.get(LOOP_BREAK_HEADER))) {
        return Response.json({ error: 'owner_must_ask' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
      }
      await this.delete('cardLoop');
      await this.clearAlarm();
      return Response.json({ ok: true, loop: null }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      if (error instanceof CardLoopError) {
        return Response.json({ error: error.code }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
      }
      return Response.json({ error: 'loop_failed' }, { status: 500 });
    }
  }

  /**
   * Cooldown elapsed. Start the bot again through runBotLoop, which runs the
   * decision gate before any spend. This method does not sign on its own.
   */
  async wakeCardLoop(env, now) {
    if (this.cardLoopWake) return { woke: false, reason: 'running', spent: false };
    this.cardLoopWake = this.runDueCardLoop(env, now);
    try {
      return await this.cardLoopWake;
    } finally {
      this.cardLoopWake = null;
    }
  }

  async runDueCardLoop(env, now) {
    const loop = await this.get('cardLoop');
    if (!loop?.active) return { woke: false, reason: 'no_loop', spent: false };
    if (await this.get('ownerPaused') === true) return { woke: false, reason: 'run_paused', spent: false };
    if (!cardLoopDue(loop, now)) return { woke: false, reason: 'cooling', spent: false };
    const meta = await this.get('meta');
    const ownerId = typeof meta?.ownerId === 'string' ? meta.ownerId : null;
    const botId = loop.botId;
    const context = await loopContext(env, { botId, goal: loop.purpose }, ownerId);
    const stillScheduled = current => current?.active && current.createdAt === loop.createdAt
      && current.nextWakeAt === loop.nextWakeAt;
    if (!stillScheduled(await this.get('cardLoop')) || await this.get('ownerPaused') === true) {
      return { woke: false, reason: 'schedule_changed', spent: false };
    }
    let run = await this.get('run');
    const retry = ['research-failed', 'verifier-blocked', 'spend-frozen'].includes(run?.pauseReason);
    if (!run || retry || replaceableSwapRun(run, now) || run.checkpoints?.monitor?.status === 'done') {
      run = createEmptyRun({ runId: `run_${now}`, botId, goal: loop.purpose, now });
      await this.put('run', run);
    }
    let gate = 'not-run';
    let spent = false;
    try {
      const result = await runBotLoop({
        run,
        bot: context.bot,
        wallet: context.wallet,
        ledger: context.ledger,
        ownerId,
        input: { goal: loop.purpose, botId, scheduled: true },
        models: loopModels(env),
        deps: loopDeps(env),
        now,
        persist: async (next) => {
          if (!stillScheduled(await this.get('cardLoop')) || await this.get('ownerPaused') === true) {
            throw new LoopEngineError('schedule_changed', 409);
          }
          await this.put('run', next);
        },
      });
      gate = result.run?.pauseReason || (result.waiting ? 'waiting' : 'ran');
      const execution = result.run?.checkpoints?.execute;
      spent = execution?.at === now && typeof execution.signature === 'string';
    } catch (error) {
      gate = typeof error?.code === 'string' ? error.code : 'loop_failed';
    }
    const current = await this.get('cardLoop');
    if (!stillScheduled(current)) {
      return { woke: true, gate, throughGate: true, spent, loop: publicCardLoop(current) };
    }
    const minutes = loop.cooldownMinutes;
    const next = {
      ...loop,
      lastWakeAt: now,
      lastGate: gate,
      nextWakeAt: now + minutes * 60_000,
    };
    await this.put('cardLoop', next);
    if (await this.get('ownerPaused') !== true) await this.armAlarm(next.nextWakeAt);
    return { woke: true, gate, throughGate: true, spent, loop: publicCardLoop(next) };
  }

  async handleBrowser(request, env, { botId, sessionRecordId, leaf }) {
    try {
      const ownerId = ownerFrom(request);
      if (!ownerId) return noStore({ error: 'owner_required' }, 401);
      const service = browserService(this, env);
      if (!leaf && request.method === 'GET') {
        return noStore(await service.listOpenSessions({ ownerId, botId }));
      }
      if (!leaf && request.method === 'POST') {
        const body = await readBrowserBody(request);
        const opened = await service.openSession({
          ownerId,
          botId,
          purpose: body.purpose ?? 'browse',
          url: typeof body.url === 'string' ? body.url : null,
        });
        return noStore({
          sessionRecordId: opened.sessionRecordId,
          purpose: opened.purpose,
          status: opened.status,
          url: opened.url,
          title: opened.title,
          reused: opened.reused === true,
          note: opened.note,
          event: opened.event,
        });
      }
      if (leaf === 'navigate' && request.method === 'POST') {
        const body = await readBrowserBody(request);
        const navigated = await service.navigateSession({
          ownerId,
          botId,
          sessionRecordId,
          url: body.url,
        });
        return noStore({
          sessionRecordId: navigated.sessionRecordId,
          url: navigated.url,
          title: navigated.title,
          recovered: navigated.recovered === true,
          note: navigated.note,
          event: navigated.event,
        });
      }
      if (leaf === 'live-view' && request.method === 'POST') {
        const body = await readBrowserBody(request);
        const control = body.control === 'owner' || body.control === 'agent' ? body.control : undefined;
        const view = await service.liveView({ ownerId, botId, sessionRecordId, control });
        return noStore({
          sessionRecordId: view.sessionRecordId,
          viewerUrl: view.viewerUrl,
          connectBefore: view.connectBefore,
          mode: view.mode,
          control: view.control,
          pageUrl: view.pageUrl,
          embedVerified: view.embedVerified,
          fallback: view.fallback,
          event: view.event,
        });
      }
      if (leaf === 'click' && request.method === 'POST') {
        const body = await readBrowserBody(request);
        if (typeof body.selector !== 'string' || !body.selector.trim() || body.selector.length > 256) {
          return noStore({ error: 'invalid_selector' }, 400);
        }
        const clicked = await service.click({
          ownerId,
          botId,
          sessionRecordId,
          selector: body.selector.trim(),
        });
        return noStore({
          sessionRecordId: clicked.sessionRecordId,
          x: clicked.x,
          y: clicked.y,
          tag: clicked.tag,
          text: clicked.text,
          event: clicked.event,
        });
      }
      if (leaf === 'release' && request.method === 'POST') {
        await readBrowserBody(request);
        const closed = await service.releaseSession({ ownerId, botId, sessionRecordId });
        return noStore({
          sessionRecordId: closed.sessionRecordId,
          status: closed.status,
          event: closed.event,
        });
      }
      return noStore({ error: 'method_not_allowed' }, 405);
    } catch (error) {
      return browserFailure(error);
    }
  }
}

async function readBrowserBody(request) {
  const text = await request.text();
  if (!text) return {};
  let body;
  try { body = JSON.parse(text); } catch { throw new SessionError('invalid_json', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SessionError('invalid_json', 400);
  if (body.sessionId != null || body.providerSessionId != null || body.viewerUrl != null) {
    throw new SessionError('provider_session_forbidden', 400);
  }
  if (body.ownerId != null && body.ownerId !== request.headers.get(OWNER_HEADER)) {
    throw new SessionError('owner_mismatch', 400);
  }
  return body;
}

/** Cloudflare Durable Object export. */
export class BotDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.machine = new BotStateMachine({
      has: key => false,
      get: () => undefined,
      set: () => {},
    });
    // Replace Map-like facade with DO storage async adapter on first request.
    this._ready = false;
  }

  async #machine() {
    if (this._ready) return this.machine;
    const store = createDurableStore(this.state.storage);
    this.machine.get = key => store.get(key);
    this.machine.put = (key, value) => store.put(key, value);
    this.machine.delete = key => store.delete(key);
    this.machine.list = prefix => store.list(prefix);
    this.machine.hooks = {
      arm: (at) => {
        const storage = this.state?.storage;
        if (storage && typeof storage.setAlarm === 'function') return storage.setAlarm(at);
        return undefined;
      },
      clear: () => {
        const storage = this.state?.storage;
        if (storage && typeof storage.deleteAlarm === 'function') return storage.deleteAlarm();
        return undefined;
      },
    };
    this._ready = true;
    return this.machine;
  }

  async alarm() {
    const machine = await this.#machine();
    await machine.wakeCardLoop(enrichEnv(this.env), Date.now());
  }

  async fetch(request) {
    const machine = await this.#machine();
    return machine.handle(request, enrichEnv(this.env));
  }
}
