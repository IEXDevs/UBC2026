import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Achieves: the existing agent rail shows the loop mark and the break control.
 * Fails when: a second card list appears, the cooldown is missing, or hover does not reveal the X.
 * Oracle: BotRail.js, page.js, and globals.css source.
 * Side effects: none.
 * Gaps: pixel hover is checked in the browser when the preview shell can render.
 */
test('the agent rail shows one loop mark and breaks it from the X', () => {
  const rail = readFileSync(join(root, 'components/BotRail.js'), 'utf8');
  const page = readFileSync(join(root, 'app/page.js'), 'utf8');
  const css = readFileSync(join(root, 'app/globals.css'), 'utf8');
  assert.equal(rail.match(/<AnimatedList/g).length, 1);
  assert.equal(rail.match(/<Dock/g).length, 1);
  assert.match(rail, /meta: loopMark\(bot, onBreakLoop\)/);
  assert.match(rail, /className="agent-loop"/);
  assert.match(rail, /agent-loop__time/);
  assert.match(rail, /agent-loop__x/);
  assert.match(rail, /onBreak\?\.\(bot\.id\)/);
  assert.equal(page.match(/<BotRail/g).length, 1);
  assert.match(page, /onBreakLoop=\{onBreakLoop\}/);
  assert.match(page, /'x-loop-break': 'owner-asked'/);
  assert.match(css, /\.agent-loop:hover \.agent-loop__x,\s*\.agent-loop:focus-visible \.agent-loop__x \{\s*opacity: 1;/);
  assert.match(css, /\.agent-loop:hover \.agent-loop__time,\s*\.agent-loop:focus-visible \.agent-loop__time \{\s*opacity: 0;/);
});
