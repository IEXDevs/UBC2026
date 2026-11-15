import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldClosePermitMenu } from './permit-menu.mjs';

function menuContaining(...nodes) {
  return { contains: (target) => nodes.includes(target) };
}

test('a pointer outside the expanded permissions menu closes it', () => {
  const option = { id: 'ask' };
  const page = { id: 'page' };
  const menu = menuContaining(option);
  assert.equal(shouldClosePermitMenu(true, page, menu), true);
  assert.equal(shouldClosePermitMenu(true, option, menu), false);
});

test('choosing Ask every time, Review by AI, or Full permissions stays inside the menu', () => {
  for (const id of ['ask', 'review', 'full']) {
    const option = { id };
    const menu = menuContaining(option);
    assert.equal(shouldClosePermitMenu(true, option, menu), false);
  }
});

test('a closed permissions menu ignores outside pointers', () => {
  assert.equal(shouldClosePermitMenu(false, { id: 'page' }, null), false);
});
