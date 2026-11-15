import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSearch, createScrape, createBrowserProvider } from './providers.mjs';

const reply = value => async () => Response.json(value);

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

test('search validates before calling upstream', async () => {
  const search = createSearch({ apiKey: 'test', fetcher: () => assert.fail('unexpected request') });
  await assert.rejects(search(' '), { code: 'invalid_search' });
  await assert.rejects(search('valid', 50), { code: 'invalid_search' });
  await assert.rejects(createSearch({})('valid'), { code: 'search_not_configured', status: 503 });
});

test('rate limits and network failures have sanitized errors', async () => {
  await assert.rejects(
    createSearch({ apiKey: 'test', fetcher: async () => new Response('secret', { status: 429 }) })('test'),
    { code: 'provider_rate_limited', status: 429 },
  );
  await assert.rejects(
    createSearch({ apiKey: 'test', fetcher: async () => { throw Error('secret'); } })('test'),
    { message: 'provider_unavailable' },
  );
});

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

test('scrape rejects unsafe URLs and missing config', async () => {
  await assert.rejects(createScrape({ apiKey: 'x' })('javascript:alert(1)'), { code: 'invalid_scrape' });
  await assert.rejects(createScrape({ apiKey: 'x' })('https://user:pass@example.com'), { code: 'invalid_scrape' });
  await assert.rejects(createScrape({})('https://example.com'), { code: 'scrape_not_configured', status: 503 });
});

test('session creation does not expose privileged connection URLs', async () => {
  const provider = createBrowserProvider({
    accountId: 'a',
    apiToken: 'b',
    fetcher: reply({ success: true, result: { sessionId: 'abc', webSocketDebuggerUrl: 'secret' } }),
  });
  assert.deepEqual(await provider.createSession(), { sessionId: 'abc' });
});

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

test('viewer rejects unexpected hosts and missing config', async () => {
  const provider = createBrowserProvider({
    accountId: 'a',
    apiToken: 'b',
    fetcher: reply({ result: { devtoolsFrontendUrl: 'https://evil.example/view' } }),
  });
  await assert.rejects(provider.readonlyView('abc'), { code: 'invalid_provider_response' });
  await assert.rejects(createBrowserProvider({}).createSession(), { code: 'browser_not_configured' });
});
