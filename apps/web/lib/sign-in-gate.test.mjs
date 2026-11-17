import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { developerPreviewAllowed, hasStoredPrivySession, hostedDevPreview, publicDevPreviewValue, showSessionHold, showSignInGate } from './sign-in-gate.mjs';

function storage(entries) {
  const keys = Object.keys(entries);
  return {
    length: keys.length,
    key: (index) => keys[index] ?? null,
    getItem: (key) => (Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : null),
  };
}

/**
 * Achieves: verifies the login page waits until Privy has finished and found no session.
 * Fails when: the login page waits until Privy has finished and found no session breaks (e.g. expected ready: false, authenticated: false }, ready: false, authenticated: true }, ready: true, authenticated: false }).
 * Oracle: assert.equal(showSignInGate({ privyConfigured: true, ready: false, authenticated: false }); assert.equal(showSignInGate({ privyConfigured: true, ready: false, authenticated: true }); assert.equal(showSignInGate({ privyConfigured: true, ready: true, authenticated: false }); assert.equal(showSignInGate({ privyConfigured: true, ready: true, authenticated: true }); assert.equal(showSessionHold({ privyConfigured: true, ready: false }); assert.equal(showSessionHold({ privyConfigured: true, ready: true })
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('the login page waits until Privy has finished and found no session', () => {
  assert.equal(showSignInGate({ privyConfigured: true, ready: false, authenticated: false }), false);
  assert.equal(showSignInGate({ privyConfigured: true, ready: false, authenticated: true }), false);
  assert.equal(showSignInGate({ privyConfigured: true, ready: true, authenticated: false }), true);
  assert.equal(showSignInGate({ privyConfigured: true, ready: true, authenticated: true }), false);
  assert.equal(showSessionHold({ privyConfigured: true, ready: false }), true);
  assert.equal(showSessionHold({ privyConfigured: true, ready: true }), false);
});

/**
 * Achieves: verifies developer preview needs DEV_PREVIEW=1 and stays off in production.
 * Fails when: developer preview needs DEV_PREVIEW=1 and stays off in production breaks (e.g. expected devPreview: '1' }, devPreview: '' }, devPreview: '0' }); failure/null paths flip.
 * Oracle: assert.equal(developerPreviewAllowed({ nodeEnv: 'development', devPreview: '1' }); assert.equal(developerPreviewAllowed({ nodeEnv: 'development', devPreview: '' }); assert.equal(developerPreviewAllowed({ nodeEnv: 'development', devPreview: '0' }); assert.equal(developerPreviewAllowed({ nodeEnv: 'test', devPreview: '1' }); assert.equal(developerPreviewAllowed({ nodeEnv: 'production', devPreview: '1' }); assert.equal(developerPreviewAllowed({ nodeEnv: 'production', devPreview: '' })
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('developer preview needs DEV_PREVIEW=1 and stays off in production', () => {
  assert.equal(developerPreviewAllowed({ nodeEnv: 'development', devPreview: '1' }), true);
  assert.equal(developerPreviewAllowed({ nodeEnv: 'development', devPreview: '' }), false);
  assert.equal(developerPreviewAllowed({ nodeEnv: 'development', devPreview: '0' }), false);
  assert.equal(developerPreviewAllowed({ nodeEnv: 'test', devPreview: '1' }), true);
  assert.equal(developerPreviewAllowed({ nodeEnv: 'production', devPreview: '1' }), false);
  assert.equal(developerPreviewAllowed({ nodeEnv: 'production', devPreview: '' }), false);
  assert.equal(hostedDevPreview('1'), true);
  assert.equal(hostedDevPreview(''), false);
  assert.equal(hostedDevPreview('0'), false);
  assert.equal(hostedDevPreview(undefined), false);
});

/**
 * Achieves: verifies next dev keeps DEV_PREVIEW when NODE_ENV is already production.
 * Fails when: next dev keeps DEV_PREVIEW when NODE_ENV is already production breaks (e.g. expected argv: ['node', 'next', 'dev'], devPreview: '1' }, argv: ['node', 'next', 'dev'], devPreview: '1' }, argv: ['node', 'next', 'dev'], devPreview: '' }).
 * Oracle: assert.equal(publicDevPreviewValue({ nodeEnv: 'production', argv: ['node', 'next', 'dev'], devPreview: '1' }); assert.equal(publicDevPreviewValue({ nodeEnv: 'development', argv: ['node', 'next', 'dev'], devPreview: '1' }); assert.equal(publicDevPreviewValue({ nodeEnv: 'development', argv: ['node', 'next', 'dev'], devPreview: '' }); assert.equal(publicDevPreviewValue({ nodeEnv: 'production', argv: ['node', 'next', 'build'], devPreview: '1' }; assert.equal(publicDevPreviewValue({ nodeEnv: 'production', argv: ['node', 'next', 'start'], devPreview: '1' }
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('next dev keeps DEV_PREVIEW when NODE_ENV is already production', () => {
  assert.equal(publicDevPreviewValue({ nodeEnv: 'production', argv: ['node', 'next', 'dev'], devPreview: '1' }), '1');
  assert.equal(publicDevPreviewValue({ nodeEnv: 'development', argv: ['node', 'next', 'dev'], devPreview: '1' }), '1');
  assert.equal(publicDevPreviewValue({ nodeEnv: 'development', argv: ['node', 'next', 'dev'], devPreview: '' }), '');
  assert.equal(publicDevPreviewValue({ nodeEnv: 'production', argv: ['node', 'next', 'build'], devPreview: '1' }), '');
  assert.equal(publicDevPreviewValue({ nodeEnv: 'production', argv: ['node', 'next', 'start'], devPreview: '1' }), '');
});

/**
 * Achieves: verifies without Privy the shell stays available.
 * Fails when: without Privy the shell stays available breaks (e.g. expected ready: false, authenticated: false }, ready: false }).
 * Oracle: assert.equal(showSignInGate({ privyConfigured: false, ready: false, authenticated: false }); assert.equal(showSessionHold({ privyConfigured: false, ready: false })
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('without Privy the shell stays available', () => {
  assert.equal(showSignInGate({ privyConfigured: false, ready: false, authenticated: false }), false);
  assert.equal(showSessionHold({ privyConfigured: false, ready: false }), false);
});

/**
 * Achieves: verifies a stored Privy session is recognized without reading the token.
 * Fails when: a stored Privy session is recognized without reading the token breaks (e.g. expected true, true, 'other': '1' }); failure/null paths flip.
 * Oracle: assert.equal(hasStoredPrivySession(storage({ 'privy:token': '"header.payload.sig"' })), true); assert.equal(hasStoredPrivySession(storage({ 'privy:clabc:refresh_token': '"refresh"' })), true); assert.equal(hasStoredPrivySession(storage({ 'privy:token': 'null', 'other': '1' }); assert.equal(hasStoredPrivySession(storage({})), false); assert.equal(hasStoredPrivySession(null), false)
 * Side effects / state checked: in-memory storage double writes/reads.
 * Gaps: none.
 */
test('a stored Privy session is recognized without reading the token', () => {
  assert.equal(hasStoredPrivySession(storage({ 'privy:token': '"header.payload.sig"' })), true);
  assert.equal(hasStoredPrivySession(storage({ 'privy:clabc:refresh_token': '"refresh"' })), true);
  assert.equal(hasStoredPrivySession(storage({ 'privy:token': 'null', 'other': '1' })), false);
  assert.equal(hasStoredPrivySession(storage({})), false);
  assert.equal(hasStoredPrivySession(null), false);
});

/**
 * Achieves: verifies refresh keeps a stored session off the login page and the unlock field is not a saved password.
 * Fails when: refresh keeps a stored session off the login page and the unlock field is not a saved password no longer holds.
 * Oracle: assert.match(page, /showSessionHold/); assert.match(page, /hasStoredPrivySession/); assert.match(page, /onDeveloperPreview=\{devAllowed \? enterDevPreview : null\}/); assert.match(page, /const hostedPreview = useHostedPreview\(\); assert.match(readFileSync(join(root, 'app/layout.js'); assert.match(desk, /autoComplete="off"/)
 * Side effects / state checked: source-text / config snapshot.
 * Gaps: source snapshot only — runtime UI/HTTP not executed.
 */
test('refresh keeps a stored session off the login page and the unlock field is not a saved password', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const page = readFileSync(join(root, 'app/page.js'), 'utf8');
  const desk = readFileSync(join(root, 'components/DeskLock.js'), 'utf8');
  const config = readFileSync(join(root, 'lib/privy-config.mjs'), 'utf8');
  assert.match(page, /showSessionHold/);
  assert.match(page, /hasStoredPrivySession/);
  assert.match(page, /onDeveloperPreview=\{devAllowed \? enterDevPreview : null\}/);
  assert.match(page, /const hostedPreview = useHostedPreview\(\)/);
  assert.match(readFileSync(join(root, 'app/layout.js'), 'utf8'), /readHostedDevPreview/);
  assert.doesNotMatch(page, /inert=\{locked/);
  assert.doesNotMatch(config, /cookieWriteBehavior/);
  assert.match(desk, /autoComplete="off"/);
  assert.doesNotMatch(desk, /current-password/);
  assert.match(desk, /name="maelstrom-desk-unlock"/);
});
