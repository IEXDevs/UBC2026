import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DOCK_EXPAND_MS, DOCK_SWITCH_MS, dockCollapseDelay, dockHoldDelay, dockShouldStayOpen, pillAnchor } from './dock-hold.mjs';

/**
 * Achieves: verifies dock expand CSS variable matches DOCK_EXPAND_MS and labels ease width instead of snapping.
 * Fails when: --dock-expand drifts from the constant, the 220ms/80ms opacity rule returns, or closed items snap with max-width 0.
 * Oracle: globals.css must declare --dock-expand: ${DOCK_EXPAND_MS}ms, animate grid-template-columns, collapse inactive items with minmax(0, 0fr), and the pane dock must shift without blob particles.
 * Side effects / state checked: stylesheet and PaneDock source text.
 * Gaps: source snapshot only for CSS; runtime animation not timed.
 */
test('dock expand duration matches the navbar stylesheet', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, new RegExp(`--dock-expand:\\s*${DOCK_EXPAND_MS}ms`));
  assert.match(css, /grid-template-columns var\(--dock-expand\) var\(--dock-ease\)/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*0fr\)/);
  assert.doesNotMatch(css, /opacity 220ms ease 80ms/);
  assert.doesNotMatch(css, /\.gooey-nav__item:not\(\[data-active\]\)\s*\{[^}]*max-width:\s*0/);
  const dock = readFileSync(new URL('../components/PaneDock.js', import.meta.url), 'utf8');
  assert.match(dock, /particleCount=\{0\}/);
});

/**
 * Achieves: verifies collapse is deferred until expand animation completes.
 * Fails when: mid-expand collapse delay is 0, or post-expand hover-out still forces stay-open forever.
 * Oracle: remaining expand time = DOCK_EXPAND_MS - elapsed; stay-open while hovering or expand incomplete.
 * Side effects / state checked: N/A.
 * Gaps: none for timing helpers.
 */
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

/**
 * Achieves: verifies pane-switch hold keeps the dock extended for DOCK_SWITCH_MS.
 * Fails when: DOCK_SWITCH_MS drifts from 2000, or switch hold is ignored when expand already finished.
 * Oracle: remaining switch ms wins over collapse when switchUntil is in the future.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('dock stays extended until a pane switch animation finishes', () => {
  const now = 5_000;
  assert.equal(DOCK_SWITCH_MS, 2000);
  assert.equal(dockShouldStayOpen(false, DOCK_EXPAND_MS + 80, DOCK_EXPAND_MS, 40), true);
  assert.equal(dockShouldStayOpen(false, DOCK_EXPAND_MS + 80, DOCK_EXPAND_MS, 0), false);
  assert.equal(dockHoldDelay(now, now - 40, now + DOCK_SWITCH_MS), DOCK_SWITCH_MS);
  assert.equal(dockHoldDelay(now, now - 40, now - 10), DOCK_EXPAND_MS - 40);
  assert.equal(dockHoldDelay(now, 0, 0), DOCK_EXPAND_MS);
});

/**
 * Achieves: verifies pill anchor is the main stage center accounting for rail width.
 * Fails when: rail width is ignored or small viewports compute off-center anchors incorrectly.
 * Oracle: independent center math — (viewport - rail)/2 adjusted by known fixture expectations.
 * Side effects / state checked: N/A.
 * Gaps: none for anchor math.
 */
test('every pane uses the main stage center as the pill anchor', () => {
  assert.equal(pillAnchor(1400, 300, 280), 710);
  assert.equal(pillAnchor(1400, 88, 280), 604);
  assert.equal(pillAnchor(1400, 300, 0), 850);
  assert.equal(pillAnchor(500, 300, 280), 300);
});

/**
 * Achieves: verifies the open dock pads the active label so a wider neighbor cannot shove it off center.
 * Fails when: PaneDock turns balanceActive off and Main slides left under History/Positions.
 * Oracle: PaneDock.js must not pass balanceActive={false}.
 * Side effects / state checked: source snapshot.
 * Gaps: runtime hover not measured here.
 */
test('the pane dock keeps the active label centered while open', () => {
  const dock = readFileSync(new URL('../components/PaneDock.js', import.meta.url), 'utf8');
  assert.doesNotMatch(dock, /balanceActive=\{false\}/);
});
