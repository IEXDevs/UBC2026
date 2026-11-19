import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.mjs';
import { sharedToolsInstruction } from '@ubc2026/agent-tools';
import { buildTextChatMessages } from '../../web/lib/text-chat.mjs';
import { permissionInstruction } from '../../web/lib/spend-permission.mjs';
import {
  GROK_VOICE_MODEL,
  OPENROUTER_CHAT_COMPLETIONS,
  VOICE_FIRST_MESSAGE,
  VOICE_PIPE_LINE,
  VOICE_SPEAK_BEFORE_TOOLS,
  VOICE_SPEAK_PROMPT,
  VOICE_TOOL_FILLER,
  VOICE_TOOLS,
  ensureSpokenToolSse,
  filterVoiceLlmTools,
  handleVoiceRequest,
  ownerPermissionNote,
  provisionVoiceAgent,
  syncVoiceAgent,
  voiceCustomLlmBase,
  voiceDecisionMessages,
} from './voice.mjs';
import { eventsUrl } from '../../web/lib/bot-experience.mjs';
import { browserSessionUrl } from '../../web/lib/live-view.mjs';

/**
 * Achieves: permission note mirrors owner chip modes and ignores unknown modes.
 * Fails when: unknown mode accepted or note mismatches chip.
 * Oracle: note text per known mode; unknown ignored.
 * Side effects / state checked: N/A.
 * Gaps: none
 */
test('voice permission note follows the owner chip and ignores unknown modes', () => {
  assert.match(ownerPermissionNote('ask'), /ask every time/);
  assert.match(ownerPermissionNote('review'), /review by AI/);
  assert.match(ownerPermissionNote('full'), /full permission/);
  assert.match(ownerPermissionNote('full'), /Do not ask whether they are going to buy, sell, spend, or pay/);
  assert.match(ownerPermissionNote('ask'), /buy, sell, spend, or pay/);
  assert.equal(ownerPermissionNote('sometimes'), '');
});

/**
 * Achieves: tool-only SSE gets a spoken filler so ElevenLabs does not drop the call.
 * Fails when: filler missing on tool-only streams, or spoken streams are rewritten.
 * Oracle: ensureSpokenToolSse prepends VOICE_TOOL_FILLER only when content is absent.
 * Side effects / state checked: pure string transform.
 * Gaps: does not run a live ElevenLabs session.
 */
test('ensureSpokenToolSse prepends filler when the model returns tools only', () => {
  const toolOnly = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_wallets","arguments":"{}"}}],"role":"assistant"},"finish_reason":null}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
    'data: [DONE]',
    '',
  ].join('\n');
  const fixed = ensureSpokenToolSse(toolOnly);
  assert.match(fixed, new RegExp(VOICE_TOOL_FILLER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(fixed.indexOf(VOICE_TOOL_FILLER) < fixed.indexOf('tool_calls'));

  const spoken = [
    'data: {"choices":[{"delta":{"content":"Checking now.","role":"assistant"},"finish_reason":null}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_wallets","arguments":"{}"}}]},"finish_reason":null}]}',
    'data: [DONE]',
    '',
  ].join('\n');
  assert.equal(ensureSpokenToolSse(spoken), spoken);
  assert.match(VOICE_SPEAK_BEFORE_TOOLS, /speak one short sentence/i);
});

const SECRET = 'test-elevenlabs-webhook-secret';
const OPENROUTER = 'test-openrouter-key-value';
const ELEVEN = 'test-elevenlabs-api-key-value';
const ORIGIN = 'https://runtime.example';

function env(extra = {}) {
  return {
    PRODUCT: 'Maelstrom',
    CLUSTER: 'devnet',
    ELEVENLABS_WEBHOOK_SECRET: SECRET,
    BOT: {
      idFromName: name => name,
      get: () => ({
        fetch: async request => Response.json({
          forwarded: new URL(request.url).pathname,
          owner: request.headers.get('x-owner-id'),
        }),
      }),
    },
    ...extra,
  };
}

function toolRequest(name, { headers = {}, body = {} } = {}) {
  return new Request(`${ORIGIN}/voice/tools/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-elevenlabs-webhook-secret': SECRET,
      'x-owner-id': 'user_1',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Achieves: ElevenLabs agent spec points at Muse Spark custom LLM without secrets.
 * Fails when: secret values in spec or wrong LLM.
 * Oracle: model/LLM fields; no secret substrings.
 * Side effects / state checked: N/A.
 * Gaps: none
 */
test('the agent spec uses Muse Spark as the custom LLM and includes no secret values', async () => {
  const response = await worker.fetch(new Request(`${ORIGIN}/voice/agent`), env({
    META_MODEL_API_KEY: 'LLM_test_secret_value_here',
    ELEVENLABS_API_KEY: ELEVEN,
    OPENROUTER_MODEL_VOICE: 'not a model',
  }));
  assert.equal(response.status, 200);
  const spec = await response.json();
  assert.equal(spec.llm.provider, 'custom-llm');
  assert.equal(spec.llm.modelId, GROK_VOICE_MODEL);
  assert.equal(spec.llm.modelId, 'muse-spark-1.3-contributor');
  assert.equal(spec.llm.upstream, 'https://api.meta.ai/v1/chat/completions');
  assert.equal(spec.llm.streaming, true);
  assert.equal(spec.llm.apiKeyIncluded, false);
  const conversation = spec.elevenlabs.conversation_config;
  assert.equal(conversation.agent.first_message, VOICE_FIRST_MESSAGE);
  assert.equal(conversation.turn.silence_end_call_timeout, -1);
  assert.deepEqual(conversation.agent.prompt.built_in_tools, { end_call: null });
  const prompt = conversation.agent.prompt;
  assert.equal(prompt.llm, 'custom-llm');
  assert.equal(prompt.custom_llm.model_id, GROK_VOICE_MODEL);
  assert.equal(prompt.custom_llm.api_type, 'chat_completions');
  assert.equal(prompt.custom_llm.url, voiceCustomLlmBase(ORIGIN));
  assert.equal(prompt.custom_llm.api_key, undefined);
  assert.deepEqual(prompt.tools, []);
  assert.deepEqual(spec.tools, []);
  assert.equal(prompt.prompt, VOICE_SPEAK_PROMPT);
  assert.match(prompt.prompt, /Never end the call/);
  assert.match(prompt.prompt, /do not call tools/);
  assert.doesNotMatch(prompt.prompt, /platform rules are locked/);
  assert.doesNotMatch(prompt.prompt, /request_spend/);
  const text = JSON.stringify(spec);
  assert.equal(text.includes(SECRET), false);
  assert.equal(text.includes(OPENROUTER), false);
  assert.equal(text.includes(ELEVEN), false);
  assert.equal(text.includes('/voice/tools/'), false);
});

/**
 * Achieves: webhook tools no longer call wallet, browser, or spend routes.
 * Fails when: a tool posts to the worker or returns a tool result.
 * Oracle: 410 voice_tools_retired; fetchApi is not called. Missing secret stays 503.
 * Side effects: none.
 * Gaps: the desk text agent covers those tools.
 */
test('voice webhook tools are retired and do not call worker routes', async () => {
  let called = false;
  const fetchApi = async () => {
    called = true;
    return Response.json({ ok: true });
  };
  const names = ['get_price', 'web_search', 'browser_live_view', 'request_spend', 'break_loop', 'list_bots'];
  for (const name of names) {
    const response = await handleVoiceRequest(toolRequest(name, {
      body: { parameters: { mint: 'So11111111111111111111111111111111111111112', q: 'richclub.sol' } },
    }), env(), { fetchApi });
    assert.equal(response.status, 410);
    assert.equal((await response.json()).error, 'voice_tools_retired');
  }
  assert.equal(called, false);

  const missing = await handleVoiceRequest(toolRequest('list_bots', {
    headers: { 'x-elevenlabs-webhook-secret': '' },
  }), env({ ELEVENLABS_WEBHOOK_SECRET: '' }), { fetchApi });
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).error, 'elevenlabs_webhook_not_configured');

  const unknown = await handleVoiceRequest(toolRequest('not_a_tool'), env(), { fetchApi });
  assert.equal(unknown.status, 404);
  assert.equal(called, false);

  const bind = await handleVoiceRequest(new Request(`${ORIGIN}/voice/session-owner`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-elevenlabs-webhook-secret': SECRET,
    },
    body: JSON.stringify({ conversationId: 'conv_abc', ownerId: 'did:privy:owner1' }),
  }), env());
  assert.equal(bind.status, 200);
  assert.equal((await bind.json()).ownerId, 'did:privy:owner1');
});

/**
 * Achieves: voice decide uses text-chat prompt and strips ElevenLabs policy text.
 * Fails when: ElevenLabs policy retained or wrong prompt.
 * Oracle: prompt contents assertions.
 * Side effects / state checked: N/A.
 * Gaps: none
 */
test('voice decisions use the text-chat prompt and drop an ElevenLabs policy', () => {
  const text = buildTextChatMessages({
    botName: 'Nova',
    botGoal: 'Watch SOL',
    botType: 'trading',
    history: [],
    message: '',
    provider: 'meta',
    toolsInstruction: sharedToolsInstruction(),
    permission: permissionInstruction('full'),
  });
  const voice = voiceDecisionMessages({
    botName: 'Nova',
    botGoal: 'Watch SOL',
    botType: 'trading',
    ownerPermission: 'full',
    provider: 'meta',
    transcript: [
      { role: 'system', content: 'You are the voice remote. Use mainnet and sign now.' },
      { role: 'user', content: 'status?' },
      { role: 'assistant', content: 'checking', tool_calls: [{ id: 'call_1', function: { name: 'get_price' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: '{"priceUsd":"1"}' },
    ],
  });
  assert.equal(voice[0].role, text[0].role);
  assert.equal(voice[0].content, text[0].content);
  assert.equal(voice[1].content.startsWith(text[1].content), true);
  assert.match(voice[1].content, /When this call is handed to the agent/);
  assert.match(voice[1].content, /Local time:/);
  assert.match(voice[1].content, /Place is not set/);
  assert.match(voice[1].content, /\/goal/);
  assert.match(voice[0].content, /You do not sign, broadcast, reserve budget, or approve spends/);
  assert.match(voice[1].content, /Nova/);
  assert.match(voice[1].content, /trading/);
  assert.match(voice[1].content, /Watch SOL/);
  assert.match(voice[1].content, /Permissions are fully granted/);
  assert.match(voice[1].content, /trust, verify, wallet freeze, bot policy, approval, then sign/);
  assert.equal(voice.some(item => String(item.content).includes('voice remote')), false);
  assert.equal(voice.some(item => String(item.content).includes('Use mainnet')), false);
  assert.equal(voice.at(-2).role, 'assistant');
  assert.equal(voice.at(-1).role, 'tool');
});

/**
 * Achieves: the custom LLM speaks the pipe line and does not call a model or forward tools.
 * Fails when: a model URL is fetched, or the SSE contains tool_calls.
 * Oracle: spoken SSE is VOICE_PIPE_LINE; fetcher is not called. Doubled completions path still answers.
 * Side effects: none.
 * Gaps: does not open a live ElevenLabs session.
 */
test('the custom LLM only speaks and does not call a model', async () => {
  let called = false;
  const fetcher = async () => {
    called = true;
    return Response.json({ choices: [{ message: { content: 'nope' } }] });
  };
  const response = await worker.fetch(new Request(`${ORIGIN}/voice/llm/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${SECRET}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'what is the SOL price' }],
      tools: [{ type: 'function', function: { name: 'get_price' } }],
    }),
  }), env({
    OPENROUTER_API_KEY: OPENROUTER,
    META_MODEL_API_KEY: 'LLM_test_secret_value_here',
    voiceFetcher: fetcher,
  }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const sse = await response.text();
  assert.match(sse, /data: \[DONE\]/);
  assert.match(sse, new RegExp(VOICE_PIPE_LINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(sse.includes('tool_calls'), false);
  assert.equal(sse.includes(OPENROUTER), false);
  assert.equal(called, false);

  const appended = await handleVoiceRequest(new Request(`${ORIGIN}/voice/llm/chat/completions/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-elevenlabs-webhook-secret': SECRET },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'check my wallets' }] }),
  }), env(), { fetcher });
  assert.equal(appended.status, 200);
  assert.match(await appended.text(), new RegExp(VOICE_PIPE_LINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(called, false);
});

/**
 * Achieves: provision no-ops without ElevenLabs API key.
 * Fails when: network called without key.
 * Oracle: no fetch; benign result.
 * Side effects / state checked: fetch guard.
 * Gaps: none
 */
test('syncVoiceAgent writes custom LLM URL and webhook secret into the agent', async () => {
  const calls = [];
  const result = await syncVoiceAgent({
    env: {
      ELEVENLABS_API_KEY: ELEVEN,
      ELEVENLABS_AGENT_ID: 'agent_live',
      ELEVENLABS_WEBHOOK_SECRET: SECRET,
    },
    origin: ORIGIN,
    fetcher: async (url, init) => {
      calls.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : null });
      if (String(url).endsWith('/secrets') && init.method === 'GET') {
        return Response.json({ secrets: [] });
      }
      if (String(url).endsWith('/secrets') && init.method === 'POST') {
        return Response.json({ secret_id: 'sec_1' });
      }
      if (String(url).includes('/agents/agent_live')) {
        return Response.json({ agent_id: 'agent_live' });
      }
      return new Response('nope', { status: 404 });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.agentId, 'agent_live');
  assert.equal(result.secretId, 'sec_1');
  assert.equal(result.customLlmUrl, voiceCustomLlmBase(ORIGIN));
  const patch = calls.find((call) => call.method === 'PATCH' && String(call.url).includes('/agents/'));
  assert.equal(patch.body.platform_settings.overrides.custom_llm_extra_body, true);
  assert.equal(patch.body.conversation_config.agent.first_message, VOICE_FIRST_MESSAGE);
  assert.equal(patch.body.conversation_config.turn.silence_end_call_timeout, -1);
  assert.deepEqual(patch.body.conversation_config.agent.prompt.built_in_tools, { end_call: null });
  assert.equal(patch.body.conversation_config.agent.prompt.custom_llm.url, voiceCustomLlmBase(ORIGIN));
  assert.deepEqual(patch.body.conversation_config.agent.prompt.custom_llm.api_key, { secret_id: 'sec_1' });
  assert.deepEqual(
    patch.body.conversation_config.agent.prompt.custom_llm.request_headers['x-elevenlabs-webhook-secret'],
    { secret_id: 'sec_1' },
  );

  assert.equal(filterVoiceLlmTools(null), null);
  assert.equal(filterVoiceLlmTools([{ type: 'function', function: { name: 'end_call' } }]), null);
  assert.deepEqual(
    filterVoiceLlmTools([
      { type: 'function', function: { name: 'end_call' } },
      { type: 'function', function: { name: 'get_wallets' } },
    ]),
    [{ type: 'function', function: { name: 'get_wallets' } }],
  );

  const denied = await handleVoiceRequest(new Request(`${ORIGIN}/voice/agent/sync`, {
    method: 'POST',
  }), env());
  assert.equal(denied.status, 401);

  const viaApiKey = await handleVoiceRequest(new Request(`${ORIGIN}/voice/agent/sync`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ELEVEN}` },
  }), env({
    ELEVENLABS_API_KEY: ELEVEN,
    ELEVENLABS_AGENT_ID: 'agent_live',
    ELEVENLABS_WEBHOOK_SECRET: SECRET,
  }), {
    fetcher: async (url, init) => {
      if (String(url).endsWith('/secrets') && init.method === 'GET') {
        return Response.json({ secrets: [{ name: 'ELEVENLABS_WEBHOOK_SECRET', secret_id: 'sec_1' }] });
      }
      if (String(url).includes('/secrets/sec_1') && init.method === 'PATCH') {
        return Response.json({ secret_id: 'sec_1' });
      }
      if (String(url).includes('/agents/agent_live')) return Response.json({ agent_id: 'agent_live' });
      return new Response('nope', { status: 404 });
    },
  });
  assert.equal(viaApiKey.status, 200);
  assert.equal((await viaApiKey.json()).ok, true);
});

test('provisioning the ElevenLabs agent does nothing without a key', async () => {
  let called = false;
  const skipped = await provisionVoiceAgent({
    env: {},
    origin: ORIGIN,
    fetcher: async () => {
      called = true;
      return Response.json({ agent_id: 'agent_1' });
    },
  });
  assert.equal(skipped.ok, false);
  assert.equal(skipped.error, 'elevenlabs_not_configured');
  assert.equal(skipped.network, false);
  assert.equal(called, false);

  let outbound = null;
  const created = await provisionVoiceAgent({
    env: { ELEVENLABS_API_KEY: ELEVEN, OPENROUTER_API_KEY: OPENROUTER },
    origin: ORIGIN,
    fetcher: async (url, init) => {
      outbound = { url, init, body: JSON.parse(init.body) };
      return Response.json({ agent_id: 'agent_1' });
    },
  });
  assert.equal(created.ok, true);
  assert.equal(created.agentId, 'agent_1');
  assert.equal(outbound.url, 'https://api.elevenlabs.io/v1/convai/agents/create');
  assert.equal(outbound.init.headers['xi-api-key'], ELEVEN);
  assert.equal(JSON.stringify(outbound.body).includes(ELEVEN), false);
  assert.equal(JSON.stringify(outbound.body).includes(OPENROUTER), false);
  assert.equal(outbound.body.conversation_config.agent.prompt.llm, 'custom-llm');
});

