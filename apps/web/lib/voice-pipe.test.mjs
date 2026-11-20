import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReplySpeech, createSpeechQueue, playAgentSpeech, splitSpeechSentences, startVoicePipe } from './voice-pipe.mjs';

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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('speech queue removes reply markdown for speech without changing the chat text', async () => {
  const finished = deferred();
  const text = '**Latest model** from $1199.\n[Apple](https://apple.com/)';
  const queue = createSpeechQueue({
    fetcher: async (_url, init) => {
      assert.equal(JSON.parse(init.body).text, 'Latest model from $1199. Apple');
      return {};
    },
    play: async ({ text: spoken, response }) => {
      await response;
      finished.resolve(spoken);
    },
  });
  queue.enqueue(text);
  assert.equal(await finished.promise, 'Latest model from $1199. Apple');
  assert.match(text, /\*\*Latest model\*\*/);
  queue.stop();
});

test('sentence splitting holds fragments, combines tiny sentences and flushes the last tail', () => {
  assert.deepEqual(splitSpeechSentences(''), { sentences: [], rest: '' });
  assert.deepEqual(splitSpeechSentences('Hi. Still thinking'), { sentences: [], rest: 'Hi. Still thinking' });
  assert.deepEqual(splitSpeechSentences('Hi. This is a complete response. Next fragment'), {
    sentences: ['Hi. This is a complete response.'], rest: ' Next fragment',
  });
  assert.deepEqual(splitSpeechSentences('A long complete question here? Another complete sentence here!\nA final fragment', { final: true }), {
    sentences: ['A long complete question here?', 'Another complete sentence here!', 'A final fragment'], rest: '',
  });
  assert.deepEqual(splitSpeechSentences('A complete newline boundary here\nNext'), {
    sentences: ['A complete newline boundary here'], rest: 'Next',
  });
  assert.equal(splitSpeechSentences('Not a boundary.yet!still incomplete').sentences.length, 0);
});

test('reply speech keeps a decimal split across deltas together until whitespace or final flush', () => {
  const spoken = [];
  const reply = createReplySpeech({ enqueue: text => spoken.push(text) });
  reply.event({ type: 'reply_delta', text: 'The current price is $123.' });
  assert.deepEqual(spoken, []);
  reply.event({ type: 'reply_delta', text: '45 per token.' });
  assert.deepEqual(spoken, []);
  reply.event({ type: 'reply_delta', text: ' The remaining balance is $456.' });
  assert.deepEqual(spoken, ['The current price is $123.45 per token.']);
  reply.event({ type: 'reply_delta', text: '78 in total.' });
  assert.deepEqual(spoken, ['The current price is $123.45 per token.']);
  assert.equal(reply.complete(), true);
  assert.deepEqual(spoken, ['The current price is $123.45 per token.', 'The remaining balance is $456.78 in total.']);
});

test('reply speech buffers the first sentence and does not repeat the final full reply', () => {
  const spoken = [];
  let cleared = 0;
  const queue = { enqueue: text => spoken.push(text), clear: () => { cleared++; } };
  const reply = createReplySpeech(queue);
  reply.event({ type: 'reply_delta', text: 'The beginning of an answer' });
  assert.deepEqual(spoken, []);
  reply.event({ type: 'reply_delta', text: '. The last tail' });
  assert.deepEqual(spoken, ['The beginning of an answer.']);
  if (!reply.complete()) queue.enqueue('The beginning of an answer. The last tail');
  assert.deepEqual(spoken, ['The beginning of an answer.', 'The last tail']);
  reply.event({ type: 'reply_delta', text: 'A new unverified answer here.' });
  reply.event({ type: 'reply_retract' });
  assert.equal(cleared, 1);
  assert.equal(reply.complete(), false);
  const textOnly = createReplySpeech(null);
  textOnly.event({ type: 'reply_delta', text: 'Ignored.' });
  assert.equal(textOnly.complete(), false);
});

test('speech queue plays in order and prefetches only the next sentence during playback', async () => {
  const requests = [];
  const played = [];
  const gates = [deferred(), deferred(), deferred()];
  const started = [deferred(), deferred(), deferred()];
  const queue = createSpeechQueue({
    fetcher: async (_url, init) => { const text = JSON.parse(init.body).text; requests.push(text); return { text }; },
    play: async ({ text, response }) => {
      assert.equal((await response).text, text);
      const index = played.length;
      played.push(text);
      started[index].resolve();
      await gates[index].promise;
    },
  });
  queue.enqueue('First sentence.');
  queue.enqueue('Second sentence.');
  queue.enqueue('Third sentence.');
  await started[0].promise;
  assert.deepEqual(requests, ['First sentence.', 'Second sentence.']);
  assert.deepEqual(played, ['First sentence.']);
  gates[0].resolve();
  await started[1].promise;
  assert.deepEqual(requests, ['First sentence.', 'Second sentence.', 'Third sentence.']);
  assert.deepEqual(played, ['First sentence.', 'Second sentence.']);
  gates[1].resolve();
  await started[2].promise;
  gates[2].resolve();
  queue.stop();
});

test('queue retraction cancels active playback and prefetch, clears pending work, and can resume', async () => {
  const signals = [];
  const played = [];
  const started = deferred();
  const resumed = deferred();
  const queue = createSpeechQueue({
    fetcher: async (_url, init) => { signals.push(init.signal); return {}; },
    play: async ({ text, response, signal }) => {
      await response;
      played.push(text);
      if (text === 'Replacement') { resumed.resolve(); return; }
      started.resolve();
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    },
  });
  queue.enqueue('First');
  queue.enqueue('Prefetched');
  queue.enqueue('Not prefetched');
  await started.promise;
  assert.equal(signals.length, 2);
  queue.clear();
  assert.ok(signals.every(signal => signal.aborted));
  queue.enqueue('Replacement');
  await resumed.promise;
  assert.deepEqual(played, ['First', 'Replacement']);
  queue.stop();
  queue.enqueue('Ignored after stop');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(played, ['First', 'Replacement']);
});

test('queue handles prefetch failure without unhandled rejection or losing subsequent speech', async () => {
  const errors = [];
  const finished = deferred();
  const queue = createSpeechQueue({
    fetcher: async (_url, init) => {
      if (JSON.parse(init.body).text === 'Bad') throw new Error('offline');
      return {};
    },
    play: async ({ text, response }) => { await response; if (text === 'Good') finished.resolve(); },
    onError: error => errors.push(error.message),
  });
  queue.enqueue('');
  queue.enqueue('Bad');
  queue.enqueue('Good');
  await finished.promise;
  assert.deepEqual(errors, ['offline']);
  queue.stop();
});

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

test('queue cancellation stops real prefetched playback and keeps current voice settings', async t => {
  const f = streamFixture(t, { supported: false });
  const settings = { voiceId: 'first', volume: 50 };
  const requests = [];
  const queue = createSpeechQueue({
    pipe: f.pipe, settings: () => ({ ...settings }),
    fetcher: async (_url, init) => {
      requests.push({ ...JSON.parse(init.body), signal: init.signal });
      return { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer };
    },
    play: options => playAgentSpeech({ ...options, createAudio: () => f.audio }),
  });
  queue.enqueue('First sentence');
  settings.voiceId = 'second';
  queue.enqueue('Second sentence');
  await f.playing;
  assert.deepEqual(requests.map(request => request.voiceId), ['first', 'second']);
  queue.clear();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(requests.every(request => request.signal.aborted));
  assert.equal(f.audio.pause.mock.callCount(), 1);
  assert.deepEqual(f.revoked, [...f.sources.keys()]);
  assert.deepEqual(f.suppression, [true, false]);
  queue.stop();
});
