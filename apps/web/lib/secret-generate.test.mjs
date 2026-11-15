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
  assert.equal(secretAcceptAllowed({ generated: true, copied: false, acknowledged: false }), false);
  assert.equal(secretAcceptAllowed({ generated: true, copied: true }), true);
  assert.equal(secretAcceptAllowed({ generated: true, acknowledged: true }), true);
  assert.equal(secretAcceptAllowed({ generated: false }), true);
});

test('each create screen shows only its own generator above the field', () => {
  const draft = readFileSync(new URL('../components/SecretDraft.js', import.meta.url), 'utf8');
  const warning = draft.indexOf('Copy this before you continue');
  const field = draft.indexOf('name={name}');
  assert.ok(warning >= 0 && field > warning);
  assert.match(draft, /I copied it/);
  assert.match(draft, /kind === 'passphrase'/);
  const desk = readFileSync(new URL('../components/DeskLock.js', import.meta.url), 'utf8');
  const recovery = readFileSync(new URL('../components/RecoveryCeremony.js', import.meta.url), 'utf8');
  assert.match(desk, /kind="password"/);
  assert.equal(desk.includes('Generate passphrase'), false);
  assert.match(desk, /secretAcceptAllowed/);
  assert.match(recovery, /kind="passphrase"/);
  assert.equal(recovery.includes('Generate password'), false);
  assert.match(recovery, /secretAcceptAllowed/);
});
