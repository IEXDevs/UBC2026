import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function source(path) {
  return readFileSync(join(root, path), 'utf8');
}

/**
 * Achieves: verifies the live browser stays in the computer sheet, and the right pane is only files.
 * Fails when: AgentThread or FileLibrary embed LiveViewPanel, or the computer sheet loses its controls.
 * Oracle: LiveViewPanel lives in ComputerSheet; FileLibrary is a scrolling file list.
 * Side effects / state checked: component source text.
 * Gaps: source snapshot only — browser session HTTP not exercised.
 */
test('the right pane is a file list and the computer sheet keeps the browser', () => {
  const thread = source('components/AgentThread.js');
  const library = source('components/FileLibrary.js');
  const sheet = source('components/ComputerSheet.js');
  const panel = source('components/LiveViewPanel.js');

  assert.equal(thread.includes('LiveViewPanel'), false);
  assert.equal(library.includes('LiveViewPanel'), false);
  assert.equal(library.includes('library-filters'), false);
  assert.match(library, /FileScroll/);
  assert.match(library, /selectOnScroll/);
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
