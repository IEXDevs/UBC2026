import {
  handleQuickNodeWebhook,
  createMemoryDedupeStore,
} from '@ubc2026/quicknode-streams';

/** Process-wide fallback dedupe for local/dev; prefer env.STREAM_DEDUPE (KV) in production. */
const fallbackDedupe = createMemoryDedupeStore();

function headerMap(request) {
  const headers = {};
  request.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
  return headers;
}

/**
 * QuickNode Streams webhook entry (Isaac / 5A).
 * Verifies HMAC, dedupes by tx signature, optionally persists, wakes bot DOs.
 */
export async function processQuickNodeWebhook(request, env, botStub) {
  const secret = env.QUICKNODE_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: 'webhook_secret_required' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const rawBody = await request.text();
  const dedupeStore = env.STREAM_DEDUPE ?? fallbackDedupe;

  try {
    const result = await handleQuickNodeWebhook({
      secret,
      headers: headerMap(request),
      rawBody,
      dedupeStore,
      persistEvent: typeof env.persistStreamEvent === 'function' ? env.persistStreamEvent : null,
      resolveBotIds: typeof env.resolveBotsForWallet === 'function'
        ? async (event) => env.resolveBotsForWallet(event)
        : async (event) => (event.botId ? [event.botId] : []),
    });

    const wakeResults = [];
    for (const wake of result.wakes) {
      const stub = botStub(env, wake.botId);
      const response = await stub.fetch(new Request('https://bot/wake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botId: wake.botId,
          reason: 'quicknode-stream',
          goal: '',
          streamEvent: {
            signature: wake.event.signature,
            wallet: wake.event.wallet,
            type: wake.event.type,
          },
        }),
      }));
      wakeResults.push({ botId: wake.botId, status: response.status });
    }

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
