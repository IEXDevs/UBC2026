import { createSearch } from '@ubc2026/browser-search';
import { createBrowserSessionService, createDefaultBrowserSessionService, ProviderError, SessionError } from '@ubc2026/browser-session';
import { SECRET_NAMES } from '@ubc2026/contracts';
import { TransferError } from '@ubc2026/transfers';
import { createEmptyRun, advanceRun, pauseRun, resumeRun } from './checkpoint.mjs';
import { decideFromCheckpoint } from './decide.mjs';
import { LoopEngineError, runBotLoop } from './loop-engine.mjs';
import { createOpenRouterFromEnv, OpenRouterError } from './openrouter.mjs';
import { assessPositions } from './schedules.mjs';

const OWNER_HEADER = 'x-owner-id';

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
      const run = await this.get('run');
      const meta = await this.get('meta');
      const positionCheck = await this.get('lastPositionCheck');
      return Response.json({ ok: true, meta, run, positionCheck });
    }

    if (request.method === 'POST' && url.pathname === '/position-check') {
      const body = await request.json().catch(() => ({}));
      const botId = String(body.botId ?? '');
      if (!botId) return Response.json({ error: 'botId_required' }, { status: 400 });
      const stored = await this.get('positions');
      const fromBody = Array.isArray(body.positions) ? body.positions : [];
      const positions = fromBody.length > 0 ? fromBody : (Array.isArray(stored) ? stored : []);
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
      const history = await this.get('positionCheckHistory');
      const prior = Array.isArray(history) ? history : [];
      await this.put('positionCheckHistory', [...prior, check].slice(-48));
      return Response.json({ ok: true, check });
    }

    if (request.method === 'POST' && url.pathname === '/wake') {
      const body = await request.json().catch(() => ({}));
      const botId = String(body.botId ?? '');
      const goal = String(body.goal ?? '');
      if (!botId) return Response.json({ error: 'botId_required' }, { status: 400 });
      let run = await this.get('run');
      if (!run || body.forceNew) {
        run = createEmptyRun({ runId: `run_${now}`, botId, goal, now });
      } else if (run.paused) {
        return Response.json({ error: 'run_paused', run }, { status: 409 });
      }
      run = advanceRun(run, 'research', body.reason ?? 'wake', now);
      await this.put('run', run);
      await this.put('meta', { botId, cluster: env.CLUSTER ?? 'devnet', updatedAt: now });
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
        verifyFn: env.verifyFn,
        lookupPrice: env.lookupPrice,
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
          verifyFn: async () => body.verifyFacts ?? facts,
          now,
        });
        await this.put('run', result.run);
        await this.put('lastGate', { at: now, gate: result.gate });
        return Response.json({ ok: true, run: result.run, gate: result.gate });
      } catch (error) {
        return Response.json({ error: error.message }, { status: 409 });
      }
    }

    const browserPath = url.pathname.match(/^\/id\/([^/]+)\/browser\/sessions(?:\/([^/]+)\/(live-view|release))?$/);
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
        const opened = await service.openSession({ ownerId, botId, purpose: body.purpose ?? 'browse' });
        return noStore({
          sessionRecordId: opened.sessionRecordId,
          purpose: opened.purpose,
          status: opened.status,
          event: opened.event,
        });
      }
      if (leaf === 'live-view' && request.method === 'POST') {
        await readBrowserBody(request);
        const view = await service.liveView({ ownerId, botId, sessionRecordId });
        return noStore({
          sessionRecordId: view.sessionRecordId,
          viewerUrl: view.viewerUrl,
          connectBefore: view.connectBefore,
          mode: view.mode,
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
    return machine.handle(request, this.env);
  }
}
