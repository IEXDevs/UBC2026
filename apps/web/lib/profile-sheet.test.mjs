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
  assert.match(sheet, /<WalletRoster[\s\S]*handle=\{handle\}/);
  assert.match(sheet, /<WalletPick rows=\{rows\} handle=\{handle\}/);
  assert.match(sheet, /className="wallet-roster-handle">@\{name\}/);
  const logins = readFileSync(new URL('../components/LinkedLogins.js', import.meta.url), 'utf8');
  assert.equal(logins.includes('Add a wallet'), false);
  assert.equal(logins.includes('linkWallet'), false);
  assert.equal(logins.includes('described.wallets'), false);
  const dialog = readFileSync(new URL('../components/CreateBotDialog.js', import.meta.url), 'utf8');
  assert.match(dialog, /className=\{`sheet create-agent/);
  assert.match(dialog, /colorsForPicker\(color, true\)/);
  assert.equal(dialog.includes('More colors'), false);
  assert.match(dialog, /className="create-limits"/);
  assert.match(dialog, /ariaLabel="Spending asset"/);
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.sheet\.create-agent \{[^}]*padding:\s*24px 24px 22px/);
  assert.match(css, /\.create-limits \{[^}]*padding:\s*16px 16px 18px/);
  assert.match(css, /\.create-limits:not\(\[open\]\) > :not\(summary\) \{ display: none; \}/);
  assert.match(dialog, /value: 'USDC'/);
  assert.match(dialog, /value: 'SOL'/);
  assert.equal(dialog.includes('Asset (USDC, SOL, or token mint address)'), false);
  for (const pane of ['assets', 'signin', 'portfolio', 'transfer', 'history', 'keys']) {
    assert.match(sheet, new RegExp(`id: '${pane}'`));
  }
  for (const section of ['send', 'receive', 'swap', 'tokens']) {
    assert.match(sheet, new RegExp(`id: '${section}'`));
  }
  const assets = sheet.slice(sheet.indexOf("pane === 'assets'"), sheet.indexOf("pane === 'signin'"));
  const signin = sheet.slice(sheet.indexOf("pane === 'signin'"), sheet.indexOf("pane === 'portfolio'"));
  assert.equal(assets.includes('LinkedLogins'), false);
  assert.match(signin, /<LinkedLogins/);
  assert.match(sheet, /function ReceivePane\(\{ active, handle \}\)/);
  assert.equal(sheet.includes('SNS name'), false);
  assert.match(sheet, /aria-label="Transfer"/);
});
