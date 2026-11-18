/**
 * Start an ElevenLabs voice conversation, retrying without TTS overrides when
 * the agent portal has Voice ID / Speed overrides disabled.
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
  if (!overrides || typeof overrides !== 'object') {
    return Conversation.startSession(rest);
  }
  try {
    return await Conversation.startSession({ ...rest, overrides });
  } catch (error) {
    // Always retry once without overrides: portal agents often mint tokens
    // but reject client TTS overrides, which used to abort the whole call.
    try {
      return await Conversation.startSession(rest);
    } catch (retryError) {
      if (isVoiceOverrideError(error) && !isVoiceOverrideError(retryError)) {
        throw retryError;
      }
      throw error;
    }
  }
}
