/**
 * Start an ElevenLabs voice conversation.
 * Prefer a plain session first — portal agents often reject TTS overrides and
 * that used to kill the whole call before any audio.
 */

export function isVoiceOverrideError(error) {
  const text = `${error?.message || ''} ${error?.code || ''}`.toLowerCase();
  return /override|voice_id|voice id|tts|not allowed|not enabled|unsupported/.test(text);
}

/**
 * @param {{ startSession: (options: object) => Promise<object> }} Conversation
 * @param {object} options
 */
export async function startVoiceConversation(Conversation, options = {}) {
  if (!Conversation || typeof Conversation.startSession !== 'function') {
    throw new Error('voice_client_missing');
  }
  const { overrides, ...rest } = options;
  // Connect without overrides first so Voice ID / Speed portal gates cannot
  // block the call. Optionally upgrade with overrides after connect.
  const live = await Conversation.startSession(rest);
  if (!overrides || typeof overrides !== 'object') return live;
  try {
    if (typeof live?.setOverrides === 'function') {
      await live.setOverrides(overrides);
    }
  } catch {
    /* keep the connected session; voice still works with agent defaults */
  }
  return live;
}
