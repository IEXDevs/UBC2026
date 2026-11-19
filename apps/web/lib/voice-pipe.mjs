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

/**
 * Play one spoken reply. Inject createAudio in tests.
 * Suppress the mic around playback so the speaker is not transcribed.
 */
export async function playAgentSpeech({
  text,
  settings = {},
  fetcher = fetch,
  createAudio = null,
  pipe = null,
} = {}) {
  const spoken = typeof text === 'string' ? text.trim() : '';
  if (!spoken) return;
  pipe?.suppress?.(true);
  pipe?.setOutputVolume?.(0.7);
  try {
    const response = await fetcher('/api/voice/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: spoken.slice(0, 2000),
        voiceId: settings.voiceId,
        speed: settings.speed,
        volume: settings.volume,
      }),
      cache: 'no-store',
    });
    if (!response?.ok) {
      const error = new Error('voice_rejected');
      error.code = 'voice_rejected';
      throw error;
    }
    const bytes = typeof response.arrayBuffer === 'function'
      ? await response.arrayBuffer()
      : null;
    if (!bytes) return;
    const BlobCtor = globalThis.Blob;
    const blob = typeof BlobCtor === 'function'
      ? new BlobCtor([bytes], { type: 'audio/mpeg' })
      : null;
    const makeAudio = typeof createAudio === 'function'
      ? createAudio
      : (url) => (typeof Audio === 'function' ? new Audio(url) : null);
    if (!blob) return;
    const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : '';
    const audio = makeAudio(url);
    const volume = Number(settings.volume);
    if (audio && Number.isFinite(volume)) {
      audio.volume = Math.min(1, Math.max(0, volume / 100));
    }
    if (typeof audio?.play !== 'function') return;
    await audio.play();
    await new Promise((resolve, reject) => {
      audio.onended = resolve;
      audio.onerror = () => {
        const error = new Error('voice_rejected');
        error.code = 'voice_rejected';
        reject(error);
      };
    });
    if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
  } finally {
    pipe?.setOutputVolume?.(0);
    pipe?.suppress?.(false);
  }
}
