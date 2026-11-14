import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConversationLog, eventToConversationText } from './voice-conversation.mjs';

test('conversation log keeps live events for voice read-back', () => {
  const log = createConversationLog({ max: 3 });
  const seen = [];
  log.subscribe((entry) => seen.push(entry.kind));
  log.push({ kind: 'timeline', text: 'Trust gate passed' });
  log.push({ kind: 'security', text: 'Pause every bot' });
  log.pushUser('Show Live View');
  log.push({ kind: 'extra', text: 'overflow' });
  assert.equal(log.entries().length, 3);
  assert.match(log.recentText(), /Pause every bot/);
  assert.equal(eventToConversationText({ kind: 'tx.confirmed', summary: 'Deposit landed' }), 'tx.confirmed: Deposit landed');
  assert.ok(seen.includes('security'));
});
