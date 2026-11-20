/**
 * Start an ElevenLabs voice conversation.
 * Prefer a plain session first — portal agents often reject TTS overrides and
 * that used to kill the whole call before any audio.
 *
 * Prefer signed WebSocket when available: LiveKit/WebRTC rooms have been
 * dropping shortly after connect on Chrome. Fall back to conversationToken.
 */

export function isVoiceOverrideError(error) {
  const text = `${error?.message || ''} ${error?.code || ''}`.toLowerCase();
  return /override|voice_id|voice id|tts|not allowed|not enabled|unsupported/.test(text);
}

export function isLiveKitDisconnect(details = {}) {
  const blob = `${details?.message || ''} ${details?.closeReason || ''} ${details?.reason || ''}`.toLowerCase();
  return /livekit|webrtc|room|peerconnection|ice|sctp/.test(blob);
}

/**
 * Build the startSession options for the preferred transport.
 * signedUrl → websocket; otherwise conversationToken → webrtc.
 */
export function voiceConnectionOptions({ token = '', signedUrl = '', preferWebsocket = true } = {}) {
  const signed = typeof signedUrl === 'string' ? signedUrl.trim() : '';
  const conversationToken = typeof token === 'string' ? token.trim() : '';
  if (preferWebsocket && signed) {
    return { signedUrl: signed, connectionType: 'websocket' };
  }
  if (conversationToken) {
    return { conversationToken, connectionType: 'webrtc' };
  }
  if (signed) {
    return { signedUrl: signed, connectionType: 'websocket' };
  }
  return null;
}

/**
 * @param {{ startSession: (options: object) => Promise<object> }} Conversation
 * @param {object} options
 */
export async function startVoiceConversation(Conversation, options = {}) {
  if (!Conversation || typeof Conversation.startSession !== 'function') {
    throw new Error('voice_client_missing');
  }
  const {
    overrides,
    conversationToken,
    signedUrl,
    preferWebsocket = true,
    connectionType: _ignored,
    ...rest
  } = options;
  const connection = voiceConnectionOptions({
    token: conversationToken,
    signedUrl,
    preferWebsocket,
  });
  if (!connection) throw new Error('voice_connection_missing');
  // Connect without overrides first so Voice ID / Speed portal gates cannot
  // block the call. Optionally upgrade with overrides after connect.
  const live = await Conversation.startSession({ ...rest, ...connection });
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
