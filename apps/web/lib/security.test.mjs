import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applySecurityActionLocal,
  buildSecurityPage,
  pauseAllUrl,
  securityActionLabel,
} from './security.mjs';
import { getDemoShellState } from './demo-state.mjs';

test('security page lists kill-switch actions without secrets', () => {
  const state = getDemoShellState();
  const page = buildSecurityPage({
    ownerId: 'did:privy:abc',
    accountLabel: 'a@example.com',
    bots: state.bots,
  });
  assert.equal(page.signedIn, true);
  assert.equal(page.actions.length, 4);
  assert.equal(securityActionLabel('unfreeze-all-bots'), 'Unfreeze every bot');
  assert.equal(securityActionLabel('pause-all'), 'Pause every bot');
  assert.ok(page.notes.every((n) => !/sk-|eyJ|secret/i.test(n)));
  assert.equal(pauseAllUrl('https://runtime.example/', 'bot_1'), 'https://runtime.example/bots/bot_1/pause');
  assert.equal(pauseAllUrl('javascript:x', 'bot_1'), null);
});

test('local pause and freeze update bot shell state', () => {
  const state = getDemoShellState();
  const paused = applySecurityActionLocal(state.bots, 'pause-all');
  assert.ok(paused.every((b) => b.status === 'draft' || b.status === 'paused'));
  const frozen = applySecurityActionLocal(state.bots, 'freeze-all-bots');
  assert.ok(frozen.every((b) => b.frozen === true || b.status === 'draft'));
});
