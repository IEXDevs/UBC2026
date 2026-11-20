import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VoiceTokenError,
  requestScribeToken,
  requestSpeech,
  requestVoiceSignedUrl,
  requestVoiceToken,
  speechSpeed,
} from './voice-token.mjs';

/**
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

/**
 * Achieves: verifies scribe single-use token POST path, xi-api-key header, and unconfigured/reject/unreachable codes.
 * Fails when: method ≠ POST, URL drifts, empty key ≠ voice_unconfigured, HTTP fail ≠ voice_rejected, or throw ≠ voice_unreachable.
 * Oracle: POST https://api.elevenlabs.io/v1/single-use-token/realtime_scribe → token; VoiceTokenError codes match conversation path.
 * Side effects / state checked: stub fetcher records method/href/key.
 * Gaps: none for requestScribeToken error surface.
 */
test('a voice signed URL request returns a websocket URL', async () => {
  const signed = await requestVoiceSignedUrl({
    apiKey: 'server-key',
    agentId: 'agent_test',
    fetcher: async (url, init) => {
      assert.equal(String(url), 'https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=agent_test');
      assert.equal(init.headers['xi-api-key'], 'server-key');
      return { ok: true, json: async () => ({ signed_url: 'wss://api.elevenlabs.io/v1/convai/conversation?sig=1' }) };
    },
  });
  assert.equal(signed, 'wss://api.elevenlabs.io/v1/convai/conversation?sig=1');
  await assert.rejects(
    () => requestVoiceSignedUrl({
      apiKey: 'server-key',
      agentId: 'agent_test',
      fetcher: async () => ({ ok: true, json: async () => ({ signed_url: 'https://not-ws.example' }) }),
    }),
    error => error.code === 'voice_rejected',
  );
});

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

/**
 * Achieves: speech rendering posts clipped text to ElevenLabs flash and never returns the API key.
 * Fails when: an empty key calls out, speed leaves 0.7–1.2, or the key appears in the thrown error.
 * Oracle: POST /v1/text-to-speech/{voiceId}/stream with xi-api-key and eleven_flash_v2_5.
 * Side effects: injected fetcher only.
 * Gaps: does not play audio.
 */
test('requestSpeech streams a desk reply and keeps the API key on the request', async () => {
  assert.equal(speechSpeed(0.1), 0.7);
  assert.equal(speechSpeed(3), 1.2);
  await assert.rejects(
    () => requestSpeech({ apiKey: '', voiceId: '21m00Tcm4TlvDq8ikWAM', text: 'hello' }),
    error => error.code === 'voice_unconfigured',
  );
  let seen;
  const audio = await requestSpeech({
    apiKey: 'server-key',
    voiceId: '21m00Tcm4TlvDq8ikWAM',
    text: '  hello there  ',
    speed: 0.9,
    fetcher: async (url, init) => {
      seen = { href: String(url), method: init.method, key: init.headers['xi-api-key'], body: JSON.parse(init.body) };
      return { ok: true, body: new Uint8Array([1, 2, 3]) };
    },
  });
  assert.equal(audio.body[0], 1);
  assert.equal(seen.method, 'POST');
  assert.equal(seen.key, 'server-key');
  assert.match(seen.href, /\/text-to-speech\/21m00Tcm4TlvDq8ikWAM\/stream/);
  assert.equal(new URL(seen.href).searchParams.get('output_format'), 'mp3_22050_32');
  assert.equal(new URL(seen.href).searchParams.get('optimize_streaming_latency'), '3');
  assert.equal(seen.body.text, 'hello there');
  assert.equal(seen.body.model_id, 'eleven_flash_v2_5');
  assert.equal(seen.body.voice_settings.speed, 0.9);
  assert.equal(JSON.stringify(seen.body).includes('server-key'), false);
});
