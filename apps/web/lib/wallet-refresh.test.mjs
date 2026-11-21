import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function source(path) {
  return readFileSync(join(root, path), 'utf8');
}

/**
 * Achieves: verifies wallet balances refresh about every 5 seconds.
 * Fails when: the shell ticker, the SOL balance read, or the portfolio views stop polling.
 * Oracle: page bumps listsTick on a 5000ms timer; solana + portfolio effects listen to it.
 * Side effects / state checked: component source text.
 * Gaps: source snapshot only — no timer execution.
 */
test('wallet balances refresh every 5 seconds', () => {
  const page = source('app/page.js');
  assert.match(page, /WALLET_REFRESH_MS = 5000/);
  assert.match(page, /const refresh = \(\) => setListsTick\(tick => tick \+ 1\)/);
  assert.match(page, /setInterval\(refresh, WALLET_REFRESH_MS\)/);
  assert.match(page, /walletsOpen, listsTick\]\)/);

  const accountValue = source('components/AccountValue.js');
  assert.match(page, /<AccountValue[^\n]+refreshKey=\{\`\$\{listsTick\}/);
  assert.match(accountValue, /refreshPortfolio\.current\?\.\(\);\s*\}, \[refreshKey\]\)/);

  const tokenScreen = source('components/TokenScreen.js');
  assert.match(tokenScreen, /setInterval\(\(\) => setPollTick\(\(tick\) => tick \+ 1\), 5000\)/);
  assert.match(tokenScreen, /refreshKey, pollTick\]/);
});

test('the account total stays visible until an available replacement arrives', () => {
  const accountValue = source('components/AccountValue.js');
  assert.doesNotMatch(accountValue, /setPortfolio\(null\)/);
  assert.match(accountValue, /if \(pending\) return/);
  assert.match(accountValue, /if \(hasAccountValue\(enriched\.portfolio\)\) setPortfolio\(enriched\.portfolio\)/);
});

test('the send pane defines its recipient before deriving the effective asset', () => {
  const sheet = source('components/WalletsSheet.js');
  const sendPane = sheet.slice(sheet.indexOf('function SendPane('));
  const pickedAt = sendPane.indexOf('const picked = destinations.find');
  const targetAt = sendPane.indexOf('const target = picked');
  const effectiveAt = sendPane.indexOf('const effectiveAsset = target');
  assert.ok(pickedAt >= 0 && targetAt > pickedAt && effectiveAt > targetAt);
  assert.match(sendPane, /\/\^\[0-9\]\+\$\/\.test\(units\)/);
  assert.match(sendPane, /\/\^\[0-9\]\+\$\/\.test\(effectiveAsset\.amount\)/);
});

test('the portfolio graph tolerates missing usdMicro values', () => {
  const graph = source('components/PortfolioGraph.js');
  assert.doesNotMatch(graph, /BigInt\(row\.usdMicro\) \* 10000n\) \/ BigInt\(wallet\.totalUsdMicro\)/);
  assert.match(graph, /\/\^\[0-9\]\+\$\/\.test\(row\.usdMicro\)/);
});

test('the send pane keeps the typed amount while balances reload', () => {
  const sheet = source('components/WalletsSheet.js');
  const sendPane = sheet.slice(sheet.indexOf('function SendPane('));
  const effectAt = sendPane.indexOf('const list = Array.isArray(tokens)');
  assert.ok(effectAt >= 0);
  assert.match(sendPane.slice(effectAt), /if \(!list\.length\) return;/);
});

test('the developer preview never polls the runtime', () => {
  const page = source('app/page.js');
  assert.match(page, /if \(!ownerId \|\| devPreview\) \{\s*\n\s*setTransfers\(\[\]\);/);
  assert.match(page, /if \(!ownerId \|\| devPreview\) \{\s*\n\s*setRemoteLists\(emptyMoneyState\(\)\);/);
  assert.match(page, /if \(!ownerId \|\| devPreview\) return undefined;/);
});

test('the developer preview runs on the browser copy without account sync', () => {
  const page = source('app/page.js');
  assert.match(page, /The preview has no account store/);
  assert.match(page, /bindAccountState\(\{\}\);/);
  assert.match(page, /The preview has no directory row/);
});
