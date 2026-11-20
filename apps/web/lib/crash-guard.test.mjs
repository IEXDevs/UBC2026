import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fromThisApp,
  isIgnorableAuthFailure,
  shouldCrashOnError,
  shouldCrashOnRejection,
} from './crash-guard.mjs';

const origin = 'https://dev.maelstrom.iexdevs.com';

test('CrashGuard only treats same-origin app frames as crashes', () => {
  assert.equal(fromThisApp(`${origin}/_next/static/chunk.js`, origin), true);
  assert.equal(fromThisApp('https://auth.privy.io/iframe.js', origin), false);
  assert.equal(fromThisApp('', origin), false);
});

test('Privy wallet-connect failures are ignorable auth noise', () => {
  assert.equal(isIgnorableAuthFailure('No available adapters'), true);
  assert.equal(isIgnorableAuthFailure('Unable to refresh tokens - token is missing or no longer valid'), true);
  assert.equal(isIgnorableAuthFailure('Privy iframe failed to load: Exceeded max attempts before resolving function'), true);
  assert.equal(isIgnorableAuthFailure('Error authenticating session'), true);
  assert.equal(isIgnorableAuthFailure('GET /api/privy-auth/api/v1/sessions'), true);
  assert.equal(isIgnorableAuthFailure('Connecting to data:, violates connect-src'), true);
  assert.equal(isIgnorableAuthFailure('TrustedScript / Function constructor'), true);
  assert.equal(isIgnorableAuthFailure('Turnstile postMessage origin mismatch challenges.cloudflare.com'), true);
});

test('production overlay ignores Privy unhandled rejections even when stacked in Next chunks', () => {
  const reason = new Error('No available adapters');
  reason.stack = `Error: No available adapters\n    at connect (${origin}/_next/static/chunks/privy.js:1:1)`;
  assert.equal(shouldCrashOnRejection(reason, { origin }), false);
  assert.equal(shouldCrashOnRejection(new Error('Unable to refresh tokens'), { origin }), false);
  assert.equal(shouldCrashOnError({
    message: 'Privy iframe failed to load',
    filename: `${origin}/_next/static/chunks/app.js`,
    origin,
  }), false);
});

test('a real same-origin app rejection still opens the 404 overlay', () => {
  const reason = new Error('roster parse failed');
  reason.stack = `Error: roster parse failed\n    at load (${origin}/_next/static/chunks/app.js:12:3)`;
  assert.equal(shouldCrashOnRejection(reason, { origin }), true);
  assert.equal(shouldCrashOnError({
    message: 'roster parse failed',
    filename: `${origin}/_next/static/chunks/app.js`,
    origin,
  }), true);
});

test('unattributed rejections and extension stacks do not 404 the desk', () => {
  assert.equal(shouldCrashOnRejection({ message: 'boom' }, { origin }), false);
  const ext = new Error('injected');
  ext.stack = 'Error: injected\n    at chrome-extension://abc/content.js:1:1';
  assert.equal(shouldCrashOnRejection(ext, { origin }), false);
  assert.equal(shouldCrashOnError({ message: 'ResizeObserver loop limit exceeded', filename: `${origin}/x.js`, origin }), false);
});

test('CrashGuard wires the helper instead of treating every object rejection as fatal', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const guard = readFileSync(join(root, 'components/CrashGuard.js'), 'utf8');
  assert.match(guard, /shouldCrashOnRejection/);
  assert.match(guard, /shouldCrashOnError/);
  assert.doesNotMatch(guard, /typeof event\?\.reason !== 'object'/);
});
