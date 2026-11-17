import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applySecurityActionLocal,
  buildSecurityPage,
  pauseAllUrl,
  securityActionLabel,
} from './security.mjs';
import { getDemoShellState } from './demo-state.mjs';

/*
 * Achieves: verifies security page lists kill-switch actions and never echoes secrets in notes.
 * Fails when: action count drifts, labels wrong, notes contain sk-/JWT/secret, or javascript: pause URL accepted.
 * Oracle: 4 actions; pause URL is runtime/bots/:id/pause; javascript:x → null.
 * Side effects / state checked: N/A.
 * Gaps: none for page builder; remote pause HTTP is out of scope.
 */
test('security page lists kill-switch actions without secrets', () => {
  const state = getDemoShellState();
  const page = buildSecurityPage({
    ownerId: 'did:privy:abc',
    accountLabel: 'a@example.com',
    bots: state.bots,
  });
  assert.equal(page.signedIn, true);
  assert.equal(page.actions.length, 4);
  assert.equal(securityActionLabel('unfreeze-all-bots'), 'Unfreeze every agent');
  assert.equal(securityActionLabel('pause-all'), 'Pause every agent');
  assert.ok(page.notes.every((n) => !/sk-|eyJ|secret/i.test(n)));
  assert.equal(pauseAllUrl('https://runtime.example/', 'bot_1'), 'https://runtime.example/bots/bot_1/pause');
  assert.equal(pauseAllUrl('javascript:x', 'bot_1'), null);
});

/*
 * Achieves: verifies local pause/freeze mutate bot shell status without remote calls.
 * Fails when: pause-all leaves watching bots active, or freeze-all leaves frozen=false on live bots.
 * Oracle: every bot is draft|paused after pause-all; frozen===true or draft after freeze-all.
 * Side effects / state checked: returned bot arrays only (inputs not required to stay immutable).
 * Gaps: none for local apply; undo/unfreeze path is separate.
 */
test('local pause and freeze update bot shell state', () => {
  const state = getDemoShellState();
  const paused = applySecurityActionLocal(state.bots, 'pause-all');
  assert.ok(paused.every((b) => b.status === 'draft' || b.status === 'paused'));
  const frozen = applySecurityActionLocal(state.bots, 'freeze-all-bots');
  assert.ok(frozen.every((b) => b.frozen === true || b.status === 'draft'));
});
