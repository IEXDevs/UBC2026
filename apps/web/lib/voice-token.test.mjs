import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceTokenError, requestScribeToken, requestVoiceToken } from './voice-token.mjs';

/*
 * Achieves: verifies conversation token mint uses xi-api-key, returns only the token, and maps empty key / HTTP / network failures.
 * Fails when: empty apiKey ≠ voice_unconfigured, URL/agent_id drift, reject ≠ voice_rejected, or throw ≠ voice_unreachable.
 * Oracle: GET https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=…; VoiceTokenError codes.
 * Side effects / state checked: stub fetcher records href + xi-api-key header.
 * Gaps: no live ElevenLabs.
 */
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
  await assert.rejects(
    () => requestVoiceToken({
      apiKey: 'server-key',
      agentId: 'agent_test',
      fetcher: async () => { throw new Error('network'); },
    }),
    error => error.code === 'voice_unreachable',
  );
});

/*
 * Achieves: verifies scribe single-use token POST path, xi-api-key header, and unconfigured/reject/unreachable codes.
 * Fails when: method ≠ POST, URL drifts, empty key ≠ voice_unconfigured, HTTP fail ≠ voice_rejected, or throw ≠ voice_unreachable.
 * Oracle: POST https://api.elevenlabs.io/v1/single-use-token/realtime_scribe → token; VoiceTokenError codes match conversation path.
 * Side effects / state checked: stub fetcher records method/href/key.
 * Gaps: none for requestScribeToken error surface.
 */
test('a scribe token request mints a single-use realtime_scribe token', async () => {
  await assert.rejects(
    () => requestScribeToken({ apiKey: '' }),
    error => error instanceof VoiceTokenError && error.code === 'voice_unconfigured',
  );

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

  await assert.rejects(
    () => requestScribeToken({
      apiKey: 'server-key',
      fetcher: async () => ({ ok: false, json: async () => ({ detail: 'no' }) }),
    }),
    error => error.code === 'voice_rejected',
  );
  await assert.rejects(
    () => requestScribeToken({
      apiKey: 'server-key',
      fetcher: async () => { throw new Error('network'); },
    }),
    error => error.code === 'voice_unreachable',
  );
});
