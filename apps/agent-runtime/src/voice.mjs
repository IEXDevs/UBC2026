/**
 * ElevenLabs voice agent.
 * Custom LLM is Meta Muse Spark 1.3 Contributor via Meta Model API (or OpenRouter
 * fallback). ElevenLabs calls this Worker; the Worker streams chat completions.
 * Webhook tools call the same bot, event, wallet, and browser routes as the UI.
 * No secret values are written into the agent payload.
 */
import { timingSafeEqual } from 'node:crypto';
import { SECRET_NAMES } from '@ubc2026/contracts';
import { createScrape, createSearch } from '@ubc2026/browser-search';
import {
  DASHBOARD_TOOLS,
  PRICE_TOOLS,
  VOICE_BROWSER_ALIASES,
  VOICE_RESEARCH_WEBHOOKS,
  parseAwaySince,
  sharedToolsInstruction,
  spokenAwayBriefing,
} from '@ubc2026/agent-tools';
import { readAgentPriceQuote } from '@ubc2026/prices';
import { META_SPARK_MODEL, resolveModelProvider } from './openrouter.mjs';

export const DEFAULT_VOICE_MODEL = META_SPARK_MODEL;
/** @deprecated Prefer DEFAULT_VOICE_MODEL — kept for older imports. */
export const GROK_VOICE_MODEL = DEFAULT_VOICE_MODEL;
export const OPENROUTER_CHAT_COMPLETIONS = 'https://api.meta.ai/v1/chat/completions';
const WEBHOOK_HEADER = 'x-elevenlabs-webhook-secret';
const SECRET_PLACEHOLDER = '{{ELEVENLABS_WEBHOOK_SECRET}}';
const ID = /^[a-zA-Z0-9:_-]{1,128}$/;
const OWNER_ID = /^[a-zA-Z0-9:_.-]{1,256}$/;
const MODEL_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

/** conversation_id → ownerId for the life of this isolate (plus Cache API when available). */
const voiceOwners = new Map();

export function ownerPermissionNote(value) {
  if (value === 'full') {
    return 'The owner set full permissions and let you manage funds. Do not ask whether they are going to buy, sell, spend, or pay. Infer the action and call request_spend. A mainnet price quote never authorizes a transaction. Execution stays on Solana devnet.';
  }
  if (value === 'review') {
    return 'The owner set review by AI. State what would change and wait before a trade or a spend. If the fund action is ambiguous, ask whether they mean buy, sell, spend, or pay. A transaction is not sent until they confirm.';
  }
  if (value === 'ask') {
    return 'The owner set ask every time. Ask before a trade or a spend. If it is ambiguous, ask whether they mean buy, sell, spend, or pay. Do not call request_spend until they confirm.';
  }
  return '';
}

export const VOICE_SYSTEM_PROMPT = [
  'You are the voice remote for this user\'s Maelstrom Solana agent dashboard.',
  'Prefer short confirmations.',
  'Always name the active bot before an action. If it is unclear, call list_bots and ask.',
  'Never invent balances, addresses, trust scores, positions, or decisions. Call get_wallets and read balances.displayBalanceLabel / holdings (whatever non-zero SOL or SPL is on the address).',
  'If a tool result has stub set to true, or items is empty, say the data is not available yet. Do not fill the gap.',
  'Pause and resume affect one bot. stop_all pauses every bot the list route returns. Before stop_all, say "Stopping all bots now".',
  'Pause, resume, and stop_all only make the fleet safer.',
  'Fund movements go through request_spend only. That route runs trust, verify, wallet freeze, bot policy, approval mode, then sign on Solana devnet. A mainnet price quote never authorizes a transaction.',
  'When the owner set full permissions, they let you manage funds. Do not ask whether they are going to buy, sell, spend, or pay.',
  'In ask or review, wait for the owner before request_spend. Do not raise limits or freeze wallets from tools.',
  'Do not ask for seed phrases, private keys, passwords, or API keys.',
  'Never read out Live View URLs, tokens, or secrets. If a tool hides them, leave them hidden.',
  'If a tool returns confirmation-required or manual-review, say so and stop.',
  'When the owner asks what happened while they were away, call what_happened_while_away and read briefing.spoken. Do not invent events. That tool only reads stored timeline events. It does not spend or sign.',
  'Execution stays on Solana devnet.',
  sharedToolsInstruction(),
].join('\n');

function toVoiceTool(def) {
  const required = Array.isArray(def.required)
    ? def.required
    : (Array.isArray(def.parameters?.required) ? def.parameters.required : []);
  const properties = def.properties
    || Object.fromEntries(
      Object.entries(def.parameters?.properties || {}).map(([key, schema]) => {
        const next = { type: schema.type, description: schema.description || key };
        if (schema.minimum != null) next.minimum = schema.minimum;
        if (schema.maximum != null) next.maximum = schema.maximum;
        return [key, next];
      }),
    );
  return Object.freeze({
    name: def.name,
    description: def.description,
    required: Object.freeze([...required]),
    properties: Object.freeze({ ...properties }),
    calls: Object.freeze(def.voiceCalls || def.calls || []),
    handler: def.handler || 'http',
  });
}

/**
 * Same capabilities as text chat: research/browser + dashboard tools.
 * Legacy open_browser_session / release_browser_session aliases remain.
 */
export const VOICE_TOOLS = Object.freeze([
  ...VOICE_RESEARCH_WEBHOOKS.map(toVoiceTool),
  ...PRICE_TOOLS.map(toVoiceTool),
  ...DASHBOARD_TOOLS.map(toVoiceTool),
  ...VOICE_BROWSER_ALIASES.map(toVoiceTool),
]);

export function grokVoiceModel(env = {}) {
  const override = typeof env.OPENROUTER_MODEL_VOICE === 'string' ? env.OPENROUTER_MODEL_VOICE.trim() : '';
  if (MODEL_ID.test(override) && override.length <= 128) return override;
  return resolveModelProvider(env).defaultModel || DEFAULT_VOICE_MODEL;
}

export function voiceChatCompletionsUrl(env = {}) {
  const resolved = resolveModelProvider(env);
  return `${resolved.baseUrl}/chat/completions`;
}

function modelApiKey(env = {}) {
  return resolveModelProvider(env).apiKey;
}

function webhookHeaders() {
  return Object.freeze({
    [WEBHOOK_HEADER]: SECRET_PLACEHOLDER,
    'x-owner-id': '{{owner_id}}',
    'x-spend-permission': '{{spend_permission}}',
  });
}

export function voiceAgentCreateBody({ origin, modelId = DEFAULT_VOICE_MODEL } = {}) {
  const base = String(origin ?? '').replace(/\/$/, '');
  return {
    name: 'Maelstrom operator',
    conversation_config: {
      agent: {
        prompt: {
          prompt: VOICE_SYSTEM_PROMPT,
          llm: 'custom-llm',
          custom_llm: {
            url: `${base}/voice/llm/chat/completions`,
            model_id: modelId,
            api_type: 'chat_completions',
            request_headers: { [WEBHOOK_HEADER]: SECRET_PLACEHOLDER },
          },
          tools: VOICE_TOOLS.map(item => ({
            type: 'webhook',
            name: item.name,
            description: item.description,
            response_timeout_secs: 20,
            api_schema: {
              url: `${base}/voice/tools/${item.name}`,
              method: 'POST',
              request_headers: { ...webhookHeaders() },
              request_body_schema: {
                type: 'object',
                properties: { ...item.properties },
                required: [...item.required],
              },
            },
          })),
        },
      },
    },
  };
}

export function voiceAgentSpec(request, env = {}) {
  const origin = new URL(request.url).origin;
  const modelId = grokVoiceModel(env);
  return {
    product: 'Maelstrom',
    llm: {
      provider: 'custom-llm',
      modelId,
      upstream: voiceChatCompletionsUrl(env),
      streaming: true,
      apiKeyIncluded: false,
    },
    tools: VOICE_TOOLS.map(item => ({
      name: item.name,
      calls: item.calls.map(entry => ({ method: entry.method, path: entry.path })),
    })),
    elevenlabs: voiceAgentCreateBody({ origin, modelId }),
  };
}

/**
 * Create the agent in ElevenLabs when a key is present. Tests inject fetcher.
 * Returns elevenlabs_not_configured and does not call the network when the key is empty.
 */
export async function provisionVoiceAgent({ env = {}, origin, fetcher = fetch } = {}) {
  const apiKey = typeof env.ELEVENLABS_API_KEY === 'string' ? env.ELEVENLABS_API_KEY.trim() : '';
  if (!apiKey) return { ok: false, error: 'elevenlabs_not_configured', network: false };
  const body = voiceAgentCreateBody({ origin, modelId: grokVoiceModel(env) });
  const serialized = JSON.stringify(body);
  if (serialized.includes(apiKey)) return { ok: false, error: 'secret_in_payload', network: false };
  let response;
  try {
    response = await fetcher('https://api.elevenlabs.io/v1/convai/agents/create', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: serialized,
    });
  } catch {
    return { ok: false, error: 'elevenlabs_unavailable', network: true };
  }
  if (!response?.ok) return { ok: false, error: 'elevenlabs_failed', status: response?.status ?? 502, network: true };
  const data = await response.json().catch(() => ({}));
  const agentId = typeof data?.agent_id === 'string' ? data.agent_id : null;
  return { ok: Boolean(agentId), error: agentId ? undefined : 'elevenlabs_invalid_response', agentId, network: true };
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

function presentedSecret(request) {
  const header = request.headers.get(WEBHOOK_HEADER);
  if (typeof header === 'string' && header !== '') return header;
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(authorization);
  return match ? match[1] : '';
}

function secretMatches(expected, presented) {
  const left = Buffer.from(typeof expected === 'string' ? expected : '');
  const right = Buffer.from(typeof presented === 'string' ? presented : '');
  if (left.length === 0) return false;
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

function authorize(request, env) {
  const expected = typeof env.ELEVENLABS_WEBHOOK_SECRET === 'string' ? env.ELEVENLABS_WEBHOOK_SECRET : '';
  if (expected.trim() === '') return json({ error: 'elevenlabs_webhook_not_configured' }, 503);
  if (!secretMatches(expected, presentedSecret(request))) return json({ error: 'unauthorized' }, 401);
  return null;
}

function readOwnerCandidate(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('{{') || trimmed.includes('}}')) return null;
  if (!OWNER_ID.test(trimmed)) return null;
  return trimmed;
}

function ownerIdFromHeader(request) {
  return readOwnerCandidate(request.headers.get('x-owner-id'));
}

function ownerIdFromBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const direct = readOwnerCandidate(body.owner_id) || readOwnerCandidate(body.ownerId);
  if (direct) return direct;
  const dyn = body.dynamic_variables && typeof body.dynamic_variables === 'object'
    ? body.dynamic_variables
    : null;
  if (dyn) {
    const fromDyn = readOwnerCandidate(dyn.owner_id) || readOwnerCandidate(dyn.ownerId);
    if (fromDyn) return fromDyn;
  }
  const parameters = body.parameters && typeof body.parameters === 'object' && !Array.isArray(body.parameters)
    ? body.parameters
    : null;
  if (parameters) {
    return readOwnerCandidate(parameters.owner_id) || readOwnerCandidate(parameters.ownerId);
  }
  return null;
}

function voiceOwnerCacheKey(conversationId) {
  return new Request(`https://maelstrom.voice/owner/${encodeURIComponent(conversationId)}`);
}

async function rememberVoiceOwner(conversationId, owner) {
  voiceOwners.set(conversationId, owner);
  try {
    if (typeof caches === 'undefined' || !caches?.default?.put) return;
    await caches.default.put(
      voiceOwnerCacheKey(conversationId),
      new Response(owner, {
        headers: { 'cache-control': 'max-age=86400', 'content-type': 'text/plain;charset=utf-8' },
      }),
    );
  } catch {
    // Isolate map is enough for same-worker tool calls after bind.
  }
}

async function recallVoiceOwner(conversationId) {
  if (voiceOwners.has(conversationId)) return voiceOwners.get(conversationId);
  try {
    if (typeof caches === 'undefined' || !caches?.default?.match) return null;
    const hit = await caches.default.match(voiceOwnerCacheKey(conversationId));
    if (!hit) return null;
    const text = readOwnerCandidate(await hit.text());
    if (text) voiceOwners.set(conversationId, text);
    return text;
  } catch {
    return null;
  }
}

function parameterBag(body, name) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_body' };
  if (typeof body.tool_name === 'string' && body.tool_name !== name) return { error: 'tool_name_mismatch' };
  const parameters = body.parameters && typeof body.parameters === 'object' && !Array.isArray(body.parameters)
    ? body.parameters
    : body;
  return { parameters, conversationId: typeof body.conversation_id === 'string' ? body.conversation_id.slice(0, 128) : undefined };
}

function fillPath(path, parameters) {
  return path.replace(/:([a-zA-Z]+)/g, (_, key) => {
    const value = parameters[key];
    if (!ID.test(value)) return '';
    return encodeURIComponent(value);
  });
}

function requestFor(entry, parameters, owner) {
  const path = fillPath(entry.path, parameters);
  if (path === '' || path.includes('/:')) return null;
  const url = new URL(path, 'https://runtime.internal');
  for (const key of entry.query) {
    if (parameters[key] != null && parameters[key] !== '') url.searchParams.set(key, String(parameters[key]));
  }
  const init = {
    method: entry.method,
    headers: { 'x-owner-id': owner, accept: 'application/json' },
  };
  if (entry.method !== 'GET') {
    const body = {};
    for (const key of entry.body) {
      if (typeof parameters[key] !== 'string' || parameters[key].trim() === '') continue;
      const max = key === 'url' || key === 'goal' ? 2000 : 256;
      body[key] = parameters[key].trim().slice(0, max);
    }
    if (entry.path.endsWith('/browser/sessions') && body.purpose == null) body.purpose = 'browse';
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

const HIDDEN_KEY = /viewerurl|token|authorization|apikey|api_key|secret|seed|privatekey|private_key|password|jwt/i;

function knownSecrets(env) {
  return SECRET_NAMES.map(name => env?.[name]).filter(value => typeof value === 'string' && value.length >= 8);
}

function redactString(value, secrets) {
  let text = value.length > 500 ? value.slice(0, 500) : value;
  for (const secret of secrets) text = text.split(secret).join('[hidden]');
  return text
    .replace(/https?:\/\/live\.browser\.run\S*/gi, '[hidden]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[hidden]');
}

function redact(value, secrets, depth = 0) {
  if (depth > 6) return '[hidden]';
  if (typeof value === 'string') return redactString(value, secrets);
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 8).map(item => redact(item, secrets, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (HIDDEN_KEY.test(key)) continue;
      out[key] = redact(item, secrets, depth + 1);
    }
    return out;
  }
  return null;
}

async function speakable(response, secrets) {
  const status = response.status;
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  const body = redact(payload, secrets);
  const encoded = JSON.stringify(body);
  return {
    status,
    stub: payload?.stub === true,
    body: encoded.length > 4000 ? { truncated: true, stub: payload?.stub === true } : body,
  };
}

async function runPriceTool(parameters, env) {
  const rawKey = env.JUPITER_API_KEY;
  const apiKey = typeof rawKey === 'string' && rawKey.trim() ? rawKey.trim() : null;
  try {
    const quote = await readAgentPriceQuote(parameters.mint, {
      fetcher: typeof env.fetch === 'function' ? env.fetch : fetch,
      apiKey,
    });
    return { handler: 'price', quote };
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'price_unavailable';
    return { error: code };
  }
}

async function runResearchTool(name, parameters, env) {
  const secrets = knownSecrets(env);
  try {
    if (name === 'web_search') {
      const search = createSearch({ apiKey: env.FIRECRAWL_API_KEY, fetcher: fetch });
      const limit = Number.isInteger(parameters.limit) ? parameters.limit : 5;
      const results = await search(parameters.query, limit);
      return { handler: 'research', results: redact(results, secrets) };
    }
    if (name === 'web_scrape') {
      const scrape = createScrape({ apiKey: env.FIRECRAWL_API_KEY, fetcher: fetch });
      const page = await scrape(parameters.url);
      return { handler: 'research', page: redact(page, secrets) };
    }
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'voice_api_failed';
    return { error: code };
  }
  return { error: 'unknown_tool' };
}

async function resolveSessionId(parameters, owner, fetchApi, env) {
  if (typeof parameters.sessionRecordId === 'string' && ID.test(parameters.sessionRecordId)) {
    return parameters.sessionRecordId;
  }
  if (!ID.test(parameters.botId)) return '';
  const listRequest = requestFor(
    { method: 'GET', path: '/bots/:botId/browser/sessions', query: [], body: [] },
    { botId: parameters.botId },
    owner,
  );
  if (!listRequest) return '';
  const listed = await fetchApi(listRequest, env);
  const payload = await listed.json().catch(() => ({}));
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  const open = sessions.filter((row) => row?.status === 'open' && ID.test(row.sessionRecordId));
  return open[0]?.sessionRecordId || '';
}

function trustedSpendPermission(value) {
  return value === 'ask' || value === 'review' || value === 'full' ? value : 'ask';
}

async function runCalls(toolDef, parameters, owner, fetchApi, env, options = {}) {
  const secrets = knownSecrets(env);
  if (toolDef.name === 'what_happened_while_away') {
    const entry = toolDef.calls[0];
    const outbound = requestFor(entry, parameters, owner);
    if (!outbound) return { error: 'invalid_parameters' };
    const response = await fetchApi(outbound, env);
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    const rawItems = Array.isArray(payload?.items) ? payload.items : [];
    const items = rawItems.map((item) => ({
      ...item,
      summary: typeof item?.summary === 'string' ? redactString(item.summary, secrets) : item?.summary,
    }));
    const briefing = spokenAwayBriefing(items, {
      since: parameters.since,
      source: payload?.source,
      botId: parameters.botId,
      unavailable: response.status >= 400,
    });
    return {
      calls: [{ method: entry.method, path: entry.path, status: response.status }],
      briefing,
    };
  }
  if (toolDef.name === 'stop_all') {
    const listRequest = requestFor(toolDef.calls[0], parameters, owner);
    const listed = await fetchApi(listRequest, env);
    const summary = await speakable(listed, secrets);
    const items = Array.isArray(summary.body?.items) ? summary.body.items : [];
    const paused = [];
    for (const item of items) {
      const id = item && typeof item.id === 'string' ? item.id : '';
      if (!ID.test(id)) continue;
      const pauseRequest = requestFor(toolDef.calls[1], { botId: id }, owner);
      const result = await fetchApi(pauseRequest, env);
      paused.push({ botId: id, status: result.status });
    }
    return { calls: toolDef.calls.map(entry => ({ method: entry.method, path: entry.path })), list: summary, paused };
  }
  let params = { ...parameters };
  if (toolDef.name === 'request_spend') {
    const body = {
      botId: params.botId,
      action: params.action,
      amount: params.amount,
      permission: trustedSpendPermission(options.spendPermission),
      confirmed: false,
    };
    if (typeof params.destination === 'string') body.destination = params.destination;
    if (typeof params.handle === 'string') body.handle = params.handle;
    if (typeof params.asset === 'string') body.asset = params.asset;
    if (params.quoteCluster === 'mainnet') {
      body.quote = { pricingCluster: 'mainnet', paperPnl: true, authorizesTransaction: false };
    }
    const outbound = new Request('https://runtime.internal/api/spend', {
      method: 'POST',
      headers: {
        'x-owner-id': owner,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const response = await fetchApi(outbound, env);
    return {
      calls: [{ method: 'POST', path: '/api/spend', ...(await speakable(response, secrets)) }],
    };
  }
  if (
    (toolDef.name === 'browser_navigate' || toolDef.name === 'browser_live_view' || toolDef.name === 'browser_release')
    && !ID.test(params.sessionRecordId || '')
  ) {
    params.sessionRecordId = await resolveSessionId(params, owner, fetchApi, env);
    if (!ID.test(params.sessionRecordId || '')) return { error: 'session_not_found' };
  }
  const results = [];
  for (const entry of toolDef.calls) {
    const outbound = requestFor(entry, params, owner);
    if (!outbound) return { error: 'invalid_parameters' };
    const response = await fetchApi(outbound, env);
    results.push({ method: entry.method, path: entry.path, ...(await speakable(response, secrets)) });
  }
  return { calls: results };
}

function validateParameters(toolDef, parameters) {
  for (const key of toolDef.required) {
    if (key === 'botId' || key === 'sessionRecordId') {
      if (typeof parameters[key] !== 'string' || !ID.test(parameters[key])) return false;
      continue;
    }
    if (key === 'query') {
      if (typeof parameters.query !== 'string' || !parameters.query.trim() || parameters.query.length > 1000) return false;
      continue;
    }
    if (key === 'url') {
      if (typeof parameters.url !== 'string' || !parameters.url.trim() || parameters.url.length > 2000) return false;
      continue;
    }
    if (parameters[key] == null || parameters[key] === '') return false;
  }
  if (toolDef.properties.query && parameters.query != null) {
    if (typeof parameters.query !== 'string' || !parameters.query.trim() || parameters.query.length > 1000) return false;
  }
  if (toolDef.properties.url && parameters.url != null) {
    if (typeof parameters.url !== 'string' || !parameters.url.trim() || parameters.url.length > 2000) return false;
  }
  if (toolDef.properties.limit && parameters.limit != null) {
    if (!Number.isInteger(parameters.limit) || parameters.limit < 1 || parameters.limit > 10) return false;
  }
  if (toolDef.properties.purpose && parameters.purpose != null && (typeof parameters.purpose !== 'string' || parameters.purpose.length > 64)) return false;
  if (toolDef.properties.goal && parameters.goal != null && typeof parameters.goal !== 'string') return false;
  if (toolDef.properties.provider && parameters.provider != null) {
    if (parameters.provider !== 'sandbox' && parameters.provider !== 'laso') return false;
  }
  if (toolDef.properties.domain && parameters.domain != null) {
    if (typeof parameters.domain !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}\.sol$/i.test(parameters.domain)) return false;
  }
  if (toolDef.properties.amount && parameters.amount != null) {
    if (typeof parameters.amount !== 'string' || !/^(0|[1-9][0-9]{0,39})$/.test(parameters.amount)) return false;
  }
  if (toolDef.properties.from && parameters.from != null) {
    if (typeof parameters.from !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(parameters.from)) return false;
  }
  if (toolDef.properties.mint && parameters.mint != null) {
    if (typeof parameters.mint !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(parameters.mint)) return false;
  }
  if (toolDef.properties.action && parameters.action != null) {
    if (!['buy', 'sell', 'spend', 'pay'].includes(parameters.action)) return false;
  }
  if (toolDef.properties.handle && parameters.handle != null) {
    if (typeof parameters.handle !== 'string' || !/^[a-z0-9][a-z0-9_]{1,31}$/.test(parameters.handle)) return false;
  }
  if (toolDef.properties.destination && parameters.destination != null) {
    if (typeof parameters.destination !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(parameters.destination)) return false;
  }
  if (toolDef.properties.quoteCluster && parameters.quoteCluster != null) {
    if (parameters.quoteCluster !== 'mainnet' && parameters.quoteCluster !== 'devnet') return false;
  }
  if (toolDef.properties.botId && parameters.botId != null && parameters.botId !== '') {
    if (typeof parameters.botId !== 'string' || !ID.test(parameters.botId)) return false;
  }
  if (toolDef.properties.since && parameters.since != null && parameters.since !== '') {
    if (parseAwaySince(parameters.since) == null) return false;
  }
  return true;
}

export async function handleVoiceRequest(request, env = {}, { fetchApi, fetcher = fetch } = {}) {
  const url = new URL(request.url);
  if (url.pathname === '/voice/agent' && request.method === 'GET') return json(voiceAgentSpec(request, env));
  if (url.pathname === '/voice/llm/chat/completions' && request.method === 'POST') {
    return handleCustomLlm(request, env, fetcher);
  }
  if (url.pathname === '/voice/session-owner' && request.method === 'POST') {
    return handleSessionOwner(request, env);
  }
  const toolMatch = url.pathname.match(/^\/voice\/tools\/([^/]+)$/);
  if (toolMatch && request.method === 'POST') {
    return handleTool(toolMatch[1], request, env, fetchApi);
  }
  return json({ error: 'not_found' }, 404);
}

async function handleSessionOwner(request, env) {
  const denied = authorize(request, env);
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'invalid_body' }, 400);
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim().slice(0, 128) : '';
  const owner = readOwnerCandidate(body.ownerId) || readOwnerCandidate(body.owner_id);
  if (!ID.test(conversationId) || !owner) return json({ error: 'invalid_body' }, 400);
  await rememberVoiceOwner(conversationId, owner);
  return json({ ok: true, conversationId, ownerId: owner });
}

async function resolveToolOwner(request, body) {
  const fromHeader = ownerIdFromHeader(request);
  if (fromHeader) return fromHeader;
  const fromBody = ownerIdFromBody(body);
  if (fromBody) return fromBody;
  const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id.trim().slice(0, 128) : '';
  if (conversationId) return recallVoiceOwner(conversationId);
  return null;
}

async function handleTool(name, request, env, fetchApi) {
  const denied = authorize(request, env);
  if (denied) return denied;
  const toolDef = VOICE_TOOLS.find(item => item.name === name);
  if (!toolDef) return json({ error: 'unknown_tool' }, 404);
  const body = await request.json().catch(() => null);
  const parsed = parameterBag(body, name);
  if (parsed.error) return json({ error: parsed.error }, 400);
  if (!validateParameters(toolDef, parsed.parameters)) return json({ error: 'invalid_parameters' }, 400);
  const owner = await resolveToolOwner(request, body);
  if (!owner) return json({ error: 'owner_required' }, 400);
  if (parsed.conversationId) await rememberVoiceOwner(parsed.conversationId, owner);
  let result;
  try {
    if (toolDef.handler === 'research') {
      result = await runResearchTool(name, parsed.parameters, env);
    } else if (toolDef.handler === 'price') {
      result = await runPriceTool(parsed.parameters, env);
    } else {
      if (typeof fetchApi !== 'function') return json({ error: 'voice_api_unavailable' }, 503);
      result = await runCalls(toolDef, parsed.parameters, owner, fetchApi, env, {
        spendPermission: request.headers.get('x-spend-permission'),
      });
    }
  } catch {
    return json({ error: 'voice_api_failed' }, 502);
  }
  if (result.error) return json({ error: result.error }, result.error === 'session_not_found' ? 404 : 400);
  return json({
    result: {
      tool: name,
      ...(parsed.conversationId ? { conversationId: parsed.conversationId } : {}),
      ...result,
    },
  });
}

function clip(value, max) {
  const text = typeof value === 'string' ? value : '';
  return text.length > max ? text.slice(0, max) : text;
}

function sanitizeContent(content, secrets) {
  if (typeof content === 'string') return redactString(clip(content, 4000), secrets);
  if (!Array.isArray(content)) return '';
  return redactString(clip(content.map(part => (typeof part?.text === 'string' ? part.text : '')).join(''), 4000), secrets);
}

function sanitizeMessages(messages, secrets) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 32) return null;
  const roles = new Set(['system', 'user', 'assistant', 'tool']);
  const cleaned = [];
  for (const message of messages) {
    if (!message || !roles.has(message.role)) return null;
    const next = { role: message.role, content: sanitizeContent(message.content, secrets) };
    if (typeof message.tool_call_id === 'string') next.tool_call_id = clip(message.tool_call_id, 128);
    if (Array.isArray(message.tool_calls) && message.tool_calls.length <= 8) {
      next.tool_calls = message.tool_calls.map(callItem => ({
        id: clip(callItem?.id, 128),
        type: 'function',
        function: {
          name: clip(callItem?.function?.name, 64),
          arguments: clip(typeof callItem?.function?.arguments === 'string' ? callItem.function.arguments : '', 2000),
        },
      }));
    }
    cleaned.push(next);
  }
  return cleaned;
}

function sanitizeTools(tools, secrets) {
  if (tools == null) return undefined;
  if (!Array.isArray(tools) || tools.length > 32) return null;
  const encoded = JSON.stringify(tools);
  if (encoded.length > 100000) return null;
  let text = encoded;
  for (const secret of secrets) text = text.split(secret).join('[hidden]');
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function handleCustomLlm(request, env, fetcher) {
  const denied = authorize(request, env);
  if (denied) return denied;
  const resolved = resolveModelProvider(env);
  const apiKey = modelApiKey(env);
  if (!apiKey) return json({ error: 'openrouter_not_configured' }, 503);
  const secrets = knownSecrets(env);
  const incoming = await request.json().catch(() => null);
  if (!incoming || typeof incoming !== 'object') return json({ error: 'invalid_body' }, 400);
  const messages = sanitizeMessages(incoming.messages, secrets);
  const tools = sanitizeTools(incoming.tools, secrets);
  if (!messages || tools === null) return json({ error: 'invalid_body' }, 400);
  const adapted = resolved.provider === 'meta'
    ? messages.map(item => (item?.role === 'system' ? { ...item, role: 'developer' } : item))
    : messages.slice();
  const permissionNote = ownerPermissionNote(incoming.ownerPermission);
  if (permissionNote) {
    adapted.unshift({
      role: resolved.provider === 'meta' ? 'developer' : 'system',
      content: permissionNote,
    });
  }
  const payload = {
    model: grokVoiceModel(env),
    messages: adapted,
    stream: true,
  };
  if (resolved.provider !== 'meta') payload.temperature = 0.4;
  else payload.reasoning_effort = 'minimal';
  if (tools) payload.tools = tools;
  let response;
  try {
    response = await fetcher(voiceChatCompletionsUrl(env), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        accept: 'text/event-stream',
        'content-type': 'application/json',
        'x-title': 'Maelstrom',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return json({ error: 'openrouter_unavailable' }, 502);
  }
  if (!response?.ok) {
    return json({ error: response?.status === 401 ? 'openrouter_unauthorized' : 'openrouter_failed' }, response?.status === 401 ? 401 : 502);
  }
  const type = response.headers?.get?.('content-type') ?? '';
  if (type.includes('text/event-stream') && response.body) {
    return new Response(response.body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
    });
  }
  const data = await response.json().catch(() => null);
  const text = redactString(typeof data?.choices?.[0]?.message?.content === 'string' ? data.choices[0].message.content : '', secrets);
  const chunk = {
    id: 'chatcmpl-voice',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
  };
  const done = { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
  const sse = `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(done)}\n\ndata: [DONE]\n\n`;
  return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
}
