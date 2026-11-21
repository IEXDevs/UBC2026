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
