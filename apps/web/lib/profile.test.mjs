import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimSaveNote, mentionIn, profileAfterDirectoryRead, profileRailLabel, recipientHint } from './profile.mjs';

test('a message can name a handle or an SNS name', () => {
  assert.equal(mentionIn('send it to @Alex'), '@Alex');
  assert.equal(mentionIn('pay @richclub.sol today'), '@richclub.sol');
  assert.equal(mentionIn('hello'), null);
  assert.equal(recipientHint({ kind: 'handle', handle: 'alex', displayName: 'Alex', address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' }), 'Alex(4zMMC...DncDU)');
  assert.equal(recipientHint({ kind: 'handle', handle: 'alex', missing: true }), '@alex is not on Maelstrom');
  assert.equal(recipientHint({ kind: 'sns', domain: 'richclub.sol', address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' }), 'richclub.sol(4zMMC...DncDU)');
  assert.equal(recipientHint({ kind: 'sns', domain: 'richclub.sol', error: 'sns_not_found' }), 'Failed.');
  assert.equal(profileRailLabel({ handle: 'sid', displayName: 'Sid Chevvan' }), '@sid');
  assert.equal(profileRailLabel({ handle: '  @sid ', displayName: 'Sid Chevvan' }), '@sid');
  assert.equal(profileRailLabel({ displayName: 'Sid Chevvan', fallback: 'You' }), 'Sid Chevvan');
  assert.equal(profileRailLabel({ fallback: 'You' }), 'You');
});

test('an empty Supabase directory does not erase a saved handle claim', () => {
  const local = { handle: 'alex', displayName: 'Alex' };
  const empty = profileAfterDirectoryRead(local, { ok: true, source: 'supabase', profile: null });
  assert.equal(empty.persist, 'keep');
  assert.equal(empty.profile.handle, 'alex');
  assert.equal(empty.profile.displayName, 'Alex');
  const missingName = profileAfterDirectoryRead({ handle: 'alex' }, { source: 'supabase', profile: null });
  assert.equal(missingName.persist, 'clear');
  const server = profileAfterDirectoryRead(local, {
    source: 'supabase',
    profile: { handle: 'alex', displayName: 'Alex Rivera' },
  });
  assert.equal(server.persist, 'write');
  assert.equal(server.profile.displayName, 'Alex Rivera');
  assert.equal(profileAfterDirectoryRead(local, { source: 'local' }).persist, 'keep');
});

test('a failed claim names the status and error code', () => {
  assert.equal(claimSaveNote({ error: 'handle_taken' }), 'That handle is already taken.');
  assert.equal(
    claimSaveNote({ status: 502, code: 'profile_save_failed' }),
    'The directory did not update (502 profile_save_failed). Try the claim again.',
  );
  assert.equal(
    claimSaveNote({ status: 400, code: 'invalid_profile' }),
    'The directory did not update (400 invalid_profile). Try the claim again.',
  );
  assert.equal(claimSaveNote({ status: 502, code: 'Bearer secret-value' }), 'The directory did not update (502 profile_save_failed). Try the claim again.');
  assert.equal(claimSaveNote(new Error('network')), 'The directory did not update (profile_save_failed). Try the claim again.');
});
