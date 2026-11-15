import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dictationBusyError,
  dictationUnsupportedError,
  startBrowserDictation,
} from './dictation.mjs';

function fakeClient() {
  const CommitStrategy = { VAD: 'vad', MANUAL: 'manual' };
  const RealtimeEvents = {
    COMMITTED_TRANSCRIPT: 'committed_transcript',
    ERROR: 'error',
    AUTH_ERROR: 'auth_error',
    QUOTA_EXCEEDED: 'quota_exceeded',
    CLOSE: 'close',
  };
  return { CommitStrategy, RealtimeEvents, Scribe: { connect() {} } };
}

test('dictation helpers expose stable error codes', () => {
  assert.equal(dictationUnsupportedError().code, 'unsupported');
  assert.equal(dictationBusyError().code, 'voice_live');
});

test('startBrowserDictation uses an ElevenLabs Scribe token and VAD commits', async () => {
  let connectOpts = null;
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const listeners = new Map();
  const connection = {
    on(event, fn) {
      listeners.set(event, fn);
    },
    close() {
      listeners.get('close')?.();
    },
  };

  const job = startBrowserDictation({
    fetcher: async () => ({
      ok: true,
      json: async () => ({ token: 'sutkn_test' }),
    }),
    loadClient: async () => {
      const client = fakeClient();
      client.Scribe.connect = (opts) => {
        connectOpts = opts;
        queueMicrotask(() => resolveReady());
        return connection;
      };
      return client;
    },
  });

  await ready;
  assert.equal(connectOpts.token, 'sutkn_test');
  assert.equal(connectOpts.modelId, 'scribe_v2_realtime');
  assert.equal(connectOpts.commitStrategy, 'manual');
  listeners.get('committed_transcript')?.({ text: 'hello ' });
  listeners.get('committed_transcript')?.({ text: ' world' });
  job.cancel();
  assert.equal(await job, 'hello world');
});

test('startBrowserDictation rejects when the scribe token route fails', async () => {
  await assert.rejects(
    () => startBrowserDictation({
      fetcher: async () => ({
        ok: false,
        json: async () => ({ error: 'voice_unconfigured' }),
      }),
      loadClient: async () => fakeClient(),
    }),
    (error) => error.code === 'voice_unconfigured',
  );
});
