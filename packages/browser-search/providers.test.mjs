import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSearch, createScrape, createBrowserProvider } from './providers.mjs';

const reply = value => async () => Response.json(value);

/**
 * Achieves: Search POSTs to Firecrawl with bearer auth and drops javascript: results.
 * Fails when: Wrong URL/method/auth, query not posted, or javascript: URL is returned.
 * Oracle: Assert fetcher sees api.firecrawl.dev + Bearer; result length filters unsafe scheme.
 * Side effects: none (injected fetcher; no real network).
 * Gaps: Does not cover upstream success:false payload shapes beyond length filter.
 */
test('search posts to Firecrawl and strips unsafe URLs', async () => {
  const search = createSearch({
    apiKey: 'fc-test',
    fetcher: async (url, options) => {
      assert.equal(url, 'https://api.firecrawl.dev/v1/search');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer fc-test');
      assert.deepEqual(JSON.parse(options.body), { query: 'a & b', limit: 5, ignoreInvalidURLs: true });
      return Response.json({
        success: true,
        data: [
          { title: 'A', url: 'https://example.com', description: 'B' },
          { url: 'javascript:alert(1)' },
        ],
      });
    },
  });
  const results = await search('a & b');
  assert.equal(results.length, 1);
  assert.equal(results[0].snippet, 'B');
});

/**
 * Achieves: Blank query / oversize limit / missing API key fail before any upstream call.
 * Fails when: Upstream fetcher is invoked, or wrong error codes/status.
 * Oracle: assert.fail fetcher proves no call; codes invalid_search / search_not_configured.
 * Side effects: none.
 * Gaps: Exact max limit boundary value only checked at 50 (over).
 */
test('search validates before calling upstream', async () => {
  const search = createSearch({ apiKey: 'test', fetcher: () => assert.fail('unexpected request') });
  await assert.rejects(search(' '), { code: 'invalid_search' });
  await assert.rejects(search('valid', 50), { code: 'invalid_search' });
  await assert.rejects(createSearch({})('valid'), { code: 'search_not_configured', status: 503 });
});

/**
 * Achieves: 429 and thrown upstream errors become sanitized codes without leaking body/message secrets.
 * Fails when: Error message includes 'secret' body text, or codes/status wrong.
 * Oracle: Injected Response('secret') / throw Error('secret'); assert code/message only.
 * Side effects: none.
 * Gaps: Does not cover non-JSON success payloads.
 */
test('rate limits and network failures have sanitized errors', async () => {
  await assert.rejects(
    createSearch({ apiKey: 'test', fetcher: async () => new Response('secret', { status: 429 }) })('test'),
    (err) => {
      assert.equal(err.code, 'provider_rate_limited');
      assert.equal(err.status, 429);
      assert.equal(String(err.message).includes('secret'), false);
      return true;
    },
  );
  await assert.rejects(
    createSearch({ apiKey: 'test', fetcher: async () => { throw Error('secret'); } })('test'),
    (err) => {
      assert.equal(err.message, 'provider_unavailable');
      assert.equal(String(err.cause ?? '').includes('secret') || String(err.message).includes('secret'), false);
      return true;
    },
  );
});

/**
 * Achieves: Scrape posts safe https URL and truncates markdown to maxMarkdownChars.
 * Fails when: Truncation skipped, wrong Firecrawl body, or truncated flag false when cut.
 * Oracle: Independent 'a'*600 input vs maxMarkdownChars=500 length check.
 * Side effects: none (injected fetcher).
 * Gaps: http (non-https) acceptance is provider-dependent — not asserted here.
 */
test('scrape returns truncated markdown for a safe http(s) URL', async () => {
  const markdown = 'a'.repeat(600);
  const scrape = createScrape({
    apiKey: 'fc-test',
    maxMarkdownChars: 500,
    fetcher: async (url, options) => {
      assert.equal(url, 'https://api.firecrawl.dev/v1/scrape');
      assert.deepEqual(JSON.parse(options.body), {
        url: 'https://example.com/page',
        formats: ['markdown'],
        onlyMainContent: true,
      });
      return Response.json({
        success: true,
        data: {
          markdown,
          metadata: { title: 'Page' },
        },
      });
    },
  });
  const page = await scrape('https://example.com/page');
  assert.equal(page.title, 'Page');
  assert.equal(page.markdown, markdown.slice(0, 500));
  assert.equal(page.truncated, true);
});

/**
 * Achieves: javascript: and userinfo URLs are rejected; missing API key returns 503.
 * Fails when: Credentialed URLs scrape, or unconfigured scrape succeeds.
 * Oracle: URL safety policy (no javascript:, no user:pass@); scrape_not_configured status 503.
 * Side effects: none.
 * Gaps: file:// and data: schemes not enumerated.
 */
test('scrape rejects unsafe URLs and missing config', async () => {
  await assert.rejects(createScrape({ apiKey: 'x' })('javascript:alert(1)'), { code: 'invalid_scrape' });
  await assert.rejects(createScrape({ apiKey: 'x' })('https://user:pass@example.com'), { code: 'invalid_scrape' });
  await assert.rejects(createScrape({})('https://example.com'), { code: 'scrape_not_configured', status: 503 });
});

/**
 * Achieves: createSession returns only sessionId — never webSocketDebuggerUrl.
 * Fails when: Privileged debugger URL appears in the returned object.
 * Oracle: Upstream plants webSocketDebuggerUrl:'secret'; client must strip it.
 * Side effects: none (injected fetcher).
 * Gaps: Does not assert Authorization header shape (covered indirectly by other tests).
 */
test('session creation does not expose privileged connection URLs', async () => {
  const provider = createBrowserProvider({
    accountId: 'a',
    apiToken: 'b',
    fetcher: reply({ success: true, result: { sessionId: 'abc', webSocketDebuggerUrl: 'secret' } }),
  });
  assert.deepEqual(await provider.createSession(), { sessionId: 'abc' });
});

/**
 * Achieves: Readonly live view POSTs guardrails.mode=readonly and expiresInMs=300000.
 * Fails when: Interactive guardrails omitted incorrectly, deadline ≠ 5min, or path escapes session id.
 * Oracle: Exact JSON body equality; '../other' → invalid_session.
 * Side effects: none.
 * Gaps: Token expiry enforcement is Cloudflare-side.
 */
test('viewer always requests readonly permissions and a five-minute connect deadline', async () => {
  const provider = createBrowserProvider({
    accountId: 'a',
    apiToken: 'b',
    fetcher: async (url, options) => {
      assert.equal(url, 'https://api.cloudflare.com/client/v4/accounts/a/browser-run/devtools/browser/abc/live_view');
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), {
        mode: 'tab',
        expiresInMs: 300000,
        guardrails: { mode: 'readonly' },
        targetId: 'TARGET1',
      });
      return Response.json({ result: { devtoolsFrontendUrl: 'https://live.browser.run/ui/view?jwt=test' } });
    },
  });
  const view = await provider.readonlyView('abc', { targetId: 'TARGET1' });
  assert.equal(view.mode, 'readonly');
  assert.match(view.viewerUrl, /^https:\/\/live\.browser\.run\/ui\/view\?/);
  await assert.rejects(provider.readonlyView('../other'), { code: 'invalid_session' });
});

/**
 * Achieves: interactive:true omits readonly guardrails while keeping the five-minute deadline.
 * Fails when: guardrails still present, or mode is not interactive.
 * Oracle: Exact body { mode:'tab', expiresInMs:300000 } with no guardrails key.
 * Side effects: none.
 * Gaps: Does not assert UI control handoff (browser-session owns that).
 */
test('an interactive viewer omits the readonly guardrail', async () => {
  const provider = createBrowserProvider({
    accountId: 'a',
    apiToken: 'b',
    fetcher: async (_url, options) => {
      assert.deepEqual(JSON.parse(options.body), { mode: 'tab', expiresInMs: 300000 });
      return Response.json({ result: { devtoolsFrontendUrl: 'https://live.browser.run/ui/view?jwt=test' } });
    },
  });
  const view = await provider.readonlyView('abc', { interactive: true });
  assert.equal(view.mode, 'interactive');
});

/**
 * Achieves: openTab uses PUT json/new with encoded https URL and rejects javascript:.
 * Fails when: Wrong method, URL not encoded, or javascript: navigates.
 * Oracle: URL path match with percent-encoding; invalid_navigate on javascript:.
 * Side effects: none.
 * Gaps: Redirect / title mismatches from provider not normalized here.
 */
test('openTab navigates with PUT json/new and rejects unsafe urls', async () => {
  const provider = createBrowserProvider({
    accountId: 'a',
    apiToken: 'b',
    fetcher: async (url, options) => {
      assert.equal(options.method, 'PUT');
      assert.match(url, /\/browser\/abc\/json\/new\?url=https%3A%2F%2Fwww\.google\.com%2F$/);
      return Response.json({
        id: 'TAB123',
        type: 'page',
        url: 'https://www.google.com/',
        title: 'Google',
      });
    },
  });
  const tab = await provider.openTab('abc', 'https://www.google.com/');
  assert.deepEqual(tab, { targetId: 'TAB123', url: 'https://www.google.com/', title: 'Google' });
  await assert.rejects(provider.openTab('abc', 'javascript:alert(1)'), { code: 'invalid_navigate' });
});

/**
 * Achieves: create uses browser-run keep_alive path; close DELETEs the session and strips secrets.
 * Fails when: Wrong path/method, or create returns debugger URL.
 * Oracle: Call-order spy on URL/method; create response must equal {sessionId} only.
 * Side effects: none (injected fetcher).
 * Gaps: keep_alive duration policy only matched via regex, not business-rule doc.
 */
test('close deletes the Browser Run session and create uses the browser-run path', async () => {
  const calls = [];
  const provider = createBrowserProvider({
    accountId: 'acct',
    apiToken: 'tok',
    fetcher: async (url, options) => {
      calls.push({ url, method: options.method });
      if (options.method === 'DELETE') return Response.json({ status: 'closing' });
      return Response.json({ success: true, result: { sessionId: 'sess-1', webSocketDebuggerUrl: 'wss://secret' } });
    },
  });
  assert.deepEqual(await provider.createSession(), { sessionId: 'sess-1' });
  assert.match(calls[0].url, /\/browser-run\/devtools\/browser\?keep_alive=600000&targets=true$/);
  assert.deepEqual(await provider.closeSession('sess-1'), { status: 'closing' });
  assert.equal(calls[1].method, 'DELETE');
  assert.match(calls[1].url, /\/browser-run\/devtools\/browser\/sess-1$/);
});

/**
 * Achieves: Non-live.browser.run viewer hosts are rejected; missing credentials refuse create.
 * Fails when: evil.example viewerUrl is accepted, or empty config creates a session.
 * Oracle: Host allowlist live.browser.run; browser_not_configured on empty config.
 * Side effects: none.
 * Gaps: Subdomain / path variants beyond describeLiveViewEmbed (session package).
 */
test('viewer rejects unexpected hosts and missing config', async () => {
  const provider = createBrowserProvider({
    accountId: 'a',
    apiToken: 'b',
    fetcher: reply({ result: { devtoolsFrontendUrl: 'https://evil.example/view' } }),
  });
  await assert.rejects(provider.readonlyView('abc'), { code: 'invalid_provider_response' });
  await assert.rejects(createBrowserProvider({}).createSession(), { code: 'browser_not_configured' });
});
