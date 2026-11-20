import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GET, UBC2026_DEMO_URL } from '../app/ubc2026/route.js';

test('the public demo link temporarily redirects to the configured target', () => {
  const response = GET();
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), new URL(UBC2026_DEMO_URL).href);
});
