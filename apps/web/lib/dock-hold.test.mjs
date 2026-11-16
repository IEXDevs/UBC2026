import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DOCK_EXPAND_MS, DOCK_SWITCH_MS, dockCollapseDelay, dockHoldDelay, dockShouldStayOpen, pillAnchor } from './dock-hold.mjs';

test('dock expand duration matches the navbar stylesheet', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, new RegExp(`--dock-expand:\\s*${DOCK_EXPAND_MS}ms`));
  assert.doesNotMatch(css, /opacity 220ms ease 80ms/);
});

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

test('dock stays extended until a pane switch animation finishes', () => {
  const now = 5_000;
  assert.equal(DOCK_SWITCH_MS, 2000);
  assert.equal(dockShouldStayOpen(false, DOCK_EXPAND_MS + 80, DOCK_EXPAND_MS, 40), true);
  assert.equal(dockShouldStayOpen(false, DOCK_EXPAND_MS + 80, DOCK_EXPAND_MS, 0), false);
  assert.equal(dockHoldDelay(now, now - 40, now + DOCK_SWITCH_MS), DOCK_SWITCH_MS);
  assert.equal(dockHoldDelay(now, now - 40, now - 10), DOCK_EXPAND_MS - 40);
  assert.equal(dockHoldDelay(now, 0, 0), DOCK_EXPAND_MS);
});

test('every pane uses the main stage center as the pill anchor', () => {
  assert.equal(pillAnchor(1400, 300, 280), 710);
  assert.equal(pillAnchor(1400, 88, 280), 604);
  assert.equal(pillAnchor(1400, 300, 0), 850);
  assert.equal(pillAnchor(500, 300, 280), 300);
});
