import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLooks, randomShape, sanitizeLook, SHAPES } from './bot-look.mjs';

test('unknown shape and color fall back to the bot default', () => {
  const look = sanitizeLook('bot_shop', { shape: 'squircle', color: 'red', name: '  ' });
  assert.equal(look.shape, 'triangle');
  assert.equal(look.color, '#3dbea5');
  assert.equal(look.name, undefined);
});

test('a saved name, shape, and hex color replace the default', () => {
  const bots = applyLooks(
    [{ id: 'bot_meteora', name: 'Meteora bot' }],
    { bot_meteora: { name: '  Night desk  ', shape: 'triangle', color: '#3B7DDD' } },
  );
  assert.equal(bots[0].name, 'Night desk');
  assert.equal(bots[0].shape, 'triangle');
  assert.equal(bots[0].color, '#3b7ddd');
});

test('an agent image is a small data url and new marks stay primary shapes', () => {
  const tiny = 'data:image/png;base64,aaaa';
  const look = sanitizeLook('bot_shop', { image: tiny, color: '#3dbea5' });
  assert.equal(look.image, tiny);
  assert.equal(sanitizeLook('bot_shop', { image: 'https://example.com/a.png' }).image, undefined);
  assert.equal(sanitizeLook('bot_shop', { image: '' }).image, '');
  assert.deepEqual(SHAPES, ['circle', 'square', 'triangle']);
  assert.equal(sanitizeLook('bot_shop', { shape: 'diamond' }).shape, 'triangle');
  assert.ok(SHAPES.includes(randomShape(0)));
  assert.ok(SHAPES.includes(randomShape(0.5)));
  assert.ok(SHAPES.includes(randomShape(0.99)));
});
