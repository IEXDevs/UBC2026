/** Browser-only bot order and locally created agents. Not a server record. */

import { SHAPES } from './bot-look.mjs';

const HEX = /^#[0-9a-fA-F]{6}$/;
const ID = /^bot_[a-z0-9_]{1,40}$/;

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
