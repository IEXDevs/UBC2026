import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('profile menu keeps account destinations without a Computer entry', () => {
  const source = readFileSync(new URL('../components/AccountMenu.js', import.meta.url), 'utf8');
  const destinations = [...source.matchAll(/\{ id: '([^']+)', label: '[^']+', icon: /g)].map((match) => match[1]);
  assert.ok(destinations.includes('security'));
  assert.ok(destinations.includes('wallet'));
  assert.ok(destinations.includes('cards'));
  assert.ok(destinations.includes('profile'));
  assert.ok(destinations.includes('logs'));
  assert.ok(destinations.includes('logout'));
  assert.ok(!destinations.includes('computer'));
  assert.ok(!destinations.includes('plugins'));
});
