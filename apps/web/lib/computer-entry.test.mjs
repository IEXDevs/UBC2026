import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function source(path) {
  return readFileSync(join(root, path), 'utf8');
}

/*
 * Achieves: verifies the live browser enters from the sidebar computer screen, not the chat thread.
 * Fails when: AgentThread embeds LiveViewPanel, FileLibrary loses side-computer/LiveViewPanel, or panel controls disappear.
 * Oracle: LiveViewPanel lives in FileLibrary/ComputerSheet; panel keeps Start Browser / Take control / Force stop.
 * Side effects / state checked: component source text.
 * Gaps: source snapshot only — browser session HTTP not exercised.
 */
test('the live browser opens from the sidebar computer screen', () => {
  const thread = source('components/AgentThread.js');
  const library = source('components/FileLibrary.js');
  const sheet = source('components/ComputerSheet.js');
  const panel = source('components/LiveViewPanel.js');

  assert.equal(thread.includes('LiveViewPanel'), false);
  assert.equal(library.includes('library-menu'), false);
  assert.equal(library.includes('Bot&apos;s computer'), false);
  assert.match(library, /className="side-computer"/);
  assert.match(library, /<LiveViewPanel[\s\S]*screen/);
  assert.match(library, /onExpand=\{/);
  assert.match(sheet, /browser-preview/);
  assert.match(sheet, /autoStart/);
  assert.match(sheet, /LiveViewPanel/);
  assert.match(sheet, /LoopSteps/);
  assert.match(panel, /computer-screen/);
  assert.match(panel, /is-off/);
  assert.match(panel, /Start Browser/);
  assert.match(panel, /framed \? 'Watch' : 'Start Browser'/);
  assert.match(panel, /Take control/);
  assert.match(panel, /Return control/);
  assert.match(panel, /Force stop/);
  assert.doesNotMatch(panel, /You can interact/);
});
