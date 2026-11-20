import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.mjs';

const SECRET = 'test-elevenlabs-webhook-secret';
const ORIGIN = 'https://runtime.example';

/**
 * Achieves: a leftover ConvAI handoff does not call a model or speak a tool turn.
 * Fails when: the custom LLM fetches a model or returns tool_calls.
 * Oracle: spoken SSE is the desk pipe line; fetcher is not called.
 * Side effects: none.
 * Gaps: the desk speaks the text agent through sendBotChat, not this route.
 */
test('a voice handoff does not call a model', async () => {
  let called = false;
  const fetcher = async () => {
    called = true;
    return Response.json({ choices: [{ message: { content: 'nope' } }] });
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
      messages: [{ role: 'user', content: '/search solana mainnet-beta status' }],
    }),
  }), {
    PRODUCT: 'Maelstrom',
    SOLANA_CLUSTER: 'mainnet-beta',
    ELEVENLABS_WEBHOOK_SECRET: SECRET,
    META_MODEL_API_KEY: 'LLM_test_secret_value_here',
    voiceFetcher: fetcher,
  });
  assert.equal(response.status, 200);
  const sse = await response.text();
  assert.match(sse, /desk text agent writes the reply/);
  assert.equal(sse.includes('tool_calls'), false);
  assert.equal(called, false);
});
