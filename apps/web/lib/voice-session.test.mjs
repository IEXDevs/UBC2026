import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVoiceOverrideError, startVoiceConversation } from './voice-session.mjs';

/**
 * Achieves: override detection matches ElevenLabs portal rejection wording.
 * Fails when: obvious override errors are missed or unrelated errors match.
 * Oracle: true for override/voice_id; false for mic denial.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('isVoiceOverrideError matches portal override failures', () => {
  assert.equal(isVoiceOverrideError(new Error('Override voice_id is not allowed')), true);
  assert.equal(isVoiceOverrideError({ message: 'tts overrides not enabled' }), true);
  assert.equal(isVoiceOverrideError(new Error('NotAllowedError')), false);
});

/**
 * Achieves: startVoiceConversation retries without overrides after failure.
 * Fails when: first success is ignored, or retry never drops overrides.
 * Oracle: second call has no overrides; returns retry session.
 * Side effects / state checked: call shapes.
 * Gaps: none.
 */
test('startVoiceConversation retries without overrides', async () => {
  const calls = [];
  const Conversation = {
    async startSession(options) {
      calls.push(options);
      if (options.overrides) throw new Error('Override voice_id is not allowed');
      return { id: 'conv_ok', getId: () => 'conv_ok' };
    },
  };
  const live = await startVoiceConversation(Conversation, {
    conversationToken: 'tok',
    overrides: { tts: { voiceId: 'v1', speed: 1 } },
    dynamicVariables: { owner_id: 'did:privy:1' },
  });
  assert.equal(live.id, 'conv_ok');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].overrides, { tts: { voiceId: 'v1', speed: 1 } });
  assert.equal(Object.prototype.hasOwnProperty.call(calls[1], 'overrides'), false);
  assert.equal(calls[1].conversationToken, 'tok');
  assert.equal(calls[1].dynamicVariables.owner_id, 'did:privy:1');
});

/**
 * Achieves: successful first start does not retry.
 * Fails when: a second startSession is issued.
 * Oracle: one call; returned session is first.
 * Side effects / state checked: call count.
 * Gaps: none.
 */
test('startVoiceConversation keeps the first session when overrides work', async () => {
  let count = 0;
  const Conversation = {
    async startSession() {
      count += 1;
      return { id: `n${count}` };
    },
  };
  const live = await startVoiceConversation(Conversation, {
    conversationToken: 'tok',
    overrides: { tts: { speed: 1 } },
  });
  assert.equal(live.id, 'n1');
  assert.equal(count, 1);
});
