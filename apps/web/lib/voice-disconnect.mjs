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
  const errorType = typeof context?.errorType === 'string'
    ? context.errorType.trim()
    : (typeof context?.error_type === 'string' ? context.error_type.trim() : '');
  const debug = typeof context?.debugMessage === 'string'
    ? context.debugMessage.trim()
    : (typeof context?.debug_message === 'string' ? context.debug_message.trim() : '');
  const detail = text || ctx || debug;
  if (/unknown error|server error:\s*unknown/i.test(detail) || errorType === 'unknown') {
    return 'The voice agent hit a server error while starting. Publish the ElevenLabs agent, check its tools, then Tap Talk to retry.';
  }
  if (errorType === 'override_error' || /override/i.test(detail)) {
    return 'The voice agent rejected session overrides. Publish it and enable Voice ID and Speed, then Tap Talk to retry.';
  }
  if (errorType === 'missing_dynamic_variable' || /dynamic variable/i.test(detail)) {
    return 'The voice agent is missing a required variable. Sync the agent, then Tap Talk to retry.';
  }
  if (errorType === 'custom_llm_error' || /custom llm/i.test(detail)) {
    return 'The voice agent’s language model failed. Check the custom LLM URL, then Tap Talk to retry.';
  }
  return detail
    ? `The voice session hit an error (${detail}). Tap Talk to retry.`
    : 'The voice session hit an error. Tap Talk to retry.';
}
