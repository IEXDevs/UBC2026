import { BotDurableObject } from './bot-do.mjs';

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
 * Routes wake/pause/resume/status to a per-bot Durable Object.
 * QuickNode Streams and hourly cron wake bots through the same /wake path.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, product: env.PRODUCT ?? 'Maelstrom', cluster: env.CLUSTER ?? 'devnet' });
    }

    // QuickNode Streams webhook → wake the assigned bot.
    if (url.pathname === '/webhooks/quicknode' && request.method === 'POST') {
      const secret = request.headers.get('x-quicknode-signature') ?? request.headers.get('authorization');
      if (env.QUICKNODE_WEBHOOK_SECRET && secret !== env.QUICKNODE_WEBHOOK_SECRET) {
        return json({ error: 'unauthorized' }, 401);
      }
      const body = await request.json().catch(() => ({}));
      const botId = String(body.botId ?? body.metadata?.botId ?? '');
      if (!botId) return json({ error: 'botId_required' }, 400);
      const stub = botStub(env, botId);
      return stub.fetch(new Request('https://bot/wake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId, reason: 'quicknode-stream', goal: body.goal ?? '' }),
      }));
    }

    const botMatch = url.pathname.match(/^\/bots\/([^/]+)(?:\/(status|wake|pause|resume|advance|decide))?$/);
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
    // Hourly cron fallback: wake bots that opted into scheduled monitoring.
    // Real implementation will query Supabase for enabled bots with schedules.
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
