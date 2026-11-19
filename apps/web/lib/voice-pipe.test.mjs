import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playAgentSpeech, startVoicePipe } from './voice-pipe.mjs';

function fakeClient() {
  const CommitStrategy = { VAD: 'vad' };
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

/**
 * Achieves: a committed phrase is handed to the desk, and playback is not transcribed.
 * Fails when: mute or suppress still commits, or the speak request is not the desk reply.
 * Oracle: onCommit receives "check sol"; playAgentSpeech posts that text and ignores the echo commit.
 * Side effects: injected fetch and audio doubles.
 * Gaps: no live microphone.
 */
test('the voice pipe commits speech and does not transcribe its own playback', async () => {
  const listeners = new Map();
  let connectOpts = null;
  const connection = {
    on(event, fn) { listeners.set(event, fn); },
    close() { listeners.get('close')?.(); },
  };
  const commits = [];
  const pipe = startVoicePipe({
    fetcher: async () => ({ ok: true, json: async () => ({ token: 'sutkn_call' }) }),
    loadClient: async () => {
      const client = fakeClient();
      client.Scribe.connect = (opts) => {
        connectOpts = opts;
        return connection;
      };
      return client;
    },
    onCommit: (text) => commits.push(text),
  });
  await pipe.ready;
  assert.equal(connectOpts.modelId, 'scribe_v2_realtime');
  assert.equal(connectOpts.commitStrategy, 'vad');
  listeners.get('committed_transcript')?.({ text: 'check sol' });
  assert.deepEqual(commits, ['check sol']);
  pipe.setMicMuted(true);
  listeners.get('committed_transcript')?.({ text: 'ignored' });
  pipe.setMicMuted(false);
  pipe.suppress(true);
  listeners.get('committed_transcript')?.({ text: 'echo' });
  pipe.suppress(false);
  assert.deepEqual(commits, ['check sol']);

  let spoken = null;
  const played = [];
  await playAgentSpeech({
    text: 'SOL is flat.',
    settings: { voiceId: '21m00Tcm4TlvDq8ikWAM', speed: 0.9, volume: 50 },
    pipe,
    fetcher: async (url, init) => {
      spoken = { url, body: JSON.parse(init.body) };
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer };
    },
    createAudio: () => ({
      volume: 1,
      play() { played.push('play'); return Promise.resolve(); },
      onended: null,
      onerror: null,
      set onended(fn) { queueMicrotask(fn); },
    }),
  });
  assert.equal(spoken.url, '/api/voice/speak');
  assert.equal(spoken.body.text, 'SOL is flat.');
  assert.equal(played[0], 'play');
  listeners.get('committed_transcript')?.({ text: 'after' });
  assert.deepEqual(commits, ['check sol', 'after']);
  pipe.endSession();
});
