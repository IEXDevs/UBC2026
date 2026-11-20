import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAccountMirror, mirrorEntries } from './account-state.mjs';
import { catalogStorageKey } from './file-catalog.mjs';
import { acceptanceStorageKey, REVIEW_THRESHOLD_KEY, SPEND_PERMISSION_KEY } from './spend-permission.mjs';
import { looksStorageKey, rosterStorageKey, writeLooks, writeRoster } from './roster.mjs';
import { talkStorageKey, writeTalks } from './talk-store.mjs';
import { accountStorageKey } from './account-code.mjs';

function memory(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
  };
}

function harness({ server = [], listStatus = 200, source = 'supabase', ownerId = 'alice', local = {} } = {}) {
  const storage = memory(local);
  const posts = [];
  const timers = [];
  const fetchImpl = async (url, init = {}) => {
    if ((init.method || 'GET') === 'GET') {
      if (listStatus !== 200) return Response.json({ error: 'x' }, { status: listStatus });
      return Response.json({ ok: true, source, items: server });
    }
    const body = JSON.parse(init.body);
    posts.push(body);
    for (const item of body.items) {
      const index = server.findIndex(row => row.name === item.name);
      if (index >= 0) server.splice(index, 1);
      if (item.value !== null) server.push(item);
    }
    return Response.json({ ok: true });
  };
  const mirror = createAccountMirror({
    storage,
    ownerId,
    fetchImpl,
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => {},
  });
  return { storage, posts, timers, mirror };
}

test('starting an empty desk does not overwrite another browser’s first save', async () => {
  const server = [];
  const original = harness({ server });
  const fresh = harness({ server });
  await original.mirror.hydrate();
  await fresh.mirror.hydrate();

  const roster = { order: ['bot_1'], extra: [] };
  const looks = { bot_1: { name: 'Agent' } };
  const talks = { bot_1: [{ id: 'l1', role: 'user', text: 'hi' }] };
  writeRoster(original.mirror.storage, 'alice', roster);
  writeLooks(original.mirror.storage, 'alice', looks);
  writeTalks(original.mirror.storage, 'alice', talks);
  await original.mirror.flush();

  writeRoster(fresh.mirror.storage, 'alice', { order: [], extra: [] });
  writeLooks(fresh.mirror.storage, 'alice', {});
  writeTalks(fresh.mirror.storage, 'alice', {});
  await fresh.mirror.flush();
  assert.deepEqual(fresh.posts, []);

  const later = harness({ server });
  await later.mirror.hydrate();
  assert.deepEqual(JSON.parse(later.storage.getItem(rosterStorageKey('alice'))), roster);
  assert.deepEqual(JSON.parse(later.storage.getItem(looksStorageKey('alice'))), looks);
  assert.deepEqual(JSON.parse(later.storage.getItem(talkStorageKey('alice'))), talks);
});

test('starting with an unchanged cloud snapshot is not an edit, but clearing it is', async () => {
  const talks = { bot_1: [{ id: 'l1', role: 'user', text: 'hi' }] };
  const { mirror, posts } = harness({ server: [{ name: 'talks', value: JSON.stringify(talks) }] });
  await mirror.hydrate();

  writeTalks(mirror.storage, 'alice', talks);
  await mirror.flush();
  assert.deepEqual(posts, []);

  writeTalks(mirror.storage, 'alice', {});
  await mirror.flush();
  assert.deepEqual(posts, [{ items: [{ name: 'talks', value: '{}' }] }]);
});

test('hydrate does not import cached empty startup defaults from older builds', async () => {
  const { mirror, posts } = harness({
    local: {
      [rosterStorageKey('alice')]: '{"order":[],"extra":[]}',
      [looksStorageKey('alice')]: '{}',
      [talkStorageKey('alice')]: '{}',
    },
  });
  await mirror.hydrate();
  assert.deepEqual(posts, []);
});

/**
 * Achieves: the mirror covers the desk state that used to be browser-only and leaves the file catalog,
 * provider keys, the desk password, and the seed out.
 * Fails when: the catalog key (it holds file secret ids) or a provider key becomes mirrored.
 * Oracle: explicit key list per owner.
 * Side effects / state checked: none.
 * Gaps: none.
 */
test('mirror entries cover desk state and never the file catalog or secrets', () => {
  const entries = mirrorEntries('did:privy:abc');
  const names = entries.map(entry => entry.name).sort();
  assert.deepEqual(names, ['accountCode', 'acceptance', 'looks', 'permission', 'reviewCap', 'roster', 'talks', 'tokens', 'voiceSettings', 'voiceTime'].sort());
  const keys = entries.map(entry => entry.key);
  assert.equal(keys.includes(catalogStorageKey('did:privy:abc')), false);
  assert.equal(keys.some(key => /provider|desk-lock|desk-grant|recovery|privy:token|privy:refresh/.test(key)), false);
  assert.deepEqual(mirrorEntries(''), []);
});

/**
 * Achieves: on sign-in the account copy replaces this browser's copy, so a new browser opens the same desk.
 * Fails when: stale local data wins over the account, or onboarding acceptance is lost.
 * Oracle: local storage equals the account values after hydrate.
 * Side effects / state checked: local storage keys and no upload for keys the account had.
 * Gaps: none.
 */
test('hydrate pulls the account copy over this browser', async () => {
  const roster = JSON.stringify({ order: ['a'], extra: [] });
  const { storage, posts, mirror } = harness({
    server: [
      { name: 'roster', value: roster },
      { name: 'acceptance', value: '1' },
      { name: 'permission', value: 'review' },
      { name: 'reviewCap', value: '25000000' },
      { name: 'accountCode', value: '1234567890123456' },
    ],
    local: { [rosterStorageKey('alice')]: '{"order":["stale"],"extra":[]}' },
  });
  const result = await mirror.hydrate();
  assert.equal(result.ok, true);
  assert.equal(storage.getItem(rosterStorageKey('alice')), roster);
  assert.equal(storage.getItem(acceptanceStorageKey('alice')), '1');
  assert.equal(storage.getItem(SPEND_PERMISSION_KEY), 'review');
  assert.equal(storage.getItem(REVIEW_THRESHOLD_KEY), '25000000');
  assert.equal(storage.getItem(accountStorageKey('alice')), '1234567890123456');
  assert.equal(posts.length, 0);
});

/**
 * Achieves: data only this browser had is uploaded once, and another account's spend mode does not carry over.
 * Fails when: local chats are dropped on first sync, or a previous account's permission becomes this account's.
 * Oracle: uploaded names; shared permission keys cleared when this owner has not accepted.
 * Side effects / state checked: POST bodies and shared keys.
 * Gaps: none.
 */
test('hydrate uploads local-only data and clears another account permission', async () => {
  const talks = JSON.stringify({ bot_1: [{ id: 'l1', role: 'user', text: 'hi' }] });
  const first = harness({
    local: { [talkStorageKey('alice')]: talks, [SPEND_PERMISSION_KEY]: 'full', [REVIEW_THRESHOLD_KEY]: '999' },
  });
  await first.mirror.hydrate();
  assert.deepEqual(first.posts.flatMap(body => body.items.map(item => item.name)), ['talks']);
  assert.equal(first.posts[0].items[0].value, talks);
  assert.equal(first.storage.getItem(SPEND_PERMISSION_KEY), null);
  assert.equal(first.storage.getItem(REVIEW_THRESHOLD_KEY), null);

  const accepted = harness({
    local: { [acceptanceStorageKey('alice')]: '1', [SPEND_PERMISSION_KEY]: 'ask', [REVIEW_THRESHOLD_KEY]: '5000000' },
  });
  await accepted.mirror.hydrate();
  const names = accepted.posts.flatMap(body => body.items.map(item => item.name)).sort();
  assert.deepEqual(names, ['acceptance', 'permission', 'reviewCap']);
});

/**
 * Achieves: nothing is pushed before the account copy was read, and a failed read keeps the mirror closed.
 * Fails when: an unhydrated browser overwrites the account, or a failed read still pushes later writes.
 * Oracle: no POST and no timer after a failed or unconfigured hydrate.
 * Side effects / state checked: POST list, timer list.
 * Gaps: none.
 */
test('writes never reach the account before a successful hydrate', async () => {
  const before = harness();
  before.mirror.storage.setItem(rosterStorageKey('alice'), '{"order":[],"extra":[]}');
  assert.equal(before.timers.length, 0);

  for (const options of [{ listStatus: 503 }, { source: 'unconfigured' }]) {
    const failed = harness(options);
    const result = await failed.mirror.hydrate();
    assert.equal(result.ok, false);
    failed.mirror.storage.setItem(rosterStorageKey('alice'), '{"order":["x"],"extra":[]}');
    assert.equal(failed.timers.length, 0);
    await failed.mirror.flush();
    assert.equal(failed.posts.length, 0);
    assert.equal(failed.storage.getItem(rosterStorageKey('alice')), '{"order":["x"],"extra":[]}');
  }
});

/**
 * Achieves: after hydrate, writes to mirrored keys are batched into one push, only the latest value per
 * name is sent, deletes send null, and keys outside the list are never sent.
 * Fails when: every keystroke posts, a stale value is sent, or the file catalog is pushed.
 * Oracle: one POST with the latest values after the timer fires.
 * Side effects / state checked: POST bodies, timer count.
 * Gaps: Retry timing is not asserted.
 */
test('mirrored writes are debounced, latest-wins, and limited to the mirror list', async () => {
  const { storage, posts, timers, mirror } = harness();
  await mirror.hydrate();
  mirror.storage.setItem(rosterStorageKey('alice'), '{"order":["a"],"extra":[]}');
  mirror.storage.setItem(rosterStorageKey('alice'), '{"order":["a","b"],"extra":[]}');
  mirror.storage.setItem(SPEND_PERMISSION_KEY, 'review');
  mirror.storage.setItem(catalogStorageKey('alice'), '{"bot":[{"id":"secret"}]}');
  mirror.storage.setItem('maelstrom.providers', '[{"key":"sk-1"}]');
  assert.equal(timers.length, 1);
  assert.equal(posts.length, 0);
  await timers[0]();
  assert.equal(posts.length, 1);
  const items = Object.fromEntries(posts[0].items.map(item => [item.name, item.value]));
  assert.deepEqual(Object.keys(items).sort(), ['permission', 'roster']);
  assert.equal(items.roster, '{"order":["a","b"],"extra":[]}');
  assert.equal(JSON.stringify(posts).includes('secret'), false);
  assert.equal(storage.getItem(catalogStorageKey('alice')) != null, true);

  mirror.storage.removeItem(SPEND_PERMISSION_KEY);
  await mirror.flush();
  assert.deepEqual(posts[1].items, [{ name: 'permission', value: null }]);
});
