import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * Achieves: verifies the profile wallet block shows each wallet once, at one weight.
 * Fails when: profile duplicates wallet addresses or repeats the linked-wallet list in sign-in settings.
 * Oracle: ProfileSheet delegates wallets to ConnectedWallets once and hides LinkedLogins wallet rows.
 * Side effects / state checked: source snapshot.
 * Gaps: visual weight is checked in CSS, not a screenshot.
 */
test('profile shows the wallet name and address once', () => {
  const profile = readFileSync(new URL('../components/ProfileSheet.js', import.meta.url), 'utf8');
  const wallets = readFileSync(new URL('../components/ConnectedWallets.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.doesNotMatch(profile, /glance\.label/);
  assert.doesNotMatch(profile, /<AddressCopy/);
  assert.equal(profile.match(/<ConnectedWallets/g).length, 1);
  assert.match(profile, /<LinkedLogins showWallets=\{false\}/);
  assert.equal(wallets.match(/<AddressCopy/g).length, 1);
  assert.match(css, /\.connected-wallet-info > strong \{[^}]*font-size: 14px;[^}]*font-weight: 550;/);
});
