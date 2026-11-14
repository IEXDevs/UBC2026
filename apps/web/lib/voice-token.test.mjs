import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceTokenError, requestVoiceToken } from './voice-token.mjs';

test('a voice token request uses the server key and returns only the token', async () => {
  await assert.rejects(
    () => requestVoiceToken({ apiKey: '', agentId: 'agent_test' }),
    error => error instanceof VoiceTokenError && error.code === 'voice_unconfigured',
  );

  let seen;
  const token = await requestVoiceToken({
    apiKey: 'server-key',
    agentId: 'agent_test',
    fetcher: async (url, init) => {
      seen = { href: String(url), key: init.headers['xi-api-key'] };
      return { ok: true, json: async () => ({ token: 'conversation-token' }) };
    },
  });

  assert.equal(token, 'conversation-token');
  assert.equal(seen.key, 'server-key');
  assert.equal(seen.href, 'https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=agent_test');

  await assert.rejects(
    () => requestVoiceToken({
      apiKey: 'server-key',
      agentId: 'agent_test',
      fetcher: async () => ({ ok: false, json: async () => ({ detail: 'no' }) }),
    }),
    error => error.code === 'voice_rejected',
  );
});
