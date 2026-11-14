import assert from 'node:assert/strict';
import test from 'node:test';
import { DOCK_EXPAND_MS, dockCollapseDelay, dockShouldStayOpen } from './dock-hold.mjs';

test('dock stays open until the expand animation has finished', () => {
  const openedAt = 1_000;
  assert.equal(dockCollapseDelay(openedAt + 40, openedAt), DOCK_EXPAND_MS - 40);
  assert.equal(dockCollapseDelay(openedAt + DOCK_EXPAND_MS, openedAt), 0);
  assert.equal(dockCollapseDelay(openedAt + DOCK_EXPAND_MS + 80, openedAt), 0);
  assert.equal(dockCollapseDelay(openedAt, 0), DOCK_EXPAND_MS);
  assert.equal(dockShouldStayOpen(true, DOCK_EXPAND_MS + 20), true);
  assert.equal(dockShouldStayOpen(false, 40), true);
  assert.equal(dockShouldStayOpen(false, DOCK_EXPAND_MS), false);
});
