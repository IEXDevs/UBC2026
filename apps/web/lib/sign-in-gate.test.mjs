import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasStoredPrivySession, showSessionHold, showSignInGate } from './sign-in-gate.mjs';

function storage(entries) {
  const keys = Object.keys(entries);
  return {
    length: keys.length,
    key: (index) => keys[index] ?? null,
    getItem: (key) => (Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : null),
  };
}

test('the login page waits until Privy has finished and found no session', () => {
  assert.equal(showSignInGate({ privyConfigured: true, ready: false, authenticated: false }), false);
  assert.equal(showSignInGate({ privyConfigured: true, ready: false, authenticated: true }), false);
  assert.equal(showSignInGate({ privyConfigured: true, ready: true, authenticated: false }), true);
  assert.equal(showSignInGate({ privyConfigured: true, ready: true, authenticated: true }), false);
  assert.equal(showSessionHold({ privyConfigured: true, ready: false }), true);
  assert.equal(showSessionHold({ privyConfigured: true, ready: true }), false);
});

test('without Privy the shell stays available', () => {
  assert.equal(showSignInGate({ privyConfigured: false, ready: false, authenticated: false }), false);
  assert.equal(showSessionHold({ privyConfigured: false, ready: false }), false);
});

test('a stored Privy session is recognized without reading the token', () => {
  assert.equal(hasStoredPrivySession(storage({ 'privy:token': '"header.payload.sig"' })), true);
  assert.equal(hasStoredPrivySession(storage({ 'privy:clabc:refresh_token': '"refresh"' })), true);
  assert.equal(hasStoredPrivySession(storage({ 'privy:token': 'null', 'other': '1' })), false);
  assert.equal(hasStoredPrivySession(storage({})), false);
  assert.equal(hasStoredPrivySession(null), false);
});

test('refresh keeps a stored session off the login page and the unlock field is not a saved password', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const page = readFileSync(join(root, 'app/page.js'), 'utf8');
  const desk = readFileSync(join(root, 'components/DeskLock.js'), 'utf8');
  const config = readFileSync(join(root, 'lib/privy-config.mjs'), 'utf8');
  assert.match(page, /showSessionHold/);
  assert.match(page, /hasStoredPrivySession/);
  assert.doesNotMatch(page, /inert=\{locked/);
  assert.match(config, /cookieWriteBehavior: 'never'/);
  assert.match(desk, /autoComplete="off"/);
  assert.doesNotMatch(desk, /current-password/);
  assert.match(desk, /name="maelstrom-desk-unlock"/);
});
