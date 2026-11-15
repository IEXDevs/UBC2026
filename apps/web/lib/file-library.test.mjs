import assert from 'node:assert/strict';
import test from 'node:test';
import { fileKind, filterLibrary, libraryGroups } from './file-library.mjs';

test('files sort into media, pages, and everything else', () => {
  assert.equal(fileKind({ name: 'shot.png', type: 'image/png' }), 'media');
  assert.equal(fileKind({ name: 'notes.html', type: 'text/html' }), 'pages');
  assert.equal(fileKind({ name: 'guide.md', type: 'text/markdown' }), 'files');
});

test('this week and older split on the added time', () => {
  const now = Date.parse('2026-11-14T00:00:00Z');
  const groups = libraryGroups([
    { id: 'new', addedAt: now - 60_000 },
    { id: 'old', addedAt: now - 8 * 24 * 60 * 60 * 1000 },
  ], now);
  assert.deepEqual(groups.fresh.map(file => file.id), ['new']);
  assert.deepEqual(groups.older.map(file => file.id), ['old']);
  assert.equal(filterLibrary(groups.fresh, 'media').length, 0);
});
