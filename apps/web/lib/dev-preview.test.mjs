import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEV_PREVIEW_OWNER, isPreviewOwnerId } from './dev-preview.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function source(path) {
  return readFileSync(join(root, path), 'utf8');
}

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
  assert.equal((thread.match(/isPreviewOwnerId\(ownerId\)/g) || []).length >= 3, true);

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
