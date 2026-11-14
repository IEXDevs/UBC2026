/** Local bot name, shape, and color. Stored in the browser, not a server record. */

export const SHAPES = Object.freeze(['circle', 'square', 'triangle', 'diamond', 'pill']);

export const SHAPE_PATHS = Object.freeze({
  circle: 'M32 6a26 26 0 1 0 .1 0',
  square: 'M14 14h36v36H14z',
  triangle: 'M32 8 58 54H6z',
  diamond: 'M32 4 60 32 32 60 4 32z',
  pill: 'M20 18h24a14 14 0 0 1 0 28H20a14 14 0 0 1 0-28z',
});

export const BOT_COLORS = Object.freeze([
  { id: 'paper', value: '#f5f5f5' },
  { id: 'brown', value: '#8b5a3c' },
  { id: 'red', value: '#e24b4b' },
  { id: 'orange', value: '#f0732b' },
  { id: 'gold', value: '#f0a202' },
  { id: 'green', value: '#5aaa4a' },
  { id: 'teal', value: '#3dbea5' },
  { id: 'blue', value: '#3b7ddd' },
  { id: 'purple', value: '#7c5cff' },
  { id: 'pink', value: '#e85a9b' },
  { id: 'ash', value: '#8e8e8e' },
]);

const DEFAULTS = Object.freeze({
  bot_meteora: { shape: 'circle', color: '#7c5cff' },
  bot_shop: { shape: 'triangle', color: '#3dbea5' },
  bot_positions: { shape: 'square', color: '#8e8e8e' },
});

const HEX = /^#[0-9a-fA-F]{6}$/;

export function defaultLook(botId) {
  return DEFAULTS[botId] ?? { shape: 'circle', color: '#7c5cff' };
}

export function sanitizeLook(botId, patch) {
  const base = defaultLook(botId);
  const next = { shape: base.shape, color: base.color };
  if (patch && SHAPES.includes(patch.shape)) next.shape = patch.shape;
  if (patch && typeof patch.color === 'string' && HEX.test(patch.color)) next.color = patch.color.toLowerCase();
  if (patch && typeof patch.name === 'string') {
    const name = patch.name.trim().slice(0, 64);
    if (name) next.name = name;
  }
  return next;
}

export function applyLooks(bots, saved) {
  const store = saved && typeof saved === 'object' ? saved : {};
  return bots.map(bot => {
    const own = bot.shape ? { shape: bot.shape, color: bot.color, name: bot.name } : {};
    const look = sanitizeLook(bot.id, { ...own, ...store[bot.id] });
    return { ...bot, name: look.name ?? bot.name, shape: look.shape, color: look.color };
  });
}
