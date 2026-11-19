import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exclusiveBarMenu } from './bar-menu.mjs';

/**
 * Achieves: the entry bar keeps a single menu, and choosing it again closes it.
 * Fails when: two menus stay named, or a typed slash command leaves the old menu up.
 * Oracle: exclusiveBarMenu fixtures.
 * Side effects: none.
 */
test('the entry bar opens one menu and closes it on a second request', () => {
  assert.equal(exclusiveBarMenu(null, 'permit'), 'permit');
  assert.equal(exclusiveBarMenu('permit', 'effort'), 'effort');
  assert.equal(exclusiveBarMenu('effort', 'model'), 'model');
  assert.equal(exclusiveBarMenu('model', 'context'), 'context');
  assert.equal(exclusiveBarMenu('context', 'plus'), 'plus');
  assert.equal(exclusiveBarMenu('plus', 'plus'), null);
  assert.equal(exclusiveBarMenu('permit', 'token'), 'token');
  assert.equal(exclusiveBarMenu('token', 'token'), 'token');
  assert.equal(exclusiveBarMenu('model', 'model'), 'model');
  assert.equal(exclusiveBarMenu('context', 'context'), 'context');
});
