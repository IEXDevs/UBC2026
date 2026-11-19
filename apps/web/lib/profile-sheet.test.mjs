import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * Achieves: verifies the profile wallet block shows each wallet once, at one weight.
 * Fails when: the glance label and address are repeated above the wallet list, or the name goes back to a raw bold tag.
 * Oracle: ProfileSheet lists profile-wallet-name and does not render glance.label or a second AddressCopy before the list.
 * Side effects / state checked: source snapshot.
 * Gaps: visual weight is checked in CSS, not a screenshot.
 */
test('profile shows the wallet name and address once', () => {
  const profile = readFileSync(new URL('../components/ProfileSheet.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.doesNotMatch(profile, /glance\.label/);
  assert.equal(profile.match(/<AddressCopy/g).length, 1);
  assert.match(profile, /profile-wallet-name/);
  assert.match(css, /\.profile-wallets \.profile-wallet-name,\s*\.profile-wallets strong \{[\s\S]*font-weight: 560;/);
});
