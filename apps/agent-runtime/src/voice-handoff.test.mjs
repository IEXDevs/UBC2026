import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.mjs';

const SECRET = 'test-elevenlabs-webhook-secret';
const ORIGIN = 'https://runtime.example';

/**
 * Achieves: a voice turn with handoff speaks the agent reply and does not give the voice model tools.
 * Fails when: the voice model is called with tools, or the agent sentence is missing from the audio stream.
 * Oracle: custom LLM request with handoff true and a fake completion that allows the verifier.
 * Side effects: none beyond the fake fetcher.
 */
test('voice hands the utterance to the agent and speaks the reply', async () => {
  const calls = [];
  const fetcher = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const blob = JSON.stringify(body.messages || []);
    const content = blob.includes('Role: turn-verify')
      ? '{"allow":true}'
      : 'I looked that up with the connected apps.';
    return Response.json({ choices: [{ message: { content } }] });
  };
  const response = await worker.fetch(new Request(`${ORIGIN}/voice/llm/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-elevenlabs-webhook-secret': SECRET,
    },
    body: JSON.stringify({
      handoff: true,
      ownerId: 'user_1',
      botId: 'bot_1',
      ownerPermission: 'ask',
      reviewCap: '25000000',
      connectors: ['vercel'],
      messages: [{ role: 'user', content: '/search solana devnet status' }],
    }),
  }), {
    PRODUCT: 'Maelstrom',
    CLUSTER: 'devnet',
    ELEVENLABS_WEBHOOK_SECRET: SECRET,
    META_MODEL_API_KEY: 'LLM_test_secret_value_here',
    voiceFetcher: fetcher,
  });
  assert.equal(response.status, 200);
  const sse = await response.text();
  assert.match(sse, /I looked that up with the connected apps/);
  assert.equal(calls.some(body => body.stream === true), false);
  assert.equal(calls.some(body => Array.isArray(body.tools) && body.tools.length > 0), true);
  assert.equal(calls.some(body => body.tools?.some(tool => tool.function?.name === 'web_search')), true);
  assert.equal(calls.some(body => body.tools?.some(tool => tool.function?.name === 'delegate_task')), true);
});
