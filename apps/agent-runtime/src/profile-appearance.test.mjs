import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROFILE_LOOK_KEY, profilePhoto } from '@ubc2026/contracts';
import { saveAppearance } from './profile-appearance.mjs';
import { parseStateItem } from './account-state.mjs';

const IMAGE = 'data:image/jpeg;base64,/9j/AAAA';
const env = { SUPABASE_URL: 'https://unit-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'unit-test-only' };
const value = photo => JSON.stringify({ [PROFILE_LOOK_KEY]: { image: photo } });

function database(initial, race = null) {
  let row = initial ? { value: JSON.stringify(initial), updated_at: '2026-11-20T05:00:00.000Z' } : null;
  const requests = [];
  return {
    get row() { return row; },
    requests,
    fetcher: async (raw, init) => {
      const url = new URL(raw);
      assert.equal(url.pathname, '/rest/v1/owner_state');
      requests.push({ url, init });
      if (init.method === 'GET') {
        assert.equal(url.searchParams.get('owner_id'), 'eq.alice');
        return Response.json(row ? [{ ...row }] : []);
      }
      if (race) { row = race(row); race = null; }
      const body = JSON.parse(init.body);
      if (init.method === 'POST') {
        assert.equal(init.headers.prefer, 'resolution=ignore-duplicates,return=representation');
        assert.equal(body.owner_id, 'alice');
        if (row) return Response.json([]);
      } else {
        assert.equal(url.searchParams.get('owner_id'), 'eq.alice');
        if (url.searchParams.get('updated_at') !== `eq.${row.updated_at}`) return Response.json([]);
      }
      row = body;
      return Response.json([{ ...row }]);
    },
  };
}

test('photo-only writes preserve newer agent edits, including a concurrent edit', async () => {
  const db = database({ bot_one: { color: 'old' } }, row => ({ value: JSON.stringify({ bot_one: { color: 'newer-browser' } }), updated_at: '2026-11-20T05:01:00.000Z' }));
  assert.equal(await saveAppearance(env, 'alice', { value: value(IMAGE), profilePhoto: true }, db.fetcher), true);
  const looks = JSON.parse(db.row.value);
  assert.equal(looks.bot_one.color, 'newer-browser');
  assert.equal(profilePhoto(looks), IMAGE);
  assert.equal(db.requests.filter(request => request.init.method === 'PATCH').length, 2);
});

test('agent updates cannot overwrite or drop the canonical photo', async () => {
  const db = database({ [PROFILE_LOOK_KEY]: { image: IMAGE } });
  assert.equal(await saveAppearance(env, 'alice', { value: JSON.stringify({ bot_one: { color: 'red' }, [PROFILE_LOOK_KEY]: { image: IMAGE + 'AAAA' } }) }, db.fetcher), true);
  assert.equal(profilePhoto(JSON.parse(db.row.value)), IMAGE);
  assert.equal(await saveAppearance(env, 'alice', { value: '{}' }, db.fetcher), true);
  assert.deepEqual(JSON.parse(db.row.value), { [PROFILE_LOOK_KEY]: { image: IMAGE } });
});

test('a concurrent first writer is not overwritten by a photo insert', async () => {
  const db = database(null, () => ({ value: JSON.stringify({ bot_one: { color: 'first-writer' } }), updated_at: '2026-11-20T05:00:00.000Z' }));
  assert.equal(await saveAppearance(env, 'alice', { value: value(IMAGE), profilePhoto: true }, db.fetcher), true);
  assert.equal(JSON.parse(db.row.value).bot_one.color, 'first-writer');
  assert.equal(profilePhoto(JSON.parse(db.row.value)), IMAGE);
});

test('failed or continually conflicting writes never confirm a photo', async () => {
  assert.equal(await saveAppearance(env, 'alice', { value: value(IMAGE), profilePhoto: true }, async () => Response.json([], { status: 503 })), false);
  let writes = 0;
  assert.equal(await saveAppearance(env, 'alice', { value: value(IMAGE), profilePhoto: true }, async (_url, init) => {
    if (init.method === 'GET') return Response.json([{ value: '{}', updated_at: '2026-11-20T05:00:00.000Z' }]);
    writes += 1;
    return Response.json([]);
  }), false);
  assert.equal(writes, 3);
});

test('photo-only state items cannot carry another appearance, secret or active image', () => {
  const item = { name: 'looks', value: value(IMAGE), profilePhoto: true };
  assert.deepEqual(parseStateItem(item), item);
  assert.equal(parseStateItem({ ...item, name: 'roster' }), null);
  assert.equal(parseStateItem({ ...item, value: JSON.stringify({ [PROFILE_LOOK_KEY]: { image: IMAGE }, bot_one: {} }) }), null);
  assert.equal(parseStateItem({ ...item, value: value('data:image/svg+xml;base64,AAAA') }), null);
  assert.equal(parseStateItem({ ...item, value: JSON.stringify({ [PROFILE_LOOK_KEY]: { image: IMAGE, apiKey: 'unit-test-only' } }) }), null);
});
