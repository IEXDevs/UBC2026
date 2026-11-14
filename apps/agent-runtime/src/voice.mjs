/**
 * ElevenLabs voice agent.
 * Grok is the custom LLM: ElevenLabs calls this Worker, and the Worker streams
 * OpenRouter chat completions with an x-ai/grok model. The OpenRouter key stays here.
 * Webhook tools call the same bot, event, wallet, and browser routes as the UI.
 * No secret values are written into the agent payload.
 */
import { timingSafeEqual } from 'node:crypto';
import { SECRET_NAMES } from '@ubc2026/contracts';

export const GROK_VOICE_MODEL = 'x-ai/grok-4.7';
export const OPENROUTER_CHAT_COMPLETIONS = 'https://openrouter.ai/api/v1/chat/completions';
const WEBHOOK_HEADER = 'x-elevenlabs-webhook-secret';
const SECRET_PLACEHOLDER = '{{ELEVENLABS_WEBHOOK_SECRET}}';
const ID = /^[a-zA-Z0-9:_-]{1,128}$/;
const GROK_MODEL = /^x-ai\/grok[a-z0-9._-]*$/i;

export const VOICE_SYSTEM_PROMPT = [
  'You are the voice remote for this user\'s Maelstrom Solana agent dashboard.',
  'Prefer short confirmations.',
  'Always name the active bot before an action. If it is unclear, call list_bots and ask.',
  'Never invent balances, addresses, trust scores, positions, or decisions. Call a tool.',
  'If a tool result has stub set to true, or items is empty, say the data is not available yet. Do not fill the gap.',
  'Pause and resume affect one bot. stop_all pauses every bot the list route returns. Before stop_all, say "Stopping all bots now".',
  'Pause, resume, and stop_all only make the fleet safer.',
  'Do not send funds, approve spends, raise limits, or freeze wallets. Those stay on the app\'s existing approval screen. If the user asks, say the preview has to appear in the app first.',
  'Do not ask for seed phrases, private keys, passwords, or API keys.',
  'Never read out Live View URLs, tokens, or secrets. If a tool hides them, leave them hidden.',
  'If a tool returns confirmation-required or manual-review, say so and stop.',
  'Execution stays on Solana devnet.',
].join('\n');

const botIdProp = Object.freeze({
  type: 'string',
  description: 'Bot id',
});

/**
 * Each tool's `calls` are the existing UI/runtime routes. ElevenLabs posts to
 * /voice/tools/:name, and that handler performs these calls with the same owner header.
 */
export const VOICE_TOOLS = Object.freeze([
  tool('list_bots', 'List this user\'s bots. Same route as the bots API the app uses.', [], {}, [
    call('GET', '/api/bots'),
  ]),
  tool('get_bot_status', 'Status for one bot. Same route as the runtime status page.', ['botId'], { botId: botIdProp }, [
    call('GET', '/bots/:botId/status'),
  ]),
  tool('get_wallets', 'List wallets. Same route as the wallets API.', [], {}, [
    call('GET', '/api/wallets'),
  ]),
  tool('get_overview', 'Overview metrics, including PnL. Same route as the metrics API.', [], {}, [
    call('GET', '/api/metrics'),
  ]),
  tool('get_activity', 'Recent activity for one bot. Same feed as the bot page timeline.', ['botId'], { botId: botIdProp }, [
    call('GET', '/api/events', { query: ['botId'] }),
  ]),
  tool('why_decision', 'Why a bot acted. Same route as the decision record API.', ['botId'], { botId: botIdProp }, [
    call('GET', '/api/decisions', { query: ['botId'] }),
  ]),
  tool('get_payment_feed', 'Payments in and out for one bot. Same route as the payments API.', ['botId'], { botId: botIdProp }, [
    call('GET', '/api/payments', { query: ['botId'] }),
  ]),
  tool('pause_bot', 'Pause one bot. Same route as the runtime pause control.', ['botId'], { botId: botIdProp }, [
    call('POST', '/bots/:botId/pause'),
  ]),
  tool('resume_bot', 'Resume one bot. Same route as the runtime resume control.', ['botId'], { botId: botIdProp }, [
    call('POST', '/bots/:botId/resume'),
  ]),
  tool('wake_bot', 'Wake one bot to continue its goal. Same route as the runtime wake control.', ['botId'], {
    botId: botIdProp,
    goal: { type: 'string', description: 'Optional goal text already stored for this bot' },
  }, [
    call('POST', '/bots/:botId/wake', { body: ['goal'] }),
  ]),
  tool('start_task', 'Start the checkpointed research, decide, and approval loop for one bot. Same route as the runtime loop.', ['botId'], {
    botId: botIdProp,
    goal: { type: 'string', description: 'Optional goal text already stored for this bot' },
  }, [
    call('POST', '/bots/:botId/loop', { body: ['goal'] }),
  ]),
  tool('list_browser_sessions', 'List this owner\'s browser sessions for a bot. Same route as the Live View panel.', ['botId'], { botId: botIdProp }, [
    call('GET', '/bots/:botId/browser/sessions'),
  ]),
  tool('open_browser_session', 'Open an owner-bound browser session. Same route as the Live View panel open button. Does not return a Live View URL.', ['botId'], {
    botId: botIdProp,
    purpose: { type: 'string', description: 'Short purpose, such as browse' },
  }, [
    call('POST', '/bots/:botId/browser/sessions', { body: ['purpose'] }),
  ]),
  tool('release_browser_session', 'Release a browser session. Same route as the Live View panel release button.', ['botId', 'sessionRecordId'], {
    botId: botIdProp,
    sessionRecordId: { type: 'string', description: 'Session record id returned by open_browser_session' },
  }, [
    call('POST', '/bots/:botId/browser/sessions/:sessionRecordId/release'),
  ]),
  tool('stop_all', 'Pause every listed bot. Uses the bots list and the pause route. Say "Stopping all bots now" before calling.', [], {}, [
    call('GET', '/api/bots'),
    call('POST', '/bots/:botId/pause'),
  ]),
]);

function tool(name, description, required, properties, calls) {
  return Object.freeze({ name, description, required: Object.freeze(required), properties: Object.freeze(properties), calls: Object.freeze(calls) });
}

function call(method, path, extra = {}) {
  return Object.freeze({ method, path, query: Object.freeze(extra.query ?? []), body: Object.freeze(extra.body ?? []) });
}

export function grokVoiceModel(env = {}) {
  const override = typeof env.OPENROUTER_MODEL_VOICE === 'string' ? env.OPENROUTER_MODEL_VOICE.trim() : '';
  if (GROK_MODEL.test(override)) return override;
  return GROK_VOICE_MODEL;
}

function webhookHeaders() {
  return Object.freeze({
    [WEBHOOK_HEADER]: SECRET_PLACEHOLDER,
    'x-owner-id': '{{owner_id}}',
  });
}

export function voiceAgentCreateBody({ origin, modelId = GROK_VOICE_MODEL } = {}) {
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
      upstream: OPENROUTER_CHAT_COMPLETIONS,
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

function ownerId(request) {
  const value = request.headers.get('x-owner-id');
  if (typeof value !== 'string' || !ID.test(value)) return null;
  return value;
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
      if (typeof parameters[key] === 'string' && parameters[key].trim() !== '') body[key] = parameters[key].trim().slice(0, 256);
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

async function runCalls(toolDef, parameters, owner, fetchApi, env) {
  const secrets = knownSecrets(env);
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
  const results = [];
  for (const entry of toolDef.calls) {
    const outbound = requestFor(entry, parameters, owner);
    if (!outbound) return { error: 'invalid_parameters' };
    const response = await fetchApi(outbound, env);
    results.push({ method: entry.method, path: entry.path, ...(await speakable(response, secrets)) });
  }
  return { calls: results };
}

function validateParameters(toolDef, parameters) {
  for (const key of toolDef.required) {
    if (!ID.test(parameters[key])) return false;
  }
  if (toolDef.properties.purpose && parameters.purpose != null && (typeof parameters.purpose !== 'string' || parameters.purpose.length > 64)) return false;
  if (toolDef.properties.goal && parameters.goal != null && typeof parameters.goal !== 'string') return false;
  return true;
}

export async function handleVoiceRequest(request, env = {}, { fetchApi, fetcher = fetch } = {}) {
  const url = new URL(request.url);
  if (url.pathname === '/voice/agent' && request.method === 'GET') return json(voiceAgentSpec(request, env));
  if (url.pathname === '/voice/llm/chat/completions' && request.method === 'POST') {
    return handleCustomLlm(request, env, fetcher);
  }
  const toolMatch = url.pathname.match(/^\/voice\/tools\/([^/]+)$/);
  if (toolMatch && request.method === 'POST') {
    return handleTool(toolMatch[1], request, env, fetchApi);
  }
  return json({ error: 'not_found' }, 404);
}

async function handleTool(name, request, env, fetchApi) {
  const denied = authorize(request, env);
  if (denied) return denied;
  const owner = ownerId(request);
  if (!owner) return json({ error: 'owner_required' }, 400);
  const toolDef = VOICE_TOOLS.find(item => item.name === name);
  if (!toolDef) return json({ error: 'unknown_tool' }, 404);
  if (typeof fetchApi !== 'function') return json({ error: 'voice_api_unavailable' }, 503);
  const body = await request.json().catch(() => null);
  const parsed = parameterBag(body, name);
  if (parsed.error) return json({ error: parsed.error }, 400);
  if (!validateParameters(toolDef, parsed.parameters)) return json({ error: 'invalid_parameters' }, 400);
  let result;
  try {
    result = await runCalls(toolDef, parsed.parameters, owner, fetchApi, env);
  } catch {
    return json({ error: 'voice_api_failed' }, 502);
  }
  if (result.error) return json({ error: result.error }, 400);
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
  const apiKey = typeof env.OPENROUTER_API_KEY === 'string' ? env.OPENROUTER_API_KEY.trim() : '';
  if (!apiKey) return json({ error: 'openrouter_not_configured' }, 503);
  const secrets = knownSecrets(env);
  const incoming = await request.json().catch(() => null);
  if (!incoming || typeof incoming !== 'object') return json({ error: 'invalid_body' }, 400);
  const messages = sanitizeMessages(incoming.messages, secrets);
  const tools = sanitizeTools(incoming.tools, secrets);
  if (!messages || tools === null) return json({ error: 'invalid_body' }, 400);
  const payload = {
    model: grokVoiceModel(env),
    messages,
    stream: true,
    temperature: 0.4,
  };
  if (tools) payload.tools = tools;
  let response;
  try {
    response = await fetcher(OPENROUTER_CHAT_COMPLETIONS, {
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
