import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.mjs';
import {
  GROK_VOICE_MODEL,
  OPENROUTER_CHAT_COMPLETIONS,
  VOICE_TOOLS,
  handleVoiceRequest,
  provisionVoiceAgent,
} from './voice.mjs';
import { eventsUrl } from '../../web/lib/bot-experience.mjs';
import { browserSessionUrl } from '../../web/lib/live-view.mjs';

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

test('the agent spec uses Muse Spark as the custom LLM and includes no secret values', async () => {
  const response = await worker.fetch(new Request(`${ORIGIN}/voice/agent`), env({
    OPENROUTER_API_KEY: OPENROUTER,
    ELEVENLABS_API_KEY: ELEVEN,
    OPENROUTER_MODEL_VOICE: 'not a model',
  }));
  assert.equal(response.status, 200);
  const spec = await response.json();
  assert.equal(spec.llm.provider, 'custom-llm');
  assert.equal(spec.llm.modelId, GROK_VOICE_MODEL);
  assert.equal(spec.llm.modelId, 'meta/muse-spark-1.3-contributor');
  assert.equal(spec.llm.upstream, OPENROUTER_CHAT_COMPLETIONS);
  assert.equal(spec.llm.streaming, true);
  assert.equal(spec.llm.apiKeyIncluded, false);
  const prompt = spec.elevenlabs.conversation_config.agent.prompt;
  assert.equal(prompt.llm, 'custom-llm');
  assert.equal(prompt.custom_llm.model_id, GROK_VOICE_MODEL);
  assert.equal(prompt.custom_llm.api_type, 'chat_completions');
  assert.equal(prompt.custom_llm.url, `${ORIGIN}/voice/llm/chat/completions`);
  assert.equal(prompt.custom_llm.api_key, undefined);
  assert.equal(prompt.tools.some(item => item.name === 'browser_live_view'), false);
  const text = JSON.stringify(spec);
  assert.equal(text.includes(SECRET), false);
  assert.equal(text.includes(OPENROUTER), false);
  assert.equal(text.includes(ELEVEN), false);
  assert.match(text, /Stopping all bots now/);
});

test('webhook tools call the same routes as the bot page and Live View panel', async () => {
  const seen = [];
  const fetchApi = async request => {
    seen.push({
      method: request.method,
      url: request.url,
      owner: request.headers.get('x-owner-id'),
      body: await request.text(),
    });
    return Response.json({
      ok: true,
      items: [],
      viewerUrl: 'https://live.browser.run/ui/view?token=abc',
      note: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb',
    });
  };
  const activity = await handleVoiceRequest(toolRequest('get_activity', {
    body: { tool_name: 'get_activity', parameters: { botId: 'bot_1' }, conversation_id: 'conv_1' },
  }), env(), { fetchApi });
  const activityBody = await activity.json();
  const activityUrl = new URL(seen[0].url);
  const expectedActivity = new URL(eventsUrl(ORIGIN, 'bot_1'));
  assert.equal(activityUrl.pathname, expectedActivity.pathname);
  assert.equal(activityUrl.searchParams.get('botId'), expectedActivity.searchParams.get('botId'));
  assert.equal(seen[0].owner, 'user_1');
  assert.equal(activityBody.result.conversationId, 'conv_1');
  assert.equal(JSON.stringify(activityBody).includes('live.browser.run'), false);
  assert.equal(JSON.stringify(activityBody).includes('eyJhbGci'), false);

  seen.length = 0;
  await handleVoiceRequest(toolRequest('open_browser_session', {
    body: { parameters: { botId: 'bot_1' } },
  }), env(), { fetchApi });
  const opened = new URL(seen[0].url);
  assert.equal(opened.pathname, new URL(browserSessionUrl(ORIGIN, 'bot_1')).pathname);
  assert.deepEqual(JSON.parse(seen[0].body), { purpose: 'browse' });

  seen.length = 0;
  await handleVoiceRequest(toolRequest('release_browser_session', {
    body: { parameters: { botId: 'bot_1', sessionRecordId: 'rec_1' } },
  }), env(), { fetchApi });
  const released = new URL(seen[0].url);
  const expectedRelease = new URL(browserSessionUrl(ORIGIN, 'bot_1', { sessionRecordId: 'rec_1', action: 'release' }));
  assert.equal(released.pathname, expectedRelease.pathname);
  assert.equal(expectedRelease.pathname.includes('live-view'), false);
});

test('pause, loop, and stop_all go through the worker routes', async () => {
  const paused = await worker.fetch(toolRequest('pause_bot', {
    body: { tool_name: 'pause_bot', parameters: { botId: 'bot_1' } },
  }), env());
  const pauseBody = await paused.json();
  assert.equal(paused.status, 200);
  assert.equal(pauseBody.result.calls[0].path, '/bots/:botId/pause');
  assert.equal(pauseBody.result.calls[0].body.forwarded, '/pause');
  assert.equal(pauseBody.result.calls[0].body.owner, 'user_1');

  const loop = await worker.fetch(toolRequest('start_task', {
    body: { parameters: { botId: 'bot_1', goal: 'compare prices' } },
  }), env());
  const loopBody = await loop.json();
  assert.equal(loopBody.result.calls[0].body.forwarded, '/loop');

  const activity = await worker.fetch(toolRequest('get_activity', {
    body: { parameters: { botId: 'bot_meteora' } },
  }), env());
  const activityBody = await activity.json();
  assert.equal(activityBody.result.calls[0].body.source, 'unconfigured');
  assert.deepEqual(activityBody.result.calls[0].body.items, []);

  const stopped = await handleVoiceRequest(toolRequest('stop_all', { body: { parameters: {} } }), env(), {
    fetchApi: async request => {
      const url = new URL(request.url);
      if (url.pathname === '/api/bots') {
        return Response.json({
          items: [{ id: 'bot_1' }, { id: 'bot_2' }, { id: '../etc' }],
          viewerUrl: 'https://live.browser.run/ui/inspector',
        });
      }
      return Response.json({ forwarded: url.pathname });
    },
  });
  const stopBody = await stopped.json();
  assert.deepEqual(stopBody.result.paused, [
    { botId: 'bot_1', status: 200 },
    { botId: 'bot_2', status: 200 },
  ]);
  assert.equal(JSON.stringify(stopBody).includes('live.browser.run'), false);
});

test('tool calls fail closed without a webhook secret, owner, or known tool', async () => {
  let called = false;
  const fetchApi = async () => {
    called = true;
    return Response.json({ ok: true });
  };
  const missing = await handleVoiceRequest(toolRequest('list_bots', {
    headers: { 'x-elevenlabs-webhook-secret': '' },
  }), env({ ELEVENLABS_WEBHOOK_SECRET: '' }), { fetchApi });
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).error, 'elevenlabs_webhook_not_configured');

  const wrong = await worker.fetch(toolRequest('list_bots', {
    headers: { authorization: 'Bearer wrong-secret-value', 'x-elevenlabs-webhook-secret': '' },
  }), env());
  assert.equal(wrong.status, 401);

  const bearer = await worker.fetch(toolRequest('get_wallets', {
    headers: { 'x-elevenlabs-webhook-secret': '', authorization: `Bearer ${SECRET}` },
  }), env());
  assert.equal(bearer.status, 200);
  const walletsBody = await bearer.json();
  assert.equal(walletsBody.result.calls[0].body.source, 'unconfigured');
  assert.deepEqual(walletsBody.result.calls[0].body.items, []);

  const owner = await worker.fetch(toolRequest('list_bots', { headers: { 'x-owner-id': '' } }), env());
  assert.equal(owner.status, 400);
  const mismatch = await worker.fetch(toolRequest('list_bots', {
    body: { tool_name: 'pause_bot', parameters: {} },
  }), env());
  assert.equal(mismatch.status, 400);
  const unknown = await worker.fetch(toolRequest('browser_live_view', { body: { parameters: {} } }), env());
  assert.equal(unknown.status, 404);
  assert.equal(called, false);
  assert.equal(VOICE_TOOLS.some(item => item.calls.some(call => call.path.includes('live-view'))), false);
});

test('the custom LLM streams Grok through OpenRouter and does not call out without a key', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return Response.json({
      choices: [{ message: { content: `hello ${OPENROUTER}` } }],
    });
  };
  const response = await worker.fetch(new Request(`${ORIGIN}/voice/llm/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${SECRET}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: `key ${OPENROUTER}` }, { role: 'assistant', content: 'ok' }],
    }),
  }), env({ OPENROUTER_API_KEY: OPENROUTER, voiceFetcher: fetcher }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const sse = await response.text();
  assert.match(sse, /data: \[DONE\]/);
  assert.equal(sse.includes(OPENROUTER), false);
  assert.match(sse, /hello \[hidden\]/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, OPENROUTER_CHAT_COMPLETIONS);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${OPENROUTER}`);
  assert.equal(calls[0].body.model, GROK_VOICE_MODEL);
  assert.equal(calls[0].body.stream, true);
  assert.equal(calls[0].body.messages[0].content.includes(OPENROUTER), false);

  calls.length = 0;
  const stream = await handleVoiceRequest(new Request(`${ORIGIN}/voice/llm/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-elevenlabs-webhook-secret': SECRET },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  }), env({ OPENROUTER_API_KEY: OPENROUTER, OPENROUTER_MODEL_VOICE: 'meta/muse-spark-1.3' }), {
    fetcher: async (url, init) => {
      calls.push(JSON.parse(init.body));
      return new Response('data: {"ok":true}\n\ndata: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });
  assert.equal(await stream.text(), 'data: {"ok":true}\n\ndata: [DONE]\n\n');
  assert.equal(calls[0].model, 'meta/muse-spark-1.3');

  const blocked = await worker.fetch(new Request(`${ORIGIN}/voice/llm/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-elevenlabs-webhook-secret': SECRET },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  }), env());
  assert.equal(blocked.status, 503);
  assert.equal((await blocked.json()).error, 'openrouter_not_configured');
  assert.equal(calls.length, 1);
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
