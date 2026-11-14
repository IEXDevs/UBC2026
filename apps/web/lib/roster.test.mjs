import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftBot, mergeRoster, reorderIds } from './roster.mjs';

test('a bot draft needs a name, a known shape, and a hex color', () => {
  assert.equal(draftBot({ name: '  ', shape: 'circle', color: '#7c5cff' }), null);
  assert.equal(draftBot({ name: 'Ada', shape: 'squircle', color: '#7c5cff' }), null);
  const bot = draftBot({ name: '  Ada  ', shape: 'triangle', color: '#7C5CFF', id: 'bot_ada' });
  assert.equal(bot.name, 'Ada');
  assert.equal(bot.shape, 'triangle');
  assert.equal(bot.color, '#7c5cff');
  assert.equal(bot.id, 'bot_ada');
});

test('reorder moves one id and leaves the others in place', () => {
  assert.deepEqual(reorderIds(['a', 'b', 'c'], 'a', 'c'), ['b', 'c', 'a']);
  assert.deepEqual(reorderIds(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
  assert.deepEqual(reorderIds(['a', 'b'], 'a', 'a'), ['a', 'b']);
});

test('an empty saved order shows no bots, and a missing order keeps the seed', () => {
  const seed = [{ id: 'bot_meteora', name: 'Meteora bot', shape: 'circle', color: '#7c5cff' }];
  assert.deepEqual(mergeRoster(seed, { order: [], extra: [] }).bots, []);
  assert.equal(mergeRoster(seed, null).bots[0].id, 'bot_meteora');
  const created = draftBot({ name: 'Ada', shape: 'circle', color: '#7c5cff', id: 'bot_ada' });
  const merged = mergeRoster(seed, { order: ['bot_ada', 'bot_meteora'], extra: [created] });
  assert.deepEqual(merged.bots.map(bot => bot.id), ['bot_ada', 'bot_meteora']);
});
