import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEV_PREVIEW_OWNER, previewBot, previewPortfolioFor, previewWallets } from './dev-preview.mjs';

/**
 * Achieves: verifies the preview wallet is owner-scoped, read-only, and non-spendable.
 * Fails when: spendable/readOnly flip, ownerId drifts from DEV_PREVIEW_OWNER, or bot id/name change.
 * Oracle: preview fixtures must never authorize spend; bot_preview / Preview are the shell labels.
 * Side effects / state checked: N/A (fixture factories).
 * Gaps: none for fixtures; UI wiring of preview mode is out of scope.
 */
test('the preview wallet is visible and cannot spend', () => {
  const wallets = previewWallets();
  assert.equal(wallets.length, 2);
  assert.equal(wallets[0].ownerId, DEV_PREVIEW_OWNER);
  assert.equal(wallets[0].spendable, false);
  assert.equal(wallets[0].readOnly, true);
  assert.equal(wallets[0].kind, 'main');
  assert.equal(wallets[1].kind, 'additional');
  assert.equal(wallets[1].spendable, false);
  const bot = previewBot();
  assert.equal(bot.id, 'bot_preview');
  assert.equal(bot.name, 'Preview');
  const book = previewPortfolioFor(wallets);
  assert.equal(book.wallets[0].address, wallets[0].address);
  assert.equal(book.authorizesTransaction, false);
});
