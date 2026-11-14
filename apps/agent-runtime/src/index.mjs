import { API_ROUTES, SECRET_NAMES, matchApiRoute } from '@ubc2026/contracts';
import { BotDurableObject } from './bot-do.mjs';
import { processQuickNodeWebhook } from './quicknode-webhook.mjs';

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
 * QuickNode Streams and hourly cron wake bots through the same /wake path.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, product: env.PRODUCT ?? 'Maelstrom', cluster: env.CLUSTER ?? 'devnet' });
    }

    // QuickNode Streams webhook (Isaac / 5A): HMAC → dedupe → persist → wake bots.
    if (url.pathname === '/webhooks/quicknode' && request.method === 'POST') {
      return processQuickNodeWebhook(request, env, botStub);
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
    // Stub hourly cron (API_ROUTES cron.hourly). Wakes only bots the caller
    // lists. Position checks and Supabase schedule queries are a later chunk.
    const listed = typeof env.listScheduledBots === 'function'
      ? await env.listScheduledBots()
      : [];
    for (const bot of listed) {
      ctx.waitUntil(
        botStub(env, bot.id).fetch(new Request('https://bot/wake', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ botId: bot.id, reason: 'cron-hourly', goal: bot.goal ?? '' }),
        })),
      );
    }
  },
};
