import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  claimLookupVerdict,
  claimSaveNote,
  handleAlreadyClaimed,
  mentionIn,
  profileAfterDirectoryRead,
  profileRailLabel,
  profileSaveResult,
  recipientHint,
  sendHandleHint,
  sendHandleReady,
} from './profile.mjs';

/**
 * Achieves: verifies a message can name a handle or an SNS name.
 * Fails when: a message can name a handle or an SNS name breaks (e.g. expected '@Alex', '@richclub.sol', null).
 * Oracle: assert.equal(mentionIn('send it to @Alex'), '@Alex'); assert.equal(mentionIn('pay @richclub.sol today'), '@richclub.sol'); assert.equal(mentionIn('hello'), null); assert.equal(recipientHint({ kind: 'handle', handle: 'alex', displayName: 'Alex', address: '4zMMC9srt5Ri5X14GA; assert.equal(recipientHint({ kind: 'handle', handle: 'alex', missing: true }); assert.equal(recipientHint({ kind: 'handle', handle: 'royce', missing: false, self: true })
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('a message can name a handle or an SNS name', () => {
  assert.equal(mentionIn('send it to @Alex'), '@Alex');
  assert.equal(mentionIn('pay @richclub.sol today'), '@richclub.sol');
  assert.equal(mentionIn('hello'), null);
  assert.equal(recipientHint({ kind: 'handle', handle: 'alex', displayName: 'Alex', address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' }), 'Alex (4zMMC...DncDU)');
  assert.equal(recipientHint({ kind: 'handle', handle: 'hi', address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' }), '@hi (4zMMC...DncDU)');
  assert.equal(recipientHint({ kind: 'handle', handle: 'alex', missing: true }), '@alex is not on Maelstrom');
  assert.equal(recipientHint({ kind: 'handle', handle: 'royce', missing: false, self: true }), '@royce');
  assert.equal(recipientHint({ kind: 'handle', handle: 'royce', missing: false }), '@royce does not have a wallet yet.');
  assert.equal(recipientHint({ kind: 'sns', domain: 'richclub.sol', address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' }), 'richclub.sol (4zMMC...DncDU)');
  assert.equal(recipientHint({ kind: 'sns', domain: 'richclub.sol', error: 'sns_not_found' }), 'Failed.');
  assert.equal(profileRailLabel({ handle: 'sid', displayName: 'Sid Chevvan' }), '@sid');
  assert.equal(profileRailLabel({ handle: '  @sid ', displayName: 'Sid Chevvan' }), '@sid');
  assert.equal(profileRailLabel({ displayName: 'Sid Chevvan', fallback: 'You' }), 'Sid Chevvan');
  assert.equal(profileRailLabel({ fallback: 'You' }), 'You');
});

/**
 * Achieves: Send only enables a @handle after lookup finds a wallet address.
 * Fails when: missing handles, wallet-less profiles, or loading state still count as ready.
 * Oracle: address ready; missing/self-without-wallet blocked; hints name Maelstrom or wallet.
 * Side effects / state checked: N/A.
 * Gaps: does not call the directory.
 */
test('send blocks a handle until lookup finds a wallet', () => {
  assert.equal(sendHandleReady({ kind: 'handle', handle: 'alex', missing: true }), false);
  assert.equal(sendHandleReady({ kind: 'handle', handle: 'alex', missing: false }), false);
  assert.equal(sendHandleReady({
    kind: 'handle',
    handle: 'alex',
    missing: false,
    address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  }), true);
  assert.equal(sendHandleHint(null, { looking: true, handle: 'alex' }), 'Looking up @alex.');
  assert.equal(sendHandleHint({ kind: 'handle', handle: 'alex', missing: true }), '@alex is not on Maelstrom');
  assert.equal(
    sendHandleHint({ kind: 'handle', handle: 'royce', missing: false, self: true }),
    '@royce does not have a wallet yet.',
  );
});

/**
 * Achieves: verifies an empty Supabase directory does not erase a saved handle claim.
 * Fails when: an empty Supabase directory does not erase a saved handle claim breaks (e.g. expected 'keep', 'alex', 'Alex').
 * Oracle: assert.equal(empty.persist, 'keep'); assert.equal(empty.profile.handle, 'alex'); assert.equal(empty.profile.displayName, 'Alex'); assert.equal(missingName.persist, 'keep'); assert.equal(missingName.profile.handle, 'alex'); assert.equal(nothing.persist, 'clear')
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('an empty Supabase directory does not erase a saved handle claim', () => {
  const local = { handle: 'alex', displayName: 'Alex' };
  const empty = profileAfterDirectoryRead(local, { ok: true, source: 'supabase', profile: null });
  assert.equal(empty.persist, 'keep');
  assert.equal(empty.profile.handle, 'alex');
  assert.equal(empty.profile.displayName, 'Alex');
  const missingName = profileAfterDirectoryRead({ handle: 'alex' }, { source: 'supabase', profile: null });
  assert.equal(missingName.persist, 'keep');
  assert.equal(missingName.profile.handle, 'alex');
  const nothing = profileAfterDirectoryRead(null, { source: 'supabase', profile: null });
  assert.equal(nothing.persist, 'clear');
  const server = profileAfterDirectoryRead(local, {
    source: 'supabase',
    profile: { handle: 'alex', displayName: 'Alex Rivera' },
  });
  assert.equal(server.persist, 'write');
  assert.equal(server.profile.displayName, 'Alex Rivera');
  assert.equal(profileAfterDirectoryRead(local, { source: 'local' }).persist, 'keep');
});

/**
 * Achieves: verifies a 200 without a stored handle is not a saved claim.
 * Fails when: a 200 without a stored handle is not a saved claim breaks (e.g. expected false, 'profile_save_failed', false).
 * Oracle: assert.equal(missing.ok, false); assert.equal(missing.error, 'profile_save_failed'); assert.equal(echoed.ok, false); assert.equal(echoed.error, 'profile_save_failed'); assert.equal(stored.ok, true); assert.equal(stored.profile.handle, 'alex')
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('a 200 without a stored handle is not a saved claim', () => {
  const missing = profileSaveResult(200, { ok: true, source: 'supabase', profile: null }, 'alex');
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'profile_save_failed');
  const echoed = profileSaveResult(200, {
    ok: true,
    source: 'unconfigured',
    profile: { handle: 'alex', displayName: 'Alex' },
  }, 'alex');
  assert.equal(echoed.ok, false);
  assert.equal(echoed.error, 'profile_save_failed');
  const stored = profileSaveResult(200, {
    ok: true,
    source: 'supabase',
    profile: { handle: 'alex', displayName: 'Alex' },
  }, 'alex');
  assert.equal(stored.ok, true);
  assert.equal(stored.profile.handle, 'alex');
  const kept = profileAfterDirectoryRead(
    { handle: 'alex', displayName: 'Alex' },
    { ok: true, source: 'supabase', profile: null },
  );
  assert.equal(kept.persist, 'keep');
  assert.equal(kept.profile.handle, 'alex');
});

/**
 * Achieves: verifies a failed claim names the status and error code.
 * Fails when: a failed claim names the status and error code breaks (e.g. expected handle: 'alex', missing: true } }, handle: 'alex', missing: false } }, handle: 'royce', missing: false, self: true } }).
 * Oracle: assert.equal(handleAlreadyClaimed({ recipient: { kind: 'handle', handle: 'alex', missing: true } }); assert.equal(handleAlreadyClaimed({ recipient: { kind: 'handle', handle: 'alex', missing: false } }); assert.equal(handleAlreadyClaimed({ recipient: { kind: 'handle', handle: 'royce', missing: false, self: true }; assert.equal(handleAlreadyClaimed({ recipient: { kind: 'sns', domain: 'alex.sol' } }); assert.equal(claimSaveNote({ error: 'handle_taken' }), 'That handle is already taken.'); assert.equal( claimSaveNote({ status: 502, code: 'profile_save_failed' })
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('a failed claim names the status and error code', () => {
  assert.equal(handleAlreadyClaimed({ recipient: { kind: 'handle', handle: 'alex', missing: true } }), false);
  assert.equal(handleAlreadyClaimed({ recipient: { kind: 'handle', handle: 'alex', missing: false } }), true);
  assert.equal(handleAlreadyClaimed({ recipient: { kind: 'handle', handle: 'royce', missing: false, self: true } }), false);
  assert.equal(handleAlreadyClaimed({ recipient: { kind: 'sns', domain: 'alex.sol' } }), false);
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

/**
 * Achieves: verifies a handle can be claimed only after the directory says it is open.
 * Fails when: a handle can be claimed only after the directory says it is open breaks (e.g. expected { recipient: { kind: 'handle', handle: 'royce', missing: tru, { recipient: { kind: 'handle', handle: 'royce', missing: fal, { error: 'runtime_unconfigured' }).
 * Oracle: assert.equal(claimLookupVerdict(200, { recipient: { kind: 'handle', handle: 'royce', missing: true } }); assert.equal(claimLookupVerdict(200, { recipient: { kind: 'handle', handle: 'royce', missing: false } }); assert.equal(claimLookupVerdict(503, { error: 'runtime_unconfigured' }); assert.equal(claimLookupVerdict(502, { error: 'profile_read_failed' }); assert.equal(claimLookupVerdict(0, {})
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('a handle can be claimed only after the directory says it is open', () => {
  assert.equal(claimLookupVerdict(200, { recipient: { kind: 'handle', handle: 'royce', missing: true } }), 'open');
  assert.equal(claimLookupVerdict(200, { recipient: { kind: 'handle', handle: 'royce', missing: false } }), 'taken');
  assert.equal(claimLookupVerdict(503, { error: 'runtime_unconfigured' }), 'open');
  assert.equal(claimLookupVerdict(502, { error: 'profile_read_failed' }), 'error');
  assert.equal(claimLookupVerdict(0, {}), 'error');
});
