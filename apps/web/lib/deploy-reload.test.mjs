import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveBuildId } from './build-id.mjs';
import {
  BUILD_QUERY,
  buildsDiffer,
  checkDeploy,
  cleanBuildQuery,
  clearBrowserCaches,
  reloadUrl,
  watchDeploy,
} from './deploy-reload.mjs';

function memorySession() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
  };
}

/*
 * Achieves: verifies a build id prefers the git commit.
 * Fails when: a build id prefers the git commit breaks (e.g. expected head: (, head: (, head: ().
 * Oracle: assert.equal(resolveBuildId({ env: { NEXT_PUBLIC_BUILD_ID: 'from-env' }, head: (); assert.equal(resolveBuildId({ env: { NEXT_PUBLIC_BUILD_ID: 'from-env' }, head: (); assert.equal(resolveBuildId({ env: {}, head: ()
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('a build id prefers the git commit', () => {
  assert.equal(resolveBuildId({ env: { NEXT_PUBLIC_BUILD_ID: 'from-env' }, head: () => 'abc1234' }), 'abc1234');
  assert.equal(resolveBuildId({ env: { NEXT_PUBLIC_BUILD_ID: 'from-env' }, head: () => '' }), 'from-env');
  assert.equal(resolveBuildId({ env: {}, head: () => 'nope' }), 'dev');
});

/*
 * Achieves: verifies a new deployment is reloaded once after caches are cleared.
 * Fails when: a new deployment is reloaded once after caches are cleared breaks (e.g. expected '/api/build', 'no-store', { reload: true, id: 'bbbbbbb' }).
 * Oracle: assert.equal(url, '/api/build'); assert.equal(init.cache, 'no-store'); assert.equal(replaced, `https://maelstrom.example/desk?tab=1&${BUILD_QUERY}=bbbbbbb#voice`); assert.equal(deleted.length, 1); assert.deepEqual(first, { reload: true, id: 'bbbbbbb' }); assert.deepEqual(deleted, ['pages'])
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
test('a new deployment is reloaded once after caches are cleared', async () => {
  const deleted = [];
  const unregistered = [];
  let replaced = '';
  const session = memorySession();
  const options = {
    localId: 'aaaaaaa',
    href: 'https://maelstrom.example/desk?tab=1#voice',
    session,
    fetcher: async (url, init) => {
      assert.equal(url, '/api/build');
      assert.equal(init.cache, 'no-store');
      return { ok: true, json: async () => ({ id: 'bbbbbbb' }) };
    },
    caches: {
      keys: async () => ['pages'],
      delete: async (key) => { deleted.push(key); },
    },
    serviceWorker: {
      getRegistrations: async () => [{ unregister: async () => { unregistered.push(true); } }],
    },
    replace: (url) => { replaced = url; },
  };

  const first = await checkDeploy(options);
  assert.deepEqual(first, { reload: true, id: 'bbbbbbb' });
  assert.deepEqual(deleted, ['pages']);
  assert.deepEqual(unregistered, [true]);
  assert.equal(replaced, `https://maelstrom.example/desk?tab=1&${BUILD_QUERY}=bbbbbbb#voice`);

  const second = await checkDeploy(options);
  assert.deepEqual(second, { reload: false });
  assert.equal(deleted.length, 1);
});

/*
 * Achieves: verifies the same build and a failed check leave the page alone.
 * Fails when: the same build and a failed check leave the page alone breaks (e.g. expected { reload: false }, 'aaaaaaa', 'bbbbbbb').
 * Oracle: assert.equal(buildsDiffer('aaaaaaa', 'aaaaaaa'); assert.equal(buildsDiffer('', 'bbbbbbb'); assert.equal(reloadUrl('https://maelstrom.example/', 'bbbbbbb'); assert.equal(cleanBuildQuery(`https://maelstrom.example/?${BUILD_QUERY}=aaaaaaa`, 'aaaaaaa'); assert.equal(cleanBuildQuery('https://maelstrom.example/?x=1', 'aaaaaaa'); assert.deepEqual(same, { reload: false })
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
test('the same build and a failed check leave the page alone', async () => {
  const same = await checkDeploy({
    localId: 'aaaaaaa',
    href: 'https://maelstrom.example/',
    fetcher: async () => ({ ok: true, json: async () => ({ id: 'aaaaaaa' }) }),
    replace: () => { throw new Error('should not reload'); },
  });
  assert.deepEqual(same, { reload: false });
  assert.equal(buildsDiffer('aaaaaaa', 'aaaaaaa'), false);
  assert.equal(buildsDiffer('', 'bbbbbbb'), false);

  const failed = await checkDeploy({
    localId: 'aaaaaaa',
    href: 'https://maelstrom.example/',
    fetcher: async () => { throw new Error('offline'); },
    replace: () => { throw new Error('should not reload'); },
  });
  assert.deepEqual(failed, { reload: false });
  assert.equal(reloadUrl('https://maelstrom.example/', 'bbbbbbb'), `https://maelstrom.example/?${BUILD_QUERY}=bbbbbbb`);
  assert.equal(cleanBuildQuery(`https://maelstrom.example/?${BUILD_QUERY}=aaaaaaa`, 'aaaaaaa'), '/');
  assert.equal(cleanBuildQuery('https://maelstrom.example/?x=1', 'aaaaaaa'), null);
});

/*
 * Achieves: verifies clearing caches ignores a browser with neither cache storage nor a worker.
 * Fails when: intended checks for "clearing caches ignores a browser with neither cache storage nor a worker" no longer hold.
 * Oracle: assertions in the test body define the expected outcomes independently of production control-flow mirroring.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('clearing caches ignores a browser with neither cache storage nor a worker', async () => {
  await clearBrowserCaches();
  await clearBrowserCaches({ caches: {}, serviceWorker: {} });
});

/*
 * Achieves: verifies the watcher checks immediately and when the tab is shown.
 * Fails when: structured result drifts from expected shape.
 * Oracle: assert.deepEqual(calls, ['/'])
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
test('the watcher checks immediately and when the tab is shown', () => {
  const calls = [];
  let visible = () => {};
  const stop = watchDeploy({
    localId: 'aaaaaaa',
    href: `https://maelstrom.example/?${BUILD_QUERY}=aaaaaaa`,
    fetcher: async () => ({ ok: true, json: async () => ({ id: 'aaaaaaa' }) }),
    session: memorySession(),
    caches: { keys: async () => [], delete: async () => {} },
    serviceWorker: { getRegistrations: async () => [] },
    replace: (url) => calls.push(url),
    replaceState: (path) => calls.push(path),
    intervalMs: 1000,
    windowRef: {
      setInterval: () => 1,
      clearInterval: () => {},
      location: { href: `https://maelstrom.example/?${BUILD_QUERY}=aaaaaaa`, replace: (url) => calls.push(url) },
    },
    documentRef: {
      visibilityState: 'visible',
      addEventListener: (name, fn) => { visible = fn; },
      removeEventListener: () => {},
    },
  });
  assert.deepEqual(calls, ['/']);
  visible();
  stop();
});

/*
 * Achieves: verifies the app publishes the build id and mounts the reload watcher.
 * Fails when: resolveBuildId / NEXT_PUBLIC_BUILD_ID / DeployReload / no-store / _headers cache rules drift.
 * Oracle: next.config resolves build id; layout mounts DeployReload; /api/build is no-store; _headers cover /api/build and /_next/static.
 * Side effects / state checked: source-text / config snapshot.
 * Gaps: source snapshot only — runtime UI/HTTP not executed.
 */
test('the app publishes the build id and mounts the reload watcher', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const config = readFileSync(join(root, 'next.config.mjs'), 'utf8');
  const layout = readFileSync(join(root, 'app/layout.js'), 'utf8');
  const route = readFileSync(join(root, 'app/api/build/route.js'), 'utf8');
  const headers = readFileSync(join(root, 'public/_headers'), 'utf8');
  assert.match(config, /resolveBuildId/);
  assert.match(config, /NEXT_PUBLIC_BUILD_ID/);
  assert.match(layout, /<DeployReload \/>/);
  assert.match(route, /no-store/);
  assert.match(headers, /\/api\/build/);
  assert.match(headers, /\/_next\/static\/\*/);
  const staticAt = headers.indexOf('/_next/static/*');
  const broadAt = headers.indexOf('/*');
  assert.ok(broadAt >= 0 && staticAt > broadAt);
});
