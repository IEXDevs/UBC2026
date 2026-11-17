import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldClosePermitMenu } from './permit-menu.mjs';

function menuContaining(...nodes) {
  return { contains: (target) => nodes.includes(target) };
}

/**
 * Achieves: verifies an outside pointer closes an open permissions menu, while a
 * pointer on a contained option does not.
 * Fails when: open+outside returns false, or open+inside option returns true.
 * Oracle: outside means !menuRoot.contains(target); inside means contains is true.
 * Side effects / state checked: N/A (pure predicate).
 * Gaps: none.
 */
test('a pointer outside the expanded permissions menu closes it', () => {
  const option = { id: 'ask' };
  const page = { id: 'page' };
  const menu = menuContaining(option);
  assert.equal(shouldClosePermitMenu(true, page, menu), true);
  assert.equal(shouldClosePermitMenu(true, option, menu), false);
});

/**
 * Achieves: verifies Ask / Review / Full option nodes are treated as inside the menu.
 * Fails when: any of those option ids returns true (would close before selection).
 * Oracle: each option is in menuContaining(...); contains must keep the menu open.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('choosing Ask every time, Review by AI, or Full permissions stays inside the menu', () => {
  for (const id of ['ask', 'review', 'full']) {
    const option = { id };
    const menu = menuContaining(option);
    assert.equal(shouldClosePermitMenu(true, option, menu), false);
  }
});

/**
 * Achieves: verifies a closed menu never closes-on-pointer (no-op while collapsed).
 * Fails when: open=false returns true for any target/menu combination.
 * Oracle: first guard is `if (!open) return false`.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('a closed permissions menu ignores outside pointers', () => {
  assert.equal(shouldClosePermitMenu(false, { id: 'page' }, null), false);
});

/**
 * Achieves: verifies a missing or non-DOM menu root still closes when the menu is open.
 * Fails when: null menuRoot or object without contains keeps the menu open.
 * Oracle: without a working contains(), the predicate must treat the pointer as outside.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('an open menu with no usable root closes on any pointer', () => {
  assert.equal(shouldClosePermitMenu(true, { id: 'page' }, null), true);
  assert.equal(shouldClosePermitMenu(true, { id: 'page' }, {}), true);
});
