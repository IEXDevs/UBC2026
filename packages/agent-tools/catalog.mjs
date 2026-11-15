/**
 * Shared agent tool surface for text chat and voice.
 * Research/browser tools come from @ubc2026/browser-session.
 * Dashboard tools call the same owner HTTP routes the UI uses.
 */
import { agentTools } from '@ubc2026/browser-session';

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
    'List wallets and balances for this owner. Read balances.displayBalanceLabel aloud (Solana-devnet SOL and/or USDC). Also returns solBalanceLabel, usdcBalanceLabel, and platformUsdcLabel when available. Cluster is Solana devnet — not mainnet.',
    [],
    {},
    [call('GET', '/api/wallets')],
  ),
  dashboard('get_overview', 'Overview metrics, including PnL.', [], {}, [call('GET', '/api/metrics')]),
  dashboard('get_activity', 'Recent activity for one bot.', ['botId'], { botId }, [
    call('GET', '/api/events', { query: ['botId'] }),
  ]),
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
  dashboard('start_task', 'Start the research / decide / approval loop for one bot.', ['botId'], {
    botId,
    goal: { type: 'string', description: 'Optional goal text' },
  }, [call('POST', '/bots/:botId/loop', { body: ['goal'] })]),
  dashboard('list_browser_sessions', 'List open browser sessions for a bot.', ['botId'], { botId }, [
    call('GET', '/bots/:botId/browser/sessions'),
  ]),
  dashboard('stop_all', 'Pause every listed bot. Say "Stopping all bots now" before calling.', [], {}, [
    call('GET', '/api/bots'),
    call('POST', '/bots/:botId/pause'),
  ]),
  dashboard('prepare_shopping', 'Prepare an x402 sandbox or Laso shopping purchase. Does not sign.', ['botId'], {
    botId,
    provider: { type: 'string', description: 'sandbox or laso' },
  }, [call('POST', '/bots/:botId/shopping/prepare', { body: ['provider'] })]),
  dashboard('sns_send', 'Resolve a .sol name and build a send intent. Does not sign unless an executor is injected.', ['botId'], {
    botId,
    domain: { type: 'string', description: 'SNS domain like alex.sol' },
    amount: { type: 'string', description: 'Base-unit amount string' },
    from: { type: 'string', description: 'Sender pubkey' },
  }, [call('POST', '/bots/:botId/sns/send', { body: ['domain', 'amount', 'from'] })]),
]);

/** Research + browser tools shared with text chat. */
export const RESEARCH_TOOLS = agentTools;

/**
 * Full shared catalog. Voice also keeps legacy aliases
 * (open_browser_session / release_browser_session) that map to the same routes.
 */
export const SHARED_AGENT_TOOLS = Object.freeze([
  ...RESEARCH_TOOLS,
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
    'You have the same tools on text and voice: web_search, web_scrape, browser_open, browser_navigate, browser_live_view, browser_release, plus dashboard tools (list_bots, get_bot_status, get_wallets, get_overview, get_activity, why_decision, get_payment_feed, pause_bot, resume_bot, wake_bot, start_task, list_browser_sessions, stop_all, prepare_shopping, sns_send).',
    'When the owner asks you to look something up: call web_search first, pick a real https result url, then browser_navigate (or browser_open with that url).',
    'Do not invent balances, positions, or decisions — call get_wallets and use balances.displayBalanceLabel (devnet SOL and/or USDC).',
    'Never claim you lack a browser while these tools are available.',
    'browser_live_view never returns a viewer URL to you — the owner Live View panel shows it.',
    'Do not send funds, approve spends, raise limits, or freeze wallets from tools. Those stay on the app approval UI.',
    'If a tool returns not_configured or an error code, tell the owner which secret or Worker setting is missing.',
  ].join('\n');
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
