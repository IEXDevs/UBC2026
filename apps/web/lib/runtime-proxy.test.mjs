import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedRuntimePath, runtimeProxyTarget, safeRuntimeSearch } from './runtime-proxy.mjs';

test('runtime proxy allowlist is the live owner and bot routes', () => {
  assert.equal(isAllowedRuntimePath('/api/bots'), true);
  assert.equal(isAllowedRuntimePath('/api/bots/freeze'), true);
  assert.equal(isAllowedRuntimePath('/api/desk'), true);
  assert.equal(isAllowedRuntimePath('/api/desk/lock'), true);
  assert.equal(isAllowedRuntimePath('/api/desk/unlock'), true);
  assert.equal(isAllowedRuntimePath('/api/wallets'), true);
  assert.equal(isAllowedRuntimePath('/api/wallets/persist'), true);
  assert.equal(isAllowedRuntimePath('/api/wallets/fmfdj6yqly31huorjqzq38zc/export'), true);
  assert.equal(isAllowedRuntimePath('/api/payments'), true);
  assert.equal(isAllowedRuntimePath('/api/profiles/me'), true);
  assert.equal(isAllowedRuntimePath('/api/transfers'), true);
  assert.equal(isAllowedRuntimePath('/api/spend'), true);
  assert.equal(isAllowedRuntimePath('/api/me'), true);
  assert.equal(isAllowedRuntimePath('/api/metrics'), true);
  assert.equal(isAllowedRuntimePath('/api/logs'), true);
  assert.equal(isAllowedRuntimePath('/api/events'), true);
  assert.equal(isAllowedRuntimePath('/api/decisions'), true);
  assert.equal(isAllowedRuntimePath('/bots/bot_1/status'), true);
  assert.equal(isAllowedRuntimePath('/bots/bot_1/loop'), true);
  assert.equal(isAllowedRuntimePath('/bots/bot_1/sns/send'), true);
  assert.equal(isAllowedRuntimePath('/bots/bot_1/browser/sessions/rec_1/live-view'), true);
  assert.equal(isAllowedRuntimePath('/security/grab-back'), true);
  assert.equal(isAllowedRuntimePath('/api/routes'), false);
  assert.equal(isAllowedRuntimePath('/api/bots/../wallets'), false);
  assert.equal(isAllowedRuntimePath('https://evil.example/api/bots'), false);
});

test('runtime proxy target stays on the configured origin', () => {
  assert.deepEqual(
    runtimeProxyTarget('https://runtime.example/agent/', '/api/events', 'botId=bot_1'),
    { url: 'https://runtime.example/agent/api/events?botId=bot_1' },
  );
  assert.equal(runtimeProxyTarget('', '/api/bots').error, 'runtime_unconfigured');
  assert.equal(runtimeProxyTarget('javascript:alert(1)', '/api/bots').error, 'runtime_unconfigured');
  assert.equal(runtimeProxyTarget('https://runtime.example', '/api/secret').error, 'not_found');
  assert.equal(safeRuntimeSearch('token=secret'), null);
  assert.equal(runtimeProxyTarget('https://user:pass@runtime.example', '/api/bots').error, 'runtime_unconfigured');
});

test('runtime proxy allows wallets persist and create paths but shell must not use create', () => {
  // Proxy allowlist is not the shell provision policy — both paths are routable.
  assert.equal(isAllowedRuntimePath('/api/wallets'), true);
  assert.equal(isAllowedRuntimePath('/api/wallets/persist'), true);
  const create = runtimeProxyTarget('https://runtime.maelstrom.iexdevs.com', '/api/wallets');
  const persist = runtimeProxyTarget('https://runtime.maelstrom.iexdevs.com', '/api/wallets/persist');
  assert.equal(create.url, 'https://runtime.maelstrom.iexdevs.com/api/wallets');
  assert.equal(persist.url, 'https://runtime.maelstrom.iexdevs.com/api/wallets/persist');
  // Health is intentionally not proxied (would look like "runtime up" from the shell).
  assert.equal(runtimeProxyTarget('https://runtime.maelstrom.iexdevs.com', '/health').error, 'not_found');
});

test('runtime proxy rejects path traversal, null bytes, and overlong query values', () => {
  assert.equal(isAllowedRuntimePath('/api/bots/%2e%2e/wallets'), false);
  assert.equal(isAllowedRuntimePath('/api/bots/\0freeze'), false);
  assert.equal(isAllowedRuntimePath(''), false);
  assert.equal(isAllowedRuntimePath('api/bots'), false);
  assert.equal(safeRuntimeSearch(`botId=${'x'.repeat(300)}`), null);
  assert.equal(safeRuntimeSearch('token=secret'), null);
  assert.equal(safeRuntimeSearch('botId=bot_1&limit=10'), '?botId=bot_1&limit=10');
  // Duplicate keys still only keep allowlisted names.
  assert.equal(safeRuntimeSearch('botId=a&evil=1'), null);
});

test('runtime proxy allowlist covers shopping, commerce is not proxied from shell', () => {
  assert.equal(isAllowedRuntimePath('/bots/bot_1/shopping/prepare'), true);
  assert.equal(isAllowedRuntimePath('/bots/bot_1/shopping/settle'), true);
  // Signal settle stays on the Worker directly (no owner proxy path).
  assert.equal(isAllowedRuntimePath('/bots/bot_1/commerce/signals/sig_1'), false);
  assert.equal(isAllowedRuntimePath('/voice/agent'), true);
  assert.equal(isAllowedRuntimePath('/voice/tools/list_bots'), false);
});
