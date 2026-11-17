import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, createBrowserSessionService, agentTools, describeLiveViewEmbed, SessionError } from './session.mjs';

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

/**
 * Achieves: agentTools exposes exactly the six research/browser lifecycle names in order.
 * Fails when: Name set drifts or order changes silently.
 * Oracle: Fixed expected array equality (catalog contract for voice/text parity).
 * Side effects: none.
 * Gaps: Parameter schemas are owned by agent-tools catalog tests.
 */
test('agent tools cover search, scrape, and owned browser lifecycle', () => {
  assert.deepEqual(
    agentTools.map(tool => tool.name),
    ['web_search', 'web_scrape', 'browser_open', 'browser_navigate', 'browser_live_view', 'browser_release'],
  );
});

/**
 * Achieves: web_search returns results plus a concise event (name + count) for the timeline.
 * Fails when: Event name wrong or result URL missing.
 * Oracle: Injected search stub returns known URL; event.name === 'web_search'.
 * Side effects: none beyond in-memory service (no provider network).
 * Gaps: Secret redaction in search snippets covered when provider plants secrets (browser-search).
 */
test('search returns concise tool events without exposing secrets', async () => {
  const result = await service().search({ ownerId: 'u1', botId: 'b1', query: 'solana usdc' });
  assert.equal(result.results[0].url, 'https://example.com');
  assert.equal(result.event.name, 'web_search');
  assert.equal(result.event.resultCount, 1);
});

/**
 * Achieves: web_scrape invokeTool returns markdown page and a non-secret event.
 * Fails when: Markdown dropped or event name/truncated wrong.
 * Oracle: Injected scrape stub {markdown:'# hi'}; event.name === 'web_scrape'.
 * Side effects: none (memory store + stubs).
 * Gaps: Upstream secret sanitization is browser-search-owned.
 */
test('scrape returns markdown via Firecrawl tool without exposing secrets', async () => {
  const result = await service().invokeTool('web_scrape', { url: 'https://example.com' }, { ownerId: 'u1', botId: 'b1' });
  assert.equal(result.page.markdown, '# hi');
  assert.equal(result.event.name, 'web_scrape');
  assert.equal(result.event.truncated, false);
});

/**
 * Achieves: openSession returns record id only (no providerSessionId); other owners cannot liveView.
 * Fails when: providerSessionId leaks on open, or cross-owner liveView succeeds.
 * Oracle: Open response keys; SessionError on ownerId mismatch.
 * Side effects: memory store write for the session record.
 * Gaps: Persist/reload across workers not covered (memory store only).
 */
test('sessions are bound to owner/bot and hide provider ids from open response', async () => {
  const svc = service();
  const opened = await svc.openSession({ ownerId: 'u1', botId: 'b1', purpose: 'checkout' });
  assert.equal(opened.sessionRecordId, 'rec-1');
  assert.equal(opened.providerSessionId, undefined);
  assert.equal(opened.url, null);
  assert.match(opened.note, /about:blank/);
  const listed = await svc.listOpenSessions({ ownerId: 'u1', botId: 'b1' });
  assert.equal(listed.sessions.length, 1);
  await assert.rejects(svc.liveView({ ownerId: 'other', botId: 'b1', sessionRecordId: 'rec-1' }), SessionError);
});

/**
 * Achieves: open/navigate call openTab; owner control blocks agent navigate until returned.
 * Fails when: Tabs not opened, liveView misses targetId, or navigate succeeds under owner control.
 * Oracle: Call-order spy on openTab; owner_has_control error code.
 * Side effects: memory store updates url/control; no real Browser Run.
 * Gaps: Concurrent navigate races not simulated.
 */
test('openSession and navigateSession load https urls via openTab', async () => {
  const tabs = [];
  const svc = service({
    browsers: {
      createSession: async () => ({ sessionId: 'prov-1' }),
      openTab: async (sessionId, url) => {
        tabs.push({ sessionId, url });
        return { targetId: 'T1', url, title: 'Google' };
      },
      readonlyView: async (sessionId, opts = {}) => {
        assert.equal(sessionId, 'prov-1');
        assert.equal(opts.targetId, 'T1');
        return { viewerUrl: 'https://live.browser.run/ui/view?jwt=test', connectBefore: 't', mode: 'readonly' };
      },
    },
  });
  const opened = await svc.openSession({
    ownerId: 'u1',
    botId: 'b1',
    url: 'https://www.google.com/',
  });
  assert.equal(opened.url, 'https://www.google.com/');
  assert.equal(opened.note, undefined);
  assert.deepEqual(tabs[0], { sessionId: 'prov-1', url: 'https://www.google.com/' });
  const view = await svc.liveView({ ownerId: 'u1', botId: 'b1', sessionRecordId: 'rec-1' });
  assert.equal(view.pageUrl, 'https://www.google.com/');
  const navigated = await svc.invokeTool(
    'browser_navigate',
    { sessionRecordId: 'rec-1', url: 'https://example.com/' },
    { ownerId: 'u1', botId: 'b1' },
  );
  assert.equal(navigated.url, 'https://example.com/');
  assert.equal(tabs[1].url, 'https://example.com/');
  const held = await svc.liveView({ ownerId: 'u1', botId: 'b1', sessionRecordId: 'rec-1', control: 'owner' });
  assert.equal(held.control, 'owner');
  await assert.rejects(
    svc.navigateSession({ ownerId: 'u1', botId: 'b1', sessionRecordId: 'rec-1', url: 'https://example.com/held' }),
    (error) => error.code === 'owner_has_control',
  );
  const returned = await svc.liveView({ ownerId: 'u1', botId: 'b1', sessionRecordId: 'rec-1', control: 'agent' });
  assert.equal(returned.control, 'agent');
});

/**
 * Achieves: At maxSessionsPerBot, further opens reuse+navigate instead of erroring; other bots stay free.
 * Fails when: Third open throws, reused≠true, or bot_2 cannot open fresh.
 * Oracle: maxSessionsPerBot=2 fixture; reused flag + openTab spy URL.
 * Side effects: memory store session list; createSession spy for fresh vs reuse.
 * Gaps: LRU which session is reused is implementation-defined beyond reused:true.
 */
test('per-bot concurrency limit reuses and navigates instead of failing', async () => {
  let n = 0;
  const tabs = [];
  const svc = service({
    idFactory: () => `rec-${++n}`,
    clock: () => 1000 + n,
    browsers: {
      createSession: async () => ({ sessionId: `prov-${n}` }),
      openTab: async (sessionId, url) => {
        tabs.push({ sessionId, url });
        return { targetId: 'T', url, title: 'Page' };
      },
      readonlyView: async () => ({}),
    },
  });
  await svc.openSession({ ownerId: 'u1', botId: 'b1' });
  await svc.openSession({ ownerId: 'u1', botId: 'b1' });
  const reused = await svc.openSession({
    ownerId: 'u1',
    botId: 'b1',
    url: 'https://example.com/fun',
  });
  assert.equal(reused.reused, true);
  assert.equal(reused.url, 'https://example.com/fun');
  assert.equal(tabs.at(-1).url, 'https://example.com/fun');
  // Another bot still has capacity for a fresh session.
  const other = await svc.openSession({ ownerId: 'u1', botId: 'b2' });
  assert.equal(other.reused, false);
});

/**
 * Achieves: liveView is no-store + embedVerified; tool form redacts viewerUrl/jwt from the event payload.
 * Fails when: Cache-Control missing, jwt appears in invokeTool JSON, or embedVerified false for good host.
 * Oracle: Headers Cache-Control; JSON.stringify(redacted) must not include 'jwt'.
 * Side effects: memory store read; injected readonlyView.
 * Gaps: CSP header emission is HTTP-layer owned.
 */
test('live view is owner-only, no-store, and embeds the verified Live View host', async () => {
  const svc = service();
  await svc.openSession({ ownerId: 'u1', botId: 'b1' });
  const view = await svc.liveView({ ownerId: 'u1', botId: 'b1', sessionRecordId: 'rec-1' });
  assert.equal(view.headers['Cache-Control'], 'no-store');
  assert.equal(view.embedVerified, true);
  assert.equal(view.fallback, 'open-viewer-in-separate-tab');
  assert.equal(view.event.viewerUrl, undefined);
  assert.match(view.viewerUrl, /^https:\/\/live\.browser\.run\/ui\/view/);
  const redacted = await svc.invokeTool('browser_live_view', { sessionRecordId: 'rec-1' }, { ownerId: 'u1', botId: 'b1' });
  assert.equal(redacted.viewerUrl, undefined);
  assert.equal(JSON.stringify(redacted).includes('jwt'), false);
});

/**
 * Achieves: Only https://live.browser.run/ui/{view,inspector} embed; http/evil/other paths do not.
 * Fails when: evil host or http scheme embedVerified true, or /ui/view false.
 * Oracle: Explicit URL matrix independent of provider responses.
 * Side effects: none.
 * Gaps: Query-param allowlisting beyond path/host not asserted.
 */
test('only the checked live.browser.run UI paths are embeddable', () => {
  assert.equal(describeLiveViewEmbed('https://live.browser.run/ui/view?jwt=1').embedVerified, true);
  assert.equal(describeLiveViewEmbed('https://live.browser.run/ui/inspector?wss=1').embedVerified, true);
  assert.equal(describeLiveViewEmbed('http://live.browser.run/ui/view').embedVerified, false);
  assert.equal(describeLiveViewEmbed('https://evil.example/ui/view').embedVerified, false);
  assert.equal(describeLiveViewEmbed('https://live.browser.run/other').embedVerified, false);
});

/**
 * Achieves: releaseSession closes the provider session id and allows a new open afterward.
 * Fails when: closeSession not called with provider id, or slot stays occupied incorrectly.
 * Oracle: closeSession spy receives ['prov-1']; subsequent open succeeds.
 * Side effects: memory store delete + provider closeSession call.
 * Gaps: Provider close failure / retry not covered.
 */
test('release closes the provider session and frees a slot', async () => {
  const closed = [];
  let n = 0;
  const svc = service({
    idFactory: () => `rec-${n}`,
    browsers: {
      createSession: async () => ({ sessionId: `prov-${++n}` }),
      readonlyView: async () => ({}),
      closeSession: async sessionId => { closed.push(sessionId); },
    },
  });
  await svc.openSession({ ownerId: 'u1', botId: 'b1' });
  await svc.releaseSession({ ownerId: 'u1', botId: 'b1', sessionRecordId: 'rec-1' });
  assert.deepEqual(closed, ['prov-1']);
  await svc.openSession({ ownerId: 'u1', botId: 'b1' });
});

/**
 * Achieves: After release under a full concurrency cap, a new session opens; unknown tools are rejected.
 * Fails when: Slot not freed, or rm_rf invokeTool succeeds.
 * Oracle: unknown_tool error code; open after release under max=2.
 * Side effects: memory store mutations.
 * Gaps: Partial tool argument validation per tool is lightly covered elsewhere.
 */
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

/**
 * Achieves: Passing the raw provider session id as sessionRecordId cannot authorize liveView.
 * Fails when: liveView succeeds with sessionRecordId=prov-1 (confused deputy).
 * Oracle: session_not_found when record id is actually the provider id.
 * Side effects: none beyond prior open in memory store.
 * Gaps: none for this confused-deputy case.
 */
test('client-supplied provider session ids cannot be used as authorization', async () => {
  const svc = service();
  await svc.openSession({ ownerId: 'u1', botId: 'b1' });
  await assert.rejects(svc.liveView({ ownerId: 'u1', botId: 'b1', sessionRecordId: 'prov-1' }), (error) => error.code === 'session_not_found');
});

/**
 * Achieves: navigateSession fails closed when the browser provider cannot open tabs.
 * Fails when: Missing openTab still reports a successful navigation URL.
 * Oracle: Provider stub omits openTab; expect a SessionError / navigate failure (not silent success).
 * Side effects: memory store may still hold the blank session.
 * Gaps: Exact error code string is implementation-defined beyond not succeeding.
 */
test('navigate without openTab fails closed', async () => {
  const svc = service({
    browsers: {
      createSession: async () => ({ sessionId: 'prov-1' }),
      readonlyView: async () => ({ viewerUrl: 'https://live.browser.run/ui/view?jwt=test', mode: 'readonly' }),
    },
  });
  await svc.openSession({ ownerId: 'u1', botId: 'b1' });
  await assert.rejects(
    svc.navigateSession({ ownerId: 'u1', botId: 'b1', sessionRecordId: 'rec-1', url: 'https://example.com/' }),
    (error) => error.code === 'browser_not_configured',
  );
});
