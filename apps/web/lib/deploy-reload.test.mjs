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

test('a build id prefers the git commit', () => {
  assert.equal(resolveBuildId({ env: { NEXT_PUBLIC_BUILD_ID: 'from-env' }, head: () => 'abc1234' }), 'abc1234');
  assert.equal(resolveBuildId({ env: { NEXT_PUBLIC_BUILD_ID: 'from-env' }, head: () => '' }), 'from-env');
  assert.equal(resolveBuildId({ env: {}, head: () => 'nope' }), 'dev');
});

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

test('clearing caches ignores a browser with neither cache storage nor a worker', async () => {
  await clearBrowserCaches();
  await clearBrowserCaches({ caches: {}, serviceWorker: {} });
});

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
