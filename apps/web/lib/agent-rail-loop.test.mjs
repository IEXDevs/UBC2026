import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Achieves: the existing agent rail shows the loop mark and the break control.
 * Fails when: the cooldown gains a badge, the icon gains a timer, or the break control disappears.
 * Oracle: BotRail.js, page.js, and globals.css source.
 * Side effects: none.
 * Gaps: pixel hover is checked in the browser when the preview shell can render.
 */
test('the agent rail shows a plain loop duration and flips the active icon', () => {
  const rail = readFileSync(join(root, 'components/BotRail.js'), 'utf8');
  const page = readFileSync(join(root, 'app/page.js'), 'utf8');
  const css = readFileSync(join(root, 'app/globals.css'), 'utf8');
  assert.equal(rail.match(/<AnimatedList/g).length, 1);
  assert.equal(rail.match(/<Dock/g).length, 1);
  assert.match(rail, /meta: loopMark\(bot, onBreakLoop\)/);
  assert.match(rail, /className="agent-loop"/);
  assert.match(rail, />\s*\{label\}\s*<\/button>/);
  assert.doesNotMatch(rail, /agent-loop-countdown|agent-loop__x/);
  assert.match(rail, /onBreak\?\.\(bot\.id\)/);
  assert.equal(page.match(/<BotRail/g).length, 1);
  assert.match(page, /onBreakLoop=\{onBreakLoop\}/);
  assert.match(page, /'x-loop-break': 'owner-asked'/);
  const duration = css.match(/\.agent-loop \{([^}]+)\}/)[1];
  assert.match(duration, /border: 0;/);
  assert.match(duration, /background: transparent;/);
  assert.match(duration, /color: rgba\(235, 235, 238, 0\.55\);/);
  assert.match(css, /animation: agent-loop-flip 60s ease-in-out infinite;/);
});
