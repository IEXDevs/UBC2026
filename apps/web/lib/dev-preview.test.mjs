import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEV_PREVIEW_OWNER, previewBot, previewWallets } from './dev-preview.mjs';

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
