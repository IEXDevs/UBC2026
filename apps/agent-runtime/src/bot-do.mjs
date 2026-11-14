import { createEmptyRun, advanceRun, pauseRun, resumeRun } from './checkpoint.mjs';
import { decideFromCheckpoint } from './decide.mjs';

/**
 * Per-bot Durable Object. Holds live run checkpoints only.
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

  async handle(request, env = {}) {
    const url = new URL(request.url);
    const now = Date.now();

    if (request.method === 'GET' && url.pathname === '/status') {
      const run = await this.get('run');
      const meta = await this.get('meta');
      return Response.json({ ok: true, meta, run });
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

    return Response.json({ error: 'not_found' }, { status: 404 });
  }
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
    const storage = this.state.storage;
    this.machine = new BotStateMachine({
      has: async () => false,
      get: async () => undefined,
      set: async () => {},
    });
    // Patch instance methods to use DO storage.
    this.machine.get = async key => (await storage.get(key)) ?? null;
    this.machine.put = async (key, value) => { await storage.put(key, value); };
    this._ready = true;
    return this.machine;
  }

  async fetch(request) {
    const machine = await this.#machine();
    return machine.handle(request, this.env);
  }
}
