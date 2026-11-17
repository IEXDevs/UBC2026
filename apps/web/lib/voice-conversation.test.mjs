import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConversationLog, eventToConversationText } from './voice-conversation.mjs';

/**
 * Achieves: verifies ring-buffer conversation log, subscriber fan-out, and event text formatting.
 * Fails when: max is exceeded without FIFO drop, subscribers miss kinds, or formatting loses summary.
 * Oracle: max=3 keeps the newest three; first push is dropped; eventToConversationText uses kind+summary.
 * Side effects / state checked: subscriber sees pushed kinds; entries() length and recentText content.
 * Gaps: none for the log unit; ElevenLabs mount is out of scope.
 */
test('conversation log keeps live events for voice read-back', () => {
  const log = createConversationLog({ max: 3 });
  const seen = [];
  log.subscribe((entry) => seen.push(entry.kind));
  log.push({ kind: 'timeline', text: 'Trust gate passed' });
  log.push({ kind: 'security', text: 'Pause every bot' });
  log.pushUser('Show Live View');
  log.push({ kind: 'extra', text: 'overflow' });
  assert.equal(log.entries().length, 3);
  assert.equal(log.entries()[0].kind, 'security');
  assert.equal(log.entries().some((e) => e.kind === 'timeline'), false);
  assert.match(log.recentText(), /Pause every bot/);
  assert.equal(eventToConversationText({ kind: 'tx.confirmed', summary: 'Deposit landed' }), 'tx.confirmed: Deposit landed');
  assert.equal(eventToConversationText(null), null);
  assert.equal(log.push({ kind: 'empty', text: '   ' }), null);
  assert.ok(seen.includes('security'));
});
