import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasSeenLogin, markSeenLogin, SEEN_LOGIN_KEY } from './seen-login.mjs';

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
