import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEV_PREVIEW_OWNER, isPreviewOwnerId, previewBot, previewPortfolioFor, previewWallets } from './dev-preview.mjs';
import { securityAgent } from './security.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function source(path) {
  return readFileSync(join(root, path), 'utf8');
}

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

test('developer preview shows its draft agent without enabling security controls', () => {
  assert.deepEqual(securityAgent(previewBot()), {
    id: 'bot_preview', name: 'Preview', draft: true, frozen: false, disabled: false,
  });
});

test('only the developer preview owner skips runtime polling', () => {
  assert.equal(isPreviewOwnerId(DEV_PREVIEW_OWNER), true);
  assert.equal(isPreviewOwnerId('did:privy:abc'), false);
  assert.equal(isPreviewOwnerId(''), false);
  assert.equal(isPreviewOwnerId(null), false);
  assert.equal(isPreviewOwnerId(undefined), false);
  assert.equal(isPreviewOwnerId(42), false);
});

test('bot-scoped pollers stay off in the developer preview', () => {
  const thread = source('components/AgentThread.js');
  assert.match(thread, /isPreviewOwnerId/);
  assert.ok((thread.match(/isPreviewOwnerId\(ownerId\)/g) || []).length >= 3);
  for (const path of [
    'components/ComputerSheet.js',
    'components/Composer.js',
    'components/StatisticsSheet.js',
  ]) {
    assert.match(source(path), /isPreviewOwnerId\(ownerId\)/, `${path} must skip preview polling`);
  }
  const logsPanel = source('components/LogsPanel.js');
  assert.ok((logsPanel.match(/isPreviewOwnerId\(ownerId\)/g) || []).length >= 2, 'LogsPanel skips events and activity reads in preview');
});
