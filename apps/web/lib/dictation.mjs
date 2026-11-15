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

export function joinTranscript(parts) {
  return (Array.isArray(parts) ? parts : [])
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Start ElevenLabs realtime STT.
 * - `onPartial(text)` fires as words arrive (committed + current partial).
 * - Resolves with the final committed transcript (may be '').
 * - `cancel()` stops the mic and settles quickly.
 */
export function startBrowserDictation({
  tokenUrl = '/api/voice/scribe-token',
  fetcher = fetch,
  connect = null,
  loadClient = async () => import('@elevenlabs/client'),
  commitGraceMs = 450,
  onPartial = null,
} = {}) {
  let connection = null;
  let settled = false;
  let cancelled = false;
  let closing = false;
  const parts = [];
  let partial = '';
  let resolveOuter = null;
  let rejectOuter = null;
  let commitTimer = 0;
  let closeTimer = 0;

  const liveText = () => joinTranscript(partial ? [...parts, partial] : parts);

  const emitPartial = () => {
    if (typeof onPartial !== 'function') return;
    try {
      onPartial(liveText());
    } catch {
      /* UI errors must not kill dictation */
    }
  };

  const settle = (ok, value) => {
    if (settled) return;
    settled = true;
    if (commitTimer) {
      clearTimeout(commitTimer);
      commitTimer = 0;
    }
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = 0;
    }
    try {
      connection?.close?.();
    } catch {
      /* already closed */
    }
    connection = null;
    if (ok) resolveOuter?.(value);
    else rejectOuter?.(value);
  };

  const finish = () => {
    partial = '';
    settle(true, joinTranscript(parts));
  };

  const requestStop = () => {
    cancelled = true;
    if (settled) return;
    if (!connection) return;
    if (closing) return;
    closing = true;
    try {
      connection.commit?.();
    } catch {
      /* optional */
    }
    // Release the mic quickly even if commit is slow.
    closeTimer = setTimeout(() => {
      try {
        connection?.close?.();
      } catch {
        /* ignore */
      }
    }, 120);
    commitTimer = setTimeout(() => {
      finish();
    }, Math.max(0, commitGraceMs));
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
          // VAD commits phrases while speaking; stop still flushes via commit().
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
        requestStop();
        return;
      }

      const fail = (raw) => {
        const error = raw instanceof Error ? raw : new Error(raw?.error || raw?.message || 'dictation_failed');
        if (!error.code) error.code = 'dictation_failed';
        settle(false, error);
      };

      connection.on?.(RealtimeEvents.PARTIAL_TRANSCRIPT, (data) => {
        partial = typeof data?.text === 'string' ? data.text : '';
        emitPartial();
      });
      connection.on?.(RealtimeEvents.COMMITTED_TRANSCRIPT, (data) => {
        partial = '';
        const text = typeof data?.text === 'string' ? data.text.trim() : '';
        if (text) parts.push(text);
        emitPartial();
        if (closing) finish();
      });
      connection.on?.(RealtimeEvents.ERROR, fail);
      connection.on?.(RealtimeEvents.AUTH_ERROR, fail);
      connection.on?.(RealtimeEvents.QUOTA_EXCEEDED, fail);
      connection.on?.(RealtimeEvents.CLOSE, () => {
        finish();
      });
    })().catch((error) => {
      settle(false, error instanceof Error ? error : dictationUnsupportedError());
    });
  });

  promise.cancel = () => {
    cancelled = true;
    if (connection) requestStop();
  };

  return promise;
}
