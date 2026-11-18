/**
 * Classify ElevenLabs disconnect details for the composer.
 * Distinguishes user stop from unexpected agent/error ends so the UI can
 * keep a recoverable note instead of silently clearing the stage.
 */

export function classifyVoiceDisconnect(details, { userEnded = false } = {}) {
  if (userEnded === true || details?.reason === 'user') {
    return {
      kind: 'user',
      retryable: false,
      note: '',
      reason: 'user',
      message: '',
      closeCode: null,
    };
  }
  const reason = typeof details?.reason === 'string' ? details.reason : 'error';
  const message = typeof details?.message === 'string' ? details.message.trim() : '';
  const closeCode = Number.isFinite(details?.closeCode) ? details.closeCode : null;
  const closeReason = typeof details?.closeReason === 'string' ? details.closeReason.trim() : '';
  const detail = message || closeReason || (closeCode != null ? `code ${closeCode}` : '');
  if (reason === 'agent') {
    return {
      kind: 'agent',
      retryable: true,
      note: detail
        ? `The voice agent ended the call (${detail}). Tap Talk to retry.`
        : 'The voice agent ended the call. Tap Talk to retry.',
      reason,
      message: detail,
      closeCode,
    };
  }
  return {
    kind: 'error',
    retryable: true,
    note: detail
      ? `The voice session dropped (${detail}). Tap Talk to retry.`
      : 'The voice session dropped unexpectedly. Tap Talk to retry.',
    reason: reason || 'error',
    message: detail,
    closeCode,
  };
}

export function voiceErrorNote(message, context) {
  const text = typeof message === 'string' ? message.trim() : '';
  const ctx = typeof context?.message === 'string' ? context.message.trim() : '';
  const detail = text || ctx;
  return detail
    ? `The voice session hit an error (${detail}). Tap Talk to retry.`
    : 'The voice session hit an error. Tap Talk to retry.';
}
