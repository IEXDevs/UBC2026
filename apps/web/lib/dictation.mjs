/**
 * Browser speech-to-text for the prompt bar (dictation).
 * Distinct from ElevenLabs voice mode — this only fills the text draft.
 */

export function speechRecognitionCtor(global = globalThis) {
  return global.SpeechRecognition || global.webkitSpeechRecognition || null;
}

export function dictationUnsupportedError() {
  const error = new Error('Speech recognition is not available in this browser.');
  error.code = 'unsupported';
  return error;
}

export function dictationBusyError() {
  const error = new Error('Voice mode is already using the microphone.');
  error.code = 'voice_live';
  return error;
}

/**
 * Start one dictation pass. Resolves with the final transcript (may be '').
 * Call `cancel()` to stop early; a cancelled pass resolves to ''.
 */
export function startBrowserDictation({
  lang = 'en-US',
  Recognition = speechRecognitionCtor(),
} = {}) {
  let recognition = null;
  let settled = false;
  let cancelled = false;
  let finalText = '';

  const settle = (resolve, reject, ok, value) => {
    if (settled) return;
    settled = true;
    if (ok) resolve(value);
    else reject(value);
  };

  const promise = new Promise((resolve, reject) => {
    if (typeof Recognition !== 'function') {
      settle(resolve, reject, false, dictationUnsupportedError());
      return;
    }
    try {
      recognition = new Recognition();
    } catch (error) {
      settle(resolve, reject, false, error instanceof Error ? error : dictationUnsupportedError());
      return;
    }
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const text = [...(event?.results || [])]
        .map((result) => result?.[0]?.transcript || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if ([...(event?.results || [])].some((result) => result?.isFinal)) {
        finalText = text;
      }
    };
    recognition.onerror = (event) => {
      if (cancelled || event?.error === 'aborted' || event?.error === 'no-speech') {
        settle(resolve, reject, true, '');
        return;
      }
      const error = new Error(event?.error || 'dictation_failed');
      error.code = 'dictation_failed';
      settle(resolve, reject, false, error);
    };
    recognition.onend = () => {
      settle(resolve, reject, true, cancelled ? '' : finalText);
    };
    try {
      recognition.start();
    } catch (error) {
      settle(resolve, reject, false, error instanceof Error ? error : dictationUnsupportedError());
    }
  });

  promise.cancel = () => {
    cancelled = true;
    try {
      recognition?.stop?.();
    } catch {
      /* already stopped */
    }
  };

  return promise;
}
