/**
 * Shared agent tool surface for text chat and voice.
 * Research/browser tools come from @ubc2026/browser-session.
 * Dashboard tools call the same owner HTTP routes the UI uses.
 */
import { agentTools } from '@ubc2026/browser-session';
import { EVENT_KINDS } from '@ubc2026/contracts';

const botId = Object.freeze({ type: 'string', description: 'Bot id' });

function dashboard(name, description, required, properties, calls) {
  return Object.freeze({
    name,
    description,
    parameters: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: Object.freeze([...required]),
      properties: Object.freeze({ ...properties }),
    }),
    voiceCalls: Object.freeze(calls.map((entry) => Object.freeze({ ...entry }))),
  });
}

function call(method, path, extra = {}) {
  return Object.freeze({
    method,
    path,
    query: Object.freeze(extra.query ?? []),
    body: Object.freeze(extra.body ?? []),
  });
}

/** Fleet / wallet / timeline tools — same routes as the shell APIs. */
export const DASHBOARD_TOOLS = Object.freeze([
  dashboard('list_bots', 'List this user\'s bots.', [], {}, [call('GET', '/api/bots')]),
  dashboard('get_bot_status', 'Status for one bot.', ['botId'], { botId }, [call('GET', '/bots/:botId/status')]),
  dashboard(
    'get_wallets',
    'List wallets and every non-zero balance found for this owner. Read balances.displayBalanceLabel / holdings[] aloud — whatever SOL or SPL tokens exist on Solana-devnet and Solana-testnet for those addresses.',
    [],
    {},
    [call('GET', '/api/wallets')],
  ),
  dashboard('get_overview', 'Overview metrics, including PnL.', [], {}, [call('GET', '/api/metrics')]),
  dashboard('get_activity', 'Recent activity for one bot.', ['botId'], { botId }, [
    call('GET', '/api/events', { query: ['botId'] }),
  ]),
  dashboard(
    'what_happened_while_away',
    'Spoken briefing of what happened while the owner was away. Reads stored timeline events for this owner through GET /api/events, including rows Streams already wrote there. Optional botId and since (ISO-8601 Z or epoch milliseconds). Read-only. Does not spend, sign, or broadcast. Read briefing.spoken aloud and do not invent events.',
    [],
    {
      botId: { type: 'string', description: 'Optional bot id. Omit for every bot this owner can see.' },
      since: { type: 'string', description: 'Optional ISO-8601 UTC timestamp or epoch milliseconds. Events before this are left out.' },
    },
    [call('GET', '/api/events', { query: ['botId'] })],
  ),
  dashboard('why_decision', 'Why a bot acted (decision records).', ['botId'], { botId }, [
    call('GET', '/api/decisions', { query: ['botId'] }),
  ]),
  dashboard('get_payment_feed', 'Payments in and out for one bot.', ['botId'], { botId }, [
    call('GET', '/api/payments', { query: ['botId'] }),
  ]),
  dashboard('pause_bot', 'Pause one bot.', ['botId'], { botId }, [call('POST', '/bots/:botId/pause')]),
  dashboard('resume_bot', 'Resume one bot.', ['botId'], { botId }, [call('POST', '/bots/:botId/resume')]),
  dashboard('wake_bot', 'Wake one bot to continue its goal.', ['botId'], {
    botId,
    goal: { type: 'string', description: 'Optional goal text' },
  }, [call('POST', '/bots/:botId/wake', { body: ['goal'] })]),
  dashboard('start_task', 'Start the research / decide / approval loop for one bot. Creates a run when the bot has none, then pursues the goal through the checkpointed loop.', ['botId'], {
    botId,
    goal: { type: 'string', description: 'Optional goal text' },
  }, [call('POST', '/bots/:botId/loop', { body: ['goal'] })]),
  dashboard(
    'create_loop',
    'Start a loop that wakes this bot again after a cooldown so it can check positions or do the stored purpose. The purpose is stored with the loop. cooldownMinutes is minutes and the minimum is 15. A shorter cooldown is rejected. The wake still goes through the decision gate before any spend. Execution stays on Solana devnet.',
    ['botId', 'purpose', 'cooldownMinutes'],
    {
      botId,
      purpose: { type: 'string', description: 'Why this loop runs. Stored with the loop.' },
      cooldownMinutes: { type: 'string', description: 'Cooldown in minutes. Minimum 15.' },
    },
    [call('POST', '/bots/:botId/card-loop', { body: ['purpose', 'cooldownMinutes'] })],
  ),
  dashboard(
    'set_loop_cooldown',
    'Change the cooldown on this bot\'s loop. cooldownMinutes is minutes. The minimum is 15. A shorter cooldown is rejected. This does not spend.',
    ['botId', 'cooldownMinutes'],
    {
      botId,
      cooldownMinutes: { type: 'string', description: 'Cooldown in minutes. Minimum 15.' },
    },
    [call('POST', '/bots/:botId/card-loop/cooldown', { body: ['cooldownMinutes'] })],
  ),
  dashboard(
    'break_loop',
    'Break this bot\'s loop. Call this only when the owner explicitly asks to break, stop, or cancel the loop. Do not call it on your own, and do not call it just because a wake finished.',
    ['botId'],
    { botId },
    [call('POST', '/bots/:botId/card-loop/break')],
  ),
  dashboard('list_browser_sessions', 'List open browser sessions for a bot.', ['botId'], { botId }, [
    call('GET', '/bots/:botId/browser/sessions'),
  ]),
  dashboard('stop_all', 'Pause every listed agent. Say "Stopping every agent now" before calling.', [], {}, [
    call('GET', '/api/bots'),
    call('POST', '/bots/:botId/pause'),
  ]),
  dashboard('prepare_shopping', 'Prepare an x402 sandbox or Laso shopping purchase. Does not sign.', ['botId'], {
    botId,
    provider: { type: 'string', description: 'sandbox or laso' },
  }, [call('POST', '/bots/:botId/shopping/prepare', { body: ['provider'] })]),
  dashboard(
    'request_spend',
    'Move funds through the shared permissioned spend API. Use it for a buy, sell, spend, or pay. When the owner set full permissions, do not ask which of those they mean. A buy of wrapped SOL spends USDC. amount 1000000 is 1 USDC and does not need a destination. quoteCluster devnet does not authorize a mainnet trade. A mainnet price quote does not authorize the transaction. Execution is Solana devnet.',
    ['botId', 'action', 'amount'],
    {
      botId,
      action: { type: 'string', description: 'buy, sell, spend, or pay' },
      amount: { type: 'string', description: 'Base-unit USDC amount' },
      destination: { type: 'string', description: 'Destination Solana address' },
      handle: { type: 'string', description: 'Maelstrom handle without @' },
      asset: { type: 'string', description: 'USDC' },
      quoteCluster: { type: 'string', description: 'mainnet or devnet. A mainnet quote never authorizes a transaction.' },
    },
    [call('POST', '/api/spend', { body: ['botId', 'action', 'amount', 'destination', 'handle', 'asset', 'quoteCluster'] })],
  ),
  dashboard(
    'lookup_recipient',
    'Resolve a wallet address, @handle, or .sol SNS name to a pubkey via the profiles lookup API. Use this for richclub.sol, @alex, or a base58 address. Never web_search for .sol names or handles. Read-only. Does not sign or spend.',
    ['q'],
    {
      q: {
        type: 'string',
        description: 'Wallet address, @handle, or name.sol (for example richclub.sol)',
      },
    },
    [call('GET', '/api/profiles/lookup', { query: ['q'] })],
  ),
  dashboard('sns_send', 'Build a send intent to a .sol name after lookup_recipient (or with a known domain). Does not sign unless an executor is injected.', ['botId'], {
    botId,
    domain: { type: 'string', description: 'SNS domain like alex.sol' },
    amount: { type: 'string', description: 'Base-unit amount string' },
    from: { type: 'string', description: 'Sender pubkey' },
  }, [call('POST', '/bots/:botId/sns/send', { body: ['domain', 'amount', 'from'] })]),
]);

/** Research + browser tools shared with text chat. */
export const RESEARCH_TOOLS = agentTools;

/**
 * Mainnet paper-PnL price. DexScreener, then Jupiter Price API v3.
 * The handler reads the quote. It does not sign or broadcast.
 */
export const PRICE_TOOLS = Object.freeze([
  Object.freeze({
    name: 'get_price',
    description: 'Look up a mainnet USD price for one Solana mint. DexScreener first; Jupiter Price API v3 only if DexScreener fails. Paper PnL. The quote is labeled "devnet execution, mainnet pricing". It does not sign, broadcast, or authorize a transaction. Execution stays on Solana devnet.',
    parameters: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: Object.freeze(['mint']),
      properties: Object.freeze({
        mint: Object.freeze({ type: 'string', description: 'Solana mint address' }),
      }),
    }),
    handler: 'price',
    voiceCalls: Object.freeze([]),
  }),
]);

/**
 * Full shared catalog. Voice also keeps legacy aliases
 * (open_browser_session / release_browser_session) that map to the same routes.
 */
export const SHARED_AGENT_TOOLS = Object.freeze([
  ...RESEARCH_TOOLS,
  ...PRICE_TOOLS,
  ...DASHBOARD_TOOLS,
]);

export const SHARED_TOOL_NAMES = Object.freeze(SHARED_AGENT_TOOLS.map((tool) => tool.name));

export function toOpenAiTools(tools = SHARED_AGENT_TOOLS) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function sharedToolsInstruction() {
  return [
    'Speak to the owner in simple English. These tool notes are for you. Do not read them back, and do not quote error codes, unless the owner asks how a tool works.',
    'You have the following tools: web_search, web_scrape, browser_open, browser_navigate, browser_live_view, browser_release, get_price, plus dashboard tools (list_bots, get_bot_status, get_wallets, get_overview, get_activity, what_happened_while_away, why_decision, get_payment_feed, pause_bot, resume_bot, wake_bot, start_task, create_loop, set_loop_cooldown, break_loop, list_browser_sessions, stop_all, prepare_shopping, request_spend, lookup_recipient, sns_send).',
    'create_loop stores a purpose and a cooldown of at least 15 minutes, then starts this bot again after that cooldown. set_loop_cooldown changes that cooldown. A shorter cooldown is rejected. A loop wake still goes through the decision gate before any spend.',
    'Call break_loop only when the owner explicitly asks to break, stop, or cancel the loop. Do not break a loop on your own.',
    'When the owner asks what happened while they were away, call what_happened_while_away and read briefing.spoken. It reads stored timeline events through GET /api/events. It does not spend, sign, or broadcast.',
    'For a token price, call get_price. It reads DexScreener, then Jupiter Price API v3. The quote is paper PnL labeled "devnet execution, mainnet pricing". It does not sign, broadcast, or authorize a transaction. Execution stays on Solana devnet.',
    'When the owner asks you to find and do one trade, call get_price for the mint, then start_task. get_price does not place the trade. start_task runs the existing loop. provider_failed means the price provider is down. client_missing means the price client is not configured. invalid_mint means the mint is not a Solana address.',
    'request_spend posts the shared spend route. A locked desk is not an approval hold and does not replace trust, verify, reserve, or the permission gate. Fully-automatic still runs those gates. 1000000 is 1 USDC in base units. A USDC buy of wrapped SOL does not need a destination. Do not describe a desk lock as ask-mode.',
    'When the owner names a .sol SNS domain, an @handle, or a wallet address, call lookup_recipient with q set to that token. It hits GET /api/profiles/lookup (SNS resolve or handle directory). Never web_search for .sol names or handles. Speak the resolved address as first5...last5.',
    'When the owner asks you to open or use a specific website: browser_open, then browser_navigate to that https URL. Prefer a direct URL over searching. The owner watches Live View for form entry.',
    'When the owner asks for open-web research (not a .sol, handle, or wallet): call web_search first, pick a real https result url, then web_scrape. search_not_configured and client_missing mean FIRECRAWL_API_KEY or the research client is not configured. provider_failed means Firecrawl returned a server error. Do not invent search results.',
    'Do not invent balances, positions, or decisions — call get_wallets and read balances.balanceStatus / balances.ok / balances.displayBalanceLabel / holdings. If balanceStatus is failed or balances.ok is false, say balances could not be read (use the unavailable label). Never claim "no open positions" or "0 SOL" from a failed or partial read. Empty success means holdings is empty and balanceStatus is empty or ok with zero amounts.',
    'Never claim you lack a browser while these tools are available.',
    'browser_live_view never returns a viewer URL to you — the owner Live View panel shows it.',
    'Fund movements use request_spend. Execution stays on Solana devnet.',
    'Do not raise limits or freeze wallets from tools.',
    'If a tool is not set up, say which setting is missing in plain words. Otherwise leave the error code out of the reply.',
  ].join('\n');
}

const AWAY_KIND = Object.freeze({
  'bot.created': 'A bot was created',
  'bot.enabled': 'A bot was enabled',
  'bot.paused': 'A bot was paused',
  'bot.frozen': 'A bot was frozen',
  'bot.unfrozen': 'A bot was unfrozen',
  'wallet.frozen': 'A wallet was frozen',
  'wallet.unfrozen': 'A wallet was unfrozen',
  'run.checkpoint': 'A run checkpoint was stored',
  'tool.call': 'A tool ran',
  'trust.gate': 'A trust gate ran',
  'verify.attempt': 'Verification retried',
  'verify.settled': 'Verification settled',
  'verify.mismatch': 'Verification mismatched',
  'approval.requested': 'An approval is waiting',
  'approval.granted': 'An approval was granted',
  'approval.consumed': 'An approval was used',
  'budget.reserved': 'Budget was reserved',
  'budget.spent': 'Budget was recorded as spent',
  'payment.x402': 'An x402 payment was recorded',
  'tx.submitted': 'A transaction was submitted',
  'tx.confirmed': 'A transaction confirmed',
  'kill.stop-all': 'Stop all ran',
  'funds.grabbed': 'Funds were pulled back',
});

const AWAY_SECRET = /https?:\/\/\S+|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const AWAY_SINCE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const AWAY_SHOWN = 6;

/** Epoch ms for an away-briefing `since` value, or null when it is not a timestamp. */
export function parseAwaySince(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 40) return null;
  if (/^(0|[1-9][0-9]{0,15})$/.test(value)) {
    const ms = Number(value);
    return Number.isSafeInteger(ms) && ms > 0 ? ms : null;
  }
  if (!AWAY_SINCE_ISO.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isSafeInteger(ms) && ms > 0 ? ms : null;
}

function awayAt(event) {
  if (typeof event?.at === 'number' && Number.isSafeInteger(event.at) && event.at > 0) return event.at;
  if (typeof event?.at === 'string') {
    const ms = Date.parse(event.at);
    if (Number.isSafeInteger(ms) && ms > 0) return ms;
  }
  return null;
}

function awaySummary(summary) {
  if (typeof summary !== 'string') return '';
  const text = summary.replace(AWAY_SECRET, '[hidden]').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

/**
 * Short spoken briefing from stored timeline rows.
 * Read-only. Does not spend, sign, or broadcast.
 */
export function spokenAwayBriefing(items, { since, source, botId, unavailable = false } = {}) {
  const base = { readOnly: true, spends: false, signs: false };
  if (unavailable || source === 'unconfigured') {
    return {
      ...base,
      spoken: 'Stored timeline events are not available yet.',
      count: 0,
      events: [],
      unavailable: true,
    };
  }
  const cutoff = since == null || since === '' ? null : parseAwaySince(typeof since === 'number' ? String(since) : since);
  const rows = Array.isArray(items) ? items : [];
  const kept = [];
  for (const event of rows) {
    if (!event || typeof event !== 'object') continue;
    if (!EVENT_KINDS.includes(event.kind)) continue;
    if (typeof event.id !== 'string' || typeof event.botId !== 'string') continue;
    const at = awayAt(event);
    if (at == null) continue;
    if (cutoff != null && at < cutoff) continue;
    const summary = awaySummary(event.summary);
    kept.push({
      id: event.id,
      botId: event.botId,
      kind: event.kind,
      at,
      summary,
      stream: event.id.startsWith('stream:') || summary.startsWith('Stream '),
    });
  }
  kept.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  if (kept.length === 0) {
    return {
      ...base,
      spoken: 'Nothing new was stored on the timeline while you were away.',
      count: 0,
      events: [],
    };
  }
  const shown = kept.slice(0, AWAY_SHOWN);
  const lines = shown.map((event) => {
    const lead = AWAY_KIND[event.kind] || 'An event was stored';
    const where = event.stream ? 'from Streams' : 'on the timeline';
    return event.summary ? `${lead} ${where}: ${event.summary}.` : `${lead} ${where}.`;
  });
  const noun = kept.length === 1 ? '1 timeline event was stored' : `${kept.length} timeline events were stored`;
  const scope = typeof botId === 'string' && botId ? ' for this bot' : '';
  const extra = kept.length > shown.length ? ` The newest ${shown.length} are these.` : '';
  let spoken = `While you were away${scope}, ${noun}.${extra} ${lines.join(' ')}`;
  if (spoken.length > 700) spoken = `${spoken.slice(0, 697)}…`;
  return {
    ...base,
    spoken,
    count: kept.length,
    events: shown.map(({ stream: _stream, ...event }) => event),
  };
}

/** Voice-only aliases kept so existing ElevenLabs configs keep working. */
export const VOICE_BROWSER_ALIASES = Object.freeze([
  dashboard(
    'open_browser_session',
    'Alias for browser_open. Open an owner-bound browser session. Pass purpose and optional https url.',
    ['botId'],
    {
      botId,
      purpose: { type: 'string', description: 'Short purpose, such as browse' },
      url: { type: 'string', description: 'Optional https URL to load' },
    },
    [call('POST', '/bots/:botId/browser/sessions', { body: ['purpose', 'url'] })],
  ),
  dashboard(
    'release_browser_session',
    'Alias for browser_release. Release a browser session.',
    ['botId', 'sessionRecordId'],
    {
      botId,
      sessionRecordId: { type: 'string', description: 'Session record id' },
    },
    [call('POST', '/bots/:botId/browser/sessions/:sessionRecordId/release')],
  ),
]);

/**
 * Research/browser tools as voice webhook specs (special handlers for search/scrape).
 * browser_open/navigate/live_view/release use the same bot browser routes as text chat.
 */
export const VOICE_RESEARCH_WEBHOOKS = Object.freeze([
  Object.freeze({
    name: 'web_search',
    description: RESEARCH_TOOLS.find((t) => t.name === 'web_search').description,
    required: Object.freeze(['query']),
    properties: Object.freeze({
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'integer', description: 'Max results 1-10' },
    }),
    handler: 'research',
  }),
  Object.freeze({
    name: 'web_scrape',
    description: RESEARCH_TOOLS.find((t) => t.name === 'web_scrape').description,
    required: Object.freeze(['url']),
    properties: Object.freeze({
      url: { type: 'string', description: 'https URL to scrape' },
    }),
    handler: 'research',
  }),
  dashboard(
    'browser_open',
    RESEARCH_TOOLS.find((t) => t.name === 'browser_open').description,
    ['botId'],
    {
      botId,
      purpose: { type: 'string', description: 'Short purpose' },
      url: { type: 'string', description: 'Optional https URL' },
    },
    [call('POST', '/bots/:botId/browser/sessions', { body: ['purpose', 'url'] })],
  ),
  dashboard(
    'browser_navigate',
    RESEARCH_TOOLS.find((t) => t.name === 'browser_navigate').description,
    ['botId', 'url'],
    {
      botId,
      sessionRecordId: { type: 'string', description: 'Optional when only one session is open' },
      url: { type: 'string', description: 'https URL' },
    },
    [call('POST', '/bots/:botId/browser/sessions/:sessionRecordId/navigate', { body: ['url'] })],
  ),
  dashboard(
    'browser_live_view',
    'Mint Live View for the owner UI. The result never includes the viewer URL.',
    ['botId', 'sessionRecordId'],
    {
      botId,
      sessionRecordId: { type: 'string', description: 'Session record id' },
    },
    [call('POST', '/bots/:botId/browser/sessions/:sessionRecordId/live-view')],
  ),
  dashboard(
    'browser_release',
    RESEARCH_TOOLS.find((t) => t.name === 'browser_release').description,
    ['botId', 'sessionRecordId'],
    {
      botId,
      sessionRecordId: { type: 'string', description: 'Session record id' },
    },
    [call('POST', '/bots/:botId/browser/sessions/:sessionRecordId/release')],
  ),
]);
