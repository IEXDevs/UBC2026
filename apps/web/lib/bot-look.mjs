/** Local bot name, shape, and color. Stored in the browser, not a server record. */

export const SHAPES = Object.freeze(['circle', 'square', 'triangle']);

export const SHAPE_PATHS = Object.freeze({
  circle: 'M32 6a26 26 0 1 0 .1 0',
  square: 'M19 14h26a5 5 0 0 1 5 5v26a5 5 0 0 1-5 5H19a5 5 0 0 1-5-5V19a5 5 0 0 1 5-5z',
  triangle: 'M32 8 58 54H6z',
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

const HEX = /^#[0-9a-fA-F]{6}$/;

export function defaultLook() {
  return { shape: 'circle', color: '#7c5cff' };
}

export function randomShape(seed = Math.random()) {
  const index = Math.abs(Math.floor(Number(seed) * SHAPES.length)) % SHAPES.length;
  return SHAPES[Number.isFinite(index) ? index : 0];
}

const IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i;

export function sanitizeLook(botId, patch) {
  const base = defaultLook();
  const next = { shape: base.shape, color: base.color };
  if (patch && SHAPES.includes(patch.shape)) next.shape = patch.shape;
  if (patch && typeof patch.color === 'string' && HEX.test(patch.color)) next.color = patch.color.toLowerCase();
  if (patch && typeof patch.name === 'string') {
    const name = patch.name.trim().slice(0, 64);
    if (name) next.name = name;
  }
  if (patch && patch.image === '') next.image = '';
  else if (patch && typeof patch.image === 'string' && patch.image.length < 120000 && IMAGE.test(patch.image)) {
    next.image = patch.image;
  }
  return next;
}

export function applyLooks(bots, saved) {
  const store = saved && typeof saved === 'object' ? saved : {};
  return bots.map(bot => {
    const own = bot.shape ? { shape: bot.shape, color: bot.color, name: bot.name } : {};
    const look = sanitizeLook(bot.id, { ...own, ...store[bot.id] });
    return { ...bot, name: look.name ?? bot.name, shape: look.shape, color: look.color, image: look.image || '' };
  });
}
