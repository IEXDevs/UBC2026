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
  assert.ok(tools.some(tool => tool.function.name === 'web_search'));
  assert.ok(tools.some(tool => tool.function.name === 'browser_open'));
  assert.ok(tools.some(tool => tool.function.name === 'list_bots'));
  assert.ok(tools.some(tool => tool.function.name === 'pause_bot'));
  assert.match(chatToolsInstruction(), /same tools on text and voice/);
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
    fetcher: async () => Response.json({ ok: true, source: 'supabase', items: [] }),
  });
  const bots = await invoke('list_bots', {});
  assert.equal(bots.source, 'shell');
  assert.equal(bots.items[0].id, 'bot_local');
  const wallets = await invoke('get_wallets', {});
  assert.equal(wallets.source, 'shell');
  assert.equal(wallets.items[0].id, 'w_main');
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
