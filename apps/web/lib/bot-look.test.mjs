import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLooks, sanitizeLook } from './bot-look.mjs';

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
