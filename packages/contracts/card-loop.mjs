/**
 * Card-loop rules. A loop stores a purpose and wakes that bot after a cooldown.
 * This module does not sign, broadcast, or skip the decision gate.
 */

export const MIN_LOOP_COOLDOWN_MINUTES = 15;
export const MAX_LOOP_COOLDOWN_MINUTES = 10080;
export const LOOP_BREAK_HEADER = 'x-loop-break';
export const LOOP_BREAK_VALUE = 'owner-asked';

const BOT_ID = /^[a-zA-Z0-9:_-]{1,128}$/;
const MINUTES = /^[1-9][0-9]{0,4}$/;
const BREAK_ASK = /\b(?:break|stop|cancel|end|kill|disable|remove|quit)\b(?:\s+\w+){0,5}\s+loops?\b|\bloops?\b(?:\s+\w+){0,4}\s+(?:off|stop|cancel)\b|\b(?:stop|quit)\s+looping\b|\bno more loops?\b/i;

export class CardLoopError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CardLoopError';
    this.code = code;
  }
}

function minutesOf(value) {
  const text = typeof value === 'number' && Number.isInteger(value) ? String(value) : value;
  if (typeof text !== 'string' || !MINUTES.test(text.trim())) throw new CardLoopError('cooldown_invalid');
  const minutes = Number(text.trim());
  if (!Number.isSafeInteger(minutes)) throw new CardLoopError('cooldown_invalid');
  if (minutes < MIN_LOOP_COOLDOWN_MINUTES) throw new CardLoopError('cooldown_too_short');
  if (minutes > MAX_LOOP_COOLDOWN_MINUTES) throw new CardLoopError('cooldown_invalid');
  return minutes;
}

export function parseCooldownMinutes(value) {
  return minutesOf(value);
}

export function parseLoopPurpose(value) {
  if (typeof value !== 'string') throw new CardLoopError('purpose_required');
  const purpose = value.trim().replace(/\s+/g, ' ');
  if (!purpose || purpose.length > 500) throw new CardLoopError('purpose_required');
  return purpose;
}

export function formatCooldown(minutes) {
  if (!Number.isSafeInteger(minutes) || minutes < 1) return '';
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days}d`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours}h`;
  }
  return `${minutes}m`;
}

export function createCardLoop({ botId, purpose, cooldownMinutes, now } = {}) {
  if (typeof botId !== 'string' || !BOT_ID.test(botId)) throw new CardLoopError('invalid_bot');
  if (!Number.isSafeInteger(now) || now < 1) throw new CardLoopError('invalid_now');
  const minutes = minutesOf(cooldownMinutes);
  const stored = parseLoopPurpose(purpose);
  return {
    botId,
    purpose: stored,
    cooldownMinutes: minutes,
    active: true,
    createdAt: now,
    nextWakeAt: now + minutes * 60_000,
  };
}

export function setCardLoopCooldown(loop, cooldownMinutes, now) {
  if (!loop || loop.active !== true) throw new CardLoopError('no_loop');
  if (!Number.isSafeInteger(now) || now < 1) throw new CardLoopError('invalid_now');
  const minutes = minutesOf(cooldownMinutes);
  return {
    ...loop,
    cooldownMinutes: minutes,
    nextWakeAt: now + minutes * 60_000,
  };
}

export function publicCardLoop(loop) {
  if (!loop || loop.active !== true) return null;
  if (!Number.isSafeInteger(loop.cooldownMinutes) || loop.cooldownMinutes < MIN_LOOP_COOLDOWN_MINUTES) return null;
  if (typeof loop.purpose !== 'string' || !loop.purpose.trim() || loop.purpose.length > 500) return null;
  return {
    active: true,
    purpose: loop.purpose,
    cooldownMinutes: loop.cooldownMinutes,
    cooldownLabel: formatCooldown(loop.cooldownMinutes),
    nextWakeAt: Number.isSafeInteger(loop.nextWakeAt) ? loop.nextWakeAt : null,
  };
}

export function cardLoopDue(loop, now) {
  return Boolean(
    loop
    && loop.active === true
    && Number.isSafeInteger(now)
    && Number.isSafeInteger(loop.nextWakeAt)
    && now >= loop.nextWakeAt,
  );
}

/** True only when the owner's own words ask to break the loop. A model flag does not count. */
export function ownerAskedToBreakLoop(text) {
  if (typeof text !== 'string') return false;
  const value = text.trim();
  if (!value || value.length > 4000) return false;
  return BREAK_ASK.test(value);
}

export function ownerBreakAuthorized(header) {
  return header === LOOP_BREAK_VALUE;
}
