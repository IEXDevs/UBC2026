import {
  handleQuickNodeWebhook,
  createMemoryDedupeStore,
  createMemoryWalletKv,
  createQuickNodeKvClient,
  createSupabaseStreamStore,
  createKvDedupeStore,
  syncWalletsToKv,
  runStreamBackfill,
  StreamsError,
} from '@ubc2026/quicknode-streams';

/** Process-wide fallback dedupe for local/dev; prefer STREAM_DEDUPE KV or Supabase in production. */
const fallbackDedupe = createMemoryDedupeStore();

function headerMap(request) {
  const headers = {};
  request.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
  return headers;
}

function supabaseStore(env) {
  if (env.streamStore) return env.streamStore;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createSupabaseStreamStore({
    url: env.SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    fetchImpl: env.fetch || fetch,
  });
}

function dedupeFor(env) {
  if (env.dedupeStore) return env.dedupeStore;
  const sb = supabaseStore(env);
  if (sb) return sb;
  if (env.STREAM_DEDUPE?.get && env.STREAM_DEDUPE?.put) {
    return createKvDedupeStore(env.STREAM_DEDUPE);
  }
  return fallbackDedupe;
}

function walletKvFor(env) {
  if (env.walletKv) return env.walletKv;
  if (env.QUICKNODE_API_KEY && env.QUICKNODE_WALLET_LIST_KEY) {
    return createQuickNodeKvClient({
      apiKey: env.QUICKNODE_API_KEY,
      listKey: env.QUICKNODE_WALLET_LIST_KEY,
      fetchImpl: env.fetch || fetch,
    });
  }
  return createMemoryWalletKv();
}

function resolveBotIdsFor(env) {
  return async (event) => {
    if (typeof env.resolveBotsForWallet === 'function') {
      return env.resolveBotsForWallet(event);
    }
    const sb = supabaseStore(env);
    if (sb) return sb.resolveBotsForWallet(event);
    return event.botId ? [event.botId] : [];
  };
}

function persistFor(env) {
  return async (event) => {
    if (typeof env.persistStreamEvent === 'function') {
      return env.persistStreamEvent(event);
    }
    const sb = supabaseStore(env);
    if (sb) return sb.persistEvent(event);
    return null;
  };
}

async function wakeAndMaybeLoop(env, botStub, wake) {
  const stub = botStub(env, wake.botId);
  const wakeRes = await stub.fetch(new Request('https://bot/wake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      botId: wake.botId,
      reason: wake.reason || 'quicknode-stream',
      goal: wake.bot?.goal || '',
      streamEvent: {
        signature: wake.event.signature,
        wallet: wake.event.wallet,
        type: wake.event.type,
        amount: wake.event.amount,
        token: wake.event.token,
      },
    }),
  }));

  const out = { botId: wake.botId, wakeStatus: wakeRes.status };

  if (env.SKIP_STREAM_LOOP) return out;

  const context = typeof env.loadLoopContext === 'function'
    ? await env.loadLoopContext(wake)
    : null;
  if (!context || !wake.ownerId) return out;

  const loopRes = await stub.fetch(new Request('https://bot/loop', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-owner-id': wake.ownerId,
    },
    body: JSON.stringify(context),
  }));
  const text = await loopRes.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  out.loopStatus = loopRes.status;
  out.loop = body;
  return out;
}

/**
 * QuickNode Streams webhook entry (Isaac / 5A).
 * HMAC → dedupe → Supabase persist → wallet→bot resolve → DO /wake → optional 4A /loop.
 */
export async function processQuickNodeWebhook(request, env, botStub) {
  const secret = env.QUICKNODE_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: 'webhook_secret_required' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const rawBody = await request.text();

  try {
    const result = await handleQuickNodeWebhook({
      secret,
      headers: headerMap(request),
      rawBody,
      dedupeStore: dedupeFor(env),
      persistEvent: persistFor(env),
      resolveBotIds: resolveBotIdsFor(env),
      afterWake: (wake) => wakeAndMaybeLoop(env, botStub, wake),
    });

    const wakeResults = result.wakes.map((w) => ({
      botId: w.botId,
      status: w.after?.wakeStatus ?? 0,
      loopStatus: w.after?.loopStatus,
    }));

    return Response.json({
      ok: true,
      accepted: result.accepted.length,
      duplicates: result.duplicates.length,
      wakes: wakeResults,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error.status ?? 400;
    return Response.json({ error: error.code ?? error.message }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}

/** Owner: push desired Privy wallet addresses into the QuickNode Streams KV list. */
export async function processStreamWalletSync(request, env) {
  const ownerId = request.headers.get('x-owner-id');
  if (!ownerId) {
    return Response.json({ error: 'owner_required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }

  let body = {};
  try { body = await request.json(); } catch { body = {}; }

  const sb = supabaseStore(env);
  const wallets = Array.isArray(body.wallets)
    ? body.wallets
    : Array.isArray(body.addresses)
      ? body.addresses
      : sb
        ? await sb.listWalletAddresses()
        : null;

  if (!Array.isArray(wallets)) {
    return Response.json({ error: 'wallets_required_without_supabase' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const result = await syncWalletsToKv({ wallets, walletKv: walletKvFor(env) });
    return Response.json({ ok: true, ownerId, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof StreamsError) {
      return Response.json({ error: error.code }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
    }
    throw error;
  }
}

/** Owner: replay missed Stream rows through the same persist→wake→loop path. */
export async function processStreamBackfill(request, env, botStub) {
  const ownerId = request.headers.get('x-owner-id');
  if (!ownerId) {
    return Response.json({ error: 'owner_required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }

  let body = {};
  try { body = await request.json(); } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const rows = body.rows || body.events || body.data;
  if (!Array.isArray(rows)) {
    return Response.json({ error: 'rows_required' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const result = await runStreamBackfill({
      rows,
      dedupeStore: dedupeFor(env),
      persistEvent: persistFor(env),
      resolveBotIds: resolveBotIdsFor(env),
      afterWake: (wake) => wakeAndMaybeLoop(env, botStub, wake),
    });
    return Response.json({
      ok: true,
      ownerId,
      accepted: result.accepted.length,
      duplicates: result.duplicates.length,
      wakes: result.wakes.map((w) => ({
        botId: w.botId,
        status: w.after?.wakeStatus ?? 0,
        loopStatus: w.after?.loopStatus,
      })),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof StreamsError) {
      return Response.json({ error: error.code }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
    }
    throw error;
  }
}
