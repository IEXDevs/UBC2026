/**
 * ElevenLabs Scribe dictation for the prompt bar.
 * Fills the text draft only — distinct from live agent voice mode.
 */

export function dictationUnsupportedError() {
  const error = new Error('ElevenLabs dictation is not available.');
  error.code = 'unsupported';
  return error;
}

export function dictationBusyError() {
  const error = new Error('Voice mode is already using the microphone.');
  error.code = 'voice_live';
  return error;
}

function joinTranscript(parts) {
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Start ElevenLabs realtime STT. Resolves with committed transcript text (may be '').
 * Call `cancel()` to stop; resolves with whatever was committed so far.
 *
 * @param {object} [options]
 * @param {string} [options.tokenUrl]
 * @param {typeof fetch} [options.fetcher]
 * @param {(opts: object) => object} [options.connect] — inject Scribe.connect in tests
 * @param {() => Promise<{ Scribe: any, CommitStrategy: any, RealtimeEvents: any }>} [options.loadClient]
 */
export function startBrowserDictation({
  tokenUrl = '/api/voice/scribe-token',
  fetcher = fetch,
  connect = null,
  loadClient = async () => import('@elevenlabs/client'),
} = {}) {
  let connection = null;
  let settled = false;
  let cancelled = false;
  const parts = [];
  let resolveOuter = null;
  let rejectOuter = null;

  const settle = (ok, value) => {
    if (settled) return;
    settled = true;
    try {
      connection?.close?.();
    } catch {
      /* already closed */
    }
    connection = null;
    if (ok) resolveOuter?.(value);
    else rejectOuter?.(value);
  };

  const promise = new Promise((resolve, reject) => {
    resolveOuter = resolve;
    rejectOuter = reject;

    (async () => {
      let response;
      try {
        response = await fetcher(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
        });
      } catch {
        settle(false, Object.assign(new Error('dictation_unreachable'), { code: 'dictation_unreachable' }));
        return;
      }
      if (cancelled) {
        settle(true, '');
        return;
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || typeof payload?.token !== 'string' || !payload.token.trim()) {
        const error = new Error(payload?.error || 'dictation_rejected');
        error.code = payload?.error || 'dictation_rejected';
        settle(false, error);
        return;
      }

      const client = await loadClient();
      if (cancelled) {
        settle(true, '');
        return;
      }
      const Scribe = client.Scribe;
      const CommitStrategy = client.CommitStrategy;
      const RealtimeEvents = client.RealtimeEvents;
      if (typeof Scribe?.connect !== 'function' || !CommitStrategy || !RealtimeEvents) {
        settle(false, dictationUnsupportedError());
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
        settle(false, error instanceof Error ? error : dictationUnsupportedError());
        return;
      }

      if (cancelled) {
        settle(true, '');
        return;
      }

      const fail = (raw) => {
        const error = raw instanceof Error ? raw : new Error(raw?.error || raw?.message || 'dictation_failed');
        if (!error.code) error.code = 'dictation_failed';
        settle(false, error);
      };

      connection.on?.(RealtimeEvents.COMMITTED_TRANSCRIPT, (data) => {
        const text = typeof data?.text === 'string' ? data.text.trim() : '';
        if (text) parts.push(text);
      });
      connection.on?.(RealtimeEvents.ERROR, fail);
      connection.on?.(RealtimeEvents.AUTH_ERROR, fail);
      connection.on?.(RealtimeEvents.QUOTA_EXCEEDED, fail);
      connection.on?.(RealtimeEvents.CLOSE, () => {
        settle(true, joinTranscript(parts));
      });
    })().catch((error) => {
      settle(false, error instanceof Error ? error : dictationUnsupportedError());
    });
  });

  promise.cancel = () => {
    cancelled = true;
    if (connection) {
      try {
        connection.close?.();
      } catch {
        /* already closed */
      }
      return;
    }
    // Token/connect still in flight — the async path settles once cancelled is seen.
  };

  return promise;
}
