import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TRANSFER_CAP,
  LEGACY_LOOKS_KEY,
  LEGACY_ROSTER_KEY,
  adoptLegacyRoster,
  draftBot,
  draftTransferCap,
  isTransferLimit,
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
import { formatBaseUnits } from './money-views.mjs';

test('spending limits store exact base units and show the respective asset value', () => {
  const sol = draftTransferCap('SOL', '1000000000', '1');
  assert.equal(formatBaseUnits(sol.maxOutflow, 9), '1');
  assert.equal(formatBaseUnits(sol.maxPerTransaction, 9), '0.000000001');
  assert.equal(formatBaseUnits(DEFAULT_TRANSFER_CAP.maxOutflow), '1');
  assert.equal(formatBaseUnits(DEFAULT_TRANSFER_CAP.maxPerTransaction), '1');
  assert.equal(draftTransferCap('USDC', '0', '1'), null);
  assert.equal(isTransferLimit('1.5'), false);
  assert.equal(isTransferLimit('1'.repeat(41)), false);
});

test('the roster keeps the full token mint and its base-unit caps after a reload', () => {
  const store = memoryStorage();
  const mint = 'So11111111111111111111111111111111111111112';
  const cap = draftTransferCap(mint, '1000', '500');
  const bot = draftBot({ id: 'bot_spl', name: 'SPL sender', shape: 'circle', color: '#7c5cff', cap });
  writeRoster(store, 'alice', { order: [bot.id], extra: [bot] });
  assert.deepEqual(readRoster(store, 'alice').extra[0].cap, { mode: 'limited', asset: mint, maxOutflow: '1000', maxPerTransaction: '500' });
  assert.equal(draftTransferCap('SOL', '500', '1000'), null);
});

test('the selected wallet survives writing and merging the local agent roster', () => {
  const store = memoryStorage();
  const bot = draftBot({ id: 'bot_ada', name: 'Ada', shape: 'circle', color: '#7c5cff', walletId: 'wallet_shop' });
  writeRoster(store, 'alice', { order: [bot.id], extra: [bot] });
  const merged = mergeRoster([], readRoster(store, 'alice'));
  assert.equal(merged.bots[0].walletId, 'wallet_shop');
});

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

/**
 * Achieves: verifies a bot draft needs a name, a known shape, and a hex color.
 * Fails when: a bot draft needs a name, a known shape, and a hex color breaks (e.g. expected shape: 'circle', color: '#7c5cff' }, shape: 'squircle', color: '#7c5cff' }, 'string'); failure/null paths flip.
 * Oracle: assert.equal(draftBot({ name: ' ', shape: 'circle', color: '#7c5cff' }); assert.equal(draftBot({ name: 'Ada', shape: 'squircle', color: '#7c5cff' }); assert.equal(typeof loose.shape, 'string'); assert.equal(bot.name, 'Ada'); assert.equal(bot.shape, 'triangle'); assert.equal(bot.color, '#7c5cff')
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
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

/**
 * Achieves: verifies withoutId drops one agent and leaves the rest.
 * Fails when: structured result drifts from expected shape.
 * Oracle: assert.deepEqual(withoutId(['a', 'b', 'c'], 'b'); assert.deepEqual(withoutId(['a'], 'a'); assert.deepEqual(withoutId(['a'], 'z')
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('withoutId drops one agent and leaves the rest', () => {
  assert.deepEqual(withoutId(['a', 'b', 'c'], 'b'), ['a', 'c']);
  assert.deepEqual(withoutId(['a'], 'a'), []);
  assert.deepEqual(withoutId(['a'], 'z'), ['a']);
});

/**
 * Achieves: verifies reorder moves one id and leaves the others in place.
 * Fails when: structured result drifts from expected shape.
 * Oracle: assert.deepEqual(reorderIds(['a', 'b', 'c'], 'a', 'c'); assert.deepEqual(reorderIds(['a', 'b', 'c'], 'c', 'a'); assert.deepEqual(reorderIds(['a', 'b'], 'a', 'a')
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('reorder moves one id and leaves the others in place', () => {
  assert.deepEqual(reorderIds(['a', 'b', 'c'], 'a', 'c'), ['b', 'c', 'a']);
  assert.deepEqual(reorderIds(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
  assert.deepEqual(reorderIds(['a', 'b'], 'a', 'a'), ['a', 'b']);
});

/**
 * Achieves: verifies an empty saved order shows no bots, and a missing order keeps the seed.
 * Fails when: an empty saved order shows no bots, and a missing order keeps the seed breaks (e.g. expected { order: [], extra: [] }, null, ['bot_ada', 'bot_meteora']).
 * Oracle: assert.equal(mergeRoster(seed, null); assert.deepEqual(mergeRoster(seed, { order: [], extra: [] }); assert.deepEqual(merged.bots.map(bot => bot.id), ['bot_ada', 'bot_meteora'])
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('an empty saved order shows no bots, and a missing order keeps the seed', () => {
  const seed = [{ id: 'bot_meteora', name: 'Meteora bot', shape: 'circle', color: '#7c5cff' }];
  assert.deepEqual(mergeRoster(seed, { order: [], extra: [] }).bots, []);
  assert.equal(mergeRoster(seed, null).bots[0].id, 'bot_meteora');
  const created = draftBot({ name: 'Ada', shape: 'circle', color: '#7c5cff', id: 'bot_ada' });
  const merged = mergeRoster(seed, { order: ['bot_ada', 'bot_meteora'], extra: [created] });
  assert.deepEqual(merged.bots.map(bot => bot.id), ['bot_ada', 'bot_meteora']);
});

/**
 * Achieves: verifies removeBotFromRoster drops order and extra entries.
 * Fails when: structured result drifts from expected shape.
 * Oracle: assert.deepEqual(next.order, ['bot_meteora']); assert.deepEqual(next.extra, [])
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('removeBotFromRoster drops order and extra entries', () => {
  const created = draftBot({ name: 'Ada', shape: 'circle', color: '#7c5cff', id: 'bot_ada' });
  const next = removeBotFromRoster({
    order: ['bot_ada', 'bot_meteora'],
    extra: [created],
  }, 'bot_ada');
  assert.deepEqual(next.order, ['bot_meteora']);
  assert.deepEqual(next.extra, []);
});

/**
 * Achieves: verifies roster and looks storage keys are scoped to the owner.
 * Fails when: roster and looks storage keys are scoped to the owner breaks (e.g. expected 'maelstrom.roster.did:privy:a', 'maelstrom.botLooks.did:privy:a', '').
 * Oracle: assert.equal(rosterStorageKey('did:privy:a'), 'maelstrom.roster.did:privy:a'); assert.equal(looksStorageKey('did:privy:a'), 'maelstrom.botLooks.did:privy:a'); assert.equal(rosterStorageKey(''), ''); assert.equal(looksStorageKey(null), '')
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('roster and looks storage keys are scoped to the owner', () => {
  assert.equal(rosterStorageKey('did:privy:a'), 'maelstrom.roster.did:privy:a');
  assert.equal(looksStorageKey('did:privy:a'), 'maelstrom.botLooks.did:privy:a');
  assert.equal(rosterStorageKey(''), '');
  assert.equal(looksStorageKey(null), '');
});

/**
 * Achieves: verifies each owner keeps a separate roster.
 * Fails when: each owner keeps a separate roster breaks (e.g. expected 'did:privy:one', 'did:privy:two', null).
 * Oracle: assert.equal(readRoster(storage, 'did:privy:one'); assert.deepEqual(readRoster(storage, 'did:privy:two'); assert.deepEqual(readRoster(storage, null)
 * Side effects / state checked: in-memory storage double writes/reads.
 * Gaps: none.
 */
test('each owner keeps a separate roster', () => {
  const storage = memoryStorage();
  const ada = draftBot({ name: 'Ada', shape: 'circle', color: '#7c5cff', id: 'bot_ada' });
  writeRoster(storage, 'did:privy:one', { order: ['bot_ada'], extra: [ada] });
  writeRoster(storage, 'did:privy:two', { order: [], extra: [] });
  assert.equal(readRoster(storage, 'did:privy:one').extra[0].id, 'bot_ada');
  assert.deepEqual(readRoster(storage, 'did:privy:two').extra, []);
  assert.deepEqual(readRoster(storage, null), { order: [], extra: [] });
});

/**
 * Achieves: verifies legacy global roster is claimed once by the first signed-in owner.
 * Fails when: legacy global roster is claimed once by the first signed-in owner breaks (e.g. expected true, 'bot_ada', null).
 * Oracle: assert.equal(first.adopted, true); assert.equal(first.roster.extra[0].id, 'bot_ada'); assert.equal(storage.getItem(LEGACY_ROSTER_KEY), null); assert.equal(readLooks(storage, 'did:privy:one'); assert.equal(second.adopted, false); assert.deepEqual(second.roster.extra, [])
 * Side effects / state checked: in-memory storage double writes/reads.
 * Gaps: none.
 */
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

/**
 * Achieves: verifies writeLooks round-trips per owner.
 * Fails when: writeLooks round-trips per owner breaks (e.g. expected 'did:privy:a', 'did:privy:b').
 * Oracle: assert.equal(readLooks(storage, 'did:privy:a'); assert.deepEqual(readLooks(storage, 'did:privy:b')
 * Side effects / state checked: in-memory storage double writes/reads.
 * Gaps: none.
 */
test('writeLooks round-trips per owner', () => {
  const storage = memoryStorage();
  writeLooks(storage, 'did:privy:a', { bot_x: { color: '#111111' } });
  assert.equal(readLooks(storage, 'did:privy:a').bot_x.color, '#111111');
  assert.deepEqual(readLooks(storage, 'did:privy:b'), {});
});
