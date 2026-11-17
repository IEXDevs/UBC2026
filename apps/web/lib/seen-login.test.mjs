import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasSeenLogin, markSeenLogin, SEEN_LOGIN_KEY } from './seen-login.mjs';

/**
 * Achieves: verifies first visit is unsigned, markSeenLogin stores '1', and storage throws fail closed.
 * Fails when: unset storage reads true, mark does not write SEEN_LOGIN_KEY, or throws become true.
 * Oracle: SEEN_LOGIN_KEY value must be exactly '1'; any getItem throw → false (treat as first visit).
 * Side effects / state checked: Map-backed storage write of SEEN_LOGIN_KEY.
 * Gaps: none for helpers; markSeenLogin throw-on-set is covered below.
 */
test('a first visit is sign up, and a stored visit is log in', () => {
  const saved = new Map();
  const storage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  };
  assert.equal(hasSeenLogin(storage), false);
  markSeenLogin(storage);
  assert.equal(saved.get(SEEN_LOGIN_KEY), '1');
  assert.equal(hasSeenLogin(storage), true);
  assert.equal(hasSeenLogin({ getItem() { throw new Error('blocked'); } }), false);
});

/**
 * Achieves: verifies markSeenLogin swallows setItem failures (private mode) without throwing.
 * Fails when: setItem throw propagates out of markSeenLogin.
 * Oracle: private-mode storage may reject writes; callers must not crash on first login.
 * Side effects / state checked: no successful write; function returns undefined.
 * Gaps: none.
 */
test('markSeenLogin ignores storage write failures', () => {
  assert.doesNotThrow(() => markSeenLogin({
    setItem() { throw new Error('quota'); },
  }));
  assert.equal(hasSeenLogin(null), false);
  assert.doesNotThrow(() => markSeenLogin(null));
});
