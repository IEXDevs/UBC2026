import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordProblem } from './desk-lock.mjs';
import { generatePassphrase, generatePassword, secretAcceptAllowed } from './secret-generate.mjs';
import { normalizePassphrase } from './wallet-desk.mjs';

function fill(bytes) {
  bytes.fill(7);
}

test('generated password and passphrase fit the create rules without being logged', () => {
  const password = generatePassword(fill);
  const passphrase = generatePassphrase(fill);
  assert.equal(password.length, 20);
  assert.equal(passwordProblem(password), '');
  assert.match(password, /^[A-HJ-NP-Za-km-z2-9]+$/);
  assert.equal(passphrase.split(' ').length, 4);
  assert.equal(typeof normalizePassphrase(passphrase), 'string');
  assert.equal(secretAcceptAllowed({ generated: true, copied: false }), false);
  assert.equal(secretAcceptAllowed({ generated: true, copied: true }), true);
  assert.equal(secretAcceptAllowed({ generated: true, copied: false, acknowledged: true }), false);
  assert.equal(secretAcceptAllowed({ generated: false }), true);
});

test('each create screen keeps one generator beside the field and a copy icon inside it', () => {
  const draft = readFileSync(new URL('../components/SecretDraft.js', import.meta.url), 'utf8');
  const generate = draft.indexOf('{action}');
  const field = draft.indexOf('name={name}');
  const icon = draft.indexOf('aria-label="Copy"');
  const warning = draft.indexOf('Copy this before you continue');
  assert.ok(generate >= 0 && generate < field);
  assert.ok(field < icon);
  assert.ok(icon < warning);
  assert.equal(draft.includes('I copied it'), false);
  assert.match(draft, /from 'lucide-react'/);
  const desk = readFileSync(new URL('../components/DeskLock.js', import.meta.url), 'utf8');
  const recovery = readFileSync(new URL('../components/RecoveryCeremony.js', import.meta.url), 'utf8');
  assert.match(desk, /kind="password"/);
  assert.equal(desk.includes('Generate passphrase'), false);
  assert.equal(desk.includes('acknowledged'), false);
  assert.match(recovery, /kind="passphrase"/);
  assert.match(recovery, /Retry phrase/);
  assert.equal(recovery.includes('Generate password'), false);
  assert.equal(recovery.includes('acknowledged'), false);
});
