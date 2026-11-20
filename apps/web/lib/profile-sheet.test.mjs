import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * Achieves: verifies the wallets dialog shows each wallet once, at one weight, outside the profile sheet.
 * Fails when: the glance label and address are repeated above the wallet list, the name goes back to a raw bold tag, or wallets return to ProfileSheet.
 * Oracle: AccountWallets lists profile-wallet-name and does not render glance.label or a second AddressCopy before the list.
 * Side effects / state checked: source snapshot.
 * Gaps: visual weight is checked in CSS, not a screenshot.
 */
test('profile shows the wallet name and address once', () => {
  const profile = readFileSync(new URL('../components/ProfileSheet.js', import.meta.url), 'utf8');
  const wallets = readFileSync(new URL('../components/AccountWallets.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.equal(profile.includes('profile-wallet-name'), false);
  assert.equal(profile.includes('<AddressCopy'), false);
  assert.doesNotMatch(wallets, /glance\.label/);
  assert.equal(wallets.match(/<AddressCopy/g).length, 1);
  assert.match(wallets, /profile-wallet-name/);
  assert.match(css, /\.profile-wallets \.profile-wallet-name,\s*\.profile-wallets strong \{[\s\S]*font-weight: 560;/);
});
