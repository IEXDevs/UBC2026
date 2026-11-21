/**
 * Laso in-chat fulfillment checkpoint. One open flow per bot: the agent saves
 * where a Laso job paused for the owner (claim, KYC, issuer code, approval,
 * redemption form) and resumes from that stage when the owner confirms,
 * instead of restarting. Stored in the bot Durable Object, never in logs or
 * timeline text, and never carrying secrets: no PAN, CVV, tokens, or links.
 */

export const LASO_FLOW_STAGES = Object.freeze([
  'choice',
  'quoted',
  'paid',
  'waiting-owner',
  'verifying',
  'done',
  'failed',
]);

export const LASO_FLOW_KINDS = Object.freeze([
  'non-reloadable-usa',
  'reloadable',
  'intl',
  'gift',
  'top-up',
]);

export class LasoFlowError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const fail = code => { throw new LasoFlowError(code); };

const CARD_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SERVER_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const COUNTRY = /^[A-Z]{2}$/;

function cleanAmount(value) {
  const usd = Number(value);
  if (!Number.isFinite(usd) || usd <= 0 || usd > 100000) fail('invalid_amount');
  return usd;
}

export function startLasoFlow({ kind, amountUsd = null, laso_server_id = null, country = null, card_id = null, now = Date.now() } = {}) {
  const cleanKind = kind === 'undecided' ? 'undecided' : kind;
  if (!LASO_FLOW_KINDS.includes(cleanKind) && cleanKind !== 'undecided') fail('invalid_kind');
  if (!Number.isSafeInteger(now) || now <= 0) fail('invalid_now');
  const flow = {
    v: 1,
    kind: cleanKind,
    stage: cleanKind === 'undecided' ? 'choice' : 'quoted',
    createdAt: now,
    updatedAt: now,
  };
  if (amountUsd != null) flow.amountUsd = cleanAmount(amountUsd);
  if (laso_server_id != null) {
    const id = String(laso_server_id).trim();
    if (!SERVER_ID.test(id)) fail('invalid_product');
    flow.laso_server_id = id;
  }
  if (country != null) {
    const code = String(country).trim().toUpperCase();
    if (!COUNTRY.test(code)) fail('invalid_country');
    flow.country = code;
  }
  if (card_id != null) {
    if (typeof card_id !== 'string' || !CARD_ID.test(card_id)) fail('invalid_card');
    flow.card_id = card_id;
  }
  return flow;
}

export function flowIsOpen(flow) {
  return Boolean(flow && typeof flow === 'object'
    && (flow.stage === 'choice' || flow.stage === 'quoted' || flow.stage === 'paid'
      || flow.stage === 'waiting-owner' || flow.stage === 'verifying'));
}

/**
 * Move an open flow forward. Closed stages (done, failed) only reopen
 * through startLasoFlow, so a confirm never revives a finished purchase.
 */
export function updateLasoFlow(flow, { stage, card_id = null, note = null, now = Date.now() } = {}) {
  if (!flow || typeof flow !== 'object' || flow.v !== 1) fail('invalid_flow');
  if (!flowIsOpen(flow)) fail('flow_closed');
  if (!LASO_FLOW_STAGES.includes(stage)) fail('invalid_stage');
  if (stage === 'done' || stage === 'failed' || stage === 'choice') fail('invalid_stage');
  if (!Number.isSafeInteger(now) || now <= 0) fail('invalid_now');
  const next = { ...flow, stage, updatedAt: now };
  if (card_id != null) {
    if (typeof card_id !== 'string' || !CARD_ID.test(card_id)) fail('invalid_card');
    next.card_id = card_id;
  }
  if (note != null) {
    const text = String(note).trim().replace(/\s+/g, ' ').slice(0, 200);
    if (!text) fail('invalid_note');
    next.note = text;
  }
  return next;
}

export function closeLasoFlow(flow, { ok = true, now = Date.now() } = {}) {
  if (!flow || typeof flow !== 'object' || flow.v !== 1) fail('invalid_flow');
  if (!Number.isSafeInteger(now) || now <= 0) fail('invalid_now');
  return { ...flow, stage: ok ? 'done' : 'failed', updatedAt: now };
}

/** Owner-safe view: facts only, never secrets. There is nowhere to put one. */
export function publicLasoFlow(flow) {
  if (!flow || typeof flow !== 'object' || flow.v !== 1) return null;
  if (!LASO_FLOW_STAGES.includes(flow.stage)) return null;
  if (!LASO_FLOW_KINDS.includes(flow.kind) && flow.kind !== 'undecided') return null;
  const view = { kind: flow.kind, stage: flow.stage };
  if (Number.isFinite(flow.amountUsd)) view.amountUsd = flow.amountUsd;
  if (typeof flow.laso_server_id === 'string') view.laso_server_id = flow.laso_server_id;
  if (typeof flow.country === 'string') view.country = flow.country;
  if (typeof flow.card_id === 'string') view.card_id = flow.card_id;
  if (typeof flow.note === 'string') view.note = flow.note;
  if (Number.isSafeInteger(flow.updatedAt)) view.updatedAt = flow.updatedAt;
  return view;
}

const WAITING = {
  'non-reloadable-usa': 'Your USA card is paid. Open your Laso dashboard link and finish the card there, then reply done and I will pick up from the card status.',
  reloadable: 'Your reloadable card needs you in your own browser and inbox: signup, verification, and the one-time card-issuer code. Reply done when that is finished and I will continue from funding. Nothing restarts.',
  intl: 'Your international card order is queued with Laso. It usually fulfills within 24 hours. Reply done when you want me to re-check it and I will pick up from the order status.',
  gift: 'Your gift card is paid and its redemption details are in the receipt. Open the redemption link or enter the code on the brand site, then reply done so I can close this out.',
  'top-up': 'Your top-up is paid and lands on the card balance within a minute. Reply done and I will confirm it credited before anything is created from it.',
};

/** Short confirm-when-done nudge for a flow paused on the owner. */
export function lasoWaitingPrompt(flow) {
  if (!flowIsOpen(flow) || (flow.kind !== 'undecided' && !LASO_FLOW_KINDS.includes(flow.kind))) return null;
  if (flow.kind === 'undecided') return 'Reloadable or non-reloadable USA? A reloadable card stays open for repeat charges. A non-reloadable USA card is one prepaid card for a known one-time total at a US merchant. Which one?';
  return WAITING[flow.kind] || null;
}

const CANCEL = /\b(cancel|stop|never mind|nevermind|forget it|start over|different card|change my mind)\b/i;
const CONFIRM = /\b(done|finished|completed|complete|verified|approved|confirmed|submitted|sent it|did it|all set|ready)\b|^(yes|yeah|yep|ok|okay|sure|done)[\s,!.]*$/i;

/**
 * Read the owner's reply against an open flow. cancel wins over confirm.
 * confirm moves to verify-now, anything else keeps waiting.
 */
export function resumeLasoFlow(flow, message) {
  if (!flowIsOpen(flow)) return { decision: 'no-open-flow' };
  const text = typeof message === 'string' ? message : '';
  if (CANCEL.test(text)) return { decision: 'restart' };
  if (CONFIRM.test(text)) return { decision: 'verify-now' };
  return { decision: 'keep-waiting' };
}
