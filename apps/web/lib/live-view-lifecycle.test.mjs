import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import React from 'react';
import { browserErrorNote, browserStatusNote } from './browser-status.mjs';
import {
  browserSessionUrl,
  liveViewFrame,
  liveSessionKey,
  nextViewerRefreshAt,
  reconcileLiveSession,
} from './live-view.mjs';

function panelHarness(fetcher) {
  const source = readFileSync(new URL('../components/LiveViewPanel.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export default function', 'function');
  const { code } = transformSync(source, { loader: 'jsx', jsx: 'transform' });
  const slots = [];
  const effects = [];
  let index = 0;
  let dirty = true;
  let tree;
  // Base the fake clock on the real one so ISO connectBefore deadlines minted in
  // test fetchers compare sensibly against the component's Date.now().
  let now = Date.now();
  const timers = new Set();
  const changed = (a, b) => !a || a.length !== b.length || a.some((value, i) => value !== b[i]);
  function useState(initial) {
    const id = index++;
    if (!(id in slots)) slots[id] = typeof initial === 'function' ? initial() : initial;
    return [slots[id], value => {
      const next = typeof value === 'function' ? value(slots[id]) : value;
      if (next !== slots[id]) { slots[id] = next; dirty = true; }
    }];
  }
  function useRef(initial) {
    const id = index++;
    return slots[id] ??= { current: initial };
  }
  function useCallback(callback, deps) {
    const id = index++;
    if (changed(slots[id]?.deps, deps)) slots[id] = { deps, callback };
    return slots[id].callback;
  }
  function useEffect(callback, deps) {
    const id = index++;
    if (changed(slots[id]?.deps, deps)) effects.push(() => {
      slots[id]?.cleanup?.();
      slots[id] = { deps, cleanup: callback() };
    });
  }
  const names = ['React', 'useState', 'useRef', 'useCallback', 'useEffect', 'fetch', 'browserErrorNote', 'browserStatusNote', 'browserSessionUrl', 'liveViewFrame', 'liveSessionKey', 'reconcileLiveSession', 'nextViewerRefreshAt', 'ownerAuthHeaders', 'LatticeLoader', 'HoldButton', 'setInterval', 'clearInterval', 'Date'];
  const Panel = new Function(...names, `${code}; return LiveViewPanel;`)(
    React, useState, useRef, useCallback, useEffect, fetcher, browserErrorNote, browserStatusNote,
    browserSessionUrl, liveViewFrame, liveSessionKey, reconcileLiveSession, nextViewerRefreshAt,
    async () => ({}), () => null, () => null,
    callback => { timers.add(callback); return callback; }, callback => timers.delete(callback),
    { now: () => now },
  );
  async function settle() {
    for (let step = 0; step < 30; step++) {
      if (dirty) {
        dirty = false;
        index = 0;
        tree = Panel({ botId: 'bot_1', ownerId: 'owner', autoStart: true });
        effects.splice(0).forEach(effect => effect());
      }
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  function nodes(node, type) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(child => nodes(child, type));
    return [...(!type || node.type === type ? [node] : []), ...nodes(node.props?.children, type)];
  }
  return {
    settle,
    async poll() { now += 64_000; [...timers].forEach(callback => callback()); await settle(); },
    async tick(ms) { now += ms; [...timers].forEach(callback => callback()); await settle(); },
    frame: () => nodes(tree, 'iframe')[0]?.props.src,
    alerts: () => nodes(tree, 'p').filter(node => node.props.role === 'alert').map(node => node.props.children).join(' '),
    async release() { await nodes(tree).find(node => node.props?.onHold)?.props.onHold(); await settle(); },
  };
}

test('Computer follows revisions, probes expiration and automatically opens a fresh session', async () => {
  let row = { sessionRecordId: 'record', revision: 0, status: 'open', url: 'https://example.com/current' };
  let expired = false;
  let opens = 0;
  const views = [];
  const panel = panelHarness(async (url, options) => {
    if (url.endsWith('/release')) { row = null; return Response.json({ status: 'closed' }); }
    if (url.endsWith('/live-view')) {
      if (expired) {
        row = null;
        expired = false;
        return Response.json({ error: 'browser_session_expired', providerStatus: 404, providerReason: 'targets_unavailable' }, { status: 410 });
      }
      views.push(row.revision);
      return Response.json({ viewerUrl: `https://live.browser.run/ui/view?revision=${row.revision}`, embedVerified: true, control: 'agent' });
    }
    if (options.method === 'POST') {
      assert.equal(JSON.parse(options.body).url, 'https://example.com/current');
      opens++;
      row = { sessionRecordId: 'replacement', revision: 0, status: 'open' };
      return Response.json(row);
    }
    return Response.json({ sessions: row ? [row] : [] });
  });
  await panel.settle();
  assert.match(panel.frame(), /revision=0/);
  row = { ...row, revision: 1 };
  await panel.poll();
  assert.match(panel.frame(), /revision=1/);
  assert.ok(views.includes(1));
  expired = true;
  await panel.poll();
  await panel.poll();
  assert.equal(opens, 1);
  assert.match(panel.frame(), /revision=0/);
  await panel.release();
  await panel.poll();
  assert.equal(opens, 1);
  assert.equal(panel.frame(), undefined);
});

test('Computer displays polling and provider failures instead of silently swallowing them', async () => {
  const panel = panelHarness(async () => Response.json({ error: 'browser_not_configured', providerStatus: 403 }, { status: 503 }));
  await panel.settle();
  assert.match(panel.alerts(), /browser_not_configured \(403 API token rejected\)/);
  assert.equal(panel.frame(), undefined);
});

test('Computer remints the viewer by the connectBefore deadline instead of the flat interval', async () => {
  let row = { sessionRecordId: 'record', revision: 0, status: 'open', url: 'https://example.com/current' };
  const views = [];
  const panel = panelHarness(async (url, options) => {
    if (url.endsWith('/live-view')) {
      views.push(1);
      return Response.json({
        viewerUrl: `https://live.browser.run/ui/view?mint=${views.length}`,
        embedVerified: true,
        control: 'agent',
        connectBefore: new Date(Date.now() + 30_000).toISOString(),
      });
    }
    if (options.method === 'POST') {
      row = { sessionRecordId: 'record', revision: 0, status: 'open' };
      return Response.json(row);
    }
    return Response.json({ sessions: [row] });
  });
  await panel.settle();
  // Settle may race an extra mint while state commits; the deadline behavior under
  // test is the delta across tick, not the absolute count at settle.
  const settled = views.length;
  assert.ok(settled >= 1);
  assert.match(panel.frame(), /mint=/);
  // connectBefore 30s out means remint by ~15s (15s margin), not the flat 60s.
  await panel.tick(16_000);
  assert.equal(views.length, settled + 1);
});
