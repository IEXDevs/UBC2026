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

/**
 * Achieves: Shared catalog includes research + dashboard + price tools with get_price safety copy.
 * Fails when: A required tool name is missing, lengths drift, or get_price claims it signs.
 * Oracle: Explicit required-name allowlist + description substrings (DexScreener/Jupiter/no-sign).
 * Side effects: none.
 * Gaps: Handler wiring to runtime routes is covered in agent-runtime / web tests.
 */
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
    'create_loop',
    'set_loop_cooldown',
    'break_loop',
    'request_spend',
  ]) {
    assert.ok(SHARED_TOOL_NAMES.includes(name), name);
  }
  assert.equal(RESEARCH_TOOLS.length, 6);
  assert.ok(DASHBOARD_TOOLS.length >= 10);
  assert.equal(SHARED_AGENT_TOOLS.length, RESEARCH_TOOLS.length + PRICE_TOOLS.length + DASHBOARD_TOOLS.length);
  assert.equal(new Set(SHARED_TOOL_NAMES).size, SHARED_TOOL_NAMES.length);
  assert.deepEqual(
    SHARED_AGENT_TOOLS.map((tool) => tool.name).sort(),
    [...SHARED_TOOL_NAMES].sort(),
  );
  const price = PRICE_TOOLS.find((tool) => tool.name === 'get_price');
  assert.equal(price.handler, 'price');
  assert.deepEqual(price.voiceCalls, []);
  assert.match(price.description, /DexScreener/);
  assert.match(price.description, /Jupiter Price API v3/);
  assert.match(price.description, /devnet execution, mainnet pricing/);
  assert.match(price.description, /does not sign/);
});

/**
 * Achieves: Away briefing is read-only, redacts secrets/URLs/JWTs, and ignores pre-since or invalid kinds.
 * Fails when: spends/signs flip true, JWT/live URLs leak into spoken text, or secret.leak events appear.
 * Oracle: Hand-built timeline rows with planted secrets; EVENT_KINDS allowlist rejects secret.leak.
 * Side effects: none (pure function over fixture rows).
 * Gaps: Does not hit live Supabase event store.
 */
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

/**
 * Achieves: OpenAI tool mapping preserves every shared tool name as type=function.
 * Fails when: Names diverge from SHARED_TOOL_NAMES or type is not function.
 * Oracle: Sorted equality of mapped names vs SHARED_TOOL_NAMES constant.
 * Side effects: none.
 * Gaps: JSON Schema parameter validity not deep-checked.
 */
test('OpenAI tool mapping preserves names', () => {
  const mapped = toOpenAiTools();
  assert.equal(mapped.every((item) => item.type === 'function'), true);
  assert.deepEqual(
    mapped.map((item) => item.function.name).sort(),
    [...SHARED_TOOL_NAMES].sort(),
  );
  assert.equal(mapped.every((item) => item.function.parameters && typeof item.function.parameters === 'object'), true);
});

/**
 * Achieves: Voice research webhooks expose live_view/navigate/search; away tool is GET-only and non-spending.
 * Fails when: navigate/live_view missing, away tool gains required params, or instruction omits get_price safety.
 * Oracle: Explicit webhook name membership + away.voiceCalls path equality to GET /api/events.
 * Side effects: none.
 * Gaps: Alias → runtime dispatch covered in voice/runtime tests.
 */
test('voice research webhooks include live_view and navigate', () => {
  const names = VOICE_RESEARCH_WEBHOOKS.map((item) => item.name);
  assert.ok(names.includes('browser_live_view'));
  assert.ok(names.includes('browser_navigate'));
  assert.ok(names.includes('web_search'));
  assert.ok(VOICE_BROWSER_ALIASES.some((item) => item.name === 'open_browser_session'));
  assert.match(sharedToolsInstruction(), /simple English/);
  assert.match(sharedToolsInstruction(), /Do not read them back/);
  assert.match(sharedToolsInstruction(), /You have the following tools/);
  assert.match(sharedToolsInstruction(), /get_price/);
  assert.match(sharedToolsInstruction(), /DexScreener/);
  assert.match(sharedToolsInstruction(), /devnet execution, mainnet pricing/);
  assert.match(sharedToolsInstruction(), /balances\.displayBalanceLabel/);
  assert.match(sharedToolsInstruction(), /what_happened_while_away/);
  assert.match(sharedToolsInstruction(), /create_loop stores a purpose/);
  assert.match(sharedToolsInstruction(), /at least 15 minutes/);
  assert.match(sharedToolsInstruction(), /decision gate before any spend/);
  assert.match(sharedToolsInstruction(), /Do not break a loop on your own/);
  assert.match(sharedToolsInstruction(), /lookup_recipient/);
  assert.match(sharedToolsInstruction(), /Never web_search for \.sol/);
  assert.match(sharedToolsInstruction(), /Prefer a direct URL over searching/);
  const lookup = DASHBOARD_TOOLS.find((tool) => tool.name === 'lookup_recipient');
  assert.deepEqual(lookup.parameters.required, ['q']);
  assert.equal(lookup.voiceCalls[0].method, 'GET');
  assert.equal(lookup.voiceCalls[0].path, '/api/profiles/lookup');
  assert.deepEqual(lookup.voiceCalls[0].query, ['q']);
  assert.match(lookup.description, /Never web_search/);
  const created = DASHBOARD_TOOLS.find((tool) => tool.name === 'create_loop');
  assert.deepEqual(created.parameters.required, ['botId', 'purpose', 'cooldownMinutes']);
  assert.equal(created.voiceCalls[0].path, '/bots/:botId/card-loop');
  const cooldown = DASHBOARD_TOOLS.find((tool) => tool.name === 'set_loop_cooldown');
  assert.match(cooldown.description, /minimum is 15/i);
  const broken = DASHBOARD_TOOLS.find((tool) => tool.name === 'break_loop');
  assert.match(broken.description, /only when the owner explicitly asks/);
  assert.equal(broken.parameters.properties.ownerAsked, undefined);
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
