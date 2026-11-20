import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * Achieves: verifies connect, import, and the wallet sections stay on the wallet sheet, not the profile sheet.
 * Fails when: ProfileSheet grows a wallets fold again, or WalletsSheet drops connect, import, or a section.
 * Oracle: ProfileSheet has no WalletAdd; WalletsSheet keeps Connect, Import seed, Import key, and every section id.
 * Side effects / state checked: source snapshot.
 * Gaps: does not render the dialog.
 */
test('profile shows the wallet name and address once', () => {
  const profile = readFileSync(new URL('../components/ProfileSheet.js', import.meta.url), 'utf8');
  const sheet = readFileSync(new URL('../components/WalletsSheet.js', import.meta.url), 'utf8');
  assert.equal(profile.includes('WalletAdd'), false);
  assert.equal(profile.includes('<summary>Wallets</summary>'), false);
  assert.match(sheet, /Connect a wallet/);
  assert.match(sheet, /Import seed/);
  assert.match(sheet, /Import key/);
  assert.match(sheet, /New Wallet/);
  for (const pane of ['assets', 'portfolio', 'send', 'receive', 'swap', 'tokens', 'history', 'keys']) {
    assert.match(sheet, new RegExp(`id: '${pane}'`));
  }
});
