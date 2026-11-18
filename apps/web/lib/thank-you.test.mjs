import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { THANK_YOU } from './thank-you.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(join(root, 'app/thankyou/page.js'), 'utf8');

/**
 * Achieves: verifies the thank-you sponsors are the named companies with live https sites.
 * Fails when: a logo drops, a link leaves https, or the page stops rendering ThankYou.
 * Oracle: names in order; every href starts with https://; page.js renders ThankYou.
 */
test('thank-you logos link to the sponsor sites', () => {
  assert.deepEqual(THANK_YOU.map(company => company.name), [
    'Solana',
    'SpaceXSI',
    'Privy.io',
    'ElevenLabs',
    'Laso.Finance',
    'QuickNode',
    'Supabase',
    'Cloudflare',
  ]);
  for (const company of THANK_YOU) {
    assert.match(company.href, /^https:\/\/.+/);
    assert.match(company.src, /^\/sponsors\/.+\.svg$/);
  }
  assert.match(page, /ThankYou/);
});
