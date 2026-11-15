import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function source(path) {
  return readFileSync(join(root, path), 'utf8');
}

test('the live browser opens from the sidebar computer card', () => {
  const thread = source('components/AgentThread.js');
  const library = source('components/FileLibrary.js');
  const sheet = source('components/ComputerSheet.js');
  const panel = source('components/LiveViewPanel.js');

  assert.equal(thread.includes('LiveViewPanel'), false);
  assert.match(library, /className="side-computer"/);
  assert.match(library, /Bot&apos;s computer/);
  assert.match(library, /countOpenBrowserSessions/);
  assert.match(library, /computerStatus\(\{ openSessionCount/);
  assert.match(sheet, /browser-preview/);
  assert.match(sheet, /LiveViewPanel/);
  assert.match(panel, /Take control/);
  assert.match(panel, /Return control/);
  assert.match(panel, /You can interact/);
});
