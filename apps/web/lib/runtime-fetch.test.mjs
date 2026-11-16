import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectRuntimeFetch } from './runtime-fetch.mjs';

test('runtime fetch uses the service binding when the web Worker has one', async () => {
  const calls = [];
  const binding = {
    fetch(url, init) {
      calls.push({ url, init });
      return Promise.resolve(new Response('bound'));
    },
  };
  const fallback = () => Promise.resolve(new Response('public'));
  const response = await selectRuntimeFetch({ AGENT_RUNTIME: binding }, fallback)(
    'https://maelstrom-agent-runtime.example.workers.dev/api/bots',
    { method: 'GET' },
  );
  assert.equal(await response.text(), 'bound');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'GET');
});

test('runtime fetch uses public fetch when no service binding is present', async () => {
  let used = false;
  const fallback = () => {
    used = true;
    return Promise.resolve(new Response('public'));
  };
  const response = await selectRuntimeFetch({}, fallback)('https://runtime.example/api/bots');
  assert.equal(used, true);
  assert.equal(await response.text(), 'public');
});
