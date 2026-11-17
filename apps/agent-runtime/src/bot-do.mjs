import { createSearch } from '@ubc2026/browser-search';
import { createBrowserSessionService, createDefaultBrowserSessionService, ProviderError, SessionError } from '@ubc2026/browser-session';
import { SECRET_NAMES } from '@ubc2026/contracts';
import { TransferError } from '@ubc2026/transfers';
import { createEmptyRun, advanceRun, pauseRun, resumeRun } from './checkpoint.mjs';
import { decideFromCheckpoint } from './decide.mjs';
import { verifierFacts } from './spend-verifier.mjs';
import { LoopEngineError, runBotLoop } from './loop-engine.mjs';
import { createOpenRouterFromEnv, OpenRouterError } from './openrouter.mjs';
import { resolvePriceLookup } from './price-lookup.mjs';
import { assessPositions } from './schedules.mjs';
import { alertFromGate, alertFromPauseReason, rememberBotAlert } from './bot-alerts.mjs';
import { enrichEnv } from './runtime-env.mjs';

const OWNER_HEADER = 'x-owner-id';
/** Set only by the Worker cron path that calls the DO stub directly — never from the public edge. */
export const INTERNAL_POSITION_HEADER = 'x-maelstrom-internal';
export const INTERNAL_POSITION_VALUE = 'position-check';

function noStore(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function browserFailure(error) {
  if (error instanceof SessionError || error instanceof ProviderError) {
    return noStore({ error: error.code }, error.status);
  }
  return noStore({ error: 'browser_failed' }, 500);
}

function ownerFrom(request) {
  const ownerId = request.headers.get(OWNER_HEADER);
  if (typeof ownerId !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(ownerId)) return null;
  return ownerId;
}

function isInternalPositionCheck(request) {
  return request.headers.get(INTERNAL_POSITION_HEADER) === INTERNAL_POSITION_VALUE;
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
  constructor(storage = new Map()) {
    this.storage = storage;
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
      const positionCheck = await this.get('lastPositionCheck');
      return Response.json({
        ok: true,
        meta,
        run,
        positionCheck,
      }, { headers: { 'Cache-Control': 'no-store' } });
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
      }
      const ownerId = internal
        ? (typeof body.ownerId === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(body.ownerId) ? body.ownerId : metaOwner)
        : headerOwner;
      if (ownerId && (!metaOwner || metaOwner !== ownerId)) {
        await this.put('meta', {
          ...(meta && typeof meta === 'object' ? meta : {}),
          botId: meta?.botId || botId,
          ownerId,
          cluster: meta?.cluster || env.CLUSTER || 'devnet',
          updatedAt: now,
        });
      }
      const stored = await this.get('positions');
      const fromBody = Array.isArray(body.positions) ? body.positions : [];
      // Only the Worker cron (internal) or the verified owner may replace the book from the body.
      const positions = (internal || headerOwner)
        ? (fromBody.length > 0 ? fromBody : (Array.isArray(stored) ? stored : []))
        : (Array.isArray(stored) ? stored : []);
      const checkedAt = Number.isSafeInteger(body.now) ? body.now : now;
      const check = assessPositions({
        bot: {
          id: botId,
          maxLoss: body.maxLoss ?? null,
        },
        positions,
        quotes: body.quotes ?? {},
        balance: body.balance ?? null,
        reason: body.reason,
        now: checkedAt,
      });
      await this.put('lastPositionCheck', check);
      if (Array.isArray(fromBody) && fromBody.length > 0 && (internal || headerOwner)) {
        await this.put('positions', fromBody.slice(0, 30));
      }
      const history = await this.get('positionCheckHistory');
      const prior = Array.isArray(history) ? history : [];
      await this.put('positionCheckHistory', [...prior, check].slice(-48));
      if (check.flag === 'max-loss' && ownerId) {
        await rememberBotAlert(env, this, {
          alert: 'max-loss',
          botId,
          ownerId,
          at: checkedAt,
          scope: checkedAt,
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
      const ownerId = headerOwner || bodyOwner;
      let run = await this.get('run');
      if (!run || body.forceNew) {
        run = createEmptyRun({ runId: `run_${now}`, botId, goal, now });
      } else if (run.paused) {
        return Response.json({ error: 'run_paused', run }, { status: 409 });
      }
      run = advanceRun(run, 'research', body.reason ?? 'wake', now);
      await this.put('run', run);
      await this.put('meta', {
        botId,
        ownerId: ownerId || null,
        cluster: env.CLUSTER ?? 'devnet',
        updatedAt: now,
      });
      return Response.json({ ok: true, run });
    }

    if (request.method === 'POST' && url.pathname === '/pause') {
      const body = await request.json().catch(() => ({}));
      let run = await this.get('run');
      if (!run) return Response.json({ error: 'no_run' }, { status: 404 });
      run = pauseRun(run, body.reason ?? 'owner-pause', now);
      await this.put('run', run);
      return Response.json({ ok: true, run });
    }

    if (request.method === 'POST' && url.pathname === '/resume') {
      let run = await this.get('run');
      if (!run) return Response.json({ error: 'no_run' }, { status: 404 });
      run = resumeRun(run, now);
      await this.put('run', run);
      return Response.json({ ok: true, run });
    }

    if (request.method === 'POST' && url.pathname === '/advance') {
      const body = await request.json().catch(() => ({}));
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
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return Response.json({ error: 'invalid_json' }, { status: 400 });
      }
      const run = await this.get('run');
      if (!run) return Response.json({ error: 'no_run' }, { status: 404 });
      const now = Number.isSafeInteger(body.now) ? body.now : Date.now();
      const models = env.openRouter ?? createOpenRouterFromEnv(env, env.fetch ?? fetch);
      const deps = {
        search: env.search ?? (env.FIRECRAWL_API_KEY
          ? createSearch({ apiKey: env.FIRECRAWL_API_KEY, fetcher: env.fetch ?? fetch })
          : null),
        transferClient: env.transferClient ?? null,
        execute: env.execute ?? null,
        ledgerApi: env.ledgerApi ?? null,
        verifyFn: env.verifyFn,
        lookupPrice: resolvePriceLookup(env),
        trustLookup: env.trustLookup,
        recentBlockhash: env.recentBlockhash,
        secrets: SECRET_NAMES.map(name => env[name]).filter(value => typeof value === 'string' && value.length >= 8),
      };
      try {
        const result = await runBotLoop({
          run,
          bot: body.bot,
          wallet: body.wallet,
          ledger: body.ledger,
          ownerId,
          input: body,
          models,
          deps,
          now,
          persist: async next => { await this.put('run', next); },
        });
        const alert = alertFromPauseReason(result.run?.pauseReason);
        if (alert && body.bot?.id) {
          await rememberBotAlert(env, this, {
            alert,
            botId: body.bot.id,
            ownerId,
            at: now,
            scope: result.run?.runId || now,
          });
        }
        return Response.json({ ok: true, ...result });
      } catch (error) {
        const saved = await this.get('run');
        if (error instanceof OpenRouterError) return Response.json({ error: error.code, run: saved }, { status: error.status });
        if (error instanceof TransferError) return Response.json({ error: error.code, run: saved }, { status: 409 });
        if (error instanceof LoopEngineError) return Response.json({ error: error.code, run: saved }, { status: error.status });
        return Response.json({ error: 'loop_failed', run: saved }, { status: 500 });
      }
    }

    if (request.method === 'POST' && url.pathname === '/decide') {
      const body = await request.json().catch(() => ({}));
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

    const browserPath = url.pathname.match(/^\/id\/([^/]+)\/browser\/sessions(?:\/([^/]+)\/(live-view|release|navigate))?$/);
    if (browserPath) {
      return this.handleBrowser(request, env, {
        botId: decodeURIComponent(browserPath[1]),
        sessionRecordId: browserPath[2] ? decodeURIComponent(browserPath[2]) : null,
        leaf: browserPath[3] ?? null,
      });
    }

    return Response.json({ error: 'not_found' }, { status: 404 });
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
    this._ready = true;
    return this.machine;
  }

  async fetch(request) {
    const machine = await this.#machine();
    return machine.handle(request, enrichEnv(this.env));
  }
}
