import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chatToolsInstruction,
  createChatToolInvoker,
  openAiAgentTools,
  serializeToolResult,
} from './chat-tools.mjs';

/**
 * Achieves: verifies openAiAgentTools maps shared research and dashboard schemas.
 * Fails when: openAiAgentTools maps shared research and dashboard schemas breaks (e.g. expected /same tools on text and voice/, /get_price/, /devnet execution, mainnet pricing/).
 * Oracle: assert.match(chatToolsInstruction(), /same tools on text and voice/); assert.match(chatToolsInstruction(), /get_price/); assert.match(chatToolsInstruction(), /devnet execution, mainnet pricing/); assert.ok(tools.some(tool => tool.function.name === 'get_price'); assert.ok(tools.some(tool => tool.function.name === 'web_search'); assert.ok(tools.some(tool => tool.function.name === 'browser_open')
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
  assert.match(chatToolsInstruction(), /same tools on text and voice/);
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
    fetcher: async (url, options) => {
      calls.push({ url: String(url), method: options.method, owner: options.headers['x-owner-id'] });
      return Response.json({ items: [{ id: 'bot_1', name: 'Alpha' }] });
    },
  });
  const listed = await invoke('list_bots', {});
  assert.equal(listed.items[0].id, 'bot_1');
  assert.match(calls[0].url, /\/api\/bots$/);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].owner, 'did:privy:owner1');
});

/**
 * Achieves: verifies createChatToolInvoker falls back to shell bots and wallets when Worker is empty.
 * Fails when: createChatToolInvoker falls back to shell bots and wallets when Worker is empty breaks (e.g. expected 'shell', 'bot_local', 'shell').
 * Oracle: assert.equal(bots.source, 'shell'); assert.equal(bots.items[0].id, 'bot_local'); assert.equal(wallets.source, 'shell'); assert.equal(wallets.items[0].id, 'w_main'); assert.match(wallets.balances.displayBalanceLabel, /12\.5 USDC/); assert.match(wallets.clusterNote, /devnet/)
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
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
