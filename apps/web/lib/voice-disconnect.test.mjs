import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyVoiceDisconnect, voiceErrorNote } from './voice-disconnect.mjs';

/**
 * Achieves: user stop stays silent; agent/error disconnects keep a retry note.
 * Fails when: unexpected disconnect clears the note or looks like a user stop.
 * Oracle: kind/retryable/note per reason.
 * Side effects: none.
 * Gaps: none.
 */
test('classifyVoiceDisconnect separates user stop from unexpected ends', () => {
  const user = classifyVoiceDisconnect({ reason: 'user' });
  assert.equal(user.kind, 'user');
  assert.equal(user.retryable, false);
  assert.equal(user.note, '');

  const manual = classifyVoiceDisconnect({ reason: 'error', message: 'boom' }, { userEnded: true });
  assert.equal(manual.kind, 'user');
  assert.equal(manual.note, '');

  const agent = classifyVoiceDisconnect({ reason: 'agent', closeReason: 'end_call' });
  assert.equal(agent.kind, 'agent');
  assert.equal(agent.retryable, true);
  assert.match(agent.note, /ended the call/);
  assert.match(agent.note, /retry/i);

  const error = classifyVoiceDisconnect({ reason: 'error', message: 'custom llm 401', closeCode: 1006 });
  assert.equal(error.kind, 'error');
  assert.equal(error.retryable, true);
  assert.match(error.note, /dropped/);
  assert.match(error.note, /custom llm 401/);
  assert.match(error.note, /retry/i);
});

test('voiceErrorNote keeps recoverable detail', () => {
  assert.match(voiceErrorNote('socket failed'), /socket failed/);
  assert.match(voiceErrorNote('', { message: 'upstream' }), /upstream/);
  assert.match(voiceErrorNote(''), /Tap Talk to retry/);
});
