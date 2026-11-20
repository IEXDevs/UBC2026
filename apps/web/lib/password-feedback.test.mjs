import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordFeedback } from './password-feedback.mjs';
import { passwordProblem } from './desk-lock.mjs';
import { generatePassword, secretAcceptAllowed } from './secret-generate.mjs';
import { normalizePassphrase } from './wallet-desk.mjs';

function deskFeedback(password = '', confirmation = '') {
  return passwordFeedback(password, confirmation, passwordProblem(password));
}

test('empty password fields have no premature error or success and cannot continue', () => {
  assert.deepEqual(deskFeedback(), { problem: '', confirmation: '', matches: false, ready: false });
  assert.equal(deskFeedback('valid-password').ready, false);
  assert.equal(deskFeedback('valid-password').confirmation, '');
  assert.equal(deskFeedback('', 'valid-password').confirmation, 'Passwords do not match.');
});

test('confirmation updates for mismatch, correction, either field changing, and clearing', () => {
  assert.equal(deskFeedback('valid-password', 'different-password').confirmation, 'Passwords do not match.');
  assert.equal(deskFeedback('valid-password', 'different-password').ready, false);
  assert.equal(deskFeedback('valid-password', 'valid-password').confirmation, 'Passwords match.');
  assert.equal(deskFeedback('valid-password', 'valid-password').ready, true);
  assert.equal(deskFeedback('changed-password', 'valid-password').ready, false);
  assert.equal(deskFeedback('valid-password', '').confirmation, '');
  assert.equal(deskFeedback('valid-password', '').ready, false);
});

test('matching passwords still respect the existing wallet length limits', () => {
  for (const length of [1, 7, 129]) {
    const value = 'a'.repeat(length);
    const feedback = deskFeedback(value, value);
    assert.ok(feedback.problem);
    assert.equal(feedback.ready, false);
  }
  for (const length of [8, 128]) {
    const value = 'a'.repeat(length);
    assert.equal(deskFeedback(value, value).ready, true);
  }
});

test('generated passwords match immediately but still require copying before acceptance', () => {
  const value = generatePassword(bytes => bytes.fill(7));
  assert.equal(deskFeedback(value, value).ready, true);
  assert.equal(secretAcceptAllowed({ generated: true, copied: false }), false);
  assert.equal(secretAcceptAllowed({ generated: true, copied: true }), true);
});

test('recovery feedback preserves recovery-specific normalization and limits', () => {
  for (const value of ['short', 'a'.repeat(65), 'password\n']) {
    const normalized = normalizePassphrase(value);
    const feedback = passwordFeedback(value, value, normalized ? '' : 'Use 8 to 64 characters.', normalized);
    assert.equal(feedback.ready, false);
  }
  const value = 'ｐassword';
  const normalized = normalizePassphrase(value);
  assert.equal(passwordFeedback(value, normalized, '', normalized).ready, true);
  assert.equal(passwordFeedback(value, value, '', normalized).ready, false);
  assert.equal(passwordFeedback('a'.repeat(64), 'a'.repeat(64), '').ready, true);
});

test('both setup forms wire accessible feedback without gating seed verification or unlock', () => {
  const desk = readFileSync(new URL('../components/DeskLock.js', import.meta.url), 'utf8');
  const recovery = readFileSync(new URL('../components/RecoveryCeremony.js', import.meta.url), 'utf8');
  const draft = readFileSync(new URL('../components/SecretDraft.js', import.meta.url), 'utf8');
  const hint = readFileSync(new URL('../components/PasswordFeedback.js', import.meta.url), 'utf8');
  assert.match(desk, /aria-describedby="desk-password-match"/);
  assert.match(desk, /setting && !\(phraseGate && !replacing\) && \(!feedback.ready/);
  assert.match(desk, /secretAcceptAllowed\(\{ generated, copied \}\)/);
  assert.match(recovery, /aria-describedby="recovery-password-match"/);
  assert.match(recovery, /disabled=\{!feedback.ready\}/);
  assert.match(draft, /aria-describedby=\{describedBy\}/);
  assert.match(draft, /Copied\. Keep it somewhere safe/);
  assert.match(draft, /onCopy=\{\(event\) => \{\s*event.preventDefault\(\);\s*event.stopPropagation\(\);\s*void copy\(\);/);
  assert.doesNotMatch(draft, /onCopied\(true\)/);
  assert.match(hint, /role="status" aria-live="polite" aria-atomic="true"/);
});
