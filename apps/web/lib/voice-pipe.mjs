/**
 * Talk mode is Scribe speech-to-text plus a spoken desk reply.
 * The text agent is the only one that decides. ElevenLabs does not get tools.
 */

import { dictationUnsupportedError } from './dictation.mjs';

export function startVoicePipe({
  tokenUrl = '/api/voice/scribe-token',
  fetcher = fetch,
  connect = null,
  loadClient = async () => import('@elevenlabs/client'),
  onPartial = null,
  onCommit = null,
  onError = null,
} = {}) {
  let connection = null;
  let stopped = false;
  let muted = false;
  let suppressed = false;
  let partial = '';
  let output = 0;
  let stopSpeech = null;
  let rejectReady = null;
  let resolveReady = null;

  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const emitPartial = () => {
    if (typeof onPartial !== 'function') return;
    try {
      onPartial(partial);
    } catch {
      /* UI errors must not kill the mic */
    }
  };

  const fail = (raw) => {
    const error = raw instanceof Error ? raw : new Error(raw?.error || raw?.message || 'dictation_failed');
    if (!error.code) error.code = 'dictation_failed';
    if (connection) {
      try { connection.close?.(); } catch { /* already closed */ }
      connection = null;
    }
    try { onError?.(error); } catch { /* UI errors must not loop */ }
    rejectReady?.(error);
  };

  const pipe = {
    ready,
    registerSpeech(stop) {
      stopSpeech?.();
      stopSpeech = stop;
      return () => {
        if (stopSpeech !== stop) return false;
        stopSpeech = null;
        return true;
      };
    },
    setMicMuted(next) {
      muted = next === true;
    },
    suppress(next) {
      suppressed = next === true;
    },
    getInputVolume() {
      return !muted && partial ? 0.45 : 0;
    },
    getOutputVolume() {
      return output;
    },
    setOutputVolume(value) {
      const number = Number(value);
      output = Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0;
    },
    endSession() {
      stopSpeech?.();
      stopped = true;
      suppressed = true;
      muted = true;
      partial = '';
      output = 0;
      try { connection?.close?.(); } catch { /* already closed */ }
      connection = null;
    },
  };

  (async () => {
    let response;
    try {
      response = await fetcher(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      });
    } catch {
      fail(Object.assign(new Error('dictation_unreachable'), { code: 'dictation_unreachable' }));
      return;
    }
    if (stopped) {
      resolveReady?.();
      return;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || typeof payload?.token !== 'string' || !payload.token.trim()) {
      const error = new Error(payload?.error || 'dictation_rejected');
      error.code = payload?.error || 'dictation_rejected';
      fail(error);
      return;
    }
    const client = await loadClient();
    if (stopped) {
      resolveReady?.();
      return;
    }
    const Scribe = client.Scribe;
    const CommitStrategy = client.CommitStrategy;
    const RealtimeEvents = client.RealtimeEvents;
    if (typeof Scribe?.connect !== 'function' || !CommitStrategy || !RealtimeEvents) {
      fail(dictationUnsupportedError());
      return;
    }
    try {
      connection = (connect || Scribe.connect)({
        token: payload.token.trim(),
        modelId: 'scribe_v2_realtime',
        commitStrategy: CommitStrategy.VAD,
        microphone: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      fail(error instanceof Error ? error : dictationUnsupportedError());
      return;
    }
    if (stopped) {
      pipe.endSession();
      resolveReady?.();
      return;
    }
    connection.on?.(RealtimeEvents.PARTIAL_TRANSCRIPT, (data) => {
      if (stopped || muted || suppressed) return;
      partial = typeof data?.text === 'string' ? data.text : '';
      emitPartial();
    });
    connection.on?.(RealtimeEvents.COMMITTED_TRANSCRIPT, (data) => {
      partial = '';
      emitPartial();
      if (stopped || muted || suppressed) return;
      const text = typeof data?.text === 'string' ? data.text.trim() : '';
      if (!text || typeof onCommit !== 'function') return;
      try {
        onCommit(text);
      } catch {
        /* a chat error must not close the mic */
      }
    });
    connection.on?.(RealtimeEvents.ERROR, fail);
    connection.on?.(RealtimeEvents.AUTH_ERROR, fail);
    connection.on?.(RealtimeEvents.QUOTA_EXCEEDED, fail);
    connection.on?.(RealtimeEvents.CLOSE, () => {
      connection = null;
    });
    resolveReady?.();
  })().catch((error) => {
    fail(error instanceof Error ? error : dictationUnsupportedError());
  });

  return pipe;
}

function audioEvent(target, name, signal, start = null) {
  return new Promise((resolve, reject) => {
    const clean = () => {
      if (target.removeEventListener) {
        target.removeEventListener(name, done);
        target.removeEventListener('error', fail);
      } else {
        target[`on${name}`] = null;
        target.onerror = null;
      }
      signal.removeEventListener('abort', abort);
    };
    const done = () => { clean(); resolve(); };
    const fail = () => {
      clean();
      reject(Object.assign(new Error('voice_rejected'), { code: 'voice_rejected' }));
    };
    const abort = () => { clean(); reject(signal.reason); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    if (target.addEventListener) {
      target.addEventListener(name, done, { once: true });
      target.addEventListener('error', fail, { once: true });
    } else {
      target.onerror = fail;
      target[`on${name}`] = done;
    }
    try { start?.(); } catch (error) { clean(); reject(error); }
  });
}

function speechMediaSource() {
  return [globalThis.MediaSource, globalThis.ManagedMediaSource]
    .find(Source => typeof Source === 'function' && Source.isTypeSupported?.('audio/mpeg'));
}

function fetchSpeech(text, settings, fetcher, signal) {
  return fetcher('/api/voice/speak', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 2000), voiceId: settings.voiceId, speed: settings.speed, volume: settings.volume }),
    cache: 'no-store',
    signal,
  });
}

/** Play a streamed reply when supported, otherwise use a complete MP3 blob. */
export async function playAgentSpeech({
  text,
  settings = {},
  fetcher = fetch,
  createAudio = null,
  pipe = null,
  response: prefetched = null,
  signal: parentSignal = null,
} = {}) {
  const spoken = typeof text === 'string' ? text.trim() : '';
  if (!spoken) return;
  const controller = new AbortController();
  const { signal } = controller;
  const abort = () => controller.abort();
  parentSignal?.addEventListener('abort', abort, { once: true });
  if (parentSignal?.aborted) controller.abort();
  const release = pipe?.registerSpeech?.(() => controller.abort());
  let reader = null;
  let audio = null;
  let url = '';
  const makeAudio = typeof createAudio === 'function'
    ? createAudio
    : (src) => (typeof Audio === 'function' ? new Audio(src) : null);
  const resetAudio = () => {
    audio?.pause?.();
    audio?.removeAttribute?.('src');
    audio?.load?.();
    if (url) URL.revokeObjectURL(url);
    url = '';
  };
  const prepareAudio = (src) => {
    audio = makeAudio(src);
    const volume = Number(settings.volume);
    if (audio && Number.isFinite(volume)) audio.volume = Math.min(1, Math.max(0, volume / 100));
  };
  const play = async () => {
    if (typeof audio?.play !== 'function') return;
    const ended = audioEvent(audio, 'ended', signal);
    await Promise.all([ended, Promise.resolve().then(() => audio.play())]);
  };
  pipe?.suppress?.(true);
  pipe?.setOutputVolume?.(0.7);
  try {
    const response = await (prefetched || fetchSpeech(spoken, settings, fetcher, signal));
    signal.throwIfAborted();
    if (!response?.ok) {
      const error = new Error('voice_rejected');
      error.code = 'voice_rejected';
      throw error;
    }
    const Source = response.body?.getReader ? speechMediaSource() : null;
    let media = null;
    let buffer = null;
    if (Source) {
      try {
        media = new Source();
        url = URL.createObjectURL(media);
        prepareAudio('');
        if (!audio) throw new Error('voice_rejected');
        audio.disableRemotePlayback = true;
        await audioEvent(media, 'sourceopen', signal, () => { audio.src = url; });
        buffer = media.addSourceBuffer('audio/mpeg');
      } catch (error) {
        resetAudio();
        if (signal.aborted) throw error;
        media = null;
      }
    }
    if (media && buffer) {
      reader = response.body.getReader();
      const cancel = () => { void reader.cancel().catch(() => {}); };
      signal.addEventListener('abort', cancel, { once: true });
      const append = chunk => audioEvent(buffer, 'updateend', signal, () => buffer.appendBuffer(chunk));
      try {
        const first = await reader.read();
        signal.throwIfAborted();
        if (first.done) return;
        await append(first.value);
        const pump = async () => {
          while (true) {
            const chunk = await reader.read();
            signal.throwIfAborted();
            if (chunk.done) break;
            await append(chunk.value);
          }
          if (media.readyState === 'open') media.endOfStream();
        };
        await Promise.all([pump(), play()]);
      } finally {
        signal.removeEventListener('abort', cancel);
      }
      return;
    }
    const bytes = typeof response.arrayBuffer === 'function'
      ? await response.arrayBuffer()
      : null;
    signal.throwIfAborted();
    if (!bytes?.byteLength) return;
    const BlobCtor = globalThis.Blob;
    const blob = typeof BlobCtor === 'function'
      ? new BlobCtor([bytes], { type: 'audio/mpeg' })
      : null;
    if (!blob) return;
    url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : '';
    prepareAudio(url);
    await play();
  } catch (error) {
    if (!signal.aborted) throw error;
  } finally {
    parentSignal?.removeEventListener('abort', abort);
    controller.abort();
    if (reader) {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    resetAudio();
    if (!release || release()) {
      pipe?.setOutputVolume?.(0);
      pipe?.suppress?.(false);
    }
  }
}

export function splitSpeechSentences(text, { final = false, minLength = 24 } = {}) {
  const sentences = [];
  let start = 0;
  const boundaries = final ? /[.!?](?=\s|$)|\n/g : /[.!?](?=\s)|\n/g;
  for (const match of text.matchAll(boundaries)) {
    const end = match.index + 1;
    if (text.slice(start, end).trim().length < minLength) continue;
    sentences.push(text.slice(start, end).trim());
    start = end;
  }
  const rest = text.slice(start);
  if (final && rest.trim()) sentences.push(rest.trim());
  return { sentences, rest: final ? '' : rest };
}

export function createSpeechQueue({ settings = {}, pipe = null, fetcher = fetch, play = playAgentSpeech, onError = null } = {}) {
  const pending = [];
  let active = null;
  let running = false;
  let stopped = false;
  let generation = 0;
  const prepare = item => {
    if (!item || item.response) return;
    item.response = Promise.resolve().then(() => fetchSpeech(item.text, item.settings, fetcher, item.controller.signal));
    item.response.catch(() => {});
  };
  const drain = async () => {
    if (running || stopped) return;
    running = true;
    const current = generation;
    try {
      while (pending.length && current === generation && !stopped) {
        active = pending.shift();
        const item = active;
        prepare(item);
        prepare(pending[0]);
        try {
          await play({ text: item.text, settings: item.settings, pipe, response: item.response, signal: item.controller.signal });
        } catch (error) {
          if (!item.controller.signal.aborted) onError?.(error);
        } finally {
          item.controller.abort();
        }
      }
    } finally {
      active = null;
      running = false;
      if (pending.length && !stopped) void drain();
    }
  };
  return {
    enqueue(text) {
      if (stopped || !text?.trim()) return;
      const spoken = text.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
      if (!spoken) return;
      pending.push({ text: spoken, settings: typeof settings === 'function' ? settings() : settings, controller: new AbortController(), response: null });
      if (active) prepare(pending[0]);
      void drain();
    },
    clear() {
      generation += 1;
      active?.controller.abort();
      for (const item of pending.splice(0)) item.controller.abort();
    },
    stop() { stopped = true; this.clear(); },
  };
}

export function createReplySpeech(queue) {
  let partial = '';
  let streamed = false;
  return {
    event(event) {
      if (!queue) return;
      if (event.type === 'reply_retract') {
        partial = '';
        streamed = false;
        queue.clear();
      } else if (event.type === 'reply_delta') {
        streamed = true;
        partial += event.text;
        const split = splitSpeechSentences(partial);
        partial = split.rest;
        for (const sentence of split.sentences) queue.enqueue(sentence);
      }
    },
    complete() {
      if (!queue || !streamed) return false;
      for (const sentence of splitSpeechSentences(partial, { final: true }).sentences) queue.enqueue(sentence);
      partial = '';
      streamed = false;
      return true;
    },
  };
}
