import assert from 'node:assert/strict';
import { test } from 'node:test';
import { profilePhoto, PROFILE_LOOK_KEY, withProfilePhoto, saveProfilePhoto } from './profile-photo.mjs';
import { createAccountMirror } from './account-state.mjs';
import { readLooks } from './roster.mjs';

const IMAGE = 'data:image/jpeg;base64,/9j/AAAA';

test('profile photos reject active content and oversized images without changing agent looks', () => {
  const looks = { bot_one: { color: '#ffffff', image: IMAGE } };
  const updated = withProfilePhoto(looks, IMAGE);
  assert.deepEqual(updated.bot_one, looks.bot_one);
  assert.equal(profilePhoto(updated), IMAGE);
  assert.equal(profilePhoto(looks), '');
  for (const image of ['data:image/svg+xml;base64,PHN2Zz4=', 'https://example.test/a.jpg', IMAGE + 'A'.repeat(32768)]) {
    assert.equal(withProfilePhoto(looks, image), null);
  }
});

test('profile photos hydrate on another browser through existing owner-scoped appearance state', async () => {
  const values = new Map();
  const posts = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const mirror = createAccountMirror({
    ownerId: 'alice', storage,
    fetchImpl: async (_url, init = {}) => {
      if (init.method && init.method !== 'GET') { posts.push(JSON.parse(init.body)); return Response.json({ ok: true }); }
      return Response.json({ ok: true, source: 'supabase', items: [{ name: 'looks', value: JSON.stringify({ [PROFILE_LOOK_KEY]: { image: IMAGE }, bot_one: { color: '#ffffff' } }) }] });
    },
    setTimer: () => 1, clearTimer: () => {},
  });
  await mirror.hydrate();
  const looks = readLooks(mirror.storage, 'alice');
  assert.equal(profilePhoto(looks), IMAGE);
  assert.equal(profilePhoto(readLooks(mirror.storage, 'bob')), '');
  assert.equal(posts.length, 0);
});

test('photo saves send only the photo and require a positive server acknowledgement', async () => {
  let sent;
  const fetchImpl = async (_url, init) => {
    sent = JSON.parse(init.body);
    return Response.json({ ok: true, saved: ['looks'] });
  };
  assert.equal(await saveProfilePhoto({ ownerId: 'alice', image: IMAGE, fetchImpl }), true);
  assert.deepEqual(sent.items, [{ name: 'looks', value: JSON.stringify({ [PROFILE_LOOK_KEY]: { image: IMAGE } }), profilePhoto: true }]);
  for (const response of [Response.json({ error: 'state_failed' }, { status: 502 }), Response.json({ ok: true, saved: [] })]) {
    assert.equal(await saveProfilePhoto({ ownerId: 'alice', image: IMAGE, fetchImpl: async () => response }), false);
  }
  assert.equal(await saveProfilePhoto({ ownerId: 'alice', image: IMAGE, fetchImpl: async () => { throw Error('offline'); } }), false);
});
