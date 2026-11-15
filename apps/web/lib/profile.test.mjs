import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mentionIn, profileRailLabel, recipientHint } from './profile.mjs';

test('a message can name a handle or an SNS name', () => {
  assert.equal(mentionIn('send it to @Alex'), '@Alex');
  assert.equal(mentionIn('pay @richclub.sol today'), '@richclub.sol');
  assert.equal(mentionIn('hello'), null);
  assert.match(recipientHint({ kind: 'handle', handle: 'alex', displayName: 'Alex', address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' }), /Sends to Alex/);
  assert.equal(recipientHint({ kind: 'handle', handle: 'alex', missing: true }), '@alex is not on Maelstrom');
  assert.match(recipientHint({ kind: 'sns', domain: 'richclub.sol' }), /SNS/);
  assert.match(recipientHint({ kind: 'sns', domain: 'richclub.sol', error: 'sns_not_found' }), /not found/);
  assert.equal(profileRailLabel({ handle: 'sid', displayName: 'Sid Chevvan' }), '@sid');
  assert.equal(profileRailLabel({ handle: '  @sid ', displayName: 'Sid Chevvan' }), '@sid');
  assert.equal(profileRailLabel({ displayName: 'Sid Chevvan', fallback: 'You' }), 'Sid Chevvan');
  assert.equal(profileRailLabel({ fallback: 'You' }), 'You');
});
