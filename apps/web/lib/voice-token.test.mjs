import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceTokenError, requestScribeToken, requestVoiceToken } from './voice-token.mjs';

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

test('a scribe token request mints a single-use realtime_scribe token', async () => {
  let seen;
  const token = await requestScribeToken({
    apiKey: 'server-key',
    fetcher: async (url, init) => {
      seen = { href: String(url), method: init.method, key: init.headers['xi-api-key'] };
      return { ok: true, json: async () => ({ token: 'sutkn_scribe' }) };
    },
  });
  assert.equal(token, 'sutkn_scribe');
  assert.equal(seen.method, 'POST');
  assert.equal(seen.key, 'server-key');
  assert.equal(seen.href, 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe');
});

