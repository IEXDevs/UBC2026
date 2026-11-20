
import { EXECUTION_LABEL } from '@ubc2026/contracts/solana';
/**
 * In-app alerts for one bot's timeline.
 * There is no central notifier. Nothing here sends email, push, or X.
 * Kinds stay inside EVENT_KINDS: max loss pauses that bot, a settled
 * verify mismatch uses verify.mismatch, and an unapproved spend stays
 * an approval request because no transfer was signed.
 */
import { EVENT_KINDS, validateTimelineEvent } from '@ubc2026/contracts';
import { supabaseWrite } from './supabase-rest.mjs';

const ALERTS = Object.freeze({
  'max-loss': {
    kind: 'bot.paused',
    summary: 'Max loss reached on this bot. The bot stops, and nothing was signed.',
  },
  'near-max-loss': {
    kind: 'run.checkpoint',
    summary: 'Nearing max loss on this bot. Nothing was signed.',
  },
  'price-down': {
    kind: 'run.checkpoint',
    summary: 'Price provider is down on this bot. Nothing was signed.',
  },
  'verify-mismatch': {
    kind: 'verify.mismatch',
    summary: 'Verify mismatch on this bot. Re-checks did not settle, so the spend stays unsigned.',
  },
  'unapproved-spend': {
    kind: 'approval.requested',
    summary: 'Unapproved spend on this bot. The transfer was not signed.',
  },
});

for (const spec of Object.values(ALERTS)) {
  if (!EVENT_KINDS.includes(spec.kind)) {
    throw new Error(`Alert kind ${spec.kind} is outside EVENT_KINDS`);
  }
}

export function alertId(alert, botId, scope) {
  const raw = `evt_alert_${alert}_${botId}_${scope}`;
  const id = raw.replace(/[^a-zA-Z0-9:_.-]/g, '_').slice(0, 256);
  if (!/^[a-zA-Z0-9:_.-]{1,256}$/.test(id)) {
    const error = new Error('invalid_alert_id');
    error.code = 'invalid_alert_id';
    throw error;
  }
  return id;
}

export function botAlertEvent({ id, botId, ownerId, alert, at }) {
  const spec = ALERTS[alert];
  if (!spec) {
    const error = new Error('unknown_alert');
    error.code = 'unknown_alert';
    throw error;
  }
  return validateTimelineEvent({
    id,
    botId,
    ownerId,
    kind: spec.kind,
    summary: spec.summary,
    at,
    prevHash: null,
  });
}

export function alertFromGate(gate) {
  if (!gate) return null;
  if (gate.state === 'verify-mismatch') return 'verify-mismatch';
  if (gate.reason === 'max-loss-reached') return 'max-loss';
  if (gate.reason === 'near-max-loss') return 'near-max-loss';
  if (gate.reason === 'invalid-approval' || gate.reason === 'budget-override-required') return 'unapproved-spend';
  return null;
}

export function alertFromPauseReason(reason) {
  if (reason === 'verify-mismatch') return 'verify-mismatch';
  if (reason === 'max-loss-reached') return 'max-loss';
  if (reason === 'provider_failed' || reason === 'provider_unavailable') return 'price-down';
  if (reason === 'invalid-approval' || reason === 'approval-denied' || reason === 'budget-override-required') {
    return 'unapproved-spend';
  }
  return null;
}

/** A normal ask-mode wait is not an alert. An attempted spend that still cannot sign is. */
export function alertFromSpend(result, request) {
  if (!result || result.signed === true) return null;
  if (result.state === 'verify-mismatch') return 'verify-mismatch';
  if (result.reason === 'max-loss-reached') return 'max-loss';
  if (result.reason === 'invalid-approval' || result.reason === 'budget-override-required') return 'unapproved-spend';
  const attempted = request?.permission === 'full' || request?.confirmed === true;
  if (result.state === 'approval-needed' && attempted) return 'unapproved-spend';
  return null;
}

function preparedAlert(input) {
  const at = input?.at;
  const scope = input?.scope ?? at;
  return botAlertEvent({
    id: input?.id || alertId(input?.alert, input?.botId, scope),
    botId: input?.botId,
    ownerId: input?.ownerId,
    alert: input?.alert,
    at,
  });
}

async function saveOnBot(storage, event) {
  if (!storage || typeof storage.get !== 'function' || typeof storage.put !== 'function') return;
  const prior = await storage.get('alerts');
  const list = Array.isArray(prior) ? prior.filter(row => row && row.botId === event.botId) : [];
  if (list.some(row => row.id === event.id)) return;
  await storage.put('alerts', [...list, event].slice(-100));
}

async function writeTimeline(env, event, fetcher) {
  const written = await supabaseWrite(env, {
    path: 'timeline_events',
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: {
      id: event.id,
      bot_id: event.botId,
      owner_id: event.ownerId,
      kind: event.kind,
      summary: event.summary,
      prev_hash: null,
      at: new Date(event.at).toISOString(),
    },
    fetcher,
  });
  return written.ok === true;
}

/**
 * Store the alert on this bot and, when Supabase is configured, on its timeline.
 * Failures stay on the bot object; callers keep going.
 */
export async function rememberBotAlert(env, storage, input, fetcher = env?.fetch ?? fetch) {
  let event;
  try {
    event = preparedAlert(input);
  } catch {
    return null;
  }
  try {
    await saveOnBot(storage, event);
  } catch {
    /* The timeline row can still land. */
  }
  try {
    await writeTimeline(env, event, fetcher);
  } catch {
    /* Offline tests have no database. The bot object holds the event. */
  }
  return event;
}

/**
 * Timeline row for a finished decision memo.
 * The memo hash stays on the run. This event records that it was written.
 */
export async function rememberDecisionMemo(env, storage, input, fetcher = env?.fetch ?? fetch) {
  const digest = typeof input?.digest === 'string' && /^[a-f0-9]{64}$/.test(input.digest) ? input.digest : '';
  const trust = typeof input?.trustScore === 'string' && /^(0|[1-9][0-9]{0,3})$/.test(input.trustScore)
    ? input.trustScore
    : '';
  const approval = typeof input?.approval === 'string' && input.approval.length <= 32 ? input.approval : 'recorded';
  const summary = [
    'Decision memo recorded.',
    trust ? `Trust ${trust}.` : '',
    'Verifier consensus.',
    `Approval ${approval}.`,
    `${EXECUTION_LABEL}.`,
  ].filter(Boolean).join(' ').slice(0, 500);
  const rawId = `evt_memo_${input?.runId || input?.at || 'run'}`;
  const id = rawId.replace(/[^a-zA-Z0-9:_.-]/g, '_').slice(0, 256);
  let event;
  try {
    event = validateTimelineEvent({
      id,
      botId: input?.botId,
      ownerId: input?.ownerId,
      kind: 'verify.settled',
      summary,
      at: input?.at,
      prevHash: digest || null,
    });
  } catch {
    return null;
  }
  if (storage && typeof storage.get === 'function' && typeof storage.put === 'function') {
    try {
      const prior = await storage.get('timeline');
      const list = Array.isArray(prior) ? prior : [];
      if (!list.some(row => row && row.id === event.id)) {
        await storage.put('timeline', [...list, event].slice(-100));
      }
    } catch {
      /* The timeline row can still land. */
    }
  }
  try {
    await writeTimeline(env, event, fetcher);
  } catch {
    /* Offline tests have no database. The bot object holds the event. */
  }
  return event;
}

// Bot Durable Objects (and the Browser Run sessions they open) are created in
// Western North America instead of near whichever colo sees the first request.
// Hints only apply when an object is first created; existing objects stay put.
export const BOT_LOCATION_HINT = 'wnam';

export function botStub(env, botId) {
  return env.BOT.get(env.BOT.idFromName(botId), { locationHint: BOT_LOCATION_HINT });
}

export async function publishBotAlert(env, input, fetcher = env?.fetch ?? fetch) {
  const event = await rememberBotAlert(env, null, input, fetcher);
  if (!event || !env?.BOT || typeof env.BOT.idFromName !== 'function' || typeof env.BOT.get !== 'function') {
    return event;
  }
  try {
    const stub = botStub(env, event.botId);
    await stub.fetch(new Request('https://bot/alert', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-owner-id': event.ownerId,
      },
      body: JSON.stringify({
        id: event.id,
        alert: input.alert,
        botId: event.botId,
        ownerId: event.ownerId,
        at: event.at,
        scope: input.scope ?? event.at,
      }),
    }));
  } catch {
    /* The timeline write already ran. */
  }
  return event;
}

export async function readBotAlerts(env, botId, ownerId) {
  if (!env?.BOT || typeof env.BOT.idFromName !== 'function' || typeof env.BOT.get !== 'function') return [];
  if (typeof botId !== 'string' || !/^[a-zA-Z0-9:_.-]{1,256}$/.test(botId)) return [];
  if (typeof ownerId !== 'string' || ownerId.length < 1) return [];
  try {
    const stub = botStub(env, botId);
    const response = await stub.fetch(new Request('https://bot/alerts', {
      headers: { 'x-owner-id': ownerId },
    }));
    if (!response.ok) return [];
    const body = await response.json();
    if (!Array.isArray(body?.items)) return [];
    return body.items.filter(event => (
      event
      && event.botId === botId
      && event.ownerId === ownerId
      && EVENT_KINDS.includes(event.kind)
    ));
  } catch {
    return [];
  }
}
