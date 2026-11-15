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

test('generate actions and the warning sit above the entry field', () => {
  const source = readFileSync(new URL('../components/SecretDraft.js', import.meta.url), 'utf8');
  const password = source.indexOf('Generate password');
  const phrase = source.indexOf('Generate passphrase');
  const preview = source.indexOf('secret-preview');
  const warning = source.indexOf('Copy this before you continue');
  const field = source.indexOf('name={name}');
  assert.ok(password >= 0 && phrase > password);
  assert.ok(preview > phrase);
  assert.ok(warning > preview);
  assert.ok(field > warning);
  assert.match(source, /I copied it/);
  assert.match(readFileSync(new URL('../components/DeskLock.js', import.meta.url), 'utf8'), /SecretDraft/);
  assert.match(readFileSync(new URL('../components/RecoveryCeremony.js', import.meta.url), 'utf8'), /SecretDraft/);
  assert.match(readFileSync(new URL('../components/DeskLock.js', import.meta.url), 'utf8'), /secretAcceptAllowed/);
  assert.match(readFileSync(new URL('../components/RecoveryCeremony.js', import.meta.url), 'utf8'), /secretAcceptAllowed/);
});
