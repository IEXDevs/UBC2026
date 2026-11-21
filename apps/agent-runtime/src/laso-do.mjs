/**
 * Laso memory and status inside the per-bot Durable Object.
 * - POST /laso/session is worker-internal only: it stashes the fresh Laso
 *   id_token a paid call returned, so later status reads run without asking
 *   the owner to log in again. The token never leaves DO storage, is never
 *   logged, and expires with the Laso session.
 * - /laso/checkpoint is the owner-gated fulfillment memory: where the flow
 *   paused for the owner and what resumes it. Facts only, never secrets.
 * - GET /laso/status is the owner-gated live read (card, cards, account,
 *   topups) using the stashed session. Card numbers, CVVs, and expiries are
 *   stripped before the response is built: the owner reads those on the
 *   Laso dashboard link.
 */
import {
  LasoFlowError,
  publicLasoFlow,
  startLasoFlow,
  updateLasoFlow,
} from '@ubc2026/shopping/laso-flow.mjs';
import { INTERNAL_LASO_SESSION_HEADER, INTERNAL_LASO_SESSION_VALUE } from './laso-payment.mjs';

const OWNER_HEADER = 'x-owner-id';
const SESSION_KEY = 'lasoSession';
const FLOW_KEY = 'lasoFlow';
const LASO_BASE = 'https://laso.finance';

function noStore(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function ownerFrom(request) {
  const ownerId = request.headers.get(OWNER_HEADER);
  if (typeof ownerId !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(ownerId)) return null;
  return ownerId;
}

function botIdFrom(body, meta) {
  const candidates = [body?.botId, meta?.botId];
  for (const value of candidates) {
    if (typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(value)) return value;
  }
  return '';
}

async function bindMeta(machine, meta, { botId, ownerId, now }) {
  if (meta?.ownerId) return meta;
  const next = {
    ...(meta && typeof meta === 'object' ? meta : {}),
    botId,
    ownerId,
    updatedAt: now,
  };
  await machine.put('meta', next);
  return next;
}

export function stripCardStatus(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const out = {};
  for (const key of ['card_id', 'status', 'card_type', 'usd_amount', 'on_card_usd_amount', 'charged_usd_amount',
    'last4', 'expiry', 'balance', 'spend_limit', 'reusable', 'issuer_status', 'state', 'label',
    'last_updated_timestamp', 'created_at', 'queued_order_card_id']) {
    if (data[key] !== undefined && data[key] !== null) out[key] = data[key];
  }
  if (data.details_approval && typeof data.details_approval === 'object') {
    out.details_approval = { status: data.details_approval.status ?? null };
    if (typeof data.details_approval.approval_id === 'string') out.details_approval.approval_id = data.details_approval.approval_id;
  }
  if (typeof data.details_error === 'string') out.details_error = data.details_error.slice(0, 300);
  if (Array.isArray(data.transactions)) {
    out.transactions = data.transactions.slice(0, 25).map(row => (
      row && typeof row === 'object'
        ? {
          ...(row.amount !== undefined ? { amount: row.amount } : {}),
          ...(row.date !== undefined ? { date: row.date } : {}),
          ...(typeof row.merchant === 'string' ? { merchant: row.merchant.slice(0, 120) } : {}),
          ...(typeof row.description === 'string' ? { description: row.description.slice(0, 120) } : {}),
          ...(row.status !== undefined ? { status: row.status } : {}),
        }
        : row
    ));
  }
  if (typeof out.card_id !== 'string' && !Array.isArray(out.cards)) return null;
  return out;
}

async function readSession(machine, now) {
  const session = await machine.get(SESSION_KEY);
  if (!session || typeof session !== 'object' || typeof session.idToken !== 'string'
    || !Number.isSafeInteger(session.expiresAt)) {
    if (session) await machine.delete(SESSION_KEY);
    return null;
  }
  if (session.expiresAt <= now) {
    await machine.delete(SESSION_KEY);
    return null;
  }
  return session;
}

async function lasoGet(fetcher, path, idToken) {
  let response;
  try {
    response = await fetcher(`${LASO_BASE}${path}`, {
      headers: { Authorization: `Bearer ${idToken}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return { error: 'laso_status_unavailable' };
  }
  if (response.status === 401) return { error: 'laso_session_expired', expired: true };
  if (!response.ok) return { error: 'laso_status_unavailable' };
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== 'object') return { error: 'laso_status_unavailable' };
  return { data };
}

export async function handleLasoSession(machine, request, env, now) {
  if (request.method !== 'POST'
    || request.headers.get(INTERNAL_LASO_SESSION_HEADER) !== INTERNAL_LASO_SESSION_VALUE) {
    return noStore({ error: 'forbidden' }, 403);
  }
  const body = await request.json().catch(() => ({}));
  const ownerId = typeof body?.ownerId === 'string' ? body.ownerId : null;
  const botId = botIdFrom(body, await machine.get('meta'));
  if (!ownerId || !botId) return noStore({ error: 'invalid_session' }, 400);
  if (typeof body?.idToken !== 'string' || !body.idToken || body.idToken.length > 8192) {
    return noStore({ error: 'invalid_session' }, 400);
  }
  if (!Number.isSafeInteger(body?.expiresAt) || body.expiresAt <= now
    || body.expiresAt > now + 86400 * 1000) {
    return noStore({ error: 'invalid_session' }, 400);
  }
  const meta = await bindMeta(machine, await machine.get('meta'), { botId, ownerId, now });
  if (meta.ownerId !== ownerId || meta.botId !== botId) return noStore({ error: 'owner_forbidden' }, 403);
  await machine.put(SESSION_KEY, { idToken: body.idToken, expiresAt: body.expiresAt });
  return noStore({ ok: true });
}

export async function handleLasoCheckpoint(machine, request, env, now) {
  const denied = await machine.requireBoundOwner(request);
  if (denied) return denied;
  if (request.method === 'GET') {
    if (!ownerFrom(request)) return noStore({ error: 'owner_required' }, 401);
    return noStore({ ok: true, flow: publicLasoFlow(await machine.get(FLOW_KEY)) });
  }
  if (request.method !== 'POST') return noStore({ error: 'method_not_allowed' }, 405);
  const body = await request.json().catch(() => ({}));
  const ownerId = ownerFrom(request);
  if (!ownerId) return noStore({ error: 'owner_required' }, 401);
  try {
    const current = await machine.get(FLOW_KEY);
    let flow;
    if (body?.close === true) {
      if (!current || typeof current !== 'object' || current.v !== 1) return noStore({ error: 'no_open_flow' }, 409);
      const { closeLasoFlow } = await import('@ubc2026/shopping/laso-flow.mjs');
      flow = closeLasoFlow(current, { ok: body?.ok !== false, now });
    } else if (!current || body?.restart === true) {
      const botId = botIdFrom(body, await machine.get('meta'));
      if (!botId) return noStore({ error: 'invalid_bot' }, 400);
      await bindMeta(machine, await machine.get('meta'), { botId, ownerId, now });
      flow = startLasoFlow({
        kind: body?.kind ?? 'undecided',
        amountUsd: body?.amountUsd ?? null,
        laso_server_id: body?.laso_server_id ?? null,
        country: body?.country ?? null,
        card_id: body?.card_id ?? null,
        now,
      });
      // A checkpoint can open mid-flow (the quote already exists): land on the stage given.
      if (typeof body?.stage === 'string' && body.stage !== flow.stage) {
        flow = updateLasoFlow(flow, {
          stage: body.stage,
          card_id: body?.card_id ?? null,
          note: body?.note ?? null,
          now,
        });
      }
    } else {
      flow = updateLasoFlow(current, {
        stage: body?.stage,
        card_id: body?.card_id ?? null,
        note: body?.note ?? null,
        now,
      });
    }
    await machine.put(FLOW_KEY, flow);
    return noStore({ ok: true, flow: publicLasoFlow(flow) });
  } catch (error) {
    if (error instanceof LasoFlowError) return noStore({ error: error.code }, 400);
    return noStore({ error: 'checkpoint_failed' }, 500);
  }
}

export async function handleLasoStatus(machine, request, env, now) {
  const denied = await machine.requireBoundOwner(request);
  if (denied) return denied;
  if (request.method !== 'GET') return noStore({ error: 'method_not_allowed' }, 405);
  const session = await readSession(machine, now);
  if (!session) return noStore({ error: 'laso_session_expired' }, 409);
  const url = new URL(request.url);
  const view = url.searchParams.get('view') || 'card';
  const fetcher = env.fetch ?? fetch;
  const done = async result => {
    if (result?.expired === true) await machine.delete(SESSION_KEY);
    if (result?.error) return noStore({ error: result.error }, result.expired ? 409 : 502);
    return noStore({ ok: true, view, ...result });
  };
  if (view === 'account') {
    const result = await lasoGet(fetcher, '/get-account-balance', session.idToken);
    if (result.error) return done(result);
    return done({ account: result.data });
  }
  if (view === 'topups') {
    const result = await lasoGet(fetcher, '/list-card-transactions', session.idToken);
    if (result.error) return done(result);
    const data = result.data;
    return done({
      transactions: Array.isArray(data.transactions) ? data.transactions.slice(0, 25) : [],
      top_ups: Array.isArray(data.top_ups) ? data.top_ups.slice(0, 25) : [],
      note: typeof data.note === 'string' ? data.note.slice(0, 300) : undefined,
    });
  }
  const cardId = url.searchParams.get('card_id');
  if (cardId) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(cardId)) return noStore({ error: 'invalid_card' }, 400);
    const result = await lasoGet(fetcher, `/get-card-data?card_id=${encodeURIComponent(cardId)}`, session.idToken);
    if (result.error) return done(result);
    return done({ card: stripCardStatus(result.data) });
  }
  const cardType = url.searchParams.get('card_type');
  const allowed = ['Non-Reloadable U.S.', 'Non-Reloadable International', 'Reloadable'];
  const query = cardType && allowed.includes(cardType) ? `?card_type=${encodeURIComponent(cardType)}` : '';
  const result = await lasoGet(fetcher, `/get-card-data${query}`, session.idToken);
  if (result.error) return done(result);
  const cards = Array.isArray(result.data?.cards)
    ? result.data.cards.map(stripCardStatus).filter(Boolean)
    : [];
  return done({ cards, note: typeof result.data?.note === 'string' ? result.data.note.slice(0, 300) : undefined });
}

export async function handleLasoRequest(machine, request, env, now, pathname) {
  if (pathname === '/laso/session') return handleLasoSession(machine, request, env, now);
  if (pathname === '/laso/checkpoint') return handleLasoCheckpoint(machine, request, env, now);
  if (pathname === '/laso/status') return handleLasoStatus(machine, request, env, now);
  return noStore({ error: 'not_found' }, 404);
}
