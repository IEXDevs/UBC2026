import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dictationBusyError,
  dictationUnsupportedError,
  joinTranscript,
  startBrowserDictation,
} from './dictation.mjs';

function fakeClient() {
  const CommitStrategy = { VAD: 'vad', MANUAL: 'manual' };
  const RealtimeEvents = {
    PARTIAL_TRANSCRIPT: 'partial_transcript',
    COMMITTED_TRANSCRIPT: 'committed_transcript',
    ERROR: 'error',
    AUTH_ERROR: 'auth_error',
    QUOTA_EXCEEDED: 'quota_exceeded',
    CLOSE: 'close',
  };
  return { CommitStrategy, RealtimeEvents, Scribe: { connect() {} } };
}

/*
 * Achieves: verifies dictation helpers expose stable error codes.
 * Fails when: dictation helpers expose stable error codes breaks (e.g. expected 'unsupported', 'voice_live', '', 'world ']).
 * Oracle: assert.equal(dictationUnsupportedError().code, 'unsupported'); assert.equal(dictationBusyError().code, 'voice_live'); assert.equal(joinTranscript([' hello ', '', 'world '])
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('dictation helpers expose stable error codes', () => {
  assert.equal(dictationUnsupportedError().code, 'unsupported');
  assert.equal(dictationBusyError().code, 'voice_live');
  assert.equal(joinTranscript([' hello ', '', 'world ']), 'hello world');
});

/*
 * Achieves: verifies startBrowserDictation streams partials and cancel settles with committed text.
 * Fails when: startBrowserDictation streams partials and cancel settles with committed text breaks (e.g. expected 'function', 'sutkn_test', 'scribe_v2_realtime').
 * Oracle: assert.equal(typeof job.cancel, 'function'); assert.equal(connectOpts.token, 'sutkn_test'); assert.equal(connectOpts.modelId, 'scribe_v2_realtime'); assert.equal(connectOpts.commitStrategy, 'vad'); assert.equal(await job, 'hello world'); assert.deepEqual(partials, ['hel', 'hello', 'hello'])
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
test('startBrowserDictation streams partials and cancel settles with committed text', async () => {
  let connectOpts = null;
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const listeners = new Map();
  const connection = {
    on(event, fn) {
      listeners.set(event, fn);
    },
    commit() {
      listeners.get('committed_transcript')?.({ text: 'world' });
    },
    close() {
      listeners.get('close')?.();
    },
  };
  const partials = [];

  const job = startBrowserDictation({
    commitGraceMs: 20,
    onPartial: (text) => partials.push(text),
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

  assert.equal(typeof job.cancel, 'function');
  await ready;
  assert.equal(connectOpts.token, 'sutkn_test');
  assert.equal(connectOpts.modelId, 'scribe_v2_realtime');
  assert.equal(connectOpts.commitStrategy, 'vad');
  listeners.get('partial_transcript')?.({ text: 'hel' });
  listeners.get('partial_transcript')?.({ text: 'hello' });
  listeners.get('committed_transcript')?.({ text: 'hello' });
  assert.deepEqual(partials, ['hel', 'hello', 'hello']);
  job.cancel();
  assert.equal(await job, 'hello world');
});

/*
 * Achieves: verifies startBrowserDictation rejects when the scribe token route fails.
 * Fails when: startBrowserDictation rejects when the scribe token route fails no longer holds.
 * Oracle: assert.rejects( () => startBrowserDictation({ fetcher: async () => ({ ok: false, json: async () => ({ error: '
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
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
