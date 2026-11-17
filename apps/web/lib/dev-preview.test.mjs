import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEV_PREVIEW_OWNER, previewBot, previewWallets } from './dev-preview.mjs';

/**
 * Achieves: verifies the preview wallet is owner-scoped, read-only, and non-spendable.
 * Fails when: spendable/readOnly flip, ownerId drifts from DEV_PREVIEW_OWNER, or bot id/name change.
 * Oracle: preview fixtures must never authorize spend; bot_preview / Preview are the shell labels.
 * Side effects / state checked: N/A (fixture factories).
 * Gaps: none for fixtures; UI wiring of preview mode is out of scope.
 */
test('the preview wallet is visible and cannot spend', () => {
  const [wallet] = previewWallets();
  assert.equal(wallet.ownerId, DEV_PREVIEW_OWNER);
  assert.equal(wallet.spendable, false);
  assert.equal(wallet.readOnly, true);
  assert.equal(wallet.kind, 'main');
  const bot = previewBot();
  assert.equal(bot.id, 'bot_preview');
  assert.equal(bot.name, 'Preview');
});
