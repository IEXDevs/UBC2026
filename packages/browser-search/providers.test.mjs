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

test('viewer always requests readonly permissions and short lifetime', async () => {
  const provider = createBrowserProvider({
    accountId: 'a',
    apiToken: 'b',
    fetcher: async (url, options) => {
      assert.ok(url.endsWith('/abc/live_view'));
      assert.deepEqual(JSON.parse(options.body), { mode: 'tab', expiresInMs: 60000, guardrails: { mode: 'readonly' } });
      return Response.json({ result: { devtoolsFrontendUrl: 'https://live.browser.run/ui/view?jwt=test' } });
    },
  });
  assert.equal((await provider.readonlyView('abc')).mode, 'readonly');
  await assert.rejects(provider.readonlyView('../other'), { code: 'invalid_session' });
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
