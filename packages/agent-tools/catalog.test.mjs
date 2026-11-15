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
  parseAwaySince,
  sharedToolsInstruction,
  spokenAwayBriefing,
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

test('spoken away briefing reads stored timeline rows and does not spend', () => {
  const rows = [
    {
      id: 'evt_old',
      botId: 'bot_1',
      kind: 'bot.paused',
      summary: 'Paused before the trip',
      at: '2026-11-14T00:00:00.000Z',
    },
    {
      id: 'stream:sig1',
      botId: 'bot_1',
      ownerId: 'user_1',
      prevHash: 'ab'.repeat(32),
      kind: 'tx.confirmed',
      summary: 'Stream deposit · AbCdEf12… https://live.browser.run/ui/view?token=secret eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb',
      at: '2026-11-15T12:00:00.000Z',
    },
    {
      id: 'evt_pay',
      botId: 'bot_shop',
      kind: 'payment.x402',
      summary: 'Sandbox order settled',
      at: '2026-11-15T15:00:00.000Z',
    },
    { id: 'evt_bad', botId: 'bot_1', kind: 'secret.leak', summary: 'nope', at: 1763300000000 },
  ];
  const briefing = spokenAwayBriefing(rows, { since: '2026-11-15T00:00:00.000Z' });
  assert.equal(briefing.readOnly, true);
  assert.equal(briefing.spends, false);
  assert.equal(briefing.signs, false);
  assert.equal(briefing.count, 2);
  assert.match(briefing.spoken, /While you were away, 2 timeline events were stored/);
  assert.match(briefing.spoken, /from Streams/);
  assert.match(briefing.spoken, /x402 payment was recorded/);
  assert.equal(briefing.spoken.includes('live.browser.run'), false);
  assert.equal(briefing.spoken.includes('eyJhbGci'), false);
  assert.equal(briefing.spoken.includes('user_1'), false);
  assert.equal(briefing.events.some((event) => event.kind === 'bot.paused'), false);
  assert.equal(briefing.events.some((event) => event.kind === 'secret.leak'), false);
  assert.equal(JSON.stringify(briefing).includes('prevHash'), false);

  const empty = spokenAwayBriefing([], { since: '2026-11-15T00:00:00Z' });
  assert.match(empty.spoken, /Nothing new was stored/);
  assert.equal(spokenAwayBriefing(rows, { source: 'unconfigured' }).spoken, 'Stored timeline events are not available yet.');
  assert.equal(parseAwaySince('not-a-time'), null);
  assert.equal(parseAwaySince('1763200000000'), 1763200000000);
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
  assert.match(sharedToolsInstruction(), /what_happened_while_away/);
  const away = DASHBOARD_TOOLS.find((tool) => tool.name === 'what_happened_while_away');
  assert.deepEqual(away.voiceCalls.map((entry) => ({ method: entry.method, path: entry.path })), [
    { method: 'GET', path: '/api/events' },
  ]);
  assert.match(away.description, /Does not spend/);
  assert.equal(away.parameters.required.length, 0);
  const walletsTool = DASHBOARD_TOOLS.find((tool) => tool.name === 'get_wallets');
  assert.match(walletsTool.description, /displayBalanceLabel/);
  assert.match(walletsTool.description, /tokens/);
  assert.match(walletsTool.description, /devnet/);
});
