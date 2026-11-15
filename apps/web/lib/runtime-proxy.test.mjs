import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedRuntimePath, runtimeProxyTarget, safeRuntimeSearch } from './runtime-proxy.mjs';

test('runtime proxy allowlist is the live owner and bot routes', () => {
  assert.equal(isAllowedRuntimePath('/api/bots'), true);
  assert.equal(isAllowedRuntimePath('/api/wallets'), true);
  assert.equal(isAllowedRuntimePath('/api/payments'), true);
  assert.equal(isAllowedRuntimePath('/api/profiles/me'), true);
  assert.equal(isAllowedRuntimePath('/api/transfers'), true);
  assert.equal(isAllowedRuntimePath('/api/me'), true);
  assert.equal(isAllowedRuntimePath('/api/metrics'), true);
  assert.equal(isAllowedRuntimePath('/api/logs'), true);
  assert.equal(isAllowedRuntimePath('/api/events'), true);
  assert.equal(isAllowedRuntimePath('/api/decisions'), true);
  assert.equal(isAllowedRuntimePath('/bots/bot_1/status'), true);
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
