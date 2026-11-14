import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, createBrowserSessionService, agentTools, SessionError } from './session.mjs';

function service(overrides = {}) {
  const store = createMemoryStore();
  const browsers = {
    createSession: async () => ({ sessionId: 'prov-1' }),
    readonlyView: async sessionId => {
      assert.equal(sessionId, 'prov-1');
      return { viewerUrl: 'https://live.browser.run/ui/view?jwt=test', connectBefore: 't', mode: 'readonly' };
    },
  };
  const search = async (query, limit) => [{ title: 'A', url: 'https://example.com', snippet: query, fetchedAt: 't' }].slice(0, limit);
  const scrape = async url => ({ url, title: 'Page', markdown: '# hi', truncated: false, fetchedAt: 't' });
  return createBrowserSessionService({
    store, browsers, search, scrape, maxSessionsPerBot: 2, clock: () => 1000, idFactory: () => 'rec-1', ...overrides,
  });
}

test('agent tools cover search, scrape, and owned browser lifecycle', () => {
  assert.deepEqual(
    agentTools.map(tool => tool.name),
    ['web_search', 'web_scrape', 'browser_open', 'browser_live_view', 'browser_release'],
  );
});

test('search returns concise tool events without exposing secrets', async () => {
  const result = await service().search({ ownerId: 'u1', botId: 'b1', query: 'solana usdc' });
  assert.equal(result.results[0].url, 'https://example.com');
  assert.equal(result.event.name, 'web_search');
  assert.equal(result.event.resultCount, 1);
});

test('scrape returns markdown via Firecrawl tool without exposing secrets', async () => {
  const result = await service().invokeTool('web_scrape', { url: 'https://example.com' }, { ownerId: 'u1', botId: 'b1' });
  assert.equal(result.page.markdown, '# hi');
  assert.equal(result.event.name, 'web_scrape');
  assert.equal(result.event.truncated, false);
});

test('sessions are bound to owner/bot and hide provider ids from open response', async () => {
  const svc = service();
  const opened = await svc.openSession({ ownerId: 'u1', botId: 'b1', purpose: 'checkout' });
  assert.equal(opened.sessionRecordId, 'rec-1');
  assert.equal(opened.providerSessionId, undefined);
  const listed = await svc.listOpenSessions({ ownerId: 'u1', botId: 'b1' });
  assert.equal(listed.sessions.length, 1);
  await assert.rejects(svc.liveView({ ownerId: 'other', botId: 'b1', sessionRecordId: 'rec-1' }), SessionError);
});

test('per-bot concurrency limit is enforced', async () => {
  let n = 0;
  const svc = service({
    idFactory: () => `rec-${++n}`,
    browsers: { createSession: async () => ({ sessionId: `prov-${n}` }), readonlyView: async () => ({}) },
  });
  await svc.openSession({ ownerId: 'u1', botId: 'b1' });
  await svc.openSession({ ownerId: 'u1', botId: 'b1' });
  await assert.rejects(svc.openSession({ ownerId: 'u1', botId: 'b1' }), (error) => error.code === 'concurrency_limit' && error.status === 429);
  // Another bot still has capacity.
  await svc.openSession({ ownerId: 'u1', botId: 'b2' });
});

test('live view is owner-only, no-store, and marks Vercel embed unverified', async () => {
  const svc = service();
  await svc.openSession({ ownerId: 'u1', botId: 'b1' });
  const view = await svc.liveView({ ownerId: 'u1', botId: 'b1', sessionRecordId: 'rec-1' });
  assert.equal(view.headers['Cache-Control'], 'no-store');
  assert.equal(view.embedVerified, false);
  assert.match(view.viewerUrl, /^https:\/\/live\.browser\.run\//);
});

test('release frees a concurrency slot and invokeTool rejects unknown tools', async () => {
  let n = 0;
  const svc = service({
    idFactory: () => `rec-${++n}`,
    browsers: { createSession: async () => ({ sessionId: `prov-${n}` }), readonlyView: async () => ({}) },
  });
  await svc.openSession({ ownerId: 'u1', botId: 'b1' });
  await svc.openSession({ ownerId: 'u1', botId: 'b1' });
  await svc.releaseSession({ ownerId: 'u1', botId: 'b1', sessionRecordId: 'rec-1' });
  await svc.openSession({ ownerId: 'u1', botId: 'b1' });
  await assert.rejects(svc.invokeTool('rm_rf', {}, { ownerId: 'u1', botId: 'b1' }), (error) => error.code === 'unknown_tool');
});

test('client-supplied provider session ids cannot be used as authorization', async () => {
  const svc = service();
  await svc.openSession({ ownerId: 'u1', botId: 'b1' });
  await assert.rejects(svc.liveView({ ownerId: 'u1', botId: 'b1', sessionRecordId: 'prov-1' }), (error) => error.code === 'session_not_found');
});
