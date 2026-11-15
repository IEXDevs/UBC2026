import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DASHBOARD_TOOLS,
  PRICE_TOOLS,
  RESEARCH_TOOLS,
  SHARED_AGENT_TOOLS,
  SHARED_TOOL_NAMES,
  VOICE_BROWSER_ALIASES,
  VOICE_RESEARCH_WEBHOOKS,
  sharedToolsInstruction,
  toOpenAiTools,
} from './catalog.mjs';

test('shared catalog covers research and dashboard tools', () => {
  for (const name of [
    'web_search',
    'web_scrape',
    'get_price',
    'browser_open',
    'browser_navigate',
    'browser_live_view',
    'browser_release',
    'list_bots',
    'get_wallets',
    'pause_bot',
    'start_task',
    'request_spend',
  ]) {
    assert.ok(SHARED_TOOL_NAMES.includes(name), name);
  }
  assert.equal(RESEARCH_TOOLS.length, 6);
  assert.ok(DASHBOARD_TOOLS.length >= 10);
  assert.equal(SHARED_AGENT_TOOLS.length, RESEARCH_TOOLS.length + PRICE_TOOLS.length + DASHBOARD_TOOLS.length);
  const price = PRICE_TOOLS.find((tool) => tool.name === 'get_price');
  assert.equal(price.handler, 'price');
  assert.deepEqual(price.voiceCalls, []);
  assert.match(price.description, /DexScreener/);
  assert.match(price.description, /Jupiter Price API v3/);
  assert.match(price.description, /devnet execution, mainnet pricing/);
  assert.match(price.description, /does not sign/);
});

test('OpenAI tool mapping preserves names', () => {
  const mapped = toOpenAiTools();
  assert.equal(mapped.every((item) => item.type === 'function'), true);
  assert.deepEqual(
    mapped.map((item) => item.function.name).sort(),
    [...SHARED_TOOL_NAMES].sort(),
  );
});

test('voice research webhooks include live_view and navigate', () => {
  const names = VOICE_RESEARCH_WEBHOOKS.map((item) => item.name);
  assert.ok(names.includes('browser_live_view'));
  assert.ok(names.includes('browser_navigate'));
  assert.ok(names.includes('web_search'));
  assert.ok(VOICE_BROWSER_ALIASES.some((item) => item.name === 'open_browser_session'));
  assert.match(sharedToolsInstruction(), /same tools on text and voice/);
  assert.match(sharedToolsInstruction(), /get_price/);
  assert.match(sharedToolsInstruction(), /DexScreener/);
  assert.match(sharedToolsInstruction(), /devnet execution, mainnet pricing/);
  assert.match(sharedToolsInstruction(), /balances\.displayBalanceLabel/);
  const walletsTool = DASHBOARD_TOOLS.find((tool) => tool.name === 'get_wallets');
  assert.match(walletsTool.description, /displayBalanceLabel/);
  assert.match(walletsTool.description, /tokens/);
  assert.match(walletsTool.description, /devnet/);
});
