import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isLiveKitDisconnect,
  isVoiceOverrideError,
  startVoiceConversation,
  voiceConnectionOptions,
} from './voice-session.mjs';

test('isVoiceOverrideError matches portal TTS rejects', () => {
  assert.equal(isVoiceOverrideError({ message: 'voice_id not allowed' }), true);
  assert.equal(isVoiceOverrideError({ message: 'network' }), false);
});

test('voiceConnectionOptions prefers websocket signedUrl over LiveKit token', () => {
  assert.deepEqual(
    voiceConnectionOptions({
      token: 'tok',
      signedUrl: 'wss://api.elevenlabs.io/v1/convai/conversation?signature=1',
      preferWebsocket: true,
    }),
    {
      signedUrl: 'wss://api.elevenlabs.io/v1/convai/conversation?signature=1',
      connectionType: 'websocket',
    },
  );
  assert.deepEqual(
    voiceConnectionOptions({ token: 'tok', signedUrl: '', preferWebsocket: true }),
    { conversationToken: 'tok', connectionType: 'webrtc' },
  );
  assert.equal(isLiveKitDisconnect({ message: 'LiveKit room closed' }), true);
  assert.equal(isLiveKitDisconnect({ message: 'user hangup' }), false);
});

/**
 * Achieves: startVoiceConversation connects without overrides first.
 * Fails when: overrides are required on startSession or session is dropped.
 * Oracle: startSession has no overrides; setOverrides called with tts.
 */
test('startVoiceConversation connects without overrides first', async () => {
  const calls = [];
  const Conversation = {
    async startSession(options) {
      calls.push(options);
      return {
        id: 'live',
        async setOverrides(next) {
          calls.push({ overrides: next });
        },
      };
    },
  };
  const live = await startVoiceConversation(Conversation, {
    conversationToken: 'tok',
    signedUrl: 'wss://example.test/voice',
    preferWebsocket: true,
    overrides: { tts: { voiceId: 'v1' } },
  });
  assert.equal(calls[0].signedUrl, 'wss://example.test/voice');
  assert.equal(calls[0].connectionType, 'websocket');
  assert.equal(calls[0].conversationToken, undefined);
  assert.equal(calls[0].overrides, undefined);
  assert.deepEqual(calls[1].overrides, { tts: { voiceId: 'v1' } });
  assert.equal(live.id, 'live');
});

/**
 * Oracle: one startSession; live id kept.
 */
test('startVoiceConversation keeps the session when setOverrides is missing', async () => {
  const Conversation = {
    async startSession() {
      return { id: 'kept' };
    },
  };
  const live = await startVoiceConversation(Conversation, {
    conversationToken: 'tok',
    overrides: { tts: { voiceId: 'v1' } },
  });
  assert.equal(live.id, 'kept');
});
