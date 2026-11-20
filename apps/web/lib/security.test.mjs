import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applySecurityActionLocal,
  buildSecurityPage,
  pauseAllUrl,
  securityActionLabel,
  securityAgentStatus,
} from './security.mjs';
import { getDemoShellState } from './demo-state.mjs';

test('the scrollable agent statuses remain reachable with a keyboard', () => {
  const source = readFileSync(new URL('../components/SecurityPanel.js', import.meta.url), 'utf8');
  assert.match(source, /<ul className="security-agent-list" tabIndex=\{0\} aria-label="Agent statuses">/);
});

test('security action accessible names use the visible button text', () => {
  const source = readFileSync(new URL('../components/SecurityPanel.js', import.meta.url), 'utf8');
  const button = source.match(/<button[\s\S]*?className="security-action-button"[\s\S]*?<\/button>/)?.[0];
  assert.ok(button);
  assert.match(button, /look\.button/);
  assert.doesNotMatch(button, /aria-label=/);
});

/**
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
  assert.ok(page.actions.every((action) => action.description.length > 20));
  assert.equal(securityActionLabel('unfreeze-all-bots'), 'Unfreeze every agent');
  assert.equal(securityActionLabel('pause-all'), 'Pause every agent');
  assert.ok(page.notes.every((n) => !/sk-|eyJ|secret/i.test(n)));
  assert.equal(pauseAllUrl('https://runtime.example/', 'bot_1'), 'https://runtime.example/bots/bot_1/pause');
  assert.equal(pauseAllUrl('javascript:x', 'bot_1'), null);
});

test('agent status prioritizes frozen and paused over enabled', () => {
  assert.equal(securityAgentStatus({ frozen: true, enabled: true, status: 'paused' }), 'Frozen');
  assert.equal(securityAgentStatus({ enabled: true, status: 'paused' }), 'Paused');
  assert.equal(securityAgentStatus({ enabled: false, status: 'draft' }), 'Draft');
  assert.equal(securityAgentStatus({ enabled: false, status: 'idle' }), 'Disabled');
  assert.equal(securityAgentStatus({ enabled: true, status: 'watching' }), 'Enabled');
});

test('security overview handles an empty signed-out account without invented agents', () => {
  const page = buildSecurityPage();
  assert.equal(page.signedIn, false);
  assert.equal(page.accountLabel, 'Not signed in');
  assert.deepEqual(page.summary, { botCount: 0, enabled: 0, paused: 0, frozen: 0 });
  assert.deepEqual(page.bots, []);
});

test('security status reflects the record after a freeze and unfreeze', () => {
  const bots = [{ id: 'one', name: 'One', status: 'watching', record: { enabled: true, frozen: false } }];
  const frozen = applySecurityActionLocal(bots, 'freeze-all-bots');
  const page = buildSecurityPage({ ownerId: 'owner', bots: frozen });
  assert.equal(page.summary.frozen, 1);
  assert.equal(page.summary.paused, 1);
  assert.equal(securityAgentStatus(page.bots[0]), 'Frozen');
  const unfrozen = buildSecurityPage({ bots: applySecurityActionLocal(frozen, 'unfreeze-all-bots') });
  assert.equal(securityAgentStatus(unfrozen.bots[0]), 'Paused');
  assert.equal(bots[0].status, 'watching');
  assert.equal(bots[0].record.frozen, false);
});

/**
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
