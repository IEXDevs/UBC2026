import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLooks, BOT_COLORS, colorLabel, colorsForPicker, randomShape, sanitizeLook, SHAPES } from './bot-look.mjs';

/**
 * Achieves: verifies palette hexes map to named colors and unknown hexes are Custom.
 * Fails when: case-insensitive match breaks or #000000 is labeled as a named swatch.
 * Oracle: #7c5cff/#7C5CFF → Purple; #000000 → Custom.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('color names come from the palette', () => {
  assert.equal(colorLabel('#7c5cff'), 'Purple');
  assert.equal(colorLabel('#7C5CFF'), 'Purple');
  assert.equal(colorLabel('#000000'), 'Custom');
});

/**
 * Achieves: verifies the compact picker shows six colors and expands to the full palette.
 * Fails when: compact length ≠ 6, expand ≠ BOT_COLORS.length, or selected orange missing from compact.
 * Oracle: colorsForPicker(selected, false).length === 6; true → BOT_COLORS.length.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('the picker starts with six colors and can show the rest', () => {
  const short = colorsForPicker('#7c5cff', false);
  assert.equal(short.length, 6);
  assert.equal(colorsForPicker('#7c5cff', true).length, BOT_COLORS.length);
  const withOrange = colorsForPicker('#f0732b', false);
  assert.equal(withOrange.some(item => item.id === 'orange'), true);
});

/**
 * Achieves: verifies unknown shape/color/blank name fall back to shared defaults.
 * Fails when: squircle/red stick, or blank name is kept as empty string instead of dropped.
 * Oracle: shape circle; color #7c5cff; name undefined.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('unknown shape and color fall back to the shared default', () => {
  const look = sanitizeLook('bot_live', { shape: 'squircle', color: 'red', name: '  ' });
  assert.equal(look.shape, 'circle');
  assert.equal(look.color, '#7c5cff');
  assert.equal(look.name, undefined);
});

/**
 * Achieves: verifies saved look fields override defaults including trimmed name and lowercased hex.
 * Fails when: name whitespace remains, shape ignored, or hex case not normalized.
 * Oracle: Night desk / triangle / #3b7ddd.
 * Side effects / state checked: returned bots array.
 * Gaps: none.
 */
test('a saved name, shape, and hex color replace the default', () => {
  const bots = applyLooks(
    [{ id: 'bot_meteora', name: 'Meteora bot' }],
    { bot_meteora: { name: '  Night desk  ', shape: 'triangle', color: '#3B7DDD' } },
  );
  assert.equal(bots[0].name, 'Night desk');
  assert.equal(bots[0].shape, 'triangle');
  assert.equal(bots[0].color, '#3b7ddd');
});

/**
 * Achieves: verifies only small data-URL images are kept; remote URLs dropped; shapes stay primary set.
 * Fails when: https image kept, diamond accepted, or randomShape leaves SHAPES.
 * Oracle: data URL kept; https → undefined; SHAPES = circle/square/triangle; diamond → circle.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('an agent image is a small data url and new marks stay primary shapes', () => {
  const tiny = 'data:image/png;base64,aaaa';
  const look = sanitizeLook('bot_shop', { image: tiny, color: '#3dbea5' });
  assert.equal(look.image, tiny);
  assert.equal(sanitizeLook('bot_shop', { image: 'https://example.com/a.png' }).image, undefined);
  assert.equal(sanitizeLook('bot_shop', { image: '' }).image, '');
  assert.deepEqual(SHAPES, ['circle', 'square', 'triangle']);
  assert.equal(sanitizeLook('bot_shop', { shape: 'diamond' }).shape, 'circle');
  assert.ok(SHAPES.includes(randomShape(0)));
  assert.ok(SHAPES.includes(randomShape(0.5)));
  assert.ok(SHAPES.includes(randomShape(0.99)));
});
