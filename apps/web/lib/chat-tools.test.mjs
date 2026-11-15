import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chatToolsInstruction,
  createChatToolInvoker,
  openAiAgentTools,
  serializeToolResult,
} from './chat-tools.mjs';

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
