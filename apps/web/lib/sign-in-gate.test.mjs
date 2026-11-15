import { test } from 'node:test';
import assert from 'node:assert/strict';
import { showSignInGate } from './sign-in-gate.mjs';

test('a configured session stays on the sign-in page until Privy is ready and authenticated', () => {
  assert.equal(showSignInGate({ privyConfigured: true, ready: false, authenticated: false }), true);
  assert.equal(showSignInGate({ privyConfigured: true, ready: true, authenticated: false }), true);
  assert.equal(showSignInGate({ privyConfigured: true, ready: false, authenticated: true }), true);
  assert.equal(showSignInGate({ privyConfigured: true, ready: true, authenticated: true }), false);
});

test('without Privy the shell stays available', () => {
  assert.equal(showSignInGate({ privyConfigured: false, ready: false, authenticated: false }), false);
});
