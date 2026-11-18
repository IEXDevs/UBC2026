import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isPlaceholderBotId,
  shellConnectors,
  withoutPlaceholderBots,
} from './shell-chrome.mjs';

/**
 * Achieves: verifies only legacy demo bot ids are placeholders and withoutPlaceholderBots strips them from order/extra.
 * Fails when: bot_ada is treated as placeholder or meteora/shop/positions remain after clean.
 * Oracle: bot_meteora/shop/positions true; bot_ada false; cleaned order/extra = ['bot_ada'].
 * Side effects / state checked: N/A.
 * Gaps: does not scan live shell state for leftover demo ids beyond helpers.
 */
test('placeholder bot ids are the old demo rail and nothing else', () => {
  assert.equal(isPlaceholderBotId('bot_meteora'), true);
  assert.equal(isPlaceholderBotId('bot_shop'), true);
  assert.equal(isPlaceholderBotId('bot_positions'), true);
  assert.equal(isPlaceholderBotId('bot_ada'), false);
  const cleaned = withoutPlaceholderBots({
    order: ['bot_meteora', 'bot_ada', 'bot_shop'],
    extra: [
      { id: 'bot_positions', name: 'Position guard' },
      { id: 'bot_ada', name: 'Ada' },
    ],
  });
  assert.deepEqual(cleaned.order, ['bot_ada']);
  assert.deepEqual(cleaned.extra.map(bot => bot.id), ['bot_ada']);
});

/**
 * Achieves: verifies shell connector catalog includes Privy and excludes demo wallet/payment fixtures.
 * Fails when: privy missing or PreviewMain/bot_meteora/pay_ appear in JSON.
 * Oracle: shellConnectors() contains id privy; no demo fixture substrings.
 * Side effects / state checked: N/A.
 * Gaps: catalog content beyond privy/demo absence not enumerated.
 */
test('plugin catalog has no sample wallets or payments', () => {
  const rows = shellConnectors();
  assert.equal(rows.some(row => row.id === 'privy'), true);
  assert.equal(rows.some(row => /PreviewMain|bot_meteora|pay_/.test(JSON.stringify(row))), false);
});

/**
 * Achieves: verifies home page source does not import/render demo shell fixtures.
 * Fails when: getDemoShellState, demoBotExperiences, PreviewMain, bot_meteora, or Sandbox shopper return.
 * Oracle: page.js source string absence checks.
 * Side effects / state checked: app/page.js source text.
 * Gaps: source snapshot only — runtime import graphs not executed.
 */
test('the home shell does not render the demo fixture', () => {
  const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../app/page.js'), 'utf8');
  assert.equal(page.includes('getDemoShellState'), false);
  assert.equal(page.includes('demoBotExperiences'), false);
  assert.equal(page.includes('PreviewMain'), false);
  assert.equal(page.includes('bot_meteora'), false);
  assert.equal(page.includes('Sandbox shopper'), false);
});

/**
 * Achieves: verifies the first-agent create dialog is an opaque viewport cover and neither it nor the page scrolls.
 * Fails when: is-cover drops off the first-agent backdrop, the cover stays translucent, or overflow stays auto.
 * Oracle: CreateBotDialog adds is-cover when first; cover background #141414 and overflow hidden; html/body overflow hidden.
 * Side effects / state checked: CreateBotDialog.js + globals.css source.
 * Gaps: source snapshot only — no browser layout.
 */
test('the first-agent create screen covers the page without scrollbars', () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const dialog = readFileSync(join(root, '../components/CreateBotDialog.js'), 'utf8');
  const css = readFileSync(join(root, '../app/globals.css'), 'utf8');
  assert.match(dialog, /backdrop is-center\$\{first \? ' is-cover' : ''\}/);
  const cover = css.slice(css.indexOf('.backdrop.is-center.is-cover'), css.indexOf('.backdrop.is-corner'));
  assert.match(cover, /\.backdrop\.is-center\.is-cover \{\s*background:\s*#141414;\s*overflow:\s*hidden;/);
  assert.match(cover, /\.backdrop\.is-center\.is-cover > \.create-splash,\s*\.backdrop\.is-center\.is-cover > \.sheet \{\s*overflow:\s*hidden;/);
  assert.match(css, /\.backdrop \{\s*[^}]*background:\s*rgba\(0,\s*0,\s*0,\s*0\.46\)/);
  assert.match(css, /html:has\(\.backdrop\.is-cover\),\s*body:has\(\.backdrop\.is-cover\)\s*\{\s*overflow:\s*hidden;/);
});

/**
 * Achieves: verifies the stage header has no USDC chip, the handle row shows registered holdings, and the detail chip is that agent's wallet.
 * Fails when: the topbar still renders wallet-chip, the detail chip uses the owner glance, or the holdings shortcut is missing.
 * Oracle: topbar has no wallet-chip; AgentDetail keeps wallet-chip; page passes walletBalanceLabel(bot.walletId) and registeredHoldingsLabel.
 * Side effects / state checked: page.js, AgentDetail.js, AccountMenu.js source.
 * Gaps: source snapshot only — no browser layout.
 */
test('the stage header has no USDC chip and the detail chip is the agent wallet', () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(root, '../app/page.js'), 'utf8');
  const detail = readFileSync(join(root, '../components/AgentDetail.js'), 'utf8');
  const menu = readFileSync(join(root, '../components/AccountMenu.js'), 'utf8');
  const topbarStart = page.indexOf('<header className="topbar">');
  const topbar = page.slice(topbarStart, page.indexOf('</header>', topbarStart));
  assert.equal(topbar.includes('wallet-chip'), false);
  assert.match(detail, /className="wallet-chip"/);
  assert.match(page, /walletBalanceLabel\(bot\.walletId, \{ wallets, positions, transfers, bots \}\)/);
  assert.match(page, /holdingsLabel=\{registeredHoldingsLabel\(\{ wallets, positions, transfers, bots \}\)\}/);
  assert.match(menu, /shortcut: one shared USDC book, sum every registered wallet when each wallet stores its own holdings\./);
  assert.match(menu, /className="you-holdings"/);
});

/**
 * Achieves: verifies claim-handle overlay sits outside the fading shell and CSS disables pointer events.
 * Fails when: ClaimHandle/DeskLock move inside shell, is-claim class wiring drops, or opacity/pointer-events rules vanish.
 * Oracle: page markup order ProfileSheet → ClaimHandle/DeskLock; .shell.is-claim opacity 0 + pointer-events none.
 * Side effects / state checked: page.js + globals.css source.
 * Gaps: source snapshot only — no login flow render.
 */
test('claim handle stays outside the shell that fades on first login', () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(root, '../app/page.js'), 'utf8');
  const css = readFileSync(join(root, '../app/globals.css'), 'utf8');
  assert.match(
    page,
    /<ProfileSheet[\s\S]*?\/>\s*<\/div>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?\{setupStep === 'handle' \|\| claimWelcome \? \([\s\S]*?<ClaimHandle[\s\S]*?<DeskLock/,
  );
  assert.match(page, /setupStep === 'handle' \|\| claimWelcome \? ' is-claim'/);
  assert.match(css, /\.shell\.is-claim\s*\{[^}]*opacity:\s*0/);
  assert.match(css, /\.shell\.is-claim\s*\{[^}]*pointer-events:\s*none/);
});
