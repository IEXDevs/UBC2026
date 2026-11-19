import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const screen = readFileSync(join(root, 'components/NotFoundScreen.js'), 'utf8');
const missing = readFileSync(join(root, 'app/not-found.js'), 'utf8');
const routeError = readFileSync(join(root, 'app/error.js'), 'utf8');
const rootError = readFileSync(join(root, 'app/global-error.js'), 'utf8');
const guard = readFileSync(join(root, 'components/CrashGuard.js'), 'utf8');
const layout = readFileSync(join(root, 'app/layout.js'), 'utf8');

test('missing routes and crashes render the same 404 screen', () => {
  assert.match(screen, />\s*404\s*</);
  assert.match(screen, /Return Home/);
  assert.match(screen, /href="\/"/);
  assert.match(screen, /@keyframes floatAndSpin/);
  assert.match(screen, /const THEMES = \[/);
  assert.equal((screen.match(/bg:/g) || []).length, 5);

  assert.match(missing, /NotFoundScreen/);
  assert.match(routeError, /NotFoundScreen/);
  assert.match(rootError, /NotFoundScreen/);
  assert.match(rootError, /<html lang="en">/);
  assert.match(rootError, /globals\.css/);
  assert.match(guard, /getDerivedStateFromError/);
  assert.match(guard, /unhandledrejection/);
  assert.match(guard, /shouldCrashOnRejection/);
  assert.match(guard, /NotFoundScreen/);
  assert.match(layout, /<CrashGuard>/);
});
