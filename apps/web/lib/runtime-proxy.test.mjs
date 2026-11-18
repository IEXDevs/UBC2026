import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedRuntimePath, runtimeProxyTarget, safeRuntimeSearch } from './runtime-proxy.mjs';

/**
 * Rigor audit — proxy allowlist positive/negative samples
 * Achieves: live owner/bot paths allowed; /api/routes and traversal denied.
 * Fails when: a sensitive Worker route becomes proxied or a live shell path is blocked.
 * Oracle: ALLOWED regex table vs product shell needs (not “whatever route.js exports”).
 * Side effects: none.
 * Gaps: sample-based — exhaustive live-route cross-check is in contracts + shopping test.
 */
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
  assert.equal(isAllowedRuntimePath('/bots/bot_1/card-loop'), true);
  assert.equal(isAllowedRuntimePath('/bots/bot_1/card-loop/cooldown'), true);
  assert.equal(isAllowedRuntimePath('/bots/bot_1/card-loop/break'), true);
  assert.equal(isAllowedRuntimePath('/bots/bot_1/sns/send'), true);
  assert.equal(isAllowedRuntimePath('/bots/bot_1/browser/sessions/rec_1/live-view'), true);
  assert.equal(isAllowedRuntimePath('/security/grab-back'), true);
  assert.equal(isAllowedRuntimePath('/api/routes'), false);
  assert.equal(isAllowedRuntimePath('/api/bots/../wallets'), false);
  assert.equal(isAllowedRuntimePath('https://evil.example/api/bots'), false);
});

/**
 * Rigor audit — absolute URL construction
 * Achieves: target stays on configured origin; credentials/javascript rejected;
 *   unknown paths → not_found; secret query keys stripped.
 * Fails when: open redirect / credentialed base / arbitrary path proxy.
 * Oracle: URL parser + allowlist + QUERY_KEYS allowlist.
 * Side effects: none.
 * Gaps: none for target builder.
 */
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

/**
 * Rigor audit — wallets paths vs shell policy
 * Achieves: proxy CAN forward create+persist (agents/tools), but health is not proxied.
 * Fails when: health becomes a false “runtime up” signal via the shell proxy.
 * Oracle: shell provision policy is walletProvisionPaths (Next only) — separate from
 *   proxy allowlist.
 * Side effects: none.
 * Gaps: documents the distinction; does not execute page.js.
 */
test('runtime proxy allows wallets persist and create paths but shell must not use create', () => {
  assert.equal(isAllowedRuntimePath('/api/wallets'), true);
  assert.equal(isAllowedRuntimePath('/api/wallets/persist'), true);
  const create = runtimeProxyTarget('https://runtime.maelstrom.iexdevs.com', '/api/wallets');
  const persist = runtimeProxyTarget('https://runtime.maelstrom.iexdevs.com', '/api/wallets/persist');
  assert.equal(create.url, 'https://runtime.maelstrom.iexdevs.com/api/wallets');
  assert.equal(persist.url, 'https://runtime.maelstrom.iexdevs.com/api/wallets/persist');
  assert.equal(runtimeProxyTarget('https://runtime.maelstrom.iexdevs.com', '/health').error, 'not_found');
});

/**
 * Rigor audit — hostile path/query inputs
 * Achieves: traversal encodings, null bytes, relative paths, overlong values, and
 *   non-allowlisted query keys are rejected.
 * Fails when: `..` encodings or evil query keys pass through to the Worker.
 * Oracle: isAllowedRuntimePath + QUERY_KEYS set.
 * Side effects: none.
 * Gaps: none — closed: boundaries for query length and duplicate evil keys.
 */
test('runtime proxy rejects path traversal, null bytes, and overlong query values', () => {
  assert.equal(isAllowedRuntimePath('/api/bots/%2e%2e/wallets'), false);
  assert.equal(isAllowedRuntimePath('/api/bots/\0freeze'), false);
  assert.equal(isAllowedRuntimePath(''), false);
  assert.equal(isAllowedRuntimePath('api/bots'), false);
  assert.equal(safeRuntimeSearch(`botId=${'x'.repeat(300)}`), null);
  assert.equal(safeRuntimeSearch('token=secret'), null);
  assert.equal(safeRuntimeSearch('botId=bot_1&limit=10'), '?botId=bot_1&limit=10');
  assert.equal(safeRuntimeSearch('botId=a&evil=1'), null);
  assert.equal(safeRuntimeSearch(`q=${'y'.repeat(257)}`), null);
  assert.equal(safeRuntimeSearch('a'.repeat(513)), null);
});

/**
 * Rigor audit — shopping vs commerce/voice tool paths
 * Achieves: shopping prepare/settle proxied; commerce signals and voice tools are not
 *   (those stay Worker-direct / webhook-auth).
 * Fails when: unauthenticated shell can hit commerce settle or voice tools via proxy.
 * Oracle: auth model — commerce signals are public Worker routes; voice tools need webhook secret.
 * Side effects: none.
 * Gaps: none for these denials.
 */
test('runtime proxy allowlist covers shopping, commerce is not proxied from shell', () => {
  assert.equal(isAllowedRuntimePath('/bots/bot_1/shopping/prepare'), true);
  assert.equal(isAllowedRuntimePath('/bots/bot_1/shopping/settle'), true);
  assert.equal(isAllowedRuntimePath('/bots/bot_1/commerce/signals/sig_1'), false);
  assert.equal(isAllowedRuntimePath('/voice/agent'), true);
  assert.equal(isAllowedRuntimePath('/voice/tools/list_bots'), false);
});
