import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { securityAgent, securityPauseStatus, setSecurityPause, setSecurityFreeze } from './security.mjs';

test('security shows bulk controls before agent rows and gives each icon an accessible name', () => {
  const source = readFileSync(new URL('../components/SecurityPanel.js', import.meta.url), 'utf8');
  assert.match(source, /<h2>Security<\/h2>[\s\S]*Pause all[\s\S]*Freeze all[\s\S]*<ul className="security-agent-list" aria-label="Agents">/);
  assert.match(source, /aria-label=\{playbackLabel\}/);
  assert.doesNotMatch(source, /accountLabel|security-assurance|security-overview/);
});

test('the agent list reads freeze state from the spending record', () => {
  assert.deepEqual(securityAgent({ id: 'one', name: 'One', status: 'idle', record: { frozen: true } }), {
    id: 'one', name: 'One', draft: false, frozen: true, disabled: false,
  });
});

test('pause state reloads from the agent checkpoint', async () => {
  const signal = new AbortController().signal;
  const fetcher = async (url, options) => {
    assert.equal(url, '/api/runtime/bots/bot_1/status');
    assert.equal(options.signal, signal);
    return Response.json({ ok: true, paused: true, run: null });
  };
  assert.equal(await securityPauseStatus('bot_1', {}, signal, fetcher), true);
  assert.equal(await securityPauseStatus('bot_1', {}, signal, async () => new Response('', { status: 502 })), null);
});

test('bulk pause updates only successful agents and resume targets one agent', async () => {
  const headers = { 'x-owner-id': 'owner' };
  const fetcher = async (url, options) => {
    assert.equal(options.method, 'POST');
    assert.equal(options.headers, headers);
    if (url.endsWith('/bot_2/pause')) return Response.json({ error: 'unavailable' }, { status: 502 });
    assert.match(url, /^\/api\/runtime\/bots\/bot_1\/(pause|resume)$/);
    return Response.json({ ok: true, paused: url.endsWith('/pause') });
  };
  assert.deepEqual(await setSecurityPause(['bot_1', 'bot_2'], true, headers, fetcher), { ids: ['bot_1'], ok: false });
  assert.deepEqual(await setSecurityPause(['bot_1'], false, headers, fetcher), { ids: ['bot_1'], ok: true });
});

test('the freeze request targets an agent and bulk changes can partially succeed', async () => {
  const expected = { botId: 'bot_1', frozen: false, enabled: false };
  const single = await setSecurityFreeze('bot_1', false, {}, async (url, options) => {
    assert.equal(url, '/api/runtime/api/bots/freeze');
    assert.deepEqual(JSON.parse(options.body), { botId: 'bot_1', frozen: false });
    return Response.json({ ok: true, items: [expected, { ...expected, botId: 'bot_2' }] });
  });
  assert.deepEqual(single, { items: [expected], ok: true });
  const frozen = { ...expected, frozen: true };
  const bulk = await setSecurityFreeze(null, true, {}, async (url, options) => {
    assert.deepEqual(JSON.parse(options.body), { frozen: true });
    return Response.json({ items: [frozen] }, { status: 502 });
  });
  assert.deepEqual(bulk, { items: [frozen], ok: false });
});
