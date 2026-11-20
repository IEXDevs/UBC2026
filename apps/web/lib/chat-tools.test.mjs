import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chatToolsInstruction,
  createChatToolInvoker,
  openAiAgentTools,
  serializeToolResult,
} from './chat-tools.mjs';
import worker from '../../agent-runtime/src/index.mjs';
import { privySessionFixture } from '../../agent-runtime/src/owner-auth.fixture.mjs';

test('the agent tool resolves another signed-in user’s handle to their main wallet', async () => {
  const address = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const session = privySessionFixture('did:privy:alice');
  let displayName = 'Bob';
  const env = {
    PRIVY_APP_ID: session.appId,
    PRIVY_APP_SECRET: 'test-secret',
    SUPABASE_URL: 'https://directory.example',
    SUPABASE_SERVICE_ROLE_KEY: 'test-role-key',
    fetch: async (url, init) => {
      if (String(url) === session.jwksUrl) return session.jwks();
      if (new URL(url).pathname.endsWith('/activity_logs')) return new Response(null, { status: 204 });
      assert.equal(init.method, 'GET');
      const target = new URL(url);
      if (target.pathname === '/rest/v1/profiles') {
        assert.equal(target.searchParams.get('handle'), 'eq.wallet');
        return Response.json([{ owner_id: 'did:privy:bob', handle: 'wallet', display_name: displayName }]);
      }
      assert.equal(target.pathname, '/rest/v1/wallets');
      assert.equal(target.searchParams.get('owner_id'), 'eq.did:privy:bob');
      return Response.json([{ address }]);
    },
  };
  const invoke = createChatToolInvoker({
    ownerId: 'did:privy:alice',
    botId: 'bot_alice',
    accessToken: session.token,
    runtimeBase: 'https://runtime.example',
    fetcher: (url, init) => worker.fetch(new Request(url, init), env),
  });
  const result = await invoke('lookup_recipient', { q: '@Wallet' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.recipient, { kind: 'handle', handle: 'wallet', displayName: 'Bob', avatarUrl: null, self: false, missing: false, address });
  displayName = 'Bob (bob@example.test)';
  const privateRecipient = await invoke('lookup_recipient', { q: '@Wallet' });
  assert.equal(privateRecipient.recipient.displayName, '@wallet');
  assert.equal(privateRecipient.recipient.address, address);
  assert.equal(JSON.stringify(privateRecipient).includes('bob@example.test'), false);
});

/**
 * Achieves: verifies openAiAgentTools maps shared research and dashboard schemas.
 * Fails when: openAiAgentTools maps shared research and dashboard schemas breaks (e.g. expected /You have the following tools/, /get_price/, /devnet execution, mainnet pricing/).
 * Oracle: assert.match(chatToolsInstruction(), /You have the following tools/); assert.match(chatToolsInstruction(), /get_price/); assert.match(chatToolsInstruction(), /devnet execution, mainnet pricing/); assert.ok(tools.some(tool => tool.function.name === 'get_price'); assert.ok(tools.some(tool => tool.function.name === 'web_search'); assert.ok(tools.some(tool => tool.function.name === 'browser_open')
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('openAiAgentTools maps shared research and dashboard schemas', () => {
  const tools = openAiAgentTools();
  assert.ok(tools.some(tool => tool.function.name === 'get_price'));
  assert.ok(tools.some(tool => tool.function.name === 'web_search'));
  assert.ok(tools.some(tool => tool.function.name === 'browser_open'));
  assert.ok(tools.some(tool => tool.function.name === 'list_bots'));
  assert.ok(tools.some(tool => tool.function.name === 'pause_bot'));
  assert.match(chatToolsInstruction(), /You have the following tools/);
  assert.match(chatToolsInstruction(), /get_price/);
  assert.match(chatToolsInstruction(), /devnet execution, mainnet pricing/);
});

/**
 * Achieves: verifies get_price returns a paper quote and does not sign.
 * Fails when: get_price returns a paper quote and does not sign breaks (e.g. expected true, 'jupiter-price-v3', 'dexscreener'); failure/null paths flip.
 * Oracle: assert.equal(result.ok, true); assert.equal(result.quote.quoteSource, 'jupiter-price-v3'); assert.equal(result.quote.fallbackFrom, 'dexscreener'); assert.equal(result.quote.label, 'devnet execution, mainnet pricing'); assert.equal(result.quote.authorizesTransaction, false); assert.equal(result.quote.executionCluster, 'devnet')
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
test('get_price returns a paper quote and does not sign', async () => {
  const calls = [];
  const mint = 'So11111111111111111111111111111111111111112';
  const invoke = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_1',
    env: { JUPITER_API_KEY: 'jupiter-test-key' },
    fetcher: async (url, options) => {
      calls.push({ url: String(url), key: options?.headers?.['x-api-key'] ?? null });
      if (String(url).includes('dexscreener')) return Response.json([]);
      return Response.json({ [mint]: { usdPrice: 2, liquidity: 1, blockId: 1 } });
    },
  });
  const result = await invoke('get_price', { mint });
  assert.equal(result.ok, true);
  assert.equal(result.quote.quoteSource, 'jupiter-price-v3');
  assert.equal(result.quote.fallbackFrom, 'dexscreener');
  assert.equal(result.quote.label, 'devnet execution, mainnet pricing');
  assert.equal(result.quote.authorizesTransaction, false);
  assert.equal(result.quote.executionCluster, 'devnet');
  assert.equal(JSON.stringify(result).includes('jupiter-test-key'), false);
  assert.equal(calls.some(call => call.key === 'jupiter-test-key'), true);
});

/**
 * Achieves: get_price for a UI-wrapped SOL mint uses the public price client, not the runtime fetcher.
 * Fails when: the runtime fetcher is called, the mint is not unwrapped, or a 503 is not provider_failed.
 * Oracle: DexScreener URL for the wrapped-SOL mint and PriceError codes.
 * Side effects: injected fetchers only.
 * Gaps: live DexScreener is not part of this test.
 */
test('get_price uses the public client for wrapped SOL and reports a real outage', async () => {
  const mint = 'So11111111111111111111111111111111111111112';
  let runtimeCalls = 0;
  const invoke = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_1',
    env: {},
    fetcher: async () => {
      runtimeCalls += 1;
      return new Response('worker', { status: 404 });
    },
    priceFetch: async (url) => {
      assert.equal(String(url), `https://api.dexscreener.com/tokens/v1/solana/${mint}`);
      return Response.json([{
        baseToken: { address: mint },
        priceUsd: '74.73',
        liquidity: { usd: 9 },
        pairAddress: 'pair',
      }]);
    },
  });
  const result = await invoke('get_price', { mint: `SOL (${mint})` });
  assert.equal(result.ok, true);
  assert.equal(result.quote.mint, mint);
  assert.equal(result.quote.priceUsd, '74.73');
  assert.equal(result.quote.quoteSource, 'dexscreener');
  assert.equal(result.quote.label, 'devnet execution, mainnet pricing');
  assert.equal(result.quote.authorizesTransaction, false);
  assert.equal(runtimeCalls, 0);

  const down = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_1',
    env: {},
    priceFetch: async () => new Response('down', { status: 503 }),
  });
  const failed = await down('get_price', { mint });
  assert.equal(failed.error, 'provider_failed');
  assert.match(failed.hint, /provider is down/);

  const missing = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_1',
    env: {},
    fetcher: null,
    priceFetch: null,
  });
  const client = await missing('get_price', { mint });
  assert.equal(client.error, 'client_missing');
});

/**
 * Achieves: verifies serializeToolResult strips viewerUrl.
 * Fails when: serializeToolResult strips viewerUrl breaks (e.g. expected false, false, /bs_1/).
 * Oracle: assert.equal(text.includes('viewerUrl'), false); assert.equal(text.includes('secret'), false); assert.match(text, /bs_1/)
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('serializeToolResult strips viewerUrl', () => {
  const text = serializeToolResult({
    sessionRecordId: 'bs_1',
    viewerUrl: 'https://live.browser.run/ui/view?token=secret',
    mode: 'readonly',
  });
  assert.equal(text.includes('viewerUrl'), false);
  assert.equal(text.includes('secret'), false);
  assert.match(text, /bs_1/);
});

/**
 * Achieves: verifies createChatToolInvoker opens browser via Worker when runtime is set.
 * Fails when: createChatToolInvoker opens browser via Worker when runtime is set breaks (e.g. expected 'bs_abc', 'https://www.google.com/', 'POST').
 * Oracle: assert.equal(opened.sessionRecordId, 'bs_abc'); assert.equal(opened.url, 'https://www.google.com/'); assert.equal(calls[0].method, 'POST'); assert.equal(calls[0].owner, 'did:privy:owner1'); assert.equal(calls[0].body.url, 'https://www.google.com/'); assert.match(calls[0].url, /\/bots\/bot_1\/browser\/sessions$/)
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
test('createChatToolInvoker opens browser via Worker when runtime is set', async () => {
  const calls = [];
  const invoke = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_1',
    env: {
      NEXT_PUBLIC_AGENT_RUNTIME_URL: 'https://runtime.example',
      FIRECRAWL_API_KEY: '',
    },
    runtimeBase: 'https://runtime.example',
    fetcher: async (url, options) => {
      calls.push({
        url: String(url),
        method: options.method,
        owner: options.headers['x-owner-id'],
        body: options.body ? JSON.parse(options.body) : null,
      });
      return Response.json({
        sessionRecordId: 'bs_abc',
        purpose: 'browse',
        status: 'open',
        url: 'https://www.google.com/',
      });
    },
  });
  const opened = await invoke('browser_open', { purpose: 'shop', url: 'https://www.google.com/' });
  assert.equal(opened.sessionRecordId, 'bs_abc');
  assert.equal(opened.url, 'https://www.google.com/');
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].url, /\/bots\/bot_1\/browser\/sessions$/);
  assert.equal(calls[0].owner, 'did:privy:owner1');
  assert.equal(calls[0].body.url, 'https://www.google.com/');
});

/**
 * Achieves: verifies createChatToolInvoker navigates via Worker.
 * Fails when: createChatToolInvoker navigates via Worker breaks (e.g. expected /\/sessions\/bs_1\/navigate$/, { url: 'https://example.com/' }, 'https://example.com/').
 * Oracle: assert.equal(navigated.url, 'https://example.com/'); assert.deepEqual(JSON.parse(options.body), { url: 'https://example.com/' }); assert.match(String(url), /\/sessions\/bs_1\/navigate$/)
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
test('createChatToolInvoker navigates via Worker', async () => {
  const invoke = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_1',
    runtimeBase: 'https://runtime.example',
    fetcher: async (url, options) => {
      assert.match(String(url), /\/sessions\/bs_1\/navigate$/);
      assert.deepEqual(JSON.parse(options.body), { url: 'https://example.com/' });
      return Response.json({ sessionRecordId: 'bs_1', url: 'https://example.com/', title: 'Example' });
    },
  });
  const navigated = await invoke('browser_navigate', {
    sessionRecordId: 'bs_1',
    url: 'https://example.com/',
  });
  assert.equal(navigated.url, 'https://example.com/');
});

/**
 * Achieves: verifies createChatToolInvoker reuses session after Worker concurrency_limit.
 * Fails when: createChatToolInvoker reuses session after Worker concurrency_limit breaks (e.g. expected 'POST', 'GET', /\/sessions\/bs_old\/navigate$/).
 * Oracle: assert.equal(options.method, 'POST'); assert.equal(options.method, 'GET'); assert.equal(opened.reused, true); assert.equal(opened.url, 'https://example.com/fun'); assert.equal(opened.sessionRecordId, 'bs_old'); assert.match(String(url), /\/sessions\/bs_old\/navigate$/)
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
test('createChatToolInvoker reuses session after Worker concurrency_limit', async () => {
  let step = 0;
  const invoke = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_1',
    runtimeBase: 'https://runtime.example',
    fetcher: async (url, options) => {
      step += 1;
      if (step === 1) {
        assert.equal(options.method, 'POST');
        return Response.json({ error: 'concurrency_limit' }, { status: 429 });
      }
      if (step === 2) {
        assert.equal(options.method, 'GET');
        return Response.json({
          sessions: [{ sessionRecordId: 'bs_old', status: 'open', updatedAt: 9, url: 'https://www.google.com/' }],
        });
      }
      assert.match(String(url), /\/sessions\/bs_old\/navigate$/);
      return Response.json({ sessionRecordId: 'bs_old', url: 'https://example.com/fun', title: 'Fun' });
    },
  });
  const opened = await invoke('browser_open', { url: 'https://example.com/fun' });
  assert.equal(opened.reused, true);
  assert.equal(opened.url, 'https://example.com/fun');
  assert.equal(opened.sessionRecordId, 'bs_old');
});

/**
 * Achieves: verifies createChatToolInvoker redacts live-view viewer URLs from Worker.
 * Fails when: createChatToolInvoker redacts live-view viewer URLs from Worker breaks (e.g. expected 'bs_1', undefined, /Live View/).
 * Oracle: assert.equal(view.sessionRecordId, 'bs_1'); assert.equal(view.viewerUrl, undefined); assert.match(view.note, /Live View/)
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
test('createChatToolInvoker redacts live-view viewer URLs from Worker', async () => {
  const invoke = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_1',
    runtimeBase: 'https://runtime.example',
    fetcher: async () => Response.json({
      sessionRecordId: 'bs_1',
      viewerUrl: 'https://live.browser.run/ui/view?token=secret',
      mode: 'readonly',
      embedVerified: true,
      fallback: 'open-viewer-in-separate-tab',
    }),
  });
  const view = await invoke('browser_live_view', { sessionRecordId: 'bs_1' });
  assert.equal(view.sessionRecordId, 'bs_1');
  assert.equal(view.viewerUrl, undefined);
  assert.match(view.note, /Live View/);
});

/**
 * Achieves: verifies createChatToolInvoker returns search_not_configured without Firecrawl.
 * Fails when: createChatToolInvoker returns search_not_configured without Firecrawl breaks (e.g. expected 'search_not_configured').
 * Oracle: assert.equal(result.error, 'search_not_configured')
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('createChatToolInvoker returns search_not_configured without Firecrawl', async () => {
  const invoke = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_1',
    env: {},
    runtimeBase: '',
  });
  const result = await invoke('web_search', { query: 'solana usdc' });
  assert.equal(result.error, 'search_not_configured');
});

/**
 * Achieves: web_search posts to Firecrawl directly. A Worker 404 is not provider_failed.
 * Fails when: the runtime fetcher is called, a missing key is provider_failed, or a 503 is not provider_failed.
 * Oracle: https://api.firecrawl.dev/v1/search and error codes search_not_configured, client_missing, provider_failed.
 * Side effects: injected fetchers only.
 * Gaps: live Firecrawl is not part of this test.
 */
test('web_search calls Firecrawl directly and does not label a missing key provider_failed', async () => {
  let runtimeCalls = 0;
  const invoke = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_1',
    env: { FIRECRAWL_API_KEY: 'fc-test' },
    fetcher: async () => {
      runtimeCalls += 1;
      return Response.json({ error: 'not_found' }, { status: 404 });
    },
    searchFetch: async (url, options) => {
      assert.equal(String(url), 'https://api.firecrawl.dev/v1/search');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer fc-test');
      assert.equal(JSON.parse(options.body).query, 'conservative long-term Solana tokens');
      return Response.json({
        success: true,
        data: [{ title: 'SOL', url: 'https://example.com/sol', description: 'Fundamentals' }],
      });
    },
  });
  const result = await invoke('web_search', { query: 'conservative long-term Solana tokens' });
  assert.equal(result.results[0].url, 'https://example.com/sol');
  assert.equal(result.results[0].snippet, 'Fundamentals');
  assert.equal(result.event.name, 'web_search');
  assert.equal(JSON.stringify(result).includes('fc-test'), false);
  assert.equal(runtimeCalls, 0);

  let grounded = '';
  const local = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_1',
    env: { FIRECRAWL_API_KEY: 'fc-test' },
    fetcher: async () => Response.json({ error: 'not_found' }, { status: 404 }),
    situation: {
      at: '2026-11-19T16:33:00.000Z',
      timeZone: 'America/Chicago',
      place: 'Austin, Texas',
      locale: 'en-US',
    },
    searchFetch: async (_url, options) => {
      grounded = JSON.parse(options.body).query;
      return Response.json({ success: true, data: [] });
    },
  });
  const near = await local('web_search', { query: 'coffee near me' });
  assert.equal(near.results.length, 0);
  assert.equal(grounded, 'coffee in Austin, Texas');
  await local('web_search', { query: 'SOL price' });
  assert.equal(grounded, 'SOL price');

  const down = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_1',
    env: { FIRECRAWL_API_KEY: 'fc-test' },
    fetcher: async () => {
      throw new Error('runtime must not be called');
    },
    searchFetch: async () => new Response('down', { status: 503 }),
  });
  const failed = await down('web_search', { query: 'SOL fundamentals' });
  assert.equal(failed.error, 'provider_failed');
  assert.match(failed.hint, /research provider is down/);

  const missing = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_1',
    env: { FIRECRAWL_API_KEY: '   ' },
    fetcher: async () => Response.json({ error: 'not_found' }, { status: 404 }),
    searchFetch: async () => {
      throw new Error('must not call Firecrawl without a key');
    },
  });
  const unconfigured = await missing('web_search', { query: 'SOL fundamentals' });
  assert.equal(unconfigured.error, 'search_not_configured');
  assert.match(unconfigured.hint, /FIRECRAWL_API_KEY/);
  assert.notEqual(unconfigured.error, 'provider_failed');

  let scrapeRuntime = 0;
  const scrape = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_1',
    env: { FIRECRAWL_API_KEY: 'fc-test' },
    fetcher: async () => {
      scrapeRuntime += 1;
      return Response.json({ error: 'not_found' }, { status: 404 });
    },
    searchFetch: async (url) => {
      assert.equal(String(url), 'https://api.firecrawl.dev/v1/scrape');
      return Response.json({
        success: true,
        data: { markdown: 'SOL notes', metadata: { title: 'Notes' } },
      });
    },
  });
  const page = await scrape('web_scrape', { url: 'https://example.com/sol' });
  assert.equal(page.page.title, 'Notes');
  assert.equal(scrapeRuntime, 0);

  const noClient = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_1',
    env: { FIRECRAWL_API_KEY: 'fc-test' },
    fetcher: async () => Response.json({ error: 'not_found' }, { status: 404 }),
    searchFetch: null,
  });
  const client = await noClient('web_search', { query: 'SOL fundamentals' });
  assert.equal(client.error, 'client_missing');
  assert.notEqual(client.error, 'provider_failed');
});

/**
 * Achieves: verifies createChatToolInvoker lists bots via Worker dashboard tools.
 * Fails when: createChatToolInvoker lists bots via Worker dashboard tools breaks (e.g. expected 'bot_1', /\/api\/bots$/, 'GET').
 * Oracle: assert.equal(listed.items[0].id, 'bot_1'); assert.equal(calls[0].method, 'GET'); assert.equal(calls[0].owner, 'did:privy:owner1'); assert.match(calls[0].url, /\/api\/bots$/)
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
test('createChatToolInvoker lists bots via Worker dashboard tools', async () => {
  const calls = [];
  const invoke = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_1',
    runtimeBase: 'https://runtime.example',
    accessToken: 'privy-jwt',
    fetcher: async (url, options) => {
      calls.push({
        url: String(url),
        method: options.method,
        owner: options.headers['x-owner-id'],
        auth: options.headers.authorization ?? null,
      });
      return Response.json({ items: [{ id: 'bot_1', name: 'Alpha' }] });
    },
  });
  const listed = await invoke('list_bots', {});
  assert.equal(listed.items[0].id, 'bot_1');
  assert.match(calls[0].url, /\/api\/bots$/);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].owner, 'did:privy:owner1');
  assert.equal(calls[0].auth, 'Bearer privy-jwt');
});

/**
 * Achieves: verifies get_wallets sends Bearer and falls back to shell on login_required.
 * Fails when: Bearer is omitted or login_required surfaces instead of shell wallets.
 * Oracle: auth header is Bearer; shell fallback returns local wallet id.
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
test('createChatToolInvoker get_wallets sends Bearer and falls back on login_required', async () => {
  const calls = [];
  const invoke = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_local',
    runtimeBase: 'https://runtime.example',
    accessToken: 'privy-jwt',
    shellWallets: [{ id: 'w_main', label: 'Main', address: 'Addr1111111111111111111111111111111111', kind: 'main' }],
    shellBalanceLabel: '1 USDC',
    fetcher: async (url, options) => {
      calls.push({
        url: String(url),
        method: options.method,
        auth: options.headers.authorization ?? null,
      });
      if (String(url).includes('/api/wallets')) {
        return Response.json({ error: 'login_required' }, { status: 401 });
      }
      if (String(url).includes('/api/transfers')) {
        return Response.json({ error: 'login_required' }, { status: 401 });
      }
      return Response.json({ ok: true, items: [] });
    },
  });
  const wallets = await invoke('get_wallets', {});
  assert.equal(wallets.source, 'shell');
  assert.equal(wallets.items[0].id, 'w_main');
  assert.ok(calls.some((call) => call.auth === 'Bearer privy-jwt'));
});

/**
 * Achieves: verifies createChatToolInvoker falls back to shell bots and wallets when Worker is empty.
 * Fails when: createChatToolInvoker falls back to shell bots and wallets when Worker is empty breaks (e.g. expected 'shell', 'bot_local', 'shell').
 * Oracle: assert.equal(bots.source, 'shell'); assert.equal(bots.items[0].id, 'bot_local'); assert.equal(wallets.source, 'shell'); assert.equal(wallets.items[0].id, 'w_main'); assert.match(wallets.balances.displayBalanceLabel, /12\.5 USDC/); assert.match(wallets.clusterNote, /devnet/)
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
/**
 * Achieves: get_wallets rpc_failed stays unavailable — never "0 SOL" / empty positions.
 * Fails when: failed RPC is summarized as an empty funded wallet.
 * Oracle: balances.ok false; balanceStatus failed; label includes unavailable; no 0 SOL.
 * Side effects: fetcher doubles only.
 * Gaps: none.
 */
test('createChatToolInvoker get_wallets keeps rpc_failed distinct from empty success', async () => {
  const address = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const invoke = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_local',
    runtimeBase: 'https://runtime.example',
    env: {
      QUICKNODE_DEVNET_RPC_URL: 'https://example.invalid/devnet',
      QUICKNODE_TESTNET_RPC_URL: 'https://example.invalid/testnet',
    },
    shellWallets: [{ id: 'w_main', label: 'Main', address, kind: 'main' }],
    fetcher: async (url) => {
      const href = String(url);
      if (href.includes('/api/wallets') || href.includes('/api/transfers')) {
        return Response.json({ ok: true, source: 'supabase', items: [] });
      }
      if (href.includes('example.invalid')) {
        return new Response('boom', { status: 500 });
      }
      return new Response('nope', { status: 404 });
    },
  });
  const wallets = await invoke('get_wallets', {});
  assert.equal(wallets.balances.ok, false);
  assert.equal(wallets.balances.balanceStatus, 'failed');
  assert.match(wallets.balances.displayBalanceLabel, /balance unavailable/);
  assert.equal(wallets.balances.displayBalanceLabel.includes('0 SOL'), false);
  assert.equal(wallets.balances.displaySolLabel, null);
  assert.equal(wallets.items[0].balanceStatus, 'rpc_failed');
});

test('createChatToolInvoker falls back to shell bots and wallets when Worker is empty', async () => {
  const invoke = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_local',
    runtimeBase: 'https://runtime.example',
    shellBots: [{ id: 'bot_local', name: 'Local', type: 'trading', status: 'idle', goal: 'Watch' }],
    shellWallets: [{ id: 'w_main', label: 'Main', address: 'Addr1111111111111111111111111111111111', kind: 'main' }],
    shellBalanceLabel: '12.5 USDC',
    fetcher: async (url) => {
      if (String(url).includes('/api/transfers')) {
        return Response.json({
          ok: true,
          items: [{ asset: 'USDC', amount: '12500000', direction: 'in', toOwnerId: 'did:privy:owner1' }],
        });
      }
      return Response.json({ ok: true, source: 'supabase', items: [] });
    },
  });
  const bots = await invoke('list_bots', {});
  assert.equal(bots.source, 'shell');
  assert.equal(bots.items[0].id, 'bot_local');
  const wallets = await invoke('get_wallets', {});
  assert.equal(wallets.source, 'shell');
  assert.equal(wallets.items[0].id, 'w_main');
  assert.match(wallets.balances.displayBalanceLabel, /12\.5 USDC/);
  assert.match(wallets.clusterNote, /devnet/);
});

/**
 * Achieves: verifies createChatToolInvoker enriches shell wallet addresses via QuickNode.
 * Fails when: createChatToolInvoker enriches shell wallet addresses via QuickNode breaks (e.g. expected '2500000000', 'USDC', /2\.5 SOL/).
 * Oracle: assert.equal(wallets.items[0].solLamports, '2500000000'); assert.equal(wallets.items[0].tokens[0].symbol, 'USDC'); assert.match(wallets.balances.displayBalanceLabel, /2\.5 SOL/); assert.match(wallets.balances.displayBalanceLabel, /0\.75 USDC/); assert.ok(wallets.items[0].holdings.some((row)
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
/**
 * Achieves: Solana enrich uses rpcFetch, not the AGENT_RUNTIME binding fetcher.
 * Fails when: QuickNode URLs ride fetcher and a Worker 404 becomes rpc_failed,
 *   or a prior runtime-ok balance is overwritten by a failed enrich.
 * Oracle: rpcFetch hits example.invalid; binding fetcher never sees RPC hosts;
 *   runtime-ok wallet stays ok when rpcFetch fails.
 * Side effects: injected doubles only.
 * Gaps: none for binding bypass.
 */
test('createChatToolInvoker get_wallets uses rpcFetch and keeps runtime-ok balances', async () => {
  const { DEVNET_GENESIS_HASH } = await import('@ubc2026/wallets/privy');
  const { TESTNET_GENESIS_HASH } = await import('@ubc2026/wallets/balances');
  const address = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const rpcHosts = [];
  const bindingHosts = [];
  const invoke = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_local',
    runtimeBase: 'https://runtime.example',
    env: {
      QUICKNODE_DEVNET_RPC_URL: 'https://example.invalid/devnet',
      QUICKNODE_TESTNET_RPC_URL: 'https://example.invalid/testnet',
    },
    shellWallets: [{ id: 'w_main', label: 'Main', address, kind: 'main' }],
    fetcher: async (url) => {
      bindingHosts.push(String(url));
      if (String(url).includes('/api/wallets') || String(url).includes('/api/transfers')) {
        return Response.json({ ok: true, source: 'supabase', items: [] });
      }
      // Simulate AGENT_RUNTIME.bind returning Worker 404 for Solana hosts.
      return new Response('not found', { status: 404 });
    },
    rpcFetch: async (url, init = {}) => {
      const href = String(url);
      rpcHosts.push(href);
      const body = JSON.parse(init.body || '{}');
      const genesis = href.includes('testnet') ? TESTNET_GENESIS_HASH : DEVNET_GENESIS_HASH;
      if (body.method === 'getGenesisHash') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: genesis });
      }
      if (body.method === 'getBalance') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: { value: href.includes('testnet') ? 0 : 1_000_000_000 } });
      }
      return Response.json({ jsonrpc: '2.0', id: 1, result: { value: [] } });
    },
  });
  const wallets = await invoke('get_wallets', {});
  assert.equal(wallets.items[0].solLamports, '1000000000');
  assert.equal(wallets.items[0].balanceStatus, 'ok');
  assert.ok(rpcHosts.some((href) => href.includes('example.invalid')));
  assert.equal(bindingHosts.some((href) => href.includes('example.invalid')), false);

  const keepOk = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_local',
    runtimeBase: 'https://runtime.example',
    env: {
      QUICKNODE_DEVNET_RPC_URL: 'https://example.invalid/devnet',
      QUICKNODE_TESTNET_RPC_URL: 'https://example.invalid/testnet',
    },
    fetcher: async (url) => {
      if (String(url).includes('/api/wallets')) {
        return Response.json({
          ok: true,
          source: 'supabase',
          items: [{
            id: 'w_main',
            label: 'Main',
            address,
            kind: 'main',
            solLamports: '5000000000',
            solBalanceLabel: '5 SOL',
            holdings: [{ label: '5 SOL (devnet)', cluster: 'devnet' }],
            displayBalanceLabel: '5 SOL (devnet)',
            balanceStatus: 'ok',
          }],
        });
      }
      if (String(url).includes('/api/transfers')) {
        return Response.json({ ok: true, items: [] });
      }
      return new Response('nope', { status: 404 });
    },
    rpcFetch: async () => new Response('boom', { status: 500 }),
  });
  const preserved = await keepOk('get_wallets', {});
  assert.equal(preserved.items[0].balanceStatus, 'ok');
  assert.equal(preserved.items[0].solLamports, '5000000000');
  assert.match(preserved.balances.displayBalanceLabel, /5 SOL/);
});

test('createChatToolInvoker enriches shell wallet addresses via QuickNode', async () => {
  const { DEVNET_GENESIS_HASH, DEVNET_USDC_MINT } = await import('@ubc2026/wallets/privy');
  const { TESTNET_GENESIS_HASH } = await import('@ubc2026/wallets/balances');
  const address = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const invoke = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_local',
    runtimeBase: 'https://runtime.example',
    env: {
      QUICKNODE_DEVNET_RPC_URL: 'https://example.invalid/devnet',
      QUICKNODE_TESTNET_RPC_URL: 'https://example.invalid/testnet',
    },
    shellWallets: [{ id: 'w_main', label: 'Main', address, kind: 'main' }],
    fetcher: async (url, init = {}) => {
      const href = String(url);
      if (href.includes('/api/wallets') || href.includes('/api/transfers') || href.includes('/api/bots')) {
        return Response.json({ ok: true, source: 'supabase', items: [] });
      }
      if (href.includes('example.invalid')) {
        const body = JSON.parse(init.body || '{}');
        const genesis = href.includes('testnet') ? TESTNET_GENESIS_HASH : DEVNET_GENESIS_HASH;
        if (body.method === 'getGenesisHash') {
          return Response.json({ jsonrpc: '2.0', id: 1, result: genesis });
        }
        if (body.method === 'getBalance') {
          const value = href.includes('testnet') ? 0 : 2_500_000_000;
          return Response.json({ jsonrpc: '2.0', id: 1, result: { value } });
        }
        if (body.method === 'getTokenAccountsByOwner') {
          if (href.includes('testnet') || body.params?.[1]?.programId === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') {
            return Response.json({ jsonrpc: '2.0', id: 1, result: { value: [] } });
          }
          return Response.json({
            jsonrpc: '2.0',
            id: 1,
            result: {
              value: [{
                account: {
                  data: {
                    parsed: {
                      info: {
                        mint: DEVNET_USDC_MINT,
                        tokenAmount: { amount: '750000', decimals: 6 },
                      },
                    },
                  },
                },
              }],
            },
          });
        }
      }
      return new Response('nope', { status: 404 });
    },
  });
  const wallets = await invoke('get_wallets', {});
  assert.equal(wallets.items[0].solLamports, '2500000000');
  assert.equal(wallets.items[0].tokens[0].symbol, 'USDC');
  assert.match(wallets.balances.displayBalanceLabel, /2\.5 SOL/);
  assert.match(wallets.balances.displayBalanceLabel, /0\.75 USDC/);
  assert.ok(wallets.items[0].holdings.some((row) => row.cluster === 'devnet'));
});

/**
 * Achieves: verifies createChatToolInvoker pauses a bot via Worker.
 * Fails when: createChatToolInvoker pauses a bot via Worker breaks (e.g. expected /\/bots\/bot_2\/pause$/, 'POST', 'paused').
 * Oracle: assert.equal(options.method, 'POST'); assert.equal(paused.status, 'paused'); assert.match(String(url), /\/bots\/bot_2\/pause$/)
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
test('start_task posts the goal and full permission to the loop route', async () => {
  let seen = null;
  const invoke = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_dx4dl12n',
    runtimeBase: 'https://runtime.example',
    fetcher: async (url, options) => {
      seen = { url: String(url), method: options.method, body: JSON.parse(options.body) };
      return Response.json({ ok: true, done: true });
    },
  });
  const goal = 'beat usd inflation in the long run with long term trading';
  const started = await invoke('start_task', { botId: 'bot_dx4dl12n', goal, ownerPermission: 'full' });
  assert.equal(started.ok, true);
  assert.equal(seen.method, 'POST');
  assert.match(seen.url, /\/bots\/bot_dx4dl12n\/loop$/);
  assert.equal(seen.body.goal, goal);
  assert.equal(seen.body.ownerPermission, 'full');
  assert.equal(seen.body.bot, undefined);
});

test('createChatToolInvoker pauses a bot via Worker', async () => {
  const invoke = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_1',
    runtimeBase: 'https://runtime.example',
    fetcher: async (url, options) => {
      assert.match(String(url), /\/bots\/bot_2\/pause$/);
      assert.equal(options.method, 'POST');
      return Response.json({ status: 'paused' });
    },
  });
  const paused = await invoke('pause_bot', { botId: 'bot_2' });
  assert.equal(paused.status, 'paused');
});

/**
 * Achieves: verifies what happened while away reads events and does not spend.
 * Fails when: what happened while away reads events and does not spend breaks (e.g. expected 1, 'GET', 'did:privy:owner1'); failure/null paths flip.
 * Oracle: assert.equal(seen.length, 1); assert.equal(seen[0].method, 'GET'); assert.equal(seen[0].owner, 'did:privy:owner1'); assert.equal(seen[0].url.includes('bot_active'), false); assert.equal(briefing.spends, false); assert.equal(briefing.signs, false)
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
test('what happened while away reads events and does not spend', async () => {
  const seen = [];
  const invoke = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_active',
    runtimeBase: 'https://runtime.example',
    fetcher: async (url, options) => {
      seen.push({ url: String(url), method: options.method, owner: options.headers['x-owner-id'] });
      return Response.json({
        ok: true,
        source: 'supabase',
        items: [{
          id: 'evt_1',
          botId: 'bot_shop',
          kind: 'approval.requested',
          summary: 'Need a look at the sandbox order',
          at: '2026-11-15T12:00:00.000Z',
        }],
      });
    },
  });
  const briefing = await invoke('what_happened_while_away', {});
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'GET');
  assert.equal(seen[0].owner, 'did:privy:owner1');
  assert.match(seen[0].url, /\/api\/events$/);
  assert.equal(seen[0].url.includes('bot_active'), false);
  assert.equal(briefing.spends, false);
  assert.equal(briefing.signs, false);
  assert.match(briefing.spoken, /approval is waiting/);
  const bad = await invoke('what_happened_while_away', { since: 'yesterday' });
  assert.equal(bad.error, 'invalid_parameters');
  assert.equal(seen.length, 1);
});

/**
 * Achieves: create_loop stores purpose and cooldown on this bot; break_loop waits for the owner.
 * Fails when: a short path is skipped, break fires without the owner asking, or ownerAsked in args is forwarded.
 * Oracle: request URL, body, and x-loop-break header.
 * Side effects: mocked fetch only.
 * Gaps: the rail click is covered by the shell source test.
 */
test('create_loop and break_loop stay on this bot and the owner ask', async () => {
  const calls = [];
  const invoke = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_dx4dl12n',
    runtimeBase: 'https://runtime.example',
    ownerMessage: 'Check positions on a loop',
    fetcher: async (url, options) => {
      calls.push({
        url: String(url),
        method: options.method,
        body: JSON.parse(options.body),
        breakHeader: options.headers['x-loop-break'] || null,
      });
      return Response.json({ ok: true, loop: { active: true, purpose: 'Check positions', cooldownMinutes: 15, cooldownLabel: '15m' } });
    },
  });
  const created = await invoke('create_loop', {
    botId: 'bot_other',
    purpose: 'Check positions',
    cooldownMinutes: '15',
    ownerAsked: true,
  });
  assert.equal(created.ok, true);
  assert.match(calls[0].url, /\/bots\/bot_dx4dl12n\/card-loop$/);
  assert.equal(calls[0].body.purpose, 'Check positions');
  assert.equal(calls[0].body.cooldownMinutes, '15');
  assert.equal(calls[0].body.ownerAsked, undefined);
  const refused = await invoke('break_loop', { ownerAsked: true, userAsked: true });
  assert.equal(refused.error, 'owner_must_ask');
  assert.equal(calls.length, 1);

  const asking = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_dx4dl12n',
    runtimeBase: 'https://runtime.example',
    ownerMessage: 'Please break the loop',
    fetcher: async (url, options) => {
      calls.push({
        url: String(url),
        method: options.method,
        body: JSON.parse(options.body || '{}'),
        breakHeader: options.headers['x-loop-break'] || null,
      });
      return Response.json({ ok: true, loop: null });
    },
  });
  const broken = await asking('break_loop', { ownerAsked: false });
  assert.equal(broken.ok, true);
  assert.match(calls[1].url, /\/bots\/bot_dx4dl12n\/card-loop\/break$/);
  assert.equal(calls[1].breakHeader, 'owner-asked');
  assert.equal(calls[1].body.ownerAsked, undefined);

  const cooled = await asking('set_loop_cooldown', { cooldownMinutes: 30 });
  assert.match(calls[2].url, /\/card-loop\/cooldown$/);
  assert.equal(calls[2].body.cooldownMinutes, '30');
  assert.equal(calls[2].breakHeader, null);
});

test('request_spend carries a desk grant and a gate result is not an ask-mode hold', async () => {
  const grant = 'ab'.repeat(32);
  const calls = [];
  const invoke = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_1',
    runtimeBase: 'https://runtime.example',
    deskGrant: grant,
    fetcher: async (url, options) => {
      calls.push({
        url: String(url),
        grant: options.headers['x-desk-grant'] || null,
      });
      if (String(url).includes('/api/spend')) {
        return Response.json({
          ok: false,
          state: 'approval-needed',
          steps: ['trust-gate', 'verify-consensus', 'approval-mode'],
          signed: false,
          prompt: 'This has a low trust score, are you sure you want to buy?',
        }, { status: 409 });
      }
      return Response.json({ status: 'paused' });
    },
  });
  const spent = await invoke('request_spend', {
    botId: 'bot_1',
    action: 'buy',
    amount: '1000000',
    destination: '11111111111111111111111111111111',
  });
  assert.equal(spent.error, 'approval-needed');
  assert.equal(spent.state, 'approval-needed');
  assert.equal(spent.signed, false);
  assert.equal(spent.prompt, 'This has a low trust score, are you sure you want to buy?');
  assert.equal(spent.steps[0], 'trust-gate');
  assert.match(calls[0].url, /\/api\/spend$/);
  assert.equal(calls[0].grant, grant);
  assert.equal(JSON.stringify(spent).includes(grant), false);
  const paused = await invoke('pause_bot', { botId: 'bot_1' });
  assert.equal(paused.status, 'paused');
  assert.equal(calls[1].grant, null);
});

test('request_spend posts a 1 USDC buy without a destination', async () => {
  const calls = [];
  const invoke = createChatToolInvoker({
    ownerId: 'did:privy:owner1',
    botId: 'bot_e0madta8',
    runtimeBase: 'https://runtime.example',
    fetcher: async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      return Response.json({
        ok: false,
        state: 'reserved',
        steps: ['trust-gate', 'verify-consensus', 'bot-policy', 'approval-mode', 'reserve'],
        signed: false,
        cluster: 'devnet',
      });
    },
  });
  const spent = await invoke('request_spend', {
    action: 'buy',
    amount: 1000000,
    asset: 'USDC',
    botId: 'bot_e0madta8',
    quoteCluster: 'devnet',
    permission: 'full',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'buy');
  assert.equal(calls[0].amount, '1000000');
  assert.equal(calls[0].asset, 'USDC');
  assert.equal(calls[0].botId, 'bot_e0madta8');
  assert.equal(calls[0].quoteCluster, 'devnet');
  assert.equal(calls[0].permission, 'full');
  assert.equal(calls[0].destination, undefined);
  assert.equal(spent.error, undefined);
  assert.equal(spent.signed, false);
  assert.equal(spent.state, 'reserved');
  assert.equal(spent.steps.includes('trust-gate'), true);
  assert.equal(spent.steps.includes('reserve'), true);
  assert.equal(spent.steps.includes('approval-mode'), true);
});
