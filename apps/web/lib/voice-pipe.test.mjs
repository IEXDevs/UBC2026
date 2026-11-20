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
      set onended(fn) { if (fn) queueMicrotask(fn); },
    }),
  });
  assert.equal(spoken.url, '/api/voice/speak');
  assert.equal(spoken.body.text, 'SOL is flat.');
  assert.equal(played[0], 'play');
  listeners.get('committed_transcript')?.({ text: 'after' });
  assert.deepEqual(commits, ['check sol', 'after']);
  pipe.endSession();
});

function streamFixture(t, { managed = false, supported = true, setupError = false } = {}) {
  const sources = new Map();
  const revoked = [];
  const appended = [];
  let source;
  let finish;
  let started;
  const playing = new Promise(resolve => { started = resolve; });
  const ended = new Promise(resolve => { finish = resolve; });
  class Source extends EventTarget {
    static isTypeSupported(type) { return supported && type === 'audio/mpeg'; }
    constructor() { super(); source = this; this.readyState = 'closed'; }
    addSourceBuffer(type) {
      assert.equal(type, 'audio/mpeg');
      if (setupError) throw new Error('unsupported');
      this.buffer = new EventTarget();
      this.buffer.appendBuffer = chunk => {
        appended.push([...chunk]);
        queueMicrotask(() => this.buffer.dispatchEvent(new Event('updateend')));
      };
      return this.buffer;
    }
    endOfStream() { this.readyState = 'ended'; finish(); }
  }
  for (const key of ['MediaSource', 'ManagedMediaSource']) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value: key === (managed ? 'ManagedMediaSource' : 'MediaSource') ? Source : undefined });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else delete globalThis[key];
    });
  }
  t.mock.method(URL, 'createObjectURL', value => {
    const url = `blob:test-${sources.size}`;
    sources.set(url, value);
    return url;
  });
  t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  const audio = new EventTarget();
  Object.defineProperty(audio, 'src', {
    set(url) {
      const media = sources.get(url);
      if (media instanceof Source) queueMicrotask(() => {
        media.readyState = 'open';
        media.dispatchEvent(new Event('sourceopen'));
      });
    },
  });
  audio.play = () => { started(); return Promise.resolve(); };
  audio.pause = t.mock.fn();
  audio.removeAttribute = t.mock.fn();
  audio.load = t.mock.fn();
  const suppression = [];
  const pipe = { suppress: value => suppression.push(value), setOutputVolume() {} };
  return { audio, playing, ended, sources, revoked, appended, suppression, pipe, get source() { return source; } };
}

for (const managed of [false, true]) {
  test(`speech plays before download finishes using ${managed ? 'ManagedMediaSource' : 'MediaSource'}`, async t => {
    const f = streamFixture(t, { managed });
    let input;
    const body = new ReadableStream({ start(controller) { input = controller; } });
    const job = playAgentSpeech({
      text: 'A streamed reply', pipe: f.pipe, settings: { volume: 50 },
      fetcher: async () => ({ ok: true, body, arrayBuffer() { assert.fail('must not buffer'); } }),
      createAudio: () => f.audio,
    });
    input.enqueue(new Uint8Array([1, 2]));
    await f.playing;
    assert.deepEqual(f.appended, [[1, 2]]);
    assert.deepEqual(f.suppression, [true]);
    assert.equal(f.source.readyState, 'open');
    assert.equal(f.audio.volume, 0.5);
    assert.equal(f.audio.disableRemotePlayback, true);
    input.enqueue(new Uint8Array([3]));
    input.close();
    await f.ended;
    assert.deepEqual(f.appended, [[1, 2], [3]]);
    assert.deepEqual(f.suppression, [true]);
    f.audio.dispatchEvent(new Event('ended'));
    await job;
    assert.deepEqual(f.suppression, [true, false]);
    assert.deepEqual(f.revoked, [...f.sources.keys()]);
    assert.equal(f.audio.pause.mock.callCount(), 1);
  });
}

for (const setupError of [false, true]) {
  test(`speech falls back to a blob when streaming is ${setupError ? 'rejected during setup' : 'unsupported'}`, async t => {
    const f = streamFixture(t, { supported: setupError, setupError });
    let buffered = false;
    const job = playAgentSpeech({
      text: 'Fallback', pipe: f.pipe,
      fetcher: async () => ({ ok: true, body: new ReadableStream(), arrayBuffer: async () => {
        buffered = true;
        return new Uint8Array([1]).buffer;
      } }),
      createAudio: () => f.audio,
    });
    await f.playing;
    assert.equal(buffered, true);
    assert.ok([...f.sources.values()].at(-1) instanceof Blob);
    f.audio.dispatchEvent(new Event('ended'));
    await job;
    assert.deepEqual(f.revoked, [...f.sources.keys()]);
    assert.deepEqual(f.suppression, [true, false]);
  });
}

test('empty text does not fetch and empty streamed audio cleans up without playback', async t => {
  await playAgentSpeech({ text: ' ', fetcher() { assert.fail('empty text'); } });
  const f = streamFixture(t);
  await playAgentSpeech({
    text: 'Empty', pipe: f.pipe, createAudio: () => f.audio,
    fetcher: async () => ({ ok: true, body: new ReadableStream({ start(controller) { controller.close(); } }) }),
  });
  assert.deepEqual(f.appended, []);
  assert.deepEqual(f.revoked, [...f.sources.keys()]);
  assert.deepEqual(f.suppression, [true, false]);
});

for (const failure of ['network', 'http', 'read', 'audio', 'play', 'append']) {
  test(`speech cleans up after ${failure} failure`, async t => {
    const f = streamFixture(t);
    let input;
    let cancelled = false;
    const body = new ReadableStream({ start(controller) { input = controller; }, cancel() { cancelled = true; } });
    if (failure === 'play') f.audio.play = () => Promise.reject(new Error('play failed'));
    const job = playAgentSpeech({
      text: 'Error', pipe: f.pipe, createAudio: () => f.audio,
      fetcher: async () => {
        if (failure === 'network') throw new Error('offline');
        return { ok: failure !== 'http', body };
      },
    });
    const rejected = assert.rejects(job);
    if (['read', 'audio', 'append'].includes(failure)) {
      input.enqueue(new Uint8Array([1]));
      await f.playing;
      if (failure === 'read') input.error(new Error('read failed'));
      if (failure === 'audio') f.audio.dispatchEvent(new Event('error'));
      if (failure === 'append') {
        f.source.buffer.appendBuffer = () => { throw new Error('append failed'); };
        input.enqueue(new Uint8Array([2]));
      }
    } else if (failure === 'play') input.enqueue(new Uint8Array([1]));
    await rejected;
    if (['audio', 'play', 'append'].includes(failure)) assert.equal(cancelled, true);
    assert.deepEqual(f.revoked, [...f.sources.keys()]);
    assert.deepEqual(f.suppression, [true, false]);
  });
}

test('ending the pipe aborts downloading speech and pauses playback', async t => {
  const f = streamFixture(t);
  const pipe = startVoicePipe({
    fetcher: async () => ({ ok: true, json: async () => ({ token: 'test' }) }),
    loadClient: async () => fakeClient(),
    connect: () => ({ on() {}, close() {} }),
  });
  await pipe.ready;
  let input;
  let cancelled = false;
  let signal;
  const job = playAgentSpeech({
    text: 'Stop me', pipe, createAudio: () => f.audio,
    fetcher: async (_url, init) => {
      signal = init.signal;
      return { ok: true, body: new ReadableStream({ start(controller) { input = controller; }, cancel() { cancelled = true; } }) };
    },
  });
  input.enqueue(new Uint8Array([1]));
  await f.playing;
  pipe.endSession();
  await job;
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, true);
  assert.equal(f.audio.pause.mock.callCount(), 1);
  assert.deepEqual(f.revoked, [...f.sources.keys()]);
});

test('a replacement reply interrupts the old reply without releasing its transcript suppression', async t => {
  const f = streamFixture(t, { supported: false });
  const commits = [];
  const listeners = new Map();
  const pipe = startVoicePipe({
    fetcher: async () => ({ ok: true, json: async () => ({ token: 'test' }) }),
    loadClient: async () => fakeClient(),
    connect: () => ({ on(event, fn) { listeners.set(event, fn); }, close() {} }),
    onCommit: text => commits.push(text),
  });
  await pipe.ready;
  const first = playAgentSpeech({
    text: 'First', pipe, createAudio: () => f.audio,
    fetcher: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }),
  });
  await f.playing;
  let stopSignal;
  const second = playAgentSpeech({
    text: 'Second', pipe,
    fetcher: (_url, { signal }) => new Promise((_resolve, reject) => {
      stopSignal = signal;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  });
  await first;
  listeners.get('committed_transcript')({ text: 'echo' });
  assert.deepEqual(commits, []);
  assert.equal(pipe.getOutputVolume(), 0.7);
  assert.equal(f.audio.pause.mock.callCount(), 1);
  pipe.endSession();
  await second;
  assert.equal(stopSignal.aborted, true);
  assert.equal(pipe.getOutputVolume(), 0);
  assert.deepEqual(f.revoked, [...f.sources.keys()]);
});

test('an empty blob response does not play or leak a URL', async t => {
  const f = streamFixture(t, { supported: false });
  await playAgentSpeech({
    text: 'Empty blob', pipe: f.pipe,
    fetcher: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }),
    createAudio() { assert.fail('empty audio'); },
  });
  assert.deepEqual(f.revoked, []);
  assert.deepEqual(f.suppression, [true, false]);
});
