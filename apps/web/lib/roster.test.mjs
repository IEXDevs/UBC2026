import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_LOOKS_KEY,
  LEGACY_ROSTER_KEY,
  adoptLegacyRoster,
  draftBot,
  looksStorageKey,
  mergeRoster,
  readLooks,
  readRoster,
  removeBotFromRoster,
  reorderIds,
  rosterStorageKey,
  withoutId,
  writeLooks,
  writeRoster,
} from './roster.mjs';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    get length() { return Object.keys(data).length; },
    key(i) { return Object.keys(data)[i] ?? null; },
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem(k, v) { data[k] = String(v); },
    removeItem(k) { delete data[k]; },
  };
}

test('a bot draft needs a name, a known shape, and a hex color', () => {
  assert.equal(draftBot({ name: '  ', shape: 'circle', color: '#7c5cff' }), null);
  assert.equal(draftBot({ name: 'Ada', shape: 'squircle', color: '#7c5cff' }), null);
  const loose = draftBot({ name: 'Ada', color: '#7c5cff' });
  assert.equal(typeof loose.shape, 'string');
  const bot = draftBot({ name: '  Ada  ', shape: 'triangle', color: '#7C5CFF', id: 'bot_ada' });
  assert.equal(bot.name, 'Ada');
  assert.equal(bot.shape, 'triangle');
  assert.equal(bot.color, '#7c5cff');
  assert.equal(bot.id, 'bot_ada');
});

test('withoutId drops one agent and leaves the rest', () => {
  assert.deepEqual(withoutId(['a', 'b', 'c'], 'b'), ['a', 'c']);
  assert.deepEqual(withoutId(['a'], 'a'), []);
  assert.deepEqual(withoutId(['a'], 'z'), ['a']);
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

test('removeBotFromRoster drops order and extra entries', () => {
  const created = draftBot({ name: 'Ada', shape: 'circle', color: '#7c5cff', id: 'bot_ada' });
  const next = removeBotFromRoster({
    order: ['bot_ada', 'bot_meteora'],
    extra: [created],
  }, 'bot_ada');
  assert.deepEqual(next.order, ['bot_meteora']);
  assert.deepEqual(next.extra, []);
});

test('roster and looks storage keys are scoped to the owner', () => {
  assert.equal(rosterStorageKey('did:privy:a'), 'maelstrom.roster.did:privy:a');
  assert.equal(looksStorageKey('did:privy:a'), 'maelstrom.botLooks.did:privy:a');
  assert.equal(rosterStorageKey(''), '');
  assert.equal(looksStorageKey(null), '');
});

test('each owner keeps a separate roster', () => {
  const storage = memoryStorage();
  const ada = draftBot({ name: 'Ada', shape: 'circle', color: '#7c5cff', id: 'bot_ada' });
  writeRoster(storage, 'did:privy:one', { order: ['bot_ada'], extra: [ada] });
  writeRoster(storage, 'did:privy:two', { order: [], extra: [] });
  assert.equal(readRoster(storage, 'did:privy:one').extra[0].id, 'bot_ada');
  assert.deepEqual(readRoster(storage, 'did:privy:two').extra, []);
  assert.deepEqual(readRoster(storage, null), { order: [], extra: [] });
});

test('legacy global roster is claimed once by the first signed-in owner', () => {
  const ada = draftBot({ name: 'Ada', shape: 'circle', color: '#7c5cff', id: 'bot_ada' });
  const storage = memoryStorage({
    [LEGACY_ROSTER_KEY]: JSON.stringify({ order: ['bot_ada'], extra: [ada] }),
    [LEGACY_LOOKS_KEY]: JSON.stringify({ bot_ada: { shape: 'circle' } }),
  });
  const first = adoptLegacyRoster(storage, 'did:privy:one');
  assert.equal(first.adopted, true);
  assert.equal(first.roster.extra[0].id, 'bot_ada');
  assert.equal(storage.getItem(LEGACY_ROSTER_KEY), null);
  assert.equal(readLooks(storage, 'did:privy:one').bot_ada.shape, 'circle');

  const second = adoptLegacyRoster(storage, 'did:privy:two');
  assert.equal(second.adopted, false);
  assert.deepEqual(second.roster.extra, []);
});

test('writeLooks round-trips per owner', () => {
  const storage = memoryStorage();
  writeLooks(storage, 'did:privy:a', { bot_x: { color: '#111111' } });
  assert.equal(readLooks(storage, 'did:privy:a').bot_x.color, '#111111');
  assert.deepEqual(readLooks(storage, 'did:privy:b'), {});
});
