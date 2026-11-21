import { EXECUTION_LABEL, SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
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
    `List this owner’s SOL and SPL balances. Execution uses Solana ${SOLANA_CLUSTER}. Read balances.displayBalanceLabel and use holdings or tokens for network labels.`,
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
  dashboard('start_task', 'Start the checkpointed research and decision loop. A trade proposal waits for the owner to review and approve it in the desk.', ['botId'], {
    botId,
    goal: { type: 'string', description: 'Optional goal text' },
  }, [call('POST', '/bots/:botId/loop', { body: ['goal'] })]),
  dashboard(
    'create_loop',
    'Start a loop that wakes this bot again after a cooldown so it can check positions or do the stored purpose. The purpose is stored with the loop. cooldownMinutes is minutes and the minimum is 15. A shorter cooldown is rejected. The wake still goes through the decision gate before any spend. Execution stays on configured Solana network.',
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
  dashboard('prepare_shopping', 'Prepare a purchase, not a payment. For Laso pass provider laso, a lasoAction, and amountUsd. setup is a new USA prepaid card ($5–$1000). modify tops up the reloadable balance ($5–$10000). intl is an international prepaid card (whole dollars $100–$1000 plus fee). gift is a brand gift card (amount in the product currency; pass laso_server_id and country). A new reloadable card is never a quote: it needs KYC plus a card-issuer code plus funding first. Buy only with request_spend action x402 and the returned lasoTicket; NEVER send a plain transfer to Laso payTo.', ['botId'], {
    botId,
    provider: { type: 'string', description: 'sandbox or laso' },
    lasoAction: { type: 'string', description: 'setup follows GET /get-card. modify follows GET /fund-card-balance. intl follows GET /order-intl-card. gift follows GET /order-gift-card. All are x402 quotes.' },
    amountUsd: { type: ['number', 'string'], description: 'USD amount ($5–$1000 setup, $5–$10000 modify, whole $100–$1000 intl) or gift face value in the product currency. Defaults to 5 only when omitted.' },
    laso_server_id: { type: 'string', description: 'Gift product id from the Laso catalog (for example amazon). Required for gift.' },
    country: { type: 'string', description: 'Two-letter country for gift (defaults to US). Determines the product currency.' },
  }, [call('POST', '/bots/:botId/shopping/prepare', { body: ['provider', 'lasoAction', 'amountUsd', 'laso_server_id', 'country'] })]),
  dashboard('laso_checkpoint', 'Save or read this bot’s Laso fulfillment checkpoint: where the flow paused for the owner and what resumes it. Save one whenever a Laso flow pauses for the owner; read it when the owner confirms and continue from that stage instead of restarting. Facts only: kind, stage, amount, product, card id. Never store links, tokens, numbers, or codes.', ['botId'], {
    botId,
    stage: { type: 'string', description: 'quoted, paid, waiting-owner, or verifying' },
    kind: { type: 'string', description: 'non-reloadable-usa, reloadable, intl, gift, top-up, or undecided' },
    amountUsd: { type: ['number', 'string'], description: 'Face value in USD, or in the gift product currency' },
    laso_server_id: { type: 'string', description: 'Gift product id' },
    country: { type: 'string', description: 'Two-letter gift country' },
    card_id: { type: 'string', description: 'Laso card or order id once one exists' },
    note: { type: 'string', description: 'Short owner-safe status note, no secrets' },
    restart: { type: 'boolean', description: 'True to start a new flow when the owner changes their mind' },
    close: { type: 'boolean', description: 'True to close the flow' },
    ok: { type: 'boolean', description: 'False when closing a failed flow' },
  }, [call('POST', '/bots/:botId/laso/checkpoint', { body: ['stage', 'kind', 'amountUsd', 'laso_server_id', 'country', 'card_id', 'note', 'restart', 'close', 'ok'] }), call('GET', '/bots/:botId/laso/checkpoint')]),
  dashboard('laso_status', 'Live Laso read for this bot using its saved session: one card, the card lists, the account balance, or recent top-ups. Use it to verify a stage when the owner confirms, instead of asking them to retype anything. Numbers and statuses only; card numbers and CVVs stay on the owner dashboard link. A laso_session_expired error means the session lapsed: say so and point at the dashboard link, do not retry in a loop.', ['botId'], {
    botId,
    view: { type: 'string', description: 'card, account, or topups' },
    card_id: { type: 'string', description: 'Single card or order id' },
    card_type: { type: 'string', description: 'Non-Reloadable U.S., Non-Reloadable International, or Reloadable' },
  }, [call('GET', '/bots/:botId/laso/status', { query: ['view', 'card_id', 'card_type'] })]),
  dashboard(
    'request_spend',
    'Use swap for a live Solana trade in the agent’s assigned wallet. Pass the input asset, exact input amount in base units, and outputAsset. The owner sees the quote and approves it in the desk. Use pay or spend with a destination for transfers. USD budgets account for SOL and routable token mints.',
    ['botId', 'action', 'amount', 'asset'],
    {
      botId,
      action: { type: 'string', description: 'swap, spend, pay, or x402. Laso cards MUST use x402 with lasoTicket, never a plain spend/pay to payTo. Always requires owner confirmation.' },
      lasoTicket: { type: 'string', description: 'Exact signed ticket returned by prepare_shopping for a Laso card. For x402 use USDC and its proposal outflow as amount; omit destination.' },
      amount: { type: 'string', description: 'Integer base units of the asset. Use lamports for SOL (1 SOL = 1000000000). Use the verified mint decimals for an SPL token.' },
      destination: { type: 'string', description: 'Destination Solana address or .sol SNS domain' },
      domain: { type: 'string', description: 'SNS domain like alex.sol' },
      handle: { type: 'string', description: 'Maelstrom handle without @' },
      asset: { type: 'string', description: 'Input asset. Use USDC, SOL, or the exact Solana token mint address.' },
      outputAsset: { type: 'string', description: 'For swaps only. Use USDC, SOL, or the exact output token mint.' },
      quoteCluster: { type: 'string', description: 'mainnet or solana. A mainnet quote never authorizes a transaction.' },
    },
    [call('POST', '/api/spend', { body: ['botId', 'action', 'amount', 'destination', 'domain', 'handle', 'asset', 'outputAsset', 'quoteCluster', 'idempotencyKey', 'lasoTicket'] })],
  ),
  dashboard(
    'lookup_recipient',
    'Resolve a wallet address, @handle, or .sol SNS name to a pubkey via the profiles lookup API. Use this for richclub.sol, @alex, or a base58 address. Never web_search for .sol names or handles. Read-only. Does not sign or spend.',
    ['q'],
    {
      q: {
        type: 'string',
        description: 'A sentence or a spoken name. @Mommy Milkers is the handle mommymilkers. Letters and numbers only, lowercased. Or name.sol.',
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
    description: `Look up a mainnet USD price for one Solana mint. DexScreener first; Jupiter Price API v3 only if DexScreener fails. Paper PnL. The quote is labeled ${EXECUTION_LABEL}. It does not sign, broadcast, or authorize a transaction. Execution stays on the configured Solana network.`,
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
    'You have the following tools: web_search, web_scrape, browser_open, browser_navigate, browser_click, browser_live_view, browser_release, get_price, plus dashboard tools (list_bots, get_bot_status, get_wallets, get_overview, get_activity, what_happened_while_away, why_decision, get_payment_feed, pause_bot, resume_bot, wake_bot, start_task, create_loop, set_loop_cooldown, break_loop, list_browser_sessions, stop_all, prepare_shopping, laso_checkpoint, laso_status, request_spend, lookup_recipient, sns_send).',
    'create_loop stores a purpose and a cooldown of at least 15 minutes, then starts this bot again after that cooldown. set_loop_cooldown changes that cooldown. A shorter cooldown is rejected. A loop wake still goes through the decision gate before any spend.',
    'Call break_loop only when the owner explicitly asks to break, stop, or cancel the loop. Do not break a loop on your own.',
    'When the owner asks what happened while they were away, call what_happened_while_away and read briefing.spoken. Pass the current botId for questions about this agent. For a question about whether a loop ran, use get_bot_status and check cardLoop.lastWakeAt and lastGate. A saved schedule alone does not establish that a check ran.',
    `For a token price, call get_price. It reads DexScreener, then Jupiter Price API v3. The quote is paper PnL labeled ${EXECUTION_LABEL}. It does not sign, broadcast, or authorize a transaction. Execution stays on the configured Solana network.`,
    'Use get_price to research an exact mint. For a specific live trade call request_spend with action swap, the input amount in base units, and both asset identifiers. Use start_task when the owner asks you to find a trade. The desk quotes and confirms those real swaps with the owner. Report a swap as submitted only if the spend API returned a transaction signature.',
    'request_spend posts the shared spend route. A locked desk is not an approval hold and does not replace trust, verify, reserve, or the permission gate. Fully-automatic still runs those gates. 1000000 is 1 USDC in base units. For swaps the output goes to the assigned wallet. Do not pass a destination, handle, or price quote for a swap.',
    'For a Laso question, fetch the live Laso docs yourself instead of answering from memory: web_scrape https://laso.finance/SKILL.md first, then only the reference the task needs (payments, cards, gift-cards, payouts, banking, account, wallet-native under https://laso.finance/skills/laso-finance/references/), and re-check https://laso.finance/.well-known/docs-version.json when your cached copy may be stale. Never invent endpoints, amounts, or limits.',
    'For a Laso card ask reloadable or non-reloadable USA first when the owner does not say; never default to prepaid. Use /laso-cards for the full flow. lasoAction setup quotes a USA prepaid card and modify quotes a reloadable top-up; intl quotes an international prepaid card and gift quotes a brand gift card, both fee-bearing. A new reloadable card is KYC plus a card-issuer code plus funding, then creation: the owner completes every link and code step, you only hand links over and poll status. Preparation is NOT a purchase. Buy only with request_spend action x402, asset USDC, the exact proposed outflow and lasoTicket; the owner confirms the purchase. NEVER send a plain transfer to Laso payTo. Only report a purchase after a settlement signature is returned. A pending or queued card is not ready yet: poll USA cards every 2-3 seconds to ready, keep polling international cards with the same id, and confirm top-ups are credited before creating a card. The owner sees numbers and codes on the Laso dashboard link. Do not ask for or repeat the card number or CVV.',
    'Whenever a Laso flow pauses for the owner (choice, KYC, issuer code, approval, redemption form), save a laso_checkpoint with the kind, stage, and card id, and tell them to reply done when finished. When they confirm, read the checkpoint and continue from that stage with laso_status to verify: never restart the flow, never ask for facts the checkpoint already holds. Memory for the user lives in the checkpoint, not in your reply.',
    'When the owner names a .sol SNS domain, an @handle, or a wallet address, call lookup_recipient with q set to that token. It hits GET /api/profiles/lookup (SNS resolve or handle directory). Never web_search for .sol names or handles. Speak the resolved address as first5...last5.',
    'When the owner asks for a fact, including the latest model or its price on a named site: call web_search once and answer from that result. Do not call browser_open, browser_navigate, browser_click, browser_live_view, or delegate_task for that fact. Call web_scrape only when the search result does not already contain the fact.',
    'When the owner asks you to open or use a specific website for a form or a task on that site: browser_open, then browser_navigate to that https URL. Prefer a direct URL over searching. Use browser_click with a CSS selector to press buttons and follow flows; the owner watches the cursor move in Live View. A fact question that names a site stays on web_search.',
    'Work a browser task to completion: open, navigate, click, then read the next tool result before replying. If a click returns a new state, keep going instead of stopping after the first page load.',
    'For a Laso gift card pass provider laso with lasoAction gift, the exact laso_server_id from the catalog, the country, and the amount in the product currency; the x402 total includes the product fee. For Laso pass the owner’s requested amountUsd unchanged; never reduce it to the wallet balance. Let spend simulation report insufficient funds. Preparation opens the ticket-bound purchase confirmation directly: do not ask for another yes or prepare again on approval. Never use payTo as a plain transfer destination. Do not open a browser for the card or its claim link.',
    'When the owner asks for open-web research (not a .sol, handle, or wallet): call web_search first, pick a real https result url, then web_scrape. search_not_configured and client_missing mean FIRECRAWL_API_KEY or the research client is not configured. provider_failed means Firecrawl returned a server error. Do not invent search results.',
    'When the prompt lists an owner situation, fold that place and local date into web_search queries and into search or map pages you open. Do that for weather, hours, events, local news, and "near me", "today", "tonight", or "this weekend". Leave the place off other searches. Do not invent a city when place is not set.',
    'Do not invent balances, positions, or decisions — call get_wallets and read balances.balanceStatus / balances.ok / balances.displayBalanceLabel / holdings. If balanceStatus is failed or balances.ok is false, say balances could not be read (use the unavailable label). Never claim "no open positions" or "0 SOL" from a failed or partial read. Empty success means holdings is empty and balanceStatus is empty or ok with zero amounts.',
    'Never claim you lack a browser while these tools are available.',
    'browser_live_view never returns a viewer URL to you — the owner Live View panel shows it. After browser_click, report what the click did from the tool result, not from a guessed page.',
    'Fund movements use request_spend. Execution stays on configured Solana network.',
    'When request_spend or sns_send returns a signature, the next message includes the Solscan URL on solscanUrl. Send that message in the same turn. Do not wait for the owner to ask again.',
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
    if (event.kind === 'run.checkpoint' && event.id.startsWith('evt_loop_') && event.summary) return event.summary;
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
    'browser_click',
    RESEARCH_TOOLS.find((t) => t.name === 'browser_click').description,
    ['botId', 'selector'],
    {
      botId,
      sessionRecordId: { type: 'string', description: 'Optional when only one session is open' },
      selector: { type: 'string', description: 'CSS selector for the element to click' },
    },
    [call('POST', '/bots/:botId/browser/sessions/:sessionRecordId/click', { body: ['selector'] })],
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

export {
  AGENT_SKILLS,
  AVAILABLE_SKILLS,
  parseSkillCommand,
  skillById,
  skillInstruction,
  skillsCatalogInstruction,
} from './skills.mjs';
export { HARNESS_TOOLS, HARNESS_TOOL_NAMES, harnessInstruction } from './harness.mjs';
export {
  applySituation,
  groundBrowseUrl,
  groundSearchQuery,
  normalizeSituation,
  situationFromEdge,
  situationInstruction,
} from './situation.mjs';
