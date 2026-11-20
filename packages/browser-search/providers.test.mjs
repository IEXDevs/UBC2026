import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSearch, createScrape, createBrowserProvider, assertPublicHttpUrl, ProviderError, withEnglishGoogle } from './providers.mjs';

const reply = value => async () => Response.json(value);

test('closeTab closes only a validated target through REST, including binding sessions', async () => {
  const calls = [];
  const options = { accountId: 'account', apiToken: 'token', fetcher: async (url, init) => {
    calls.push([url, init.method]);
    return Response.json({ message: 'Target is closing' });
  } };
  for (const binding of [undefined, { acquire() {}, devtools: { newTarget() {} } }]) {
    const provider = createBrowserProvider({ ...options, binding });
    await provider.closeTab('session', 'TARGET');
    await assert.rejects(provider.closeTab('session', '../escape'), { code: 'invalid_target' });
  }
  assert.equal(calls.length, 2);
  for (const [url, method] of calls) {
    assert.equal(url, 'https://api.cloudflare.com/client/v4/accounts/account/browser-run/devtools/browser/session/json/close/TARGET');
    assert.equal(method, 'GET');
  }
});

test('browser HTTP failures expose status and canonical reasons, never upstream secrets', async () => {
  for (const status of [403, 404, 410, 500]) {
    const provider = createBrowserProvider({ accountId: 'account', apiToken: 'token', fetcher: async () =>
      Response.json({ error: 'Failed to fetch targets https://live.browser.run/ui/view?token=private Bearer secret' }, { status }) });
    await assert.rejects(provider.readonlyView('session'), error => {
      assert.equal(error.providerStatus, status);
      assert.equal(error.providerReason, 'targets_unavailable');
      assert.doesNotMatch(JSON.stringify(error), /private|Bearer|live\.browser/);
      return true;
    });
  }
});

test('session REST 404s expire views and navigation, close on release, but preserve create endpoint errors', async () => {
  const provider = createBrowserProvider({ accountId: 'test', apiToken: 'test', fetcher: async () => new Response('', { status: 404 }) });
  await assert.rejects(provider.createSession(), { code: 'browser_endpoint_missing', status: 502 });
  await assert.rejects(provider.readonlyView('abc'), { code: 'browser_session_expired', status: 410 });
  await assert.rejects(provider.openTab('abc', 'https://example.com'), { code: 'browser_session_expired', status: 410 });
  assert.deepEqual(await provider.closeSession('abc'), { status: 'closed' });
});

test('session REST 410s expire views and navigation and allow release without changing create errors', async () => {
  for (const fallback of [false, true]) {
    const provider = createBrowserProvider({ accountId: 'test', apiToken: 'test', fetcher: async url => {
      const status = fallback && url.includes('/browser-run/') ? 404 : 410;
      return Response.json({ error: 'Failed to fetch targets' }, { status });
    } });
    await assert.rejects(provider.createSession(), { code: 'provider_rejected', status: 502 });
    await assert.rejects(provider.readonlyView('abc'), { code: 'browser_session_expired', status: 410 });
    await assert.rejects(provider.openTab('abc', 'https://example.com'), { code: 'browser_session_expired', status: 410 });
    assert.deepEqual(await provider.closeSession('abc'), { status: 'closed' });
  }
});

test('binding missing-session errors expire views and navigation and allow release', async () => {
  const gone = async () => { throw new Error('Session abc not found'); };
  const provider = createBrowserProvider({ binding: {
    acquire: async () => ({ sessionId: 'abc' }), devtools: { newTarget: gone }, getLiveView: gone, closeSession: gone,
  } });
  await assert.rejects(provider.readonlyView('abc', { interactive: true }), { code: 'browser_session_expired', status: 410 });
  await assert.rejects(provider.openTab('abc', 'https://example.com'), { code: 'browser_session_expired', status: 410 });
  assert.deepEqual(await provider.closeSession('abc'), { status: 'closed' });
});

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
/**
 * Achieves: provider_failed is only an upstream 5xx. A missing key, a missing client, and a 4xx stay distinct.
 * Fails when: a 401 or 404 is provider_failed, a blank key calls Firecrawl, or a null fetcher is an outage.
 * Oracle: search_not_configured, client_missing, provider_rejected, provider_failed.
 * Side effects: none (injected fetcher).
 * Gaps: live Firecrawl is not part of this test.
 */
test('Firecrawl search reserves provider_failed for a server error', async () => {
  await assert.rejects(
    createSearch({ apiKey: '   ', fetcher: () => assert.fail('blank key must not call Firecrawl') })('SOL fundamentals'),
    { code: 'search_not_configured', status: 503 },
  );
  await assert.rejects(
    createSearch({ apiKey: 'fc-test', fetcher: null })('SOL fundamentals'),
    { code: 'client_missing', status: 503 },
  );
  await assert.rejects(
    createSearch({ apiKey: 'fc-test', fetcher: async () => new Response('no', { status: 401 }) })('SOL fundamentals'),
    (err) => {
      assert.equal(err.code, 'client_missing');
      assert.equal(String(err.message).includes('no'), false);
      return true;
    },
  );
  await assert.rejects(
    createSearch({ apiKey: 'fc-test', fetcher: async () => new Response('miss', { status: 404 }) })('SOL fundamentals'),
    (err) => {
      assert.equal(err.code, 'provider_rejected');
      assert.notEqual(err.code, 'provider_failed');
      return true;
    },
  );
  await assert.rejects(
    createSearch({ apiKey: 'fc-test', fetcher: async () => new Response('down', { status: 503 }) })('SOL fundamentals'),
    { code: 'provider_failed', status: 502 },
  );
});

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
      assert.match(url, /\/browser\/abc\/json\/new\?url=https%3A%2F%2Fwww\.google\.com%2F%3Fhl%3Den%26gl%3Dus$/);
      return Response.json({
        id: 'TAB123',
        type: 'page',
        url: 'https://www.google.com/?hl=en&gl=us',
        title: 'Google',
      });
    },
  });
  const tab = await provider.openTab('abc', 'https://www.google.com/');
  assert.deepEqual(tab, { targetId: 'TAB123', url: 'https://www.google.com/?hl=en&gl=us', title: 'Google' });
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
      calls.push({ url, method: options.method, body: options.body });
      if (options.method === 'DELETE') return Response.json({ status: 'closing' });
      return Response.json({ success: true, result: { sessionId: 'sess-1', webSocketDebuggerUrl: 'wss://secret' } });
    },
  });
  assert.deepEqual(await provider.createSession(), { sessionId: 'sess-1' });
  assert.match(calls[0].url, /\/browser-run\/devtools\/browser\?keep_alive=600000&targets=true$/);
  assert.equal(calls[0].body, undefined);
  assert.deepEqual(await provider.closeSession('sess-1'), { status: 'closing' });
  assert.equal(calls[1].method, 'DELETE');
  assert.match(calls[1].url, /\/browser-run\/devtools\/browser\/sess-1$/);
});

/**
 * Achieves: a 404 on browser-run retries browser-rendering, and a 401 is not provider_failed.
 * Fails when: the fallback is skipped, or an auth failure is labeled an outage.
 * Oracle: second URL contains /browser-rendering/; 401 code is browser_not_configured.
 * Side effects: none (injected fetcher).
 * Gaps: does not call Cloudflare.
 */
test('browser sessions fall back when browser-run is missing and keep auth distinct', async () => {
  const urls = [];
  const provider = createBrowserProvider({
    accountId: 'acct',
    apiToken: 'tok',
    fetcher: async (url) => {
      urls.push(url);
      if (url.includes('/browser-run/')) return new Response('missing', { status: 404 });
      return Response.json({ sessionId: 'sess-2' });
    },
  });
  assert.deepEqual(await provider.createSession(), { sessionId: 'sess-2' });
  assert.match(urls[0], /\/browser-run\/devtools\/browser/);
  assert.match(urls[1], /\/browser-rendering\/devtools\/browser/);
  const denied = createBrowserProvider({
    accountId: 'acct',
    apiToken: 'tok',
    fetcher: async () => new Response('no', { status: 401 }),
  });
  await assert.rejects(denied.createSession(), (err) => {
    assert.equal(err.code, 'browser_not_configured');
    assert.notEqual(err.code, 'provider_failed');
    return true;
  });
  const down = createBrowserProvider({
    accountId: 'acct',
    apiToken: 'tok',
    fetcher: async () => new Response('down', { status: 503 }),
  });
  await assert.rejects(down.createSession(), { code: 'provider_failed', status: 502 });
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

/**
 * Achieves: assertPublicHttpUrl accepts http(s) without credentials; rejects javascript/data/userinfo.
 * Fails when: Credentialed URLs or non-http schemes pass.
 * Oracle: URL protocol/username/password gates; ProviderError code invalid_navigate.
 * Side effects: none.
 * Gaps: does not resolve DNS or follow redirects.
 */
test('assertPublicHttpUrl accepts public http(s) and rejects unsafe schemes', () => {
  assert.equal(assertPublicHttpUrl('https://example.com/path').href, 'https://example.com/path');
  assert.equal(assertPublicHttpUrl(' http://example.com ').protocol, 'http:');
  assert.throws(() => assertPublicHttpUrl(''), ProviderError);
  assert.throws(() => assertPublicHttpUrl('javascript:alert(1)'), (err) => {
    assert.equal(err instanceof ProviderError, true);
    assert.equal(err.code, 'invalid_navigate');
    assert.equal(err.status, 400);
    return true;
  });
  assert.throws(() => assertPublicHttpUrl('data:text/html,hi'), ProviderError);
  assert.throws(() => assertPublicHttpUrl('https://user:pass@example.com/'), ProviderError);
  assert.throws(() => assertPublicHttpUrl('not a url'), ProviderError);
  assert.throws(() => assertPublicHttpUrl('a'.repeat(2001)), ProviderError);
});

test('Google pages open in English / US unless the url already sets hl or gl', () => {
  const pin = value => withEnglishGoogle(new URL(value)).href;
  assert.equal(pin('https://www.google.com/search?q=sf+weather'), 'https://www.google.com/search?q=sf+weather&hl=en&gl=us');
  assert.equal(pin('https://www.google.com.hk/'), 'https://www.google.com.hk/?hl=en&gl=us');
  assert.equal(pin('https://maps.google.com/?q=cafe'), 'https://maps.google.com/?q=cafe&hl=en&gl=us');
  assert.equal(pin('https://scholar.google.com/scholar?q=x'), 'https://scholar.google.com/scholar?q=x&hl=en&gl=us');
  assert.equal(pin('https://books.google.co.uk/'), 'https://books.google.co.uk/?hl=en&gl=us');
  assert.equal(pin('https://www.google.com/search?q=x&hl=fr&gl=ca'), 'https://www.google.com/search?q=x&hl=fr&gl=ca');
  assert.equal(pin('https://example.com/?q=google.com'), 'https://example.com/?q=google.com');
  assert.equal(pin('https://google.com.evil.example/'), 'https://google.com.evil.example/');
});

test('the Browser Run binding opens, interactively views and closes sessions without an API token', async () => {
  const calls = [];
  const binding = {
    acquire: async options => { calls.push(['acquire', options]); return { sessionId: 'abc' }; },
    devtools: { newTarget: async (id, url) => { calls.push(['newTarget', id, url]); return { id: 'TAB123', type: 'page', url, title: 'Google' }; } },
    getLiveView: async (id, options) => { calls.push(['getLiveView', id, options]); return { devtoolsFrontendUrl: 'https://live.browser.run/ui/view?token=t' }; },
    closeSession: async id => { calls.push(['closeSession', id]); return 'closing'; },
  };
  const provider = createBrowserProvider({ binding, fetcher: async () => assert.fail('REST must not be called') });
  assert.deepEqual(await provider.createSession(), { sessionId: 'abc' });
  assert.deepEqual(await provider.openTab('abc', 'https://www.google.com/'), { targetId: 'TAB123', url: 'https://www.google.com/?hl=en&gl=us', title: 'Google' });
  const view = await provider.readonlyView('abc', { targetId: 'TAB123', interactive: true });
  assert.equal(view.viewerUrl, 'https://live.browser.run/ui/view?token=t');
  assert.equal(view.mode, 'interactive');
  assert.deepEqual(await provider.closeSession('abc'), { status: 'closing' });
  assert.deepEqual(calls[2][2], { mode: 'tab', expiresInMs: 300000, targetId: 'TAB123' });
  await assert.rejects(provider.readonlyView('abc'), { code: 'browser_readonly_not_configured', status: 503 });
  await assert.rejects(provider.readonlyView('../abc'), { code: 'invalid_session' });
  await assert.rejects(provider.openTab('abc', 'javascript:alert(1)'), { code: 'invalid_navigate' });
  const failing = createBrowserProvider({ binding: { ...binding, acquire: async () => { throw new Error('boom'); } } });
  await assert.rejects(failing.createSession(), { code: 'provider_failed' });
  const throttled = createBrowserProvider({ binding: { ...binding, acquire: async () => { throw new Error('429 Too Many Requests'); } } });
  await assert.rejects(throttled.createSession(), { code: 'provider_rate_limited', status: 429 });
  const bad = createBrowserProvider({ binding: { ...binding, getLiveView: async () => ({ devtoolsFrontendUrl: 'https://evil.example/ui/view' }) } });
  await assert.rejects(bad.readonlyView('abc', { interactive: true }), { code: 'invalid_provider_response' });
});

test('binding read-only views reuse REST guardrails while interactive views stay on the binding', async () => {
  const bodies = [];
  const binding = {
    acquire: async () => assert.fail('not acquiring'),
    devtools: { newTarget: async () => assert.fail('not navigating') },
    getLiveView: async (id, options) => {
      assert.equal(id, 'abc');
      assert.deepEqual(options, { mode: 'tab', expiresInMs: 300000 });
      return { devtoolsFrontendUrl: 'https://live.browser.run/ui/view' };
    },
  };
  const provider = createBrowserProvider({
    binding, accountId: 'account', apiToken: 'test-token',
    fetcher: async (url, options) => {
      assert.equal(url, 'https://api.cloudflare.com/client/v4/accounts/account/browser-run/devtools/browser/abc/live_view');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      bodies.push(JSON.parse(options.body));
      return Response.json({ result: { devtoolsFrontendUrl: 'https://live.browser.run/ui/view' } });
    },
  });
  assert.equal((await provider.readonlyView('abc', { targetId: 'TAB123' })).mode, 'readonly');
  assert.equal((await provider.readonlyView('abc')).mode, 'readonly');
  assert.deepEqual(bodies, [
    { mode: 'tab', expiresInMs: 300000, guardrails: { mode: 'readonly' }, targetId: 'TAB123' },
    { mode: 'tab', expiresInMs: 300000, guardrails: { mode: 'readonly' } },
  ]);
  assert.equal((await provider.readonlyView('abc', { interactive: true })).mode, 'interactive');
  assert.equal(bodies.length, 2);
  for (const credentials of [{}, { accountId: 'account' }, { apiToken: 'test-token' }]) {
    const unconfigured = createBrowserProvider({ binding, ...credentials, fetcher: async () => assert.fail('no REST credentials') });
    await assert.rejects(unconfigured.readonlyView('abc'), { code: 'browser_readonly_not_configured' });
  }
  const failed = createBrowserProvider({ binding, accountId: 'account', apiToken: 'test-token', fetcher: async () => new Response('', { status: 403 }) });
  await assert.rejects(failed.readonlyView('abc'), { code: 'browser_not_configured' });
});

test('binding diagnostics redact viewer URLs and tokens before mapping errors', async t => {
  const lines = [];
  t.mock.method(console, 'error', line => lines.push(line));
  const provider = createBrowserProvider({ binding: {
    acquire: async () => { throw new TypeError('failed https://live.browser.run/ui/view?token=private token=short Bearer credential abcdefghijklmnopqrstuvwxyz\nretry'); },
    devtools: { newTarget: async () => {} },
  } });
  await assert.rejects(provider.createSession(), { code: 'provider_failed' });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Browser binding acquire: TypeError: failed/);
  assert.doesNotMatch(lines[0], /https|browser\.run|private|short|credential|abcdefghijklmnopqrstuvwxyz|\n/);
});
