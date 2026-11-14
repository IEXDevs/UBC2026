import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BotStateMachine, createDurableStore } from './bot-do.mjs';

function browsers() {
  const closed = [];
  return {
    closed,
    provider: {
      createSession: async () => ({ sessionId: 'prov-1' }),
      readonlyView: async sessionId => {
        if (sessionId !== 'prov-1') throw new Error('wrong provider session');
        return {
          viewerUrl: 'https://live.browser.run/ui/view?jwt=owner-secret',
          connectBefore: '2026-11-14T00:05:00.000Z',
          mode: 'readonly',
        };
      },
      closeSession: async sessionId => { closed.push(sessionId); },
    },
  };
}

function machineWithBrowsers() {
  const { provider, closed } = browsers();
  return { machine: new BotStateMachine(), closed, env: { browsers: provider } };
}

test('browser sessions are owner-bound and hide the provider id', async () => {
  const { machine, env, closed } = machineWithBrowsers();
  const opened = await machine.handle(new Request('https://bot/id/bot_1/browser/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ purpose: 'checkout' }),
  }), env);
  assert.equal(opened.status, 200);
  assert.equal(opened.headers.get('cache-control'), 'no-store');
  const openBody = await opened.json();
  assert.equal(openBody.providerSessionId, undefined);
  assert.equal(openBody.status, 'open');
  assert.equal(JSON.stringify(openBody).includes('prov-1'), false);

  const missingOwner = await machine.handle(new Request('https://bot/id/bot_1/browser/sessions', {
    method: 'POST',
    body: JSON.stringify({ ownerId: 'user_1' }),
  }), env);
  assert.equal(missingOwner.status, 401);

  const view = await machine.handle(new Request(`https://bot/id/bot_1/browser/sessions/${openBody.sessionRecordId}/live-view`, {
    method: 'POST',
    headers: { 'x-owner-id': 'user_1' },
  }), env);
  const viewBody = await view.json();
  assert.equal(view.status, 200);
  assert.equal(view.headers.get('cache-control'), 'no-store');
  assert.equal(viewBody.embedVerified, true);
  assert.equal(viewBody.viewerUrl, 'https://live.browser.run/ui/view?jwt=owner-secret');
  assert.equal(viewBody.event.viewerUrl, undefined);
  assert.equal(JSON.stringify(viewBody.event).includes('jwt'), false);

  const otherOwner = await machine.handle(new Request(`https://bot/id/bot_1/browser/sessions/${openBody.sessionRecordId}/live-view`, {
    method: 'POST',
    headers: { 'x-owner-id': 'user_2' },
  }), env);
  assert.equal(otherOwner.status, 404);

  const injected = await machine.handle(new Request(`https://bot/id/bot_1/browser/sessions/${openBody.sessionRecordId}/live-view`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ sessionId: 'prov-1' }),
  }), env);
  assert.equal(injected.status, 400);
  assert.equal((await injected.json()).error, 'provider_session_forbidden');

  const released = await machine.handle(new Request(`https://bot/id/bot_1/browser/sessions/${openBody.sessionRecordId}/release`, {
    method: 'POST',
    headers: { 'x-owner-id': 'user_1' },
  }), env);
  assert.equal(released.status, 200);
  assert.deepEqual(closed, ['prov-1']);
  const listed = await machine.handle(new Request('https://bot/id/bot_1/browser/sessions', {
    headers: { 'x-owner-id': 'user_1' },
  }), env);
  assert.deepEqual((await listed.json()).sessions, []);
});

test('durable store pages session records past the first page', async () => {
  const rows = new Map();
  for (let i = 0; i < 101; i += 1) rows.set(`browser:user_1:bot_1:rec_${String(i).padStart(3, '0')}`, { n: i });
  const storage = {
    async get(key) { return rows.get(key); },
    async put(key, value) { rows.set(key, value); },
    async delete(key) { rows.delete(key); },
    async list({ prefix = '', start, limit = 100 } = {}) {
      const keys = [...rows.keys()]
        .filter(key => key.startsWith(prefix) && (start == null || key > start))
        .sort();
      const page = new Map();
      for (const key of keys.slice(0, limit)) page.set(key, rows.get(key));
      return page;
    },
  };
  const store = createDurableStore(storage);
  const listed = await store.list('browser:user_1:bot_1:');
  assert.equal(listed.length, 101);
  assert.equal(listed[0].n, 0);
  assert.equal(listed[100].n, 100);
});
