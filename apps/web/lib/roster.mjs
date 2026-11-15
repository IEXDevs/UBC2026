/** Browser-only bot order and locally created agents. Not a server record. */

import { SHAPES } from './bot-look.mjs';

const HEX = /^#[0-9a-fA-F]{6}$/;
const ID = /^bot_[a-z0-9_]{1,40}$/;

/** Legacy unscoped keys from before agents were tied to an account. */
export const LEGACY_ROSTER_KEY = 'maelstrom.roster';
export const LEGACY_LOOKS_KEY = 'maelstrom.botLooks';
export const ROSTER_KEY_PREFIX = 'maelstrom.roster.';
export const LOOKS_KEY_PREFIX = 'maelstrom.botLooks.';

export function rosterStorageKey(ownerId) {
  if (typeof ownerId !== 'string') return '';
  const id = ownerId.trim();
  if (!id || id.length > 256) return '';
  return `${ROSTER_KEY_PREFIX}${id}`;
}

export function looksStorageKey(ownerId) {
  if (typeof ownerId !== 'string') return '';
  const id = ownerId.trim();
  if (!id || id.length > 256) return '';
  return `${LOOKS_KEY_PREFIX}${id}`;
}

function emptyRoster() {
  return { order: [], extra: [] };
}

export function normalizeRoster(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyRoster();
  const order = Array.isArray(value.order)
    ? value.order.filter((id) => typeof id === 'string' && id)
    : [];
  const extra = [];
  if (Array.isArray(value.extra)) {
    for (const item of value.extra) {
      const bot = draftBot(item);
      if (bot) extra.push(bot);
    }
  }
  return { order, extra };
}

export function readRoster(storage, ownerId) {
  const key = rosterStorageKey(ownerId);
  if (!key || !storage || typeof storage.getItem !== 'function') return emptyRoster();
  try {
    const raw = storage.getItem(key);
    if (!raw) return emptyRoster();
    return normalizeRoster(JSON.parse(raw));
  } catch {
    return emptyRoster();
  }
}

export function writeRoster(storage, ownerId, roster) {
  const key = rosterStorageKey(ownerId);
  if (!key || !storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(key, JSON.stringify(normalizeRoster(roster)));
    return true;
  } catch {
    return false;
  }
}

export function readLooks(storage, ownerId) {
  const key = looksStorageKey(ownerId);
  if (!key || !storage || typeof storage.getItem !== 'function') return {};
  try {
    const raw = storage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeLooks(storage, ownerId, looks) {
  const key = looksStorageKey(ownerId);
  if (!key || !storage || typeof storage.setItem !== 'function') return false;
  try {
    const value = looks && typeof looks === 'object' && !Array.isArray(looks) ? looks : {};
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * One-time claim of the old global roster/looks into this owner's keys.
 * Only runs when the owner has no scoped data yet.
 */
export function adoptLegacyRoster(storage, ownerId) {
  const rosterKey = rosterStorageKey(ownerId);
  const looksKey = looksStorageKey(ownerId);
  if (!rosterKey || !storage || typeof storage.getItem !== 'function') {
    return { roster: emptyRoster(), looks: {}, adopted: false };
  }
  const existing = readRoster(storage, ownerId);
  const existingLooks = readLooks(storage, ownerId);
  const hasScoped = existing.order.length > 0 || existing.extra.length > 0
    || Object.keys(existingLooks).length > 0;
  if (hasScoped) return { roster: existing, looks: existingLooks, adopted: false };

  let legacyRoster = emptyRoster();
  let legacyLooks = {};
  try {
    const rawRoster = storage.getItem(LEGACY_ROSTER_KEY);
    if (rawRoster) legacyRoster = normalizeRoster(JSON.parse(rawRoster));
  } catch {
    legacyRoster = emptyRoster();
  }
  try {
    const rawLooks = storage.getItem(LEGACY_LOOKS_KEY);
    if (rawLooks) {
      const parsed = JSON.parse(rawLooks);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) legacyLooks = parsed;
    }
  } catch {
    legacyLooks = {};
  }

  const hasLegacy = legacyRoster.order.length > 0 || legacyRoster.extra.length > 0
    || Object.keys(legacyLooks).length > 0;
  if (!hasLegacy) return { roster: emptyRoster(), looks: {}, adopted: false };

  writeRoster(storage, ownerId, legacyRoster);
  writeLooks(storage, ownerId, legacyLooks);
  try {
    storage.removeItem(LEGACY_ROSTER_KEY);
    storage.removeItem(LEGACY_LOOKS_KEY);
  } catch {
    /* ignore */
  }
  return { roster: legacyRoster, looks: legacyLooks, adopted: true };
}

export function draftBot({ name, shape, color, id } = {}) {
  const trimmed = typeof name === 'string' ? name.trim().slice(0, 64) : '';
  if (!trimmed || !SHAPES.includes(shape) || typeof color !== 'string' || !HEX.test(color)) return null;
  const nextId = typeof id === 'string' && ID.test(id) ? id : `bot_${Math.random().toString(36).slice(2, 10)}`;
  return {
    id: nextId,
    name: trimmed,
    shape,
    color: color.toLowerCase(),
    type: 'trading',
    status: 'idle',
    goal: 'Waiting for a goal.',
    walletId: 'wallet_main',
  };
}

export function withoutId(order, id) {
  if (!Array.isArray(order)) return [];
  return order.filter(item => item !== id);
}

export function reorderIds(order, fromId, toId) {
  if (!Array.isArray(order) || fromId === toId) return Array.isArray(order) ? order.slice() : [];
  const from = order.indexOf(fromId);
  const to = order.indexOf(toId);
  if (from < 0 || to < 0) return order.slice();
  const next = order.slice();
  const [id] = next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

export function mergeRoster(seed, saved) {
  const source = Array.isArray(seed) ? seed : [];
  const extra = [];
  if (saved && Array.isArray(saved.extra)) {
    for (const item of saved.extra) {
      const bot = draftBot(item);
      if (!bot) continue;
      if (source.some(entry => entry.id === bot.id) || extra.some(entry => entry.id === bot.id)) continue;
      extra.push(bot);
    }
  }
  const byId = new Map([...source, ...extra].map(bot => [bot.id, bot]));
  const order = saved && Array.isArray(saved.order)
    ? saved.order.filter(id => byId.has(id))
    : [...byId.keys()];
  return { order, extra, bots: order.map(id => byId.get(id)) };
}

/** Drop a bot from local order/extra (and optional looks map). */
export function removeBotFromRoster(roster, botId) {
  const current = roster && typeof roster === 'object' ? roster : { order: [], extra: [] };
  if (typeof botId !== 'string' || !botId) {
    return { order: Array.isArray(current.order) ? current.order.slice() : [], extra: Array.isArray(current.extra) ? current.extra.slice() : [] };
  }
  return {
    order: (Array.isArray(current.order) ? current.order : []).filter(id => id !== botId),
    extra: (Array.isArray(current.extra) ? current.extra : []).filter(item => item?.id !== botId),
  };
}
