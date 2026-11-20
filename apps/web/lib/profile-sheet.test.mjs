import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Send recipients do not require signing access and sender copy ends with a period', () => {
  const picker = readFileSync(new URL('../components/SendToField.jsx', import.meta.url), 'utf8');
  const sheet = readFileSync(new URL('../components/WalletsSheet.js', import.meta.url), 'utf8');
  assert.doesNotMatch(picker, /spendable|Read only/);
  assert.match(picker, /if \(!row \|\| row\.disabled \|\| row\.frozen\) return/);
  assert.match(picker, /const locked = row\.disabled \|\| row\.frozen/);
  assert.match(sheet, /const walletReady = target\?\.kind === 'wallet' && !target\.frozen/);
  assert.doesNotMatch(sheet, /target\.spendable/);
  assert.match(sheet, /`From \$\{active\.label\}\.`/);
  assert.match(sheet, /import \{[^}]*\bformatBaseUnits\b[^}]*\} from '\.\.\/lib\/money-views\.mjs'/);
  assert.doesNotMatch(sheet, /fundingMain|!observing &&|A connected wallet sends the selected asset to the main wallet/);
  assert.match(sheet, /connectWallet\(walletConnectionOptions\(wallet\)\)/);
  assert.match(sheet, /WalletConnection key=\{`connection:\$\{active\.id\}`\}/);
  assert.match(sheet, /observing \? 'Linked' : 'Ready'/);
});

/**
 * Achieves: keeps wallet management together without restoring the section sidebar.
 * Fails when: ProfileSheet grows wallet management, or the unified wallet drops an existing capability.
 * Oracle: WalletsSheet retains assets, animated transfers, activity, portfolio, sign-in, tokens, and keys.
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
  for (const section of ['send', 'receive', 'swap']) {
    assert.match(sheet, new RegExp(`id: '${section}'`));
  }
  assert.doesNotMatch(sheet, /const PANES|wallet-nav|pane ===|role="tablist"/);
  for (const component of ['TokenScreen', 'ConnectedPortfolio', 'SendPane', 'ReceivePane', 'JupiterSwap', 'TxnLog', 'TokenPane', 'LinkedLogins', 'PrivyKeyButton']) {
    assert.match(sheet, new RegExp(`<${component}[\\s>]`));
  }
  assert.match(sheet, /onSwap=\{\(symbol, mint\) => \{\s*setSwapMint\(mint \|\|/);
  assert.match(readFileSync(new URL('../components/TokenScreen.js', import.meta.url), 'utf8'), /onSwap\?\.\(holding\?\.symbol, selected\)/);
  assert.match(sheet, /className="wallet-overview"/);
  assert.match(sheet, /<summary>Recent activity/);
  assert.match(sheet, /<summary>Wallet settings/);
  assert.match(sheet, /settingsRef\.current\.open = true/);
  assert.match(sheet, /open=\{open && portfolioOpen\}/);
  assert.match(sheet, /function ReceivePane\(\{ active, handle \}\)/);
  assert.equal(sheet.includes('SNS name'), false);
  assert.match(sheet, /aria-label="Transfer"/);
  assert.match(sheet, /chooseTransfer\(item\.id\)/);
  assert.match(sheet, /<AnimatePresence mode="wait" initial=\{false\}>/);
  assert.match(sheet, /key=\{transfer\}/);
  assert.match(sheet, /ease: TRANSFER_EASE/);
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.wallet-switch button \{[^}]*transition:/);
});

test('unified wallet stays viewport-mounted and resets transfer drafts when the wallet changes', () => {
  const sheet = readFileSync(new URL('../components/WalletsSheet.js', import.meta.url), 'utf8');
  assert.match(sheet, /setRoot\(document\.body\)/);
  assert.match(sheet, /if \(!mounted \|\| !root\) return null/);
  assert.match(sheet, /return createPortal\(/);
  assert.match(sheet, /key=\{`\$\{active\?\.id \|\| 'empty'\}:\$\{transfer\}`\}/);
  assert.match(sheet, /key=\{active\.id\}\s+refreshKey=\{balanceRevision\}/);
  assert.match(sheet, /key=\{balanceRevision\} open=\{open && portfolioOpen\}/);
  assert.match(sheet, /const result = await onSend\?\.\(pending\);\s+if \(result\?\.ok\) setBalanceRevision\(value => value \+ 1\);\s+return result/);
  assert.match(sheet, /onSend=\{send\}/);
  assert.match(sheet, /reduceMotion \? 0 : transferDir/);
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.wallet-overview, \.wallet-settings-grid \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.wallet-body \{[^}]*min-height: 0;[^}]*overflow-y: auto/s);
  assert.equal((css.match(/\.sheet\.wallets-sheet \{/g) || []).length, 3);
  assert.match(css, /\.backdrop\.is-center > \.sheet\.wallets-sheet \{ overflow: hidden/);
  assert.match(css, /\.backdrop\.is-center\.wallet-backdrop \{ overflow: hidden/);
  assert.match(css, /\.wallet-settings \.wallet-add-create \{ flex-wrap: wrap/);
  assert.match(css, /\.wallets-sheet \.field \{ min-width: 0; grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(sheet, /body\.scrollTo\(/);
  assert.doesNotMatch(sheet, /scrollIntoView/);
  assert.match(css, /width: calc\(100vw - 32px\);\s+height: calc\(100dvh - 32px\)/);
  assert.doesNotMatch(css, /\.wallet-nav/);
  assert.match(sheet, /function openParty\(party\) \{\s+if \(!onParty\) return;\s+onClose\(\);\s+onParty\(party\)/);
  assert.equal((sheet.match(/onParty=\{openParty\}/g) || []).length, 2);
  const tokenScreen = readFileSync(new URL('../components/TokenScreen.js', import.meta.url), 'utf8');
  assert.match(tokenScreen, /previewPortfolio = null, refreshKey = 0/);
  assert.match(tokenScreen, /\[open, accounts, getAccessToken, user\?\.id, previewPortfolio, refreshKey\]/);
  assert.match(tokenScreen, /enrichPortfolio\(previewPortfolio, \{ storage: window\.localStorage \}\)/);
  for (const source of [tokenScreen, sheet]) {
    assert.doesNotMatch(source, /rememberPortfolio\(cacheKey, body\)/);
    assert.doesNotMatch(source, /setPortfolio\(body\)/);
  }
});

test('agent creation goes from color straight to USD spending limits', () => {
  const dialog = readFileSync(new URL('../components/CreateBotDialog.js', import.meta.url), 'utf8');
  assert.match(dialog, /className=\{`sheet create-agent/);
  assert.match(dialog, /colorsForPicker\(color, true\)/);
  assert.equal(dialog.includes('More colors'), false);
  assert.match(dialog, /const STEPS = \['name', 'look', 'limits'\]/);
  assert.match(dialog, /step === 'limits' && \(\s+<div className="create-limits"/);
  assert.match(dialog, /draftTransferCap\('USD', total, perTransfer\)/);
  assert.match(dialog, /dollarsToBaseUnits\(maxOutflow\)/);
  assert.doesNotMatch(dialog, /Choose a spending asset|lamports|micro-USDC/);
  assert.doesNotMatch(dialog, /<details/);
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.sheet\.create-agent \{[^}]*padding:\s*24px 24px 22px/);
  assert.match(css, /\.create-limits \{[^}]*padding:\s*16px 16px 18px/);
});
