/**
 * Unit tests for hosted DEV_PREVIEW binding reader.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHostedDevPreview } from './hosted-preview.mjs';
import { hostedDevPreview } from './sign-in-gate.mjs';

/**
 * Rigor audit — hostedDevPreview binding helper
 * Achieves: only the string '1' enables hosted preview; other values stay false.
 * Fails when: truthy non-'1' values (true, 'true', 1) enable production bypass.
 * Oracle: Worker binding DEV_PREVIEW must be exactly '1'.
 * Side effects: none.
 * Gaps: none for the pure helper.
 */
test('hostedDevPreview is true only for the string 1', () => {
  assert.equal(hostedDevPreview('1'), true);
  assert.equal(hostedDevPreview('true'), false);
  assert.equal(hostedDevPreview('0'), false);
  assert.equal(hostedDevPreview(''), false);
  assert.equal(hostedDevPreview(undefined), false);
  assert.equal(hostedDevPreview(1), false);
  assert.equal(hostedDevPreview(true), false);
});

/**
 * Rigor audit — readHostedDevPreview outside Cloudflare
 * Achieves: next dev / node tests without Worker bindings return false (no local .env bypass).
 * Fails when: missing @opennextjs/cloudflare context throws or returns true from .env.
 * Oracle: catch → false; local .env.local does not count.
 * Side effects: none (getCloudflareContext fails outside Workers).
 * Gaps: remaining true path needs a mocked Cloudflare env binding.
 */
test('readHostedDevPreview returns false outside a Cloudflare Worker binding', async () => {
  const value = await readHostedDevPreview();
  assert.equal(value, false);
});
