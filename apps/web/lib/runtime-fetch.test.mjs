import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localWorkerMissing, responseFromBinding, selectRuntimeFetch } from './runtime-fetch.mjs';

/**
 * Achieves: verifies AGENT_RUNTIME service binding is preferred over public fetch when present.
 * Fails when: binding exists but fallback is used, or method/init is not forwarded.
 * Oracle: binding Response body 'bound'; fallback unused; calls[0].init.method === 'GET'.
 * Side effects / state checked: binding.fetch invoked once with forwarded init.
 * Gaps: none for selection; URL rewriting not asserted.
 */
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

/**
 * Achieves: verifies public fetch is used when no service binding is present.
 * Fails when: empty env still tries to call a missing binding, or fallback is skipped.
 * Oracle: fallback sets used=true and returns 'public'.
 * Side effects / state checked: fallback invoked.
 * Gaps: none.
 */
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

/**
 * Achieves: a local service binding that says the worker is not running falls back to public fetch.
 * Fails when: the 503 text is returned as the account response, or a real JSON 503 is replaced.
 * Oracle: worker-not-found text uses the fallback; account_state_unavailable stays on the binding.
 * Side effects / state checked: which fetch produced the response.
 * Gaps: does not boot wrangler.
 */
test('a missing local runtime worker falls back to the public origin', async () => {
  assert.equal(localWorkerMissing(503, 'Worker "maelstrom-agent-runtime" not found. Make sure it is running locally.'), true);
  assert.equal(localWorkerMissing(503, '{"error":"account_state_unavailable"}'), false);
  assert.equal(localWorkerMissing(200, 'Worker "maelstrom-agent-runtime" not found.'), false);

  let used = false;
  const missed = await responseFromBinding(
    () => Promise.resolve(new Response('Worker "maelstrom-agent-runtime" not found. Make sure it is running locally.', { status: 503 })),
    'https://runtime.example/api/recovery',
    { method: 'GET' },
    async () => {
      used = true;
      return new Response(JSON.stringify({ error: 'login_required' }), { status: 401 });
    },
  );
  assert.equal(used, true);
  assert.equal(missed.status, 401);

  used = false;
  const live = await responseFromBinding(
    () => Promise.resolve(Response.json({ error: 'account_state_unavailable' }, { status: 503 })),
    'https://runtime.example/api/recovery',
    { method: 'GET' },
    async () => {
      used = true;
      return new Response('no');
    },
  );
  assert.equal(used, false);
  assert.equal(live.status, 503);
  assert.equal((await live.json()).error, 'account_state_unavailable');
});
